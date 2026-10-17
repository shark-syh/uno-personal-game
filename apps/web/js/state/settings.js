const KEY = "uno:settings";
const defaults = { autoCallUno: false, aiSpeed: "normal", sound: true, animation: true, showHint: true, aiChatter: true };

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
