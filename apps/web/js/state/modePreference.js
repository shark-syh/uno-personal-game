/**
 * M4 三模式偏好（会话级 + localStorage）。
 *
 * 契约来源：docs/三模式升级-Flip模式开发方案.md §2 —— key 用 `uno:mode`，
 * 与 `uno:settings` 分开存（mode 是开局参数，不是表现/规则偏好，不进设置弹窗全量写回）。
 * 生效时机：只对新开对局生效；对局中切换不改动进行中的 GameState。
 *
 * Flip（进阶）方案暂缓，第三档只展示、不可选；服务端协议也只接受 classic / mercy。
 */
const KEY = 'uno:mode';

/** 三档展示定义（顺序与左下角切换器一致） */
export const GAME_MODES = [
  { id: 'classic', label: '基础', short: '基' },
  { id: 'flip', label: '进阶', short: '进' },
  { id: 'mercy', label: '友尽', short: '友' },
];

/** 本期可开局的模式 */
export const PLAYABLE_MODES = ['classic', 'mercy'];

export function isPlayableMode(mode) {
  return PLAYABLE_MODES.includes(mode);
}

export function isKnownMode(mode) {
  return GAME_MODES.some((item) => item.id === mode);
}

function readStored() {
  try {
    const stored = window.localStorage.getItem(KEY);
    // 旧值或暂缓的 flip 一律回退 classic，避免开局时被服务端拒绝
    return isPlayableMode(stored) ? stored : 'classic';
  } catch {
    return 'classic';
  }
}

let selected = readStored();

export function getMode() {
  return selected;
}

export function setMode(mode) {
  if (!isPlayableMode(mode)) return false;
  selected = mode;
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // 隐私模式 / 禁用 localStorage：会话内仍生效
  }
  window.dispatchEvent(new CustomEvent('uno:mode-changed', { detail: { mode } }));
  return true;
}

/** 当前应使用的卡面资源目录与扩展名 */
export function cardResource(mode = selected) {
  return mode === 'mercy'
    ? { dir: 'cards-mercy', ext: 'webp' }
    : { dir: 'cards', ext: 'png' };
}
