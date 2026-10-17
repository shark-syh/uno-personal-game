const KEY = "uno:settings";
/**
 * 本地设置（localStorage）。2026-10-18 M5-06：新增 4 项低风险规则配置，
 * 默认值与引擎 DEFAULT_GAME_CONFIG 保持一致（官方口径），仅对新开对局生效。
 * 注意：契约 §1.2 settings 为向后兼容扩展（只增不改）。
 */
const defaults = {
  autoCallUno: false,
  aiSpeed: "normal",
  sound: true,
  soundVolume: 0.7,
  animation: true,
  animationSpeed: "normal",
  showHint: true,
  aiChatter: true,
  twoPlayerRules: true,
  unoPenalty: 2,
  deckExhaustion: "reshuffle",
  startCardRule: "classic",
};

export function getSettings() {
  try { return { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) || "{}")) }; }
  catch { return { ...defaults }; }
}

export function saveSettings(next) {
  const value = { ...defaults, ...next };
  localStorage.setItem(KEY, JSON.stringify(value));
  return value;
}

export { defaults as defaultSettings };
