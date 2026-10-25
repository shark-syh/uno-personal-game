import { cardLabel } from "./table.js";
import { resolveUnoWindowMs, prefersStaticMotion } from "./unoTiming.js";

const cardColors = { red: "#ff5555", yellow: "#ffaa00", green: "#55aa55", blue: "#5555ff", null: "#d7193f" };

const HAND_GAP = 10;
const HAND_MIN_REVEAL = 36;
let handLayoutObserver = null;

// M5：UNO 窗口状态——同一次窗口内重复 render 不重置金色环进度（契约 §7.4）。
// key 由 座位+牌堆规模+弃牌顶 组成：窗口内无人出牌/摸牌，这些值不变；跨窗口必然变化。
let unoWindow = null; // { key, startedAt, windowMs, expired, ticker }

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
  const cardWidth = cards[0].offsetWidth || parseFloat(styles.getPropertyValue("--v2-hand-card-w")) || parseFloat(styles.getPropertyValue("--card-w")) || 120;
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
  const node = document.createElement(onSelect ? "button" : "div"); if (onSelect) { node.type = "button"; node.disabled = !legal; } node.className = `card${mini ? " mini-card" : ""}${onSelect ? legal ? " is-legal" : " is-illegal" : ""}${drawn ? " is-drawn" : ""}`; node.dataset.cardId = card.id; node.dataset.faceCode = card.faceCode; if (onSelect) node.dataset.state = drawn ? "drawn" : legal ? "legal" : "illegal"; node.setAttribute("aria-label", cardLabel(card)); node.style.setProperty("--card-color", cardColors[card.color]);
  const image = document.createElement("img"); image.src = `cards/${card.faceCode}.png`; image.alt = cardLabel(card); image.width = 240; image.height = 360; image.draggable = false;
  const fallback = document.createElement("span"); fallback.className = "fallback-label"; fallback.textContent = card.faceCode === "WC" ? "W" : card.faceCode === "W4" ? "+4" : card.faceCode.slice(1);
  image.addEventListener("error", () => { node.classList.add("is-fallback"); image.remove(); node.append(fallback); });
  node.append(image);
  if (onSelect) node.addEventListener("click", onSelect);
  return node;
}

// M5：窗口标识——同一窗口内稳定、跨窗口必然变化（契约 §7.4 data-window-key）
function unoWindowKey(view) {
  return [
    "uno",
    view.currentSeat,
    view.table?.drawPileCount ?? "?",
    view.table?.discardTop3?.length ?? "?",
    view.table?.discardTop?.faceCode ?? "?",
  ].join("-");
}

/** 环到期（动画 animationend / 静态计时器）：只改 UI 状态，不提交任何动作（契约 §7.5） */
function expireUnoWindow(state, button) {
  // 只有「当前窗口」能到期：避免旧窗口遗留的计时器误伤新窗口
  if (unoWindow !== state || state.expired) return;
  state.expired = true;
  button.dataset.windowState = "expired";
  button.hidden = true;
  const hint = document.querySelector("#hint-bar");
  if (hint) {
    const previous = hint.textContent;
    hint.textContent = "UNO 窗口已结束";
    window.setTimeout(() => {
      if (hint.textContent === "UNO 窗口已结束") hint.textContent = previous;
    }, 1200);
  }
}

/** CALL_UNO 按钮的金色倒计时环 / 静态降级（动画关闭、reduced-motion） */
function attachUnoCountdown(button, view) {
  const windowMs = resolveUnoWindowMs(view.config?.difficulty);
  document.documentElement.style.setProperty("--uno-window-ms", `${windowMs}ms`);
  const key = unoWindowKey(view);
  if (!unoWindow || unoWindow.key !== key) {
    unoWindow = { key, startedAt: performance.now(), windowMs, expired: false, ticker: null };
  } else if (unoWindow.ticker) {
    window.clearInterval(unoWindow.ticker);
    unoWindow.ticker = null;
  }
  // 闭包只捕获本窗口的状态对象：后续 render 替换 unoWindow 后，旧计时器不会改写新窗口
  const state = unoWindow;
  const elapsed = performance.now() - state.startedAt;
  const expired = state.expired || elapsed >= state.windowMs;
  button.dataset.windowState = expired ? "expired" : "open";
  if (expired) {
    button.hidden = true;
    return;
  }
  const countdown = document.createElement("span");
  countdown.className = "uno-countdown uno-ring";
  countdown.dataset.windowKey = key;
  countdown.setAttribute("aria-hidden", "true");
  button.append(countdown);
  if (prefersStaticMotion()) {
    // 静态降级：环静止（纯金边框）+ 文本秒数，不跑动画、不每秒重绘进度
    countdown.classList.add("is-static");
    const seconds = document.createElement("span");
    seconds.className = "uno-seconds";
    seconds.setAttribute("aria-hidden", "true");
    seconds.textContent = `${Math.ceil((state.windowMs - elapsed) / 1000)}s`;
    button.append(seconds);
    state.ticker = window.setInterval(() => {
      const remaining = state.windowMs - (performance.now() - state.startedAt);
      if (remaining <= 0) {
        window.clearInterval(state.ticker);
        state.ticker = null;
        expireUnoWindow(state, button);
        return;
      }
      seconds.textContent = `${Math.ceil(remaining / 1000)}s`;
    }, 250);
  } else {
    // 负 animation-delay 恢复到窗口已流逝的进度：重复 render 不重置环（契约 §7.4 规则 2）
    countdown.style.animationDelay = `-${Math.min(elapsed, state.windowMs)}ms`;
    countdown.addEventListener("animationend", () => expireUnoWindow(state, button), { once: true });
  }
}

export function renderHand(view, { onAction, openDialog }) {
  const root = document.querySelector("#hand");
  const legal = view.human.legalActions || [];
  // M4：悬浮手牌 dock（id 不变，class 供布局/断言使用；不新增可见标题或张数文字）
  document.querySelector("#hand-zone")?.classList.add("hand-dock");
  root.dataset.count = String(view.human.hand.length);
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
  // M5 契约 §7.2：UNO 按钮只在「1 张 + uno-window + canCallUno + CALL_UNO 合法」同时成立时渲染；
  // 抓 UNO 只在 CATCH_UNO 合法且 canCatch 非空时渲染；两者不得同时出现（引擎侧保证互斥）。
  const unoVisible =
    view.phase === "uno-window" && view.human.hand.length === 1 && view.human.canCallUno === true;
  const catchVisible = (view.human.canCatch || []).length > 0;
  // 渲染前先停掉上一窗口/上一次渲染的静态计时器（按钮节点会被整体重建）
  if (unoWindow?.ticker) {
    window.clearInterval(unoWindow.ticker);
    unoWindow.ticker = null;
  }
  // 窗口已关闭时清掉窗口状态，避免 key 复用读到过期进度
  if (view.phase !== "uno-window") unoWindow = null;
  // 操作栏只保留功能动作：摸牌 / 结束回合 / 叠牌弃权 / UNO / 抓 UNO / 选色兜底 / +4 挑战。
  const actionRoot = document.querySelector("#action-bar");
  actionRoot.dataset.phase = view.phase || "";
  actionRoot.replaceChildren(...legal.filter((item) => !isCardAction(item)).filter((item) => {
    if (item.type === "CALL_UNO") return unoVisible;
    if (item.type === "CATCH_UNO") return catchVisible;
    return true;
  }).map((item) => {
    const isUno = item.type === "CALL_UNO";
    const button = document.createElement("button"); button.type = "button"; button.className = `btn${isUno ? " uno-button" : ""}`; button.dataset.actionId = item.id; button.textContent = item.label; button.disabled = Boolean(item.disabled); button.setAttribute("aria-label", isUno ? "喊 UNO" : item.label);
    // M5：金色倒计时环（动画关闭 / reduced-motion 时为静态金环 + 文本秒数）
    if (isUno) attachUnoCountdown(button, view);
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
