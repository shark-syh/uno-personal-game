import { cardBack, renderCard } from "../ui/hand.js";
import { getSettings } from "../state/settings.js";

/**
 * M6-01：事件动效（只动画 transform/opacity，纯 CSS/Web Animations，无第三方依赖）。
 *
 * 所有效果都由 `animation/queue.js` 的事件队列串行调用：
 * `applyEventEffect(event)` 立即创建临时 DOM 并返回本次效果的时长（ms），
 * 队列据此决定事件之间的停留时间；`cleanupEffects()` 在队列结束/被打断时兜底清理。
 *
 * 10 人局性能策略：飞牌类效果按事件类型有数量上限（AI 座位 DEAL 最多 3 张、
 * 摸牌最多 6 张等），总元素数受控，避免 60+ 同时动画导致掉帧。
 */

const timers = [];

function later(fn, ms) {
  timers.push(window.setTimeout(fn, ms));
}

function clearLater() {
  for (const id of timers) window.clearTimeout(id);
  timers.length = 0;
}

function layer() {
  let node = document.querySelector("#effect-layer");
  if (!node) {
    node = document.createElement("div");
    node.id = "effect-layer";
    node.setAttribute("aria-hidden", "true");
    document.body.append(node);
  }
  return node;
}

function centerOf(node) {
  if (!node || typeof node.getBoundingClientRect !== "function") {
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }
  const rect = node.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function seatAnchor(seat) {
  if (Number(seat) === 0) return centerOf(document.querySelector("#hand"));
  const node = document.querySelector(`#opponents .opponent[data-seat="${Number(seat)}"]`);
  return node ? centerOf(node) : centerOf(document.querySelector("#table-center"));
}

function drawAnchor() {
  return centerOf(document.querySelector("#draw-pile"));
}

function discardAnchor() {
  return centerOf(document.querySelector("#discard-pile"));
}

/**
 * 动画速度系数：设置页「动画速度」fast → ×0.55；`?slow=1` 调试模式 → ×2.2。
 * 队列基础节奏（200ms/事件）也通过 `motionFactor()` 使用同一系数。
 */
export function motionFactor() {
  const settings = getSettings();
  let value = settings.animationSpeed === "fast" ? 0.55 : 1;
  try {
    if (new URLSearchParams(window.location.search).get("slow") === "1") value *= 2.2;
  } catch {
    /* ignore */
  }
  return value;
}

function factor() {
  return motionFactor();
}

function scaled(ms) {
  return Math.max(60, Math.round(ms * factor()));
}

/** 飞牌：从 from 飞到 to 的临时卡牌，结束后自动移除 */
function flyCard(from, to, { card = null, faceDown = false, duration = 260, delay = 0, spin = 0 } = {}) {
  if (!from || !to) return 0;
  const node = document.createElement("div");
  node.className = "fx-card";
  node.append(faceDown || !card ? cardBack() : renderCard(card));
  node.style.left = `${from.x}px`;
  node.style.top = `${from.y}px`;
  layer().append(node);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const animation = node.animate(
    [
      { transform: "translate(-50%, -50%) scale(.55)", opacity: 0.95 },
      {
        transform: `translate(calc(-50% + ${Math.round(dx * 0.72)}px), calc(-50% + ${Math.round(dy * 0.72)}px)) scale(.72) rotate(${Math.round(spin * 0.5)}deg)`,
        opacity: 1,
        offset: 0.72,
      },
      {
        transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.9) rotate(${spin}deg)`,
        opacity: 0.9,
      },
    ],
    {
      duration: scaled(duration),
      delay: scaled(delay),
      easing: "cubic-bezier(.2,.72,.25,1)",
      fill: "both",
    },
  );
  animation.onfinish = () => node.remove();
  later(() => node.remove(), duration + delay + 260);
  return duration + delay;
}

function pulse(node, duration = 260) {
  if (!node) return;
  node.classList.remove("fx-pulse");
  // 强制重排以便连续触发同一动画
  void node.offsetWidth;
  node.classList.add("fx-pulse");
  later(() => node.classList.remove("fx-pulse"), scaled(duration) + 30);
}

function shake(node, duration = 280) {
  if (!node) return;
  node.classList.remove("fx-seat-shake");
  void node.offsetWidth;
  node.classList.add("fx-seat-shake");
  later(() => node.classList.remove("fx-seat-shake"), scaled(duration) + 30);
}

function popBadge(text, at, { danger = false, duration = 340 } = {}) {
  const node = document.createElement("div");
  node.className = `fx-badge${danger ? " is-danger" : ""}`;
  node.textContent = text;
  node.style.left = `${at.x}px`;
  node.style.top = `${at.y - 34}px`;
  layer().append(node);
  node.animate(
    [
      { transform: "translate(-50%, -50%) scale(.7)", opacity: 0 },
      { transform: "translate(-50%, -80%) scale(1.06)", opacity: 1, offset: 0.45 },
      { transform: "translate(-50%, -120%) scale(1)", opacity: 0 },
    ],
    { duration: scaled(duration), easing: "ease-out", fill: "both" },
  ).onfinish = () => node.remove();
  later(() => node.remove(), duration + 200);
  return duration;
}

function popBanner(text, at, { danger = false, duration = 420 } = {}) {
  const node = document.createElement("div");
  node.className = "fx-banner";
  node.textContent = text;
  if (danger) {
    node.style.borderColor = "rgba(255, 150, 150, .9)";
    node.style.background = "linear-gradient(135deg, #ffd0d0, #ff6b6b 60%, #d32f2f)";
    node.style.color = "#2a0a0a";
    node.style.boxShadow = "0 0 30px rgba(255, 80, 80, .8)";
  }
  node.style.left = `${at.x}px`;
  node.style.top = `${at.y}px`;
  layer().append(node);
  node.animate(
    [
      { transform: "translate(-50%, -50%) scale(.5) rotate(-6deg)", opacity: 0 },
      { transform: "translate(-50%, -50%) scale(1.18) rotate(2deg)", opacity: 1, offset: 0.38 },
      { transform: "translate(-50%, -50%) scale(1) rotate(0deg)", opacity: 1, offset: 0.72 },
      { transform: "translate(-50%, -62%) scale(1.04)", opacity: 0 },
    ],
    { duration: scaled(duration), easing: "ease-out", fill: "both" },
  ).onfinish = () => node.remove();
  later(() => node.remove(), duration + 220);
  return duration;
}

function flash(duration = 320) {
  const node = document.createElement("div");
  node.className = "fx-flash";
  layer().append(node);
  node.animate([{ opacity: 0.34 }, { opacity: 0 }], {
    duration: scaled(duration),
    easing: "ease-out",
    fill: "both",
  }).onfinish = () => node.remove();
  later(() => node.remove(), duration + 220);
  return duration;
}

function confetti(count = 24) {
  const colors = ["#ff5555", "#ffaa00", "#55aa55", "#5555ff", "#ffffff", "#ffd86b"];
  const travel = window.innerHeight + 48;
  for (let index = 0; index < count; index += 1) {
    const node = document.createElement("div");
    node.className = "fx-confetti";
    node.style.background = colors[index % colors.length];
    node.style.left = `${Math.round(Math.random() * (window.innerWidth - 12))}px`;
    // 从屏幕最顶部开始，完整飘到屏幕最底部再消失
    node.style.top = "-24px";
    layer().append(node);
    const drift = Math.round((Math.random() - 0.5) * 200);
    const duration = 1200 + Math.round(Math.random() * 700);
    node.animate(
      [
        { transform: "translate(0, 0) rotate(0deg)", opacity: 1 },
        { offset: 0.82, transform: `translate(${Math.round(drift * 0.8)}px, ${Math.round(travel * 0.82)}px) rotate(${Math.round(220 + Math.random() * 220)}deg)`, opacity: 1 },
        { transform: `translate(${drift}px, ${travel}px) rotate(${Math.round(420 + Math.random() * 300)}deg)`, opacity: 0 },
      ],
      { duration: scaled(duration), delay: scaled(index * 22), easing: "linear", fill: "both" },
    ).onfinish = () => node.remove();
    later(() => node.remove(), duration + index * 22 + 400);
  }
  return 1200;
}

/**
 * 清理动效层与临时定时器（队列结束 / 被打断 / 屏幕切换时调用）。
 * `keepConfetti`：正常播放完成时保留彩带，让它从屏幕顶部自然飘到底部
 * （结算页彩带需要完整飘落；新渲染/取消时才强制清掉）。
 */
export function cleanupEffects({ keepConfetti = false } = {}) {
  const root = document.querySelector("#effect-layer");
  if (!keepConfetti) {
    clearLater();
    if (root) root.querySelectorAll(".fx-card, .fx-badge, .fx-banner, .fx-flash, .fx-confetti").forEach((node) => node.remove());
  } else if (root) {
    root.querySelectorAll(".fx-card, .fx-badge, .fx-banner, .fx-flash").forEach((node) => node.remove());
  }
  document
    .querySelectorAll(".fx-seat-shake, .fx-pulse")
    .forEach((node) => node.classList.remove("fx-seat-shake", "fx-pulse"));
}

/** 某个事件对应的一次动效；返回停留时长（ms），0 表示无需停留 */
export function applyEventEffect(event) {
  if (!event || !event.type) return 0;
  document.documentElement.dataset.lastEffect = event.type;
  switch (event.type) {
    case "DEAL": {
      const count = Number(event.count) || 0;
      const seat = Number(event.seat);
      const target = seatAnchor(seat);
      const from = drawAnchor();
      const visible = Math.max(1, Math.min(count, seat === 0 ? 7 : 3));
      for (let index = 0; index < visible; index += 1) {
        flyCard(from, target, { faceDown: true, duration: 230, delay: index * 34 });
      }
      return (visible - 1) * 34 + 230 + 40;
    }
    case "PLAY": {
      const ms = flyCard(seatAnchor(event.seat), discardAnchor(), {
        card: event.card || null,
        duration: 250,
        spin: 10,
      });
      later(() => pulse(document.querySelector("#discard-pile"), 240), scaled(ms) - 80);
      return ms + 60;
    }
    case "DRAW":
    case "PENALTY": {
      const count = Number(event.count) || 0;
      if (count <= 0) return 0;
      const seat = Number(event.seat);
      const target = seatAnchor(seat);
      const from = drawAnchor();
      const faceUp = seat === 0 && Array.isArray(event.cards) && event.cards.length > 0;
      const cards = faceUp ? event.cards : null;
      const visible = Math.max(1, Math.min(count, faceUp ? 6 : 5));
      for (let index = 0; index < visible; index += 1) {
        flyCard(from, target, {
          card: cards ? cards[index % cards.length] : null,
          faceDown: !cards,
          duration: 220,
          delay: index * 42,
        });
      }
      return (visible - 1) * 42 + 220 + 40;
    }
    case "SKIP": {
      const seat = document.querySelector(`#opponents .opponent[data-seat="${Number(event.seat)}"]`);
      shake(seat);
      popBadge("跳过", seatAnchor(event.seat), { danger: true });
      return 320;
    }
    case "REVERSE": {
      const direction = document.querySelector("#direction-indicator");
      const tableDirection = document.querySelector("#table-direction");
      for (const node of [direction, tableDirection]) {
        if (!node) continue;
        node.animate(
          [
            { transform: "rotate(0deg) scale(1)" },
            { transform: "rotate(180deg) scale(1.22)", offset: 0.6 },
            { transform: "rotate(180deg) scale(1)" },
          ],
          { duration: scaled(320), easing: "ease-in-out", fill: "both" },
        );
      }
      return 340;
    }
    case "COLOR_SET": {
      pulse(document.querySelector("#color-glow"), 300);
      return 280;
    }
    case "STACK_PUSH": {
      pulse(document.querySelector("#stack-badge"), 260);
      return 260;
    }
    case "STACK_RESOLVE": {
      const total = Math.max(0, Math.min(Number(event.total) || 0, 10));
      const from = discardAnchor();
      const target = seatAnchor(event.seat);
      for (let index = 0; index < total; index += 1) {
        flyCard(from, target, { faceDown: true, duration: 200, delay: index * 36 });
      }
      return Math.max(240, (total - 1) * 36 + 200 + 40);
    }
    case "CHALLENGE_SUCCESS": {
      if (Array.isArray(event.hand)) return 0; // 手牌展示覆盖层由 challengeReveal 处理
      shake(document.querySelector(`#opponents .opponent[data-seat="${Number(event.challenger)}"]`));
      popBadge("挑战成功", seatAnchor(event.target));
      return 320;
    }
    case "CHALLENGE_FAIL": {
      shake(document.querySelector(`#opponents .opponent[data-seat="${Number(event.challenger)}"]`));
      flash(300);
      popBadge("挑战失败", seatAnchor(event.challenger), { danger: true });
      return 420;
    }
    case "UNO_CALLED": {
      const center = centerOf(document.querySelector("#table-center"));
      popBanner("UNO!", center);
      pulse(document.querySelector(`#opponents .opponent[data-seat="${Number(event.seat)}"]`), 300);
      return 440;
    }
    case "UNO_CAUGHT": {
      const center = centerOf(document.querySelector("#table-center"));
      popBanner("抓到了!", center, { danger: true });
      shake(document.querySelector(`#opponents .opponent[data-seat="${Number(event.seat)}"]`));
      return 400;
    }
    case "PLAYER_OUT": {
      const seat = document.querySelector(`#opponents .opponent[data-seat="${Number(event.seat)}"]`);
      if (seat) {
        pulse(seat, 320);
        popBadge("出完了", seatAnchor(event.seat));
      }
      return 320;
    }
    case "ROUND_END": {
      if (event.winnerSeat !== null && event.winnerSeat !== undefined) confetti();
      return event.winnerSeat === null ? 280 : 600;
    }
    case "PILE_RESHUFFLE": {
      shake(document.querySelector("#draw-pile"), 300);
      return 300;
    }
    default:
      return 0;
  }
}
