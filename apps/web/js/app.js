import { createMockView, mockNames } from "./mock/mockView.js";
import { render } from "./ui/render.js";
import { openDialog, installDialogKeyboard } from "./ui/dialogs.js";
import { playEvents } from "./animation/queue.js";
import { getSettings } from "./state/settings.js";

// M3-2 引擎接入前：直接打开页面默认使用 mock 数据，保证「开始游戏」等按钮可操作。
// 需要引擎模式时用 ?mock=0（或 ?mode=engine）；M3-2 接入后再把默认值切回 engine。
const query = new URLSearchParams(window.location.search);
let mode = query.get("mock") === "0" || query.get("mode") === "engine" ? "engine" : "mock";
// 开发模式：显示 mock 开发工具条与动作 toast（?mock=1 或 ?dev=1），默认干净预览。
const devMode = query.get("mock") === "1" || query.get("dev") === "1";
let view = createMockView("lobby");
let actionHandler = null;
let lastEvents = [];

function toast(message) { const region = document.querySelector("#toast-region"); const node = document.createElement("div"); node.className = "toast"; node.textContent = message; region.append(node); window.setTimeout(() => node.remove(), 2600); }
function hintFor(current) {
  if (current.phase === "stack-response") return `上家出了叠牌，选择继续叠加或摸 ${current.table.stack?.total || 0} 张`;
  if (current.phase === "challenge-decide") return "上家出了 +4，选择摸 4 张或挑战";
  if (current.phase === "choose-color") return "请选择万能牌的颜色";
  if (current.phase === "uno-window") return current.human.canCallUno ? "只剩一张牌，别忘了喊 UNO" : "发现有人忘了喊 UNO？抓住机会";
  if (current.currentSeat !== 0) return `${current.players[current.currentSeat]?.name || "AI"} 正在行动`;
  // 引擎/动作自带 hint 时优先展示（如"红色数字牌可以出"），否则用通用引导
  const actionHint = (current.human.legalActions || []).find((action) => action.hint)?.hint;
  return actionHint || "轮到你了，选择一张高亮的牌，或摸一张";
}
function draw() {
  render(view, {
    onAction: handleAction,
    openDialog: open,
    hintFor,
    playEvents,
    onSelect: (name) => rerender(createMockView(name)),
    onReplay: () => playEvents(lastEvents, () => toast("动画队列已重播"))
  });
}
function rerender(next) { view = { ...next, mock: mode === "mock", settings: getSettings(), dev: { ...(next.dev || {}), toolbar: devMode } }; lastEvents = view.events || []; draw(); }
function handleAction(action) {
  if (document.querySelector("#game-screen").getAttribute("aria-busy") === "true") return;
  if (actionHandler) { actionHandler(action); return; }
  if (mode !== "mock") return;
  console.log("[UNO mock action]", action);
  toast(`（演示）已提交：${action.label || action.type}`);
  if (action.type === "START_GAME") { const next = createMockView("normal-play", action.config.playerCount); next.config = action.config; next.players[0].name = action.config.playerName; rerender(next); return; }
  if (action.type === "BACK_TO_LOBBY") { rerender(createMockView("lobby")); return; }
  if (action.type === "RESTART") { rerender(createMockView("normal-play")); return; }
}
function open(kind, payload, source = "user") { openDialog(kind, payload, handleAction, source); }

window.UnoApp = {
  render(next) { mode = next.mock ? "mock" : "engine"; view = next; lastEvents = next.events || []; draw(); },
  playEvents,
  setActionHandler(fn) { actionHandler = typeof fn === "function" ? fn : null; },
  setMockMode(enabled, name = "lobby") { mode = enabled ? "mock" : "engine"; if (enabled) rerender(createMockView(mockNames.includes(name) ? name : "lobby")); else { view = { ...view, mock: false }; draw(); } },
  getMode() { return mode; }
};

document.querySelector("#quit-game").addEventListener("click", () => open("confirm-quit"));
document.querySelectorAll("[data-open-dialog]").forEach((button) => button.addEventListener("click", () => open(button.dataset.openDialog)));
window.addEventListener("uno:settings-changed", () => { if (mode === "mock") rerender(view); toast("设置已保存"); });
installDialogKeyboard();
rerender(view);
