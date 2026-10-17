import { applyEventEffect, cleanupEffects, motionFactor } from "./effects.js";
import { playSfxForEvent } from "../audio/sfx.js";
import { hideChallengeHand, showChallengeHand, showOpponentLookedNotice } from "../ui/challengeReveal.js";

/** M5-01：挑战成功展示对方手牌的时长（2~3 秒，展示期间保持输入锁） */
const CHALLENGE_REVEAL_MS = 2600;
/** 事件队列基础节奏（无额外动效时每条事件 200ms，M3-2 起的约定） */
const BASE_EVENT_MS = 200;

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

/** AI 挑战人类成功：只提示，不展示牌面（M5-01） */
function isAiLookedEvent(event) {
  return event?.type === "CHALLENGE_SUCCESS" && !Array.isArray(event.hand) && event.target === 0;
}

/** 清理当前播放的定时器与临时禁用状态（不触发完成回调） */
function clearRun() {
  clearTimeout(timer);
  timer = null;
  cleanupEffects();
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
  // M6-05：基础节奏跟随动画速度设置（fast/正常）与 ?slow=1 调试模式
  const baseEventMs = Math.max(90, Math.round(BASE_EVENT_MS * motionFactor()));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animationOff = document.documentElement.dataset.animation === "false";
  const revealEvent = events.find(isChallengeHandEvent);
  if (reduced || animationOff) {
    // 关闭动效时：音效仍按事件播放（受设置开关控制）；挑战手牌展示保留（信息不因动效关闭而丢失）
    events.forEach((event) => {
      playSfxForEvent(event);
      if (isAiLookedEvent(event)) showOpponentLookedNotice(event.challenger);
    });
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
    playSfxForEvent(event);
    let delay = baseEventMs;
    if (isChallengeHandEvent(event)) {
      // 人类挑战 AI 成功：展示对方手牌 2~3 秒，期间输入保持锁定
      showChallengeHand({ targetSeat: event.target, hand: event.hand, duration: CHALLENGE_REVEAL_MS });
      delay = CHALLENGE_REVEAL_MS;
    } else {
      if (isAiLookedEvent(event)) showOpponentLookedNotice(event.challenger);
      const effectMs = applyEventEffect(event);
      if (effectMs > delay) delay = effectMs;
    }
    timer = window.setTimeout(next, delay);
  };
  next();
}
