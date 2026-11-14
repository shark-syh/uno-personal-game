import { cardLabel } from "./table.js";
import { resolveUnoWindowMs, prefersStaticMotion } from "./unoTiming.js";
import { cardResource } from "../state/modePreference.js";

const cardColors = { red: "#ff5555", yellow: "#ffaa00", green: "#55aa55", blue: "#5555ff", null: "#d7193f" };

// M4：当前渲染所用的卡面资源模式（由 render() 每次从 view.mode 同步）。
// classic → cards/{短码}.png（原 54 张 CC0 零改动）；mercy → cards-mercy/{B 版 slug}.webp。
let cardResourceMode = "classic";
export function setCardResourceMode(mode) {
  cardResourceMode = mode === "mercy" ? "mercy" : "classic";
}

/** 图片缺失时的文字牌面：mercy 的 faceCode 是 B 版 slug，不能沿用 classic 的 slice(1) 短码逻辑 */
function fallbackLabel(card) {
  if (cardResourceMode !== "mercy") {
    return card.faceCode === "WC" ? "W" : card.faceCode === "W4" ? "+4" : card.faceCode.slice(1);
  }
  if (card.kind === "number") return String(card.value ?? "?");
  const labels = {
    draw2: "+2", draw4: "+4", draw6: "+6", draw10: "+10",
    skip: "跳过", reverse: "反转", skipEveryone: "全跳", discardAll: "全弃",
    wildReverseDraw4: "反转+4", wildColorRoulette: "轮盘",
  };
  return labels[card.kind] || card.kind;
}

const HAND_GAP = 10;
const HAND_MIN_REVEAL = 36;
let handLayoutObserver = null;

// U3：空格 = 点击「当前主操作按钮」。不新增动作语义、不自己调 onAction，
// 而是复用按钮自身的 click 监听，因此 UiAction、事件队列、aria-busy 输入锁与鼠标点击逐项一致；
// 出牌仍只点手牌（空格落不到手牌上），Tab → Enter 路径不变。
let spaceShortcutInstalled = false;
function installSpaceShortcut() {
  if (spaceShortcutInstalled) return;
  spaceShortcutInstalled = true;
  document.addEventListener("keydown", (event) => {
    const isSpace = event.code === "Space" || event.key === " " || event.key === "Spacebar";
    if (!isSpace || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const active = document.activeElement;
    // 输入框 / 房间码 / 弹窗内不接管：保留原生输入与弹窗键盘操作
    if (active?.matches?.("input, textarea, select, [contenteditable]") || active?.closest?.("#dialog-root")) return;
    if (document.querySelector("#dialog-root.is-open")) return;
    if (!document.querySelector("#game-screen.is-active")) return;
    // 手牌坞以外的按钮（顶栏等）保留浏览器原生空格激活，不破坏键盘可达性
    if (active?.matches?.("button, a, [role='button']") && !active.closest("#hand-zone")) return;
    // 阻止页面滚动，同时阻止焦点所在按钮的原生空格点击（避免空格代劳出牌）
    event.preventDefault();
    const primary = document.querySelector("#action-bar button[data-primary]:not(:disabled)");
    if (primary) primary.click();
  }, true);
}

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
  const resource = cardResource(cardResourceMode);
  const image = document.createElement("img"); image.src = `${resource.dir}/${card.faceCode}.${resource.ext}`; image.alt = cardLabel(card); image.width = 240; image.height = 360; image.draggable = false;
  const fallback = document.createElement("span"); fallback.className = "fallback-label"; fallback.textContent = fallbackLabel(card);
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
  installSpaceShortcut();
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
  const functional = legal.filter((item) => !isCardAction(item)).filter((item) => {
    if (item.type === "CALL_UNO") return unoVisible;
    if (item.type === "CATCH_UNO") return catchVisible;
    // M4 友尽：4 个轮盘选色 / N-1 个换手目标改由自动弹窗承载，不挤 44px 细轨
    if (item.type === "SWAP_HANDS" || item.type === "CHOOSE_ROULETTE_COLOR") return false;
    return true;
  });
  // U3：当前主操作 = 动作条里第一个可用功能按钮（常规回合即「摸牌」，摸牌后即「结束回合」）。
  // 空格只点它，长条主色 + aria-keyshortcuts 只是可发现性提示，不改变点击路径。
  const primaryIndex = functional.findIndex((item) => !item.disabled);
  actionRoot.replaceChildren(...functional.map((item, index) => {
    const isUno = item.type === "CALL_UNO";
    const button = document.createElement("button"); button.type = "button"; button.className = `btn${isUno ? " uno-button" : ""}`; button.dataset.actionId = item.id; button.textContent = item.label; button.disabled = Boolean(item.disabled); button.setAttribute("aria-label", isUno ? "喊 UNO" : item.label);
    if (index === primaryIndex) {
      button.dataset.primary = "true";
      button.setAttribute("aria-keyshortcuts", "Space");
      if (!isUno) button.classList.add("btn-primary");
    }
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
