import { renderCard } from "./hand.js";

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
  const opponents = view.players.filter((player) => !player.isHuman);
  root.dataset.count = String(opponents.length);
  root.replaceChildren(...opponents.map((player) => {
    const node = document.createElement("article"); node.className = `opponent opponent-seat-${player.seat}${player.seat === view.currentSeat ? " is-current" : ""}`; node.dataset.seat = String(player.seat); node.setAttribute("aria-label", `${player.name}，${player.handCount} 张牌`);
    const avatar = document.createElement("span"); avatar.className = "avatar"; avatar.textContent = player.avatar;
    const name = document.createElement("strong"); name.className = "opponent-name"; name.textContent = player.name;
    const meta = document.createElement("span"); meta.className = "opponent-meta"; meta.textContent = `${player.handCount} 张${player.saidUno ? " · UNO" : ""}`;
    node.append(avatar, name, meta);
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
}
