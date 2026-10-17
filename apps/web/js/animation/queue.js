let timer = null;
let completion = null;
let disabledStates = [];

/** 清理当前播放的定时器与临时禁用状态（不触发完成回调） */
function clearRun() {
  clearTimeout(timer);
  timer = null;
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
  if (reduced || document.documentElement.dataset.animation === "false" || !events.length) { finish(); return; }
  document.querySelector("#game-screen")?.setAttribute("aria-busy", "true");
  document.querySelector("#action-bar")?.setAttribute("aria-disabled", "true");
  disabledStates = [...document.querySelectorAll("#action-bar button, #hand button, #dialog-root button[data-action-id]")].map((node) => [node, node.disabled]);
  disabledStates.forEach(([node]) => { node.disabled = true; });
  let index = 0;
  const next = () => { if (index >= events.length) { finish(); return; } index += 1; timer = window.setTimeout(next, 200); };
  next();
}
