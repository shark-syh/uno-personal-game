import { renderLobby } from "./lobby.js";
import { renderTable } from "./table.js";
import { renderResult } from "./result.js";
import { renderDevToolbar } from "./devToolbar.js";
import { closeDialog, closeAutoDialog } from "./dialogs.js";
import { cancelEvents } from "../animation/queue.js";

let lastScreen = null;

export function render(view, context) {
  cancelEvents();
  // 屏幕切换时关闭所有弹窗；同一屏幕内的重绘只关闭"自动弹窗"（选色/挑战），
  // 不打断玩家主动打开的设置、战绩、退出确认等弹窗。
  if (lastScreen !== null && lastScreen !== view.screen) closeDialog();
  else closeAutoDialog();
  lastScreen = view.screen;
  document.documentElement.dataset.animation = String(view.settings?.animation !== false);
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.toggle("is-active", screen.dataset.screen === view.screen));
  if (view.screen === "lobby") renderLobby(view, context);
  if (view.screen === "game") renderTable(view, context);
  if (view.screen === "result") renderResult(view, context);
  renderDevToolbar(view, context);
  if (view.screen === "game" && view.phase === "choose-color") context.openDialog("color", { actions: view.human.legalActions.filter((action) => action.type === "CHOOSE_COLOR") }, "auto");
  if (view.screen === "game" && view.phase === "challenge-decide") context.openDialog("challenge", { actions: view.human.legalActions }, "auto");
}
