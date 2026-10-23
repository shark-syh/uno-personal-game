import { renderCard } from "./hand.js";
import { setViewerSeat } from "../state/viewer.js";
import { restoreEmoteBubbles } from "./emotes.js";

const OPPONENT_HAND_MAX = 5;

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
  const total = view.players.length;
  // 对手座位框按「相对视角座位的距离」套用 opponent-seat-N 布局类（单机 viewer=0 时与绝对座位一致），
  // data-seat 仍保留真实座位号，供动效落点 / 挑战展示 / 台词气泡按座位查找。
  const relativeSeat = (seat) => (seat - viewer + total) % Math.max(total, 1);
  const opponents = view.players.filter((player) => player.seat !== viewer);
  root.dataset.count = String(opponents.length);
  root.replaceChildren(...opponents.map((player) => {
    const node = document.createElement("article"); node.className = `opponent opponent-seat-${relativeSeat(player.seat)}${player.seat === view.currentSeat ? " is-current" : ""}`; node.dataset.seat = String(player.seat); node.dataset.handCount = String(player.handCount); node.setAttribute("aria-label", `${player.name}，${player.handCount} 张牌`);
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
