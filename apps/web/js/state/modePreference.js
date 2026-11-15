/**
 * M4 三模式偏好（仅当前页面会话有效；刷新后回到基础模式）。
 *
 * mode 是开局参数，不是表现/规则偏好，不进设置弹窗全量写回。
 * 生效时机：只对新开对局生效；对局中切换不改动进行中的 GameState。
 *
 * Flip（进阶）方案暂缓，第三档只展示、不可选；服务端协议也只接受 classic / mercy。
 */
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

let selected = 'classic';

export function getMode() {
  return selected;
}

export function setMode(mode) {
  if (!isPlayableMode(mode)) return false;
  selected = mode;
  window.dispatchEvent(new CustomEvent('uno:mode-changed', { detail: { mode } }));
  return true;
}

/** 当前应使用的卡面资源目录与扩展名 */
export function cardResource(mode = selected) {
  return mode === 'mercy'
    ? { dir: 'cards-mercy', ext: 'webp' }
    : { dir: 'cards', ext: 'png' };
}
