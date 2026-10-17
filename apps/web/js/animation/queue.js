import { hideChallengeHand, showChallengeHand, showOpponentLookedNotice } from "../ui/challengeReveal.js";

/** M5-01：挑战成功展示对方手牌的时长（2~3 秒，展示期间保持输入锁） */
const CHALLENGE_REVEAL_MS = 2600;

let timer = null;
let completion = null;
let disabledStates = [];

function lockInput() {
  document.querySelector("#game-screen")?.setAttribute("aria-busy", "true");
  document.querySelector("#action-bar")?.setAttribute("aria-disabled", "true");
  disabledStates = [...document.querySelectorAll("#action-bar button, #hand button, #dialog-root button[data-action-id]")].map((node) => [node, node.disabled]);
  disabledStates.forEach(([node]) => { node.disabled = true; });
}

/** 当前事件是否携带"人类挑战 AI 成功"的完整手牌快照 */
function isChallengeHandEvent(event) {
  return event?.type === "CHALLENGE_SUCCESS" && Array.isArray(event.hand);
}

/** 清理当前播放的定时器与临时禁用状态（不触发完成回调） */
function clearRun() {
  clearTimeout(timer);
  timer = null;
  hideChallengeHand();
  document.querySelector("#game-screen")?.removeAttribute("aria-busy");
  document.querySelector("#action-bar")?.removeAttribute("aria-disabled");
  disabledStates.forEach(([node, disabled]) => { node.disabled = disabled; });
  disabledStates = [];
}

/** 播放完成：清理并通知调用方 */
function finish() {
  const done = completion;
  completion = null;
  clearRun();
  done?.();
}

/** 取消当前播放：只清理，不触发完成回调（避免引擎把"被新渲染打断"误当成"动画已播完"） */
export function cancelEvents() {
  completion = null;
  clearRun();
}

export function playEvents(events = [], done = () => {}) {
  cancelEvents();
  completion = done;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animationOff = document.documentElement.dataset.animation === "false";
  const revealEvent = events.find(isChallengeHandEvent);
  if (reduced || animationOff) {
    // 信息展示不因关闭动效而丢失：静态展示后自动消失，期间同样锁输入
    if (revealEvent) {
      lockInput();
      showChallengeHand({ targetSeat: revealEvent.target, hand: revealEvent.hand, duration: CHALLENGE_REVEAL_MS });
      timer = window.setTimeout(() => {
        hideChallengeHand();
        finish();
      }, CHALLENGE_REVEAL_MS);
      return;
    }
    finish();
    return;
  }
  if (!events.length) {
    finish();
    return;
  }
  lockInput();
  let index = 0;
  const next = () => {
    if (index >= events.length) {
      finish();
      return;
    }
    const event = events[index];
    index += 1;
    let delay = 200;
    if (isChallengeHandEvent(event)) {
      // 人类挑战 AI 成功：展示对方手牌 2~3 秒，期间输入保持锁定
      showChallengeHand({ targetSeat: event.target, hand: event.hand, duration: CHALLENGE_REVEAL_MS });
      delay = CHALLENGE_REVEAL_MS;
    } else if (event.type === "CHALLENGE_SUCCESS" && event.target === 0) {
      // AI 挑战人类成功：只提示「查看了你的手牌」，不展示牌面
      showOpponentLookedNotice(event.challenger);
    }
    timer = window.setTimeout(next, delay);
  };
  next();
}
