/**
 * M9-03：联机预置表情（纯 emoji）。
 *
 * - 只在联机房间内启用（大厅等待 + 对局中）；单机模式不显示入口；
 * - 发送者座位由 onlineMode 在 joined 时告知；收到广播后：
 *   自己的座位 → toast 提示；其他座位 → 在对应对手框 / 房间列表行弹气泡；
 * - 本地做 5 条 + 2 秒冷却的按钮禁用提示，服务端仍会做同样的权威限频；
 * - 气泡状态存在模块内，players.js / renderRoom 重渲染后调用 restoreEmoteBubbles()
 *   把未过期的气泡补回 DOM（否则每来一条服务端视图就会把气泡清掉）。
 */

/** 与服务端 protocol.ts 的 EMOTE_EMOJIS 保持一致 */
const EMOJIS = ["😂", "😭", "😡", "😎", "🤡", "💀", "👍", "👎", "🔥", "🎉", "🙈", "🫠"];
const BURST = 5;
const COOLDOWN_MS = 2000;
const BUBBLE_MS = 2200;

let enabled = false;
let selfSeat = -1;
let sendEmoji = () => {};
let toast = (message) => console.log(`[uno-emote] ${message}`);
let roomToggle = null;
let gameToggle = null;
let picker = null;
let anchor = null;
let optionButtons = [];
let burstLeft = BURST;
let cooldownUntil = 0;
let tickTimer = null;

const bubbles = new Map();

const $ = (selector) => document.querySelector(selector);

function isCooling() {
  return Date.now() < cooldownUntil;
}

function closePicker() {
  if (picker) picker.hidden = true;
  anchor = null;
}

function positionPicker() {
  if (!picker || !anchor) return;
  const rect = anchor.getBoundingClientRect();
  picker.style.left = "0px";
  picker.style.top = "0px";
  const width = picker.offsetWidth;
  const height = picker.offsetHeight;
  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - width - 8));
  let top = rect.bottom + 8;
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 8);
  picker.style.left = `${Math.round(left)}px`;
  picker.style.top = `${Math.round(top)}px`;
}

function updateCooldownUi() {
  const cooling = isCooling();
  const label = cooling ? `冷却 ${Math.ceil((cooldownUntil - Date.now()) / 1000)}s` : "表情";
  for (const button of [roomToggle, gameToggle]) {
    if (!button) continue;
    button.disabled = cooling;
    button.textContent = label;
  }
  for (const button of optionButtons) button.disabled = cooling || !enabled;
}

function startCooldown(ms = COOLDOWN_MS) {
  closePicker();
  cooldownUntil = Date.now() + ms;
  if (tickTimer) clearInterval(tickTimer);
  const tick = () => {
    if (Date.now() >= cooldownUntil) {
      cooldownUntil = 0;
      burstLeft = BURST;
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = null;
    }
    updateCooldownUi();
  };
  tick();
  tickTimer = setInterval(tick, 200);
}

/** 服务端返回限频错误时，客户端同步进入冷却（秒数由错误信息提示） */
export function startEmoteCooldown(ms = COOLDOWN_MS) {
  startCooldown(ms);
}

function consumeLocalBudget() {
  if (isCooling() || burstLeft <= 0) return false;
  burstLeft -= 1;
  if (burstLeft <= 0) startCooldown();
  return true;
}

function openPicker(button) {
  if (!enabled) return;
  if (isCooling()) {
    toast("表情冷却中，请稍后再试");
    return;
  }
  if (picker && !picker.hidden && anchor === button) {
    closePicker();
    return;
  }
  anchor = button;
  picker.hidden = false;
  positionPicker();
  updateCooldownUi();
}

function pickEmoji(emoji) {
  if (!enabled) return;
  if (!consumeLocalBudget()) {
    toast("表情冷却中，请稍后再试");
    return;
  }
  sendEmoji(emoji);
}

function removeBubbleNode(seat) {
  document.querySelectorAll(`.emote-bubble[data-seat="${seat}"]`).forEach((node) => node.remove());
}

function paintBubble(seat) {
  const entry = bubbles.get(seat);
  if (!entry || Date.now() >= entry.expiresAt) return;
  removeBubbleNode(seat);
  const host =
    $(`#opponents .opponent[data-seat="${seat}"]`) ||
    $(`#room-players .room-player[data-seat="${seat}"]`);
  if (!host) return;
  const bubble = document.createElement("span");
  bubble.className = "emote-bubble";
  bubble.dataset.seat = String(seat);
  bubble.textContent = entry.emoji;
  host.append(bubble);
}

function showBubble(seat, emoji) {
  const previous = bubbles.get(seat);
  if (previous?.timer) clearTimeout(previous.timer);
  const expiresAt = Date.now() + BUBBLE_MS;
  const timer = window.setTimeout(() => {
    bubbles.delete(seat);
    removeBubbleNode(seat);
  }, BUBBLE_MS);
  bubbles.set(seat, { emoji, expiresAt, timer });
  paintBubble(seat);
}

/** 重渲染后把未过期气泡补回 DOM（players.js / onlineMode.renderRoom 调用） */
export function restoreEmoteBubbles() {
  for (const [seat, entry] of bubbles) {
    if (Date.now() >= entry.expiresAt) {
      if (entry.timer) clearTimeout(entry.timer);
      bubbles.delete(seat);
      removeBubbleNode(seat);
      continue;
    }
    paintBubble(seat);
  }
}

function clearBubbles() {
  for (const entry of bubbles.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  bubbles.clear();
  document.querySelectorAll(".emote-bubble").forEach((node) => node.remove());
}

/** 收到服务端表情广播：自己 → toast，其他座位 → 座位框气泡 */
export function handleEmoteBroadcast(seat, emoji) {
  if (!enabled) return;
  if (seat === selfSeat) {
    toast(`你：${emoji}`);
    return;
  }
  showBubble(seat, emoji);
}

export function setEmoteSelfSeat(seat) {
  selfSeat = Number.isInteger(seat) && seat >= 0 ? seat : -1;
}

/** 进入/离开联机模式时开关表情入口（单机不显示） */
export function setEmoteEnabled(value) {
  const next = Boolean(value);
  if (next === enabled) return;
  enabled = next;
  if (roomToggle) roomToggle.hidden = !next;
  if (gameToggle) gameToggle.hidden = !next;
  if (!next) {
    closePicker();
    clearBubbles();
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    cooldownUntil = 0;
    burstLeft = BURST;
  }
  updateCooldownUi();
}

/** 由 app.js 启动时调用一次；send 负责把 emoji 上行给服务端 */
export function initEmotes(options = {}) {
  if (typeof options.send === "function") sendEmoji = options.send;
  if (typeof options.toast === "function") toast = options.toast;

  roomToggle = $("#room-emote-toggle");
  gameToggle = $("#game-emote-toggle");
  picker = $("#emote-picker");
  if (!picker) return;

  optionButtons = EMOJIS.map((emoji) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "emote-option";
    button.textContent = emoji;
    button.setAttribute("aria-label", `发送表情 ${emoji}`);
    button.addEventListener("click", () => pickEmoji(emoji));
    return button;
  });
  picker.replaceChildren(...optionButtons);

  roomToggle?.addEventListener("click", () => openPicker(roomToggle));
  gameToggle?.addEventListener("click", () => openPicker(gameToggle));

  document.addEventListener("click", (event) => {
    if (!picker || picker.hidden) return;
    if (picker.contains(event.target) || roomToggle?.contains(event.target) || gameToggle?.contains(event.target)) return;
    closePicker();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePicker();
  });
  window.addEventListener("resize", closePicker);
  window.addEventListener("scroll", closePicker, true);

  updateCooldownUi();
}
