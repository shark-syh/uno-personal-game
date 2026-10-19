/**
 * M8-01 客户端联机入口 + M8-02 最小联机路径（垂直切片：双客户端同局）。
 *
 * 职责：
 * - 大厅「局域网联机」区块：创建房间 / 输房间码加入（显示名可选，默认「你」）；
 * - 房间面板：房间码、座位列表（房主/断线标记）、房主开始按钮；
 * - 对局阶段：不再本地 applyAction，改为把 UI 动作上行到服务端，
 *   渲染服务端按座位下发的 GameView（复用现有渲染层与事件动画）。
 *
 * 后续里程碑：M8-03 联机模式细节打磨（UNO 倒计时同步、挑战展示等）、
 * M8-04 服务端 AI 补位、M8-06 token 重连恢复（token 已存 sessionStorage）。
 */
import { toEngineAction } from "../vendor/uno-engine.js";
import { getSettings } from "../state/settings.js";
import { playEvents } from "../animation/queue.js";

let socket = null;
let joined = null; // { code, seat, token }
let lastRoom = null;
let inGame = false;
let toast = (message) => console.log(`[uno-online] ${message}`);
let exitToEngineLobby = () => {};

const $ = (selector) => document.querySelector(selector);

let lanUrls = [];
/** 从 /api/health 取本机局域网地址（缓存一次；失败静默，不影响游戏） */
function loadLanUrls() {
  if (lanUrls.length > 0) return Promise.resolve(lanUrls);
  return fetch("/api/health")
    .then((res) => res.json())
    .then((data) => { lanUrls = data.lanUrls || []; return lanUrls; })
    .catch(() => []);
}

function displayName() {
  const value = $("#online-name")?.value.trim() || "";
  return value.slice(0, 12) || "你";
}

function showRoomPanel() {
  $("#single-panel").hidden = true;
  $("#room-panel").hidden = false;
}

function showSinglePanel() {
  $("#room-panel").hidden = true;
  $("#single-panel").hidden = false;
}

function renderRoom(room) {
  lastRoom = room;
  $("#room-code").textContent = room.code;
  const list = $("#room-players");
  list.replaceChildren(...room.players.map((player) => {
    const item = document.createElement("li");
    item.className = "room-player";
    const badges = [];
    if (player.seat === room.hostSeat) badges.push("房主");
    if (joined && player.seat === joined.seat) badges.push("我");
    if (!player.connected) badges.push("已掉线");
    item.innerHTML = `<span class="room-seat">${player.seat + 1}P</span><span class="room-name"></span><span class="room-badges">${badges.join(" · ")}</span>`;
    item.querySelector(".room-name").textContent = player.name;
    return item;
  }));
  const isHost = joined && joined.seat === room.hostSeat;
  const canStart = isHost && room.status === "lobby" && room.players.length >= 2;
  $("#room-start").hidden = !canStart;
  const status = $("#room-status");
  if (room.status === "playing") status.textContent = "对局进行中…";
  else if (room.status === "ended") status.textContent = "对局已结束，可离开房间";
  else if (isHost) status.textContent = room.players.length >= 2 ? "人齐了就开始吧" : "至少 2 人才能开始（AI 补位后续版本提供）";
  else status.textContent = "等待房主开始…";
  // 房主视角的大厅提示：直接给出「好友该打开的地址 + 房间码」
  const invite = $("#room-invite");
  if (!invite) return;
  if (room.status !== "lobby") { invite.hidden = true; return; }
  loadLanUrls().then((urls) => {
    if (!urls.length || !joined || room.code !== joined.code) return;
    invite.textContent = `其他设备请打开 ${urls[0]} 并输入房间码 ${room.code} 加入`;
    invite.hidden = false;
  });
}

function closeSocket() {
  if (socket) {
    socket.onclose = null;
    try { socket.close(); } catch { /* 忽略 */ }
  }
  socket = null;
  joined = null;
  lastRoom = null;
  inGame = false;
}

/** 离开联机模式：恢复单机引擎大厅 */
function exitOnline() {
  closeSocket();
  window.UnoApp.setActionHandler(null);
  showSinglePanel();
  exitToEngineLobby();
}

function decorate(view) {
  view.mock = false;
  view.settings = getSettings();
  if (!view.dev) view.dev = {};
  return view;
}

/** 服务端下发视图：渲染 + 播事件动画（事件已按本座位脱敏） */
function onView(view) {
  if (!inGame) {
    inGame = true;
    // 与单机一致的 UNO 窗口倒计时条时长（窗口服务端的开启/关闭由状态机裁决）
    document.documentElement.style.setProperty("--uno-window-ms", "4000ms");
    window.UnoApp.setActionHandler(handleOnlineAction);
  }
  const decorated = decorate(view);
  window.UnoApp.render(decorated);
  playEvents(decorated.events || []);
}

function handleOnlineAction(action) {
  if (!action || typeof action.type !== "string") return;
  if (action.type === "BACK_TO_LOBBY") {
    exitOnline();
    return;
  }
  if (action.type === "RESTART") {
    toast("联机对局暂不支持「再来一局」，请回大厅重新组房");
    return;
  }
  if (action.type === "START_GAME") return; // 联机开局只走房间面板按钮
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  let engineAction;
  try {
    engineAction = toEngineAction(action);
  } catch (error) {
    console.error("[uno-online] 无法识别的 UI 动作", action, error);
    return;
  }
  socket.send(JSON.stringify({ type: "action", action: engineAction }));
}

function handleMessage(event) {
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
  if (message.type === "joined") {
    joined = { code: message.room.code, seat: message.seat, token: message.token };
    try { sessionStorage.setItem("uno:online", JSON.stringify(joined)); } catch { /* 隐私模式忽略 */ }
    renderRoom(message.room);
    showRoomPanel();
    return;
  }
  if (message.type === "room") {
    renderRoom(message.room);
    return;
  }
  if (message.type === "view") {
    onView(message.view);
    return;
  }
  if (message.type === "error") {
    toast(message.message || "联机操作失败");
    if (message.code === "ROOM_NOT_FOUND" || message.code === "ROOM_ALREADY_PLAYING") {
      // 加入失败：保持在大厅联机区块，不进房间
    }
  }
}

function connect(next) {
  if (socket) closeSocket();
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
  socket.onmessage = handleMessage;
  socket.onopen = () => next(socket);
  socket.onclose = () => {
    if (!joined) return; // 尚未进房（连接失败等）
    toast("已断开联机连接，回到单机大厅");
    exitOnline();
  };
  socket.onerror = () => {
    if (!joined) toast("连不上联机服务，请确认是通过 npm start 打开的页面");
  };
}

function createRoom() {
  connect((ws) => ws.send(JSON.stringify({ type: "create-room", name: displayName() })));
}

function joinRoom() {
  const code = ($("#online-code")?.value || "").trim().toUpperCase();
  if (!/^[A-Z2-9]{4,6}$/.test(code)) {
    toast("请输入正确的房间码（4~6 位字母数字）");
    return;
  }
  connect((ws) => ws.send(JSON.stringify({ type: "join-room", code, name: displayName() })));
}

/** 由 app.js 在启动时调用一次：绑定联机区块按钮 */
export function initOnlineMode(options = {}) {
  if (typeof options.toast === "function") toast = options.toast;
  if (typeof options.onExit === "function") exitToEngineLobby = options.onExit;
  $("#online-create")?.addEventListener("click", createRoom);
  $("#online-join")?.addEventListener("click", joinRoom);
  $("#room-start")?.addEventListener("click", () => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "start-game" }));
  });
  $("#room-leave")?.addEventListener("click", () => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "leave-room" }));
    exitOnline();
  });
}
