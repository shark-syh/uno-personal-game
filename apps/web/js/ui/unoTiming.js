/**
 * M5：UNO 窗口时长映射（契约 §7.1 的唯一数据源，禁止在 CSS/HTML/其他 JS 里重复写 4000/6000/8000/10000）。
 * - 时长只用于 UI 金色环呈现与单机 AI 推进节奏；窗口开/关仍由引擎/服务端状态机裁决，不新增超时罚牌。
 * - ?test=1 测试模式固定 120ms 短窗口，不写难度映射（契约 §7.5）。
 */
export const UNO_WINDOW_BY_DIFFICULTY = {
  casual: 10000,
  easy: 8000,
  realistic: 6000,
  hardcore: 4000,
};

export const UNO_WINDOW_DEFAULT_MS = 4000;
export const UNO_TEST_WINDOW_MS = 120;

export function isTestMode() {
  try {
    return new URLSearchParams(window.location.search).get('test') === '1';
  } catch {
    return false;
  }
}

export function unoWindowMsFor(difficulty) {
  return UNO_WINDOW_BY_DIFFICULTY[difficulty] ?? UNO_WINDOW_DEFAULT_MS;
}

/** 测试模式优先：引擎与 UI 渲染统一从这里取窗口时长 */
export function resolveUnoWindowMs(difficulty) {
  return isTestMode() ? UNO_TEST_WINDOW_MS : unoWindowMsFor(difficulty);
}

/** 动画关闭 / reduced-motion 时走静态降级（静态金环 + 文本秒数，无动画） */
export function prefersStaticMotion() {
  return (
    document.documentElement.dataset.animation === 'false' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
