import { renderCard } from "./hand.js";

/**
 * M5-01：挑战时手牌展示。
 * - 人类挑战 AI 成功：展示被挑战 AI 的完整手牌 2~3 秒（引擎只在"挑战者是人类"时
 *   在 CHALLENGE_SUCCESS 事件里携带手牌；其他人/AI 永远是脱敏事件）。
 * - AI 挑战人类成功：只给一条「AI 查看了你的手牌」提示，不展示任何牌面。
 *
 * 信息展示不依赖动效是否开启：即使关闭动画/减少动态效果，手牌也会静态展示后自动消失
 * （由 animation/queue.js 统一控制时长与输入锁）。
 */
const REVEAL_MS = 2600;

let hideTimer = null;

function seatName(seat) {
  const opponent = document.querySelector(`#opponents .opponent[data-seat="${seat}"] .opponent-name`);
  const text = opponent?.textContent?.trim() || "";
  if (text) return text;
  return seat === 0 ? "你" : "对手";
}

/** 显示人类挑战 AI 成功后的对方手牌（覆盖牌桌，不可交互） */
export function showChallengeHand({ targetSeat, hand, duration = REVEAL_MS } = {}) {
  const overlay = document.querySelector("#challenge-reveal");
  if (!overlay) return;
  clearTimer();
  const cards = Array.isArray(hand) ? hand : [];
  const title = overlay.querySelector("#challenge-reveal-title");
  const body = overlay.querySelector("#challenge-reveal-hand");
  const count = overlay.querySelector("#challenge-reveal-count");
  if (title) title.textContent = `挑战成功：查看 ${seatName(targetSeat)} 的手牌`;
  if (body) body.replaceChildren(...cards.map((card) => renderCard(card)));
  if (count) count.textContent = `${cards.length} 张`;
  overlay.dataset.handCount = String(cards.length);
  overlay.dataset.targetSeat = String(targetSeat ?? "");
  overlay.hidden = false;
  hideTimer = window.setTimeout(() => hideChallengeHand(), duration);
}

/** 隐藏手牌展示（自动到期 / 新渲染 / 新局 / 回大厅都会调用） */
export function hideChallengeHand() {
  clearTimer();
  const overlay = document.querySelector("#challenge-reveal");
  if (!overlay) return;
  overlay.hidden = true;
  overlay.dataset.handCount = "";
  overlay.dataset.targetSeat = "";
  overlay.querySelector("#challenge-reveal-hand")?.replaceChildren();
}

/** AI 挑战人类成功时的提示（不泄露牌面） */
export function showOpponentLookedNotice(seat) {
  const region = document.querySelector("#toast-region");
  if (!region) return;
  region.querySelectorAll('[data-kind="challenge-notice"]').forEach((node) => node.remove());
  const node = document.createElement("div");
  node.className = "toast";
  node.dataset.kind = "challenge-notice";
  node.textContent = `${seatName(seat)} 查看了你的手牌`;
  region.append(node);
  window.setTimeout(() => node.remove(), REVEAL_MS);
}

/** 取消所有展示/提示（回大厅、新局、屏幕切换时兜底） */
export function clearChallengeReveal() {
  hideChallengeHand();
  document
    .querySelectorAll('#toast-region [data-kind="challenge-notice"]')
    .forEach((node) => node.remove());
}

function clearTimer() {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
}
