import { renderCard } from "./hand.js";
import { setViewerSeat } from "../state/viewer.js";
import { restoreEmoteBubbles } from "./emotes.js";

const OPPONENT_HAND_MAX = 5;
/** M2（契约 §2.1）：≥10 张进入「满堆」样式（卡背间距收密 + 徽标高亮） */
const OPPONENT_HAND_FULL = 10;
/** M2（契约 §2.2）：数量变化动效的单次时长上限；实际时长走 --v2-dur-base（180ms） */
const HAND_FX_MS = 260;
/**
 * M2：上一次 render 的对手手牌数（座位 → 张数），用于 data-hand-count diff 驱动一次性动效。
 * 进入对局/切屏时由 render.js 调 resetOpponentHandCounts() 清空——首帧与换局不播数量变化。
 */
const lastHandCounts = new Map();

/** 清空手牌数基线（新对局 / 从大厅、结算页进入牌桌时调用） */
export function resetOpponentHandCounts() {
  lastHandCounts.clear();
  delete document.documentElement.dataset.handFx;
}

function motionOff() {
  return (
    document.documentElement.dataset.animation === "false" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * M2：数量变化一次性反馈（契约 §2.2）。
 * - 卡背张数增加：最顶卡背 180ms 推入（scale 0.8→1 + 位移）；
 * - 卡背张数减少：被移除的顶牌克隆 180ms 弹出淡出后移除；
 * - 张数封顶在 5 张时（6→7、10→9 等）：用溢出徽标的一次性 bump / 淡出表达数量变化；
 * - 动画关闭 / reduced-motion：不加任何动效节点与 class（静态降级）。
 * 触发由 render 前的张数快照 diff 决定，重复 render（张数不变）不会重播。
 * @returns {"enter"|"leave"|"badge-up"|"badge-leave"|null}
 */
function applyHandCountFx(stack, previousCount, { visible, overflow }) {
  if (previousCount === undefined) return null;
  const previousVisible = Math.min(OPPONENT_HAND_MAX, Math.max(0, previousCount));
  const previousOverflow = Math.max(0, previousCount - OPPONENT_HAND_MAX);
  if (visible > previousVisible) {
    const top = [...stack.querySelectorAll(".opponent-hand-card")].at(-1);
    if (top) top.classList.add("is-enter");
    return "enter";
  }
  if (visible < previousVisible) {
    const ghost = document.createElement("span");
    ghost.className = "opponent-hand-card is-leave";
    ghost.style.setProperty("--oh-i", String(previousVisible - 1));
    ghost.style.setProperty("--oh-center", String((previousVisible - 1) / 2));
    ghost.style.zIndex = String(previousVisible + 1);
    ghost.setAttribute("aria-hidden", "true");
    stack.append(ghost);
    window.setTimeout(() => ghost.remove(), HAND_FX_MS);
    return "leave";
  }
  if (overflow > 0) {
    const badge = stack.querySelector(".opponent-hand-overflow");
    if (badge) {
      badge.classList.add("is-bump");
      window.setTimeout(() => badge.classList.remove("is-bump"), HAND_FX_MS);
      return "badge-up";
    }
    return null;
  }
  if (previousOverflow > 0) {
    const ghost = document.createElement("span");
    ghost.className = "opponent-hand-overflow is-leave";
    ghost.textContent = `+${previousOverflow}`;
    ghost.setAttribute("aria-hidden", "true");
    stack.append(ghost);
    window.setTimeout(() => ghost.remove(), HAND_FX_MS);
    return "badge-leave";
  }
  return null;
}
// M3：圆周座位锚点角度表（CSS 角度：0°=右，90°=下；覆盖 1~9 个对手，N 为 10 人局上限）。
// 相对座位 1 从玩家左侧开始顺时针；JS 只负责把角度换算成 --seat-x/--seat-y，CSS 只消费。
const SEAT_ANGLES = {
  1: [270],
  2: [210, 330],
  3: [180, 270, 360],
  4: [160, 220, 320, 380],
  5: [150, 210, 270, 330, 390],
  6: [150, 198, 246, 294, 342, 390],
  7: [150, 190, 230, 270, 310, 350, 390],
  8: [150, 184, 219, 254, 286, 321, 356, 390],
  // 10 人局：r4/r6 从 240/300 收拢到 245/295，配合 --v2-seat-w 104px（layout.css），
  // 避免中窄牌桌（≤1199）上「左列夹紧座位 ↔ 斜上座位 ↔ 顶部中央座位」三盒角部重叠。
  9: [150, 180, 210, 245, 270, 295, 330, 360, 390],
};

function seatAnchor(relativeSeat, opponentCount) {
  const table = SEAT_ANGLES[opponentCount] || SEAT_ANGLES[9];
  const angle = table[relativeSeat - 1] ?? 270;
  const rad = (angle * Math.PI) / 180;
  return { angle, x: 50 + 46 * Math.cos(rad), y: 50 + 40 * Math.sin(rad) };
}

/**
 * M2（契约 §2.1）：卡背 N 张分档 + 溢出徽标。
 * 渲染张数仍封顶 5：1~5 张逐张、6~9 张 5 张 + 「+N」徽标、≥10 张 5 张 + 徽标 + .is-full。
 * 精确牌数只由座位文本/aria-label 提供，徽标与卡背同为 aria-hidden 装饰层。
 * @param {object} player 公开视图里的对手（只消费 handCount）
 * @param {number|undefined} previousCount 上一次 render 的该座位手牌数（diff 基线）
 * @param {string[]} fx 本次 render 触发的数量变化动效收集器（seat:kind）
 */
function renderOpponentHand(player, previousCount, fx) {
  const count = Math.max(0, Number(player.handCount) || 0);
  const visible = Math.min(OPPONENT_HAND_MAX, count);
  if (!visible) return null;
  const overflow = Math.max(0, count - OPPONENT_HAND_MAX);
  const stack = document.createElement("div");
  stack.className = "opponent-hand";
  stack.dataset.visible = String(visible);
  stack.dataset.overflow = String(overflow);
  stack.dataset.layout = "fan";
  stack.setAttribute("aria-hidden", "true");
  if (count >= OPPONENT_HAND_FULL) stack.classList.add("is-full");
  const center = (visible - 1) / 2;
  for (let index = 0; index < visible; index += 1) {
    const card = document.createElement("span");
    card.className = "opponent-hand-card";
    card.style.setProperty("--oh-i", String(index));
    card.style.setProperty("--oh-center", String(center));
    card.style.zIndex = String(index + 1);
    stack.append(card);
  }
  if (overflow > 0) {
    const badge = document.createElement("span");
    badge.className = "opponent-hand-overflow";
    badge.textContent = `+${overflow}`;
    badge.setAttribute("aria-hidden", "true");
    stack.append(badge);
  }
  if (previousCount !== undefined && previousCount !== count && !motionOff()) {
    const kind = applyHandCountFx(stack, previousCount, { visible, overflow });
    if (kind) fx.push(`${player.seat}:${kind}`);
  }
  return stack;
}

/**
 * BUG-04：AI 台词 TTL 到期时只清对应座位的气泡文本。
 * 这里刻意不做整页 render：避免把玩家刚打开的设置/战绩弹窗关掉，
 * 也避免打断正在播放的事件动画（render 会 cancelEvents）。
 */
export function clearPlayerLine(seat) {
  const root = document.querySelector("#speech-layer");
  if (!root || seat === null || seat === undefined) return;
  const bubble = root.querySelector(`[data-seat="${seat}"]`);
  if (!bubble) return;
  bubble.textContent = "";
}

/** 清空 speech-layer 内所有座位的气泡文本（新局 / 回大厅 / 退出引擎模式时调用） */
export function clearAllLines() {
  const root = document.querySelector("#speech-layer");
  if (!root) return;
  root.querySelectorAll("[data-seat]").forEach((bubble) => {
    bubble.textContent = "";
  });
}

export function renderPlayers(view) {
  const root = document.querySelector("#opponents");
  const speechRoot = document.querySelector("#speech-layer");
  // M9-02：以「视角座位」区分自己与对手，而不是 isHuman——联机模式下所有玩家
  // 在服务端都是 isHuman=true，自己的座位由 view.human.seat 给出。
  const viewer = view.human?.seat ?? 0;
  setViewerSeat(viewer);
  const gameScreen = document.querySelector("#game-screen");
  if (gameScreen) gameScreen.dataset.viewerSeat = String(viewer);
  const total = view.players.length;
  // M3：座位按「相对视角座位的距离」计算圆周锚点（相对座位 1 = 玩家左侧），
  // data-seat 仍保留真实座位号，供动效落点 / 挑战展示 / 台词气泡按座位查找。
  const relativeSeat = (seat) => (seat - viewer + total) % Math.max(total, 1);
  const opponents = view.players.filter((player) => player.seat !== viewer);
  // M2：对比上一次 render 的张数快照（进入对局时已由 render.js 重置基线）——diff 驱动一次性动效
  const previousHandCounts = new Map(lastHandCounts);
  const handFx = [];
  root.dataset.count = String(opponents.length);
  root.dataset.seatCount = String(opponents.length);
  root.replaceChildren(...opponents.map((player) => {
    const relative = relativeSeat(player.seat);
    const anchor = seatAnchor(relative, opponents.length);
    const isCurrent = player.seat === view.currentSeat;
    const handCount = Math.max(0, Number(player.handCount) || 0);
    const node = document.createElement("article");
    node.className = `opponent${isCurrent ? " is-current" : ""}`;
    node.dataset.seat = String(player.seat);
    node.dataset.relativeSeat = String(relative);
    node.dataset.handCount = String(handCount);
    node.dataset.current = String(isCurrent);
    node.dataset.uno = String(Boolean(player.saidUno));
    node.dataset.thinking = String(Boolean(player.thinking));
    node.style.setProperty("--seat-x", `${anchor.x.toFixed(2)}%`);
    node.style.setProperty("--seat-y", `${anchor.y.toFixed(2)}%`);
    node.style.setProperty("--seat-angle", `${anchor.angle}deg`);
    node.setAttribute("aria-label", `${player.name}，${handCount} 张牌`);
    const avatar = document.createElement("span"); avatar.className = "avatar"; avatar.textContent = player.avatar;
    const name = document.createElement("strong"); name.className = "opponent-name"; name.textContent = player.name;
    const meta = document.createElement("span"); meta.className = "opponent-meta"; meta.textContent = `${handCount} 张${player.saidUno ? " · UNO" : ""}`;
    node.append(avatar, name, meta);
    const hand = renderOpponentHand(player, previousHandCounts.get(player.seat), handFx);
    if (hand) node.append(hand);
    if (player.lastPlayed) node.append(renderCard(player.lastPlayed, { mini: true }));
    if (player.saidUno) { const uno = document.createElement("span"); uno.className = "status-pill"; uno.textContent = "UNO"; node.append(uno); }
    return node;
  }));
  // 动效收集器同时作为 verify-ui 的观测点；无动效时移除属性，重复 render 可断言「不重播」
  if (handFx.length) document.documentElement.dataset.handFx = handFx.join(",");
  else delete document.documentElement.dataset.handFx;
  lastHandCounts.clear();
  for (const player of opponents) {
    lastHandCounts.set(player.seat, Math.max(0, Number(player.handCount) || 0));
  }
  speechRoot.replaceChildren(...opponents.map((player) => {
    const bubble = document.createElement("span");
    bubble.dataset.seat = String(player.seat);
    bubble.className = player.thinking ? "opponent-line thinking" : "opponent-line";
    bubble.textContent = player.thinking
      ? `${player.name}：思考中`
      : view.settings?.aiChatter !== false && player.line
        ? `${player.name}：“${player.line}”`
        : "";
    return bubble;
  }));
  // M9-03：视图重渲染会清空座位框，未过期的表情气泡需要补回
  restoreEmoteBubbles();
}
