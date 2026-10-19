import { cardLabel } from "./table.js";

const cardColors = { red: "#ff5555", yellow: "#ffaa00", green: "#55aa55", blue: "#5555ff", null: "#d7193f" };

const HAND_GAP = 10;
const HAND_MIN_REVEAL = 36;
let handLayoutObserver = null;

/**
 * 手牌排布：默认全部排开（不重叠）；数量超出可用宽度时均匀折叠，
 * 每张至少露出 HAND_MIN_REVEAL；仍放不下时由 #hand 横向滚动兜底。
 * 折叠量写入 CSS 变量 --hand-overlap，由 cards.css 的负 margin 实现。
 */
function layoutHand() {
  const root = document.querySelector("#hand");
  if (!root) return;
  const cards = [...root.children].filter((node) => node.classList?.contains("card"));
  if (!cards.length) {
    root.style.setProperty("--hand-gap", `${HAND_GAP}px`);
    root.style.setProperty("--hand-overlap", "0px");
    return;
  }
  const styles = getComputedStyle(root);
  const padding = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
  const available = Math.max(0, root.clientWidth - padding);
  const cardWidth = cards[0].offsetWidth || parseFloat(styles.getPropertyValue("--card-w")) || 120;
  const count = cards.length;
  const needed = count * cardWidth + (count - 1) * HAND_GAP;
  if (needed <= available) {
    root.style.setProperty("--hand-gap", `${HAND_GAP}px`);
    root.style.setProperty("--hand-overlap", "0px");
    return;
  }
  const step = Math.max(HAND_MIN_REVEAL, Math.floor((available - cardWidth) / Math.max(1, count - 1)));
  root.style.setProperty("--hand-gap", "0px");
  root.style.setProperty("--hand-overlap", `${Math.max(0, cardWidth - step)}px`);
}

/** 窗口/容器尺寸变化时重新计算排布（只挂一次） */
function ensureHandLayoutObserver() {
  const root = document.querySelector("#hand");
  if (handLayoutObserver || !root || typeof ResizeObserver !== "function") return;
  handLayoutObserver = new ResizeObserver(() => layoutHand());
  handLayoutObserver.observe(root);
}

export function renderCard(card, { mini = false, legal = false, drawn = false, onSelect = null } = {}) {
  const node = document.createElement(onSelect ? "button" : "div"); if (onSelect) { node.type = "button"; node.disabled = !legal; } node.className = `card${mini ? " mini-card" : ""}${onSelect ? legal ? " is-legal" : " is-illegal" : ""}${drawn ? " is-drawn" : ""}`; node.dataset.cardId = card.id; node.dataset.faceCode = card.faceCode; node.setAttribute("aria-label", cardLabel(card)); node.style.setProperty("--card-color", cardColors[card.color]);
  const image = document.createElement("img"); image.src = `cards/${card.faceCode}.png`; image.alt = cardLabel(card); image.width = 240; image.height = 360; image.draggable = false;
  const fallback = document.createElement("span"); fallback.className = "fallback-label"; fallback.textContent = card.faceCode === "WC" ? "W" : card.faceCode === "W4" ? "+4" : card.faceCode.slice(1);
  image.addEventListener("error", () => { node.classList.add("is-fallback"); image.remove(); node.append(fallback); });
  node.append(image);
  if (onSelect) node.addEventListener("click", onSelect);
  return node;
}

export function renderHand(view, { onAction, openDialog }) {
  const root = document.querySelector("#hand");
  const legal = view.human.legalActions || [];
  // 出牌类动作只承载在「点手牌」路径上（BUG-06：操作栏不再渲染出牌按钮）。
  const cardTypes = ["PLAY_CARD", "PLAY_DRAWN", "STACK_PLAY"];
  const isCardAction = (item) => cardTypes.includes(item.type);
  const playable = legal.filter((item) => isCardAction(item) && !item.disabled);
  const legalIds = new Set(playable.map((item) => item.cardId));
  root.replaceChildren(...view.human.hand.map((card) => renderCard(card, { legal: legalIds.has(card.id), drawn: view.human.drawnThisTurn?.id === card.id, onSelect: () => {
    const actions = playable.filter((item) => item.cardId === card.id);
    if (!actions.length) return;
    if (actions.length > 1 || card.kind === "wild" || card.kind === "wild4") openDialog("color", { cardId: card.id, actions });
    else onAction(actions[0]);
  } })));
  // 操作栏只保留功能动作：摸牌 / 结束回合 / 叠牌弃权 / UNO / 抓 UNO / 选色兜底 / +4 挑战。
  const actionRoot = document.querySelector("#action-bar");
  actionRoot.replaceChildren(...legal.filter((item) => !isCardAction(item)).map((item) => {
    const button = document.createElement("button"); button.type = "button"; button.className = `btn${item.type === "CALL_UNO" ? " uno-button" : ""}`; button.dataset.actionId = item.id; button.textContent = item.label; button.disabled = Boolean(item.disabled); button.setAttribute("aria-label", item.label);
    // UNO 窗口倒计时条：动画关闭 / reduced-motion 时不创建
    if (item.type === "CALL_UNO" && document.documentElement.dataset.animation !== "false" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const countdown = document.createElement("span"); countdown.className = "uno-countdown"; countdown.setAttribute("aria-hidden", "true");
      button.append(countdown);
    }
    button.addEventListener("click", () => {
      if (item.type === "CHOOSE_COLOR") openDialog("color", { actions: legal.filter((candidate) => candidate.type === "CHOOSE_COLOR") });
      // BUG-02：UNO 一击即喊，不再弹二次确认框
      else if (item.type === "CALL_UNO") onAction(item);
      else if (item.type === "CATCH_UNO") openDialog("catch", item, "auto");
      else if (item.type === "CHALLENGE_W4" || item.type === "DECLINE_CHALLENGE") openDialog("challenge", { actions: legal }, "auto");
      else onAction(item);
    });
    return button;
  }));
  ensureHandLayoutObserver();
  layoutHand();
}

export function cardBack() { const wrap = document.createElement("div"); wrap.className = "card card-back"; const image = document.createElement("img"); image.src = "assets/card-back.svg"; image.alt = "抽牌堆"; image.width = 240; image.height = 360; wrap.append(image); return wrap; }
