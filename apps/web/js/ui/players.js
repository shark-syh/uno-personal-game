import { renderCard } from "./hand.js";
import { setViewerSeat } from "../state/viewer.js";
import { restoreEmoteBubbles } from "./emotes.js";

const OPPONENT_HAND_MAX = 5;
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

function renderOpponentHand(player) {
  const visible = Math.min(OPPONENT_HAND_MAX, Math.max(0, Number(player.handCount) || 0));
  if (!visible) return null;
  const stack = document.createElement("div");
  stack.className = "opponent-hand";
  stack.dataset.visible = String(visible);
  stack.dataset.layout = "fan";
  stack.setAttribute("aria-hidden", "true");
  const center = (visible - 1) / 2;
  for (let index = 0; index < visible; index += 1) {
    const card = document.createElement("span");
    card.className = "opponent-hand-card";
    card.style.setProperty("--oh-i", String(index));
    card.style.setProperty("--oh-center", String(center));
    card.style.zIndex = String(index + 1);
    stack.append(card);
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
  root.dataset.count = String(opponents.length);
  root.dataset.seatCount = String(opponents.length);
  root.replaceChildren(...opponents.map((player) => {
    const relative = relativeSeat(player.seat);
    const anchor = seatAnchor(relative, opponents.length);
    const isCurrent = player.seat === view.currentSeat;
    const node = document.createElement("article");
    node.className = `opponent${isCurrent ? " is-current" : ""}`;
    node.dataset.seat = String(player.seat);
    node.dataset.relativeSeat = String(relative);
    node.dataset.handCount = String(player.handCount);
    node.dataset.current = String(isCurrent);
    node.dataset.uno = String(Boolean(player.saidUno));
    node.dataset.thinking = String(Boolean(player.thinking));
    node.style.setProperty("--seat-x", `${anchor.x.toFixed(2)}%`);
    node.style.setProperty("--seat-y", `${anchor.y.toFixed(2)}%`);
    node.style.setProperty("--seat-angle", `${anchor.angle}deg`);
    node.setAttribute("aria-label", `${player.name}，${player.handCount} 张牌`);
    const avatar = document.createElement("span"); avatar.className = "avatar"; avatar.textContent = player.avatar;
    const name = document.createElement("strong"); name.className = "opponent-name"; name.textContent = player.name;
    const meta = document.createElement("span"); meta.className = "opponent-meta"; meta.textContent = `${player.handCount} 张${player.saidUno ? " · UNO" : ""}`;
    node.append(avatar, name, meta);
    const hand = renderOpponentHand(player);
    if (hand) node.append(hand);
    if (player.lastPlayed) node.append(renderCard(player.lastPlayed, { mini: true }));
    if (player.saidUno) { const uno = document.createElement("span"); uno.className = "status-pill"; uno.textContent = "UNO"; node.append(uno); }
    return node;
  }));
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
