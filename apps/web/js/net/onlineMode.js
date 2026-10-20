/**
 * M8 客户端联机：M8-01 入口与房间 + M8-02 服务端视图渲染 + M8-03 再来一局 +
 * M8-04 AI 补位选择 + M8-06 断线重连（token 存 sessionStorage，自动恢复座位）。
 *
 * 职责：
 * - 大厅「局域网联机」区块：创建房间 / 输房间码加入（显示名可选，默认「你」）；
 * - 房间面板：房间码、座位列表（房主/断线标记）、AI 补位、房主开始按钮；
 * - 对局阶段：不再本地 applyAction，改为把 UI 动作上行到服务端，
 *   渲染服务端按座位下发的 GameView（复用现有渲染层与事件动画）；
 * - 断线自动重连（最多 3 次），页面刷新后凭 sessionStorage 静默恢复。
 *
 * M9-02：服务端每个权威步骤都会广播一次视图（AI 补位、断线顶替同样如此）。
 * 客户端把视图按到达顺序排队，逐条「渲染 + 播事件动画」；否则后一条视图的
 * render 会立刻 cancelEvents，导致 AI 连续行动时只剩最后一步的动效可见。
 */
import { toEngineAction } from "../vendor/uno-engine.js";
import { getSettings } from "../state/settings.js";
import { playEvents } from "../animation/queue.js";
import {
  initEmotes,
  setEmoteEnabled,
  setEmoteSelfSeat,
  handleEmoteBroadcast,
  startEmoteCooldown,
  restoreEmoteBubbles,
} from "../ui/emotes.js";

let socket = null;
let joined = null; // { code, seat, token }
let lastRoom = null;
let inGame = false;
let toast = (message) => console.log(`[uno-online] ${message}`);
let exitToEngineLobby = () => {};
// M8-06 重连状态：手动退出不打重连；rejoin 待确认期间收到 error = 凭证失效
let manualExit = false;
let rejoinPending = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
const MAX_RECONNECT_ATTEMPTS = 3;

/** M9-02：服务端视图队列（逐条渲染 + 播动画，保证 AI 连动/代打时每一步都可见） */
let viewQueue = [];
let processingView = false;
let viewGeneration = 0;

function resetViewQueue() {
  viewGeneration += 1;
  viewQueue = [];
  processingView = false;
}

const $ = (selector) => document.querySelector(selector);

function persistSession() {
  if (!joined) return;
  try { sessionStorage.setItem("uno:online", JSON.stringify(joined)); } catch { /* 隐私模式忽略 */ }
}

function clearSession() {
  try { sessionStorage.removeItem("uno:online"); } catch { /* 忽略 */ }
}

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

/** 当前房主选择的 AI 补位数（选择器不可见时为 0） */
function showAiCount() {
  const aiRow = $("#room-ai-row");
  if (!aiRow || aiRow.hidden) return 0;
  return Number($("#room-ai-count")?.value || "0");
}

function renderRoom(room) {
  lastRoom = room;
  $("#room-code").textContent = room.code;
  const list = $("#room-players");
  list.replaceChildren(...room.players.map((player) => {
    const item = document.createElement("li");
    item.className = "room-player";
    item.dataset.seat = String(player.seat);
    const badges = [];
    if (player.seat === room.hostSeat) badges.push("房主");
    if (joined && player.seat === joined.seat) badges.push("我");
    if (!player.connected) badges.push("已掉线");
    item.innerHTML = `<span class="room-seat">${player.seat + 1}P</span><span class="room-name"></span><span class="room-badges">${badges.join(" · ")}</span>`;
    item.querySelector(".room-name").textContent = player.name;
    return item;
  }));
  // M9-03：房间列表重渲染后补回未过期的表情气泡
  restoreEmoteBubbles();
  const isHost = joined && joined.seat === room.hostSeat;
  // M8-04 AI 补位：房主在大厅可选补几个 AI（开局人数 = 真人 + AI）
  const aiRow = $("#room-ai-row");
  const aiSelect = $("#room-ai-count");
  if (aiRow && aiSelect) {
    const showAi = Boolean(isHost) && room.status === "lobby";
    aiRow.hidden = !showAi;
    if (showAi) {
      const maxAi = 10 - room.players.length;
      const prev = Number(aiSelect.value || "0");
      aiSelect.replaceChildren(...Array.from({ length: maxAi + 1 }, (_, n) => {
        const option = document.createElement("option");
        option.value = String(n);
        option.textContent = n === 0 ? "不补位" : `+${n} 个 AI`;
        return option;
      }));
      aiSelect.value = String(Math.min(prev, maxAi));
    }
  }
  const aiCount = showAiCount();
  const canStart = isHost && room.status === "lobby" && room.players.length + aiCount >= 2;
  $("#room-start").hidden = !canStart;
  // 自己的当前名字回填到改名框（正聚焦输入时不打扰）
  const nameInput = $("#room-name-input");
  if (nameInput && joined && document.activeElement !== nameInput) {
    nameInput.value = room.players[joined.seat]?.name ?? "";
  }
  const status = $("#room-status");
  if (room.status === "playing") status.textContent = "对局进行中…";
  else if (room.status === "ended") status.textContent = "对局已结束，可离开房间";
  else if (isHost) status.textContent = room.players.length + aiCount >= 2 ? "人齐了就开始吧" : "至少 2 人才能开始（可加 AI 补位）";
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
  resetViewQueue();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    socket.onclose = null;
    try { socket.close(); } catch { /* 忽略 */ }
  }
  socket = null;
  joined = null;
  lastRoom = null;
  inGame = false;
  rejoinPending = false;
  reconnectAttempts = 0;
}

/** 离开联机模式：恢复单机引擎大厅 */
function exitOnline() {
  manualExit = true;
  clearSession();
  closeSocket();
  setEmoteEnabled(false);
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

/** 服务端下发视图：排队，逐条渲染 + 播事件动画（事件已按本座位脱敏） */
function onView(view) {
  if (!inGame) {
    inGame = true;
    // 与单机一致的 UNO 窗口倒计时条时长（窗口服务端的开启/关闭由状态机裁决）
    document.documentElement.style.setProperty("--uno-window-ms", "4000ms");
    window.UnoApp.setActionHandler(handleOnlineAction);
  }
  viewQueue.push(decorate(view));
  processViewQueue();
}

/**
 * 处理队首视图：渲染后用事件动画的完成回调驱动下一条。
 * 动画期间（及队列未清空时）拒绝上行动作，避免基于过期画面操作。
 */
function processViewQueue() {
  if (processingView) return;
  const next = viewQueue.shift();
  if (!next) return;
  const generation = viewGeneration;
  processingView = true;
  window.UnoApp.render(next);
  playEvents(next.events || [], () => {
    if (generation !== viewGeneration) return;
    processingView = false;
    // 放到下一轮宏任务，给浏览器一次绘制机会，也避免无事件视图递归过深
    if (viewQueue.length > 0) window.setTimeout(processViewQueue, 0);
  });
}

function handleOnlineAction(action) {
  if (!action || typeof action.type !== "string") return;
  // 视图还在播放/排队：画面不是最新权威状态，先不接受操作
  if (processingView || viewQueue.length > 0) return;
  if (action.type === "BACK_TO_LOBBY") {
    exitOnline();
    return;
  }
  if (action.type === "RESTART") {
    // M8-03 再来一局：由服务端裁决（仅房主、对局结束后），非房主会收到错误提示
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "rematch" }));
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
    const wasRejoin = rejoinPending;
    joined = { code: message.room.code, seat: message.seat, token: message.token };
    rejoinPending = false;
    reconnectAttempts = 0;
    persistSession();
    setEmoteSelfSeat(message.seat);
    setEmoteEnabled(true);
    renderRoom(message.room);
    showRoomPanel();
    if (wasRejoin) toast("已重连，恢复你的座位");
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
  if (message.type === "emote") {
    handleEmoteBroadcast(message.seat, message.emoji);
    return;
  }
  if (message.type === "error") {
    // 重连被服务端拒绝（房间没了/凭证失效）：清理会话回单机大厅
    if (rejoinPending) {
      toast(message.message || "重连失败，请重新加入");
      exitOnline();
      return;
    }
    // M9-03：服务端限频（客户端本地计数被绕过时兜底）
    if (message.code === "EMOTE_RATE_LIMITED") startEmoteCooldown();
    toast(message.message || "联机操作失败");
  }
}

/** 建立 WS 连接（创建/加入/重连共用）；断线时若已进房则自动尝试重连 */
function connectRaw(next) {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
  socket = ws;
  ws.onmessage = handleMessage;
  ws.onopen = () => next(ws);
  ws.onclose = () => {
    if (manualExit || !joined) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(attemptReconnect, 800);
  };
  ws.onerror = () => {
    if (!joined) toast("连不上联机服务，请确认是通过 npm start 打开的页面");
  };
}

/** 断线重连：凭 sessionStorage 的 (code, token) 恢复原座位，最多尝试 MAX_RECONNECT_ATTEMPTS 次 */
function attemptReconnect() {
  if (manualExit || !joined) return;
  reconnectAttempts += 1;
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    toast("重连失败，已回到单机大厅");
    exitOnline();
    return;
  }
  const session = joined;
  connectRaw((ws) => {
    rejoinPending = true;
    ws.send(JSON.stringify({ type: "rejoin", code: session.code, token: session.token }));
  });
}

function connect(next) {
  if (socket) closeSocket();
  manualExit = false;
  connectRaw(next);
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
  initEmotes({
    toast,
    send: (emoji) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "emote", emoji }));
    },
  });
  $("#online-create")?.addEventListener("click", createRoom);
  $("#online-join")?.addEventListener("click", joinRoom);
  $("#room-start")?.addEventListener("click", () => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "start-game", aiCount: showAiCount() }));
    }
  });
  // AI 补位选择变化会改变「开始」可用性，立刻重渲房间面板
  $("#room-ai-count")?.addEventListener("change", () => {
    if (lastRoom) renderRoom(lastRoom);
  });
  // M8-06 页面刷新恢复：有未退出的联机会话时静默尝试重连
  try {
    const saved = JSON.parse(sessionStorage.getItem("uno:online") || "null");
    if (saved && typeof saved.code === "string" && typeof saved.token === "string") {
      joined = saved;
      setEmoteSelfSeat(saved.seat);
      setEmoteEnabled(true);
      connectRaw((ws) => {
        rejoinPending = true;
        ws.send(JSON.stringify({ type: "rejoin", code: saved.code, token: saved.token }));
      });
    }
  } catch { /* 损坏的会话数据忽略 */ }
  $("#room-leave")?.addEventListener("click", () => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "leave-room" }));
    exitOnline();
  });
  const saveName = () => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    const value = ($("#room-name-input")?.value || "").trim();
    if (!value) {
      toast("名字不能为空");
      return;
    }
    socket.send(JSON.stringify({ type: "rename", name: value }));
    $("#room-name-input")?.blur();
  };
  $("#room-name-save")?.addEventListener("click", saveName);
  $("#room-name-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveName();
  });
}
