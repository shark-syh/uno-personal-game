import { mockNames } from "../mock/mockView.js";

export function renderDevToolbar(view, { onSelect, onReplay }) {
  const root = document.querySelector("#dev-toolbar");
  const enabled = Boolean(view.mock) && view.dev?.toolbar !== false;
  root.hidden = !enabled;
  if (!enabled) return;
  root.replaceChildren(); const label = document.createElement("label"); label.textContent = "Mock 局面"; label.htmlFor = "mock-select"; const select = document.createElement("select"); select.id = "mock-select"; select.setAttribute("aria-label", "切换 mock 局面"); mockNames.forEach((name) => { const option = document.createElement("option"); option.value = name; option.textContent = name; option.selected = name === view.dev?.mockName; select.append(option); }); select.addEventListener("change", () => onSelect(select.value)); const replay = document.createElement("button"); replay.className = "btn btn-ghost"; replay.type = "button"; replay.textContent = "重播动画"; replay.setAttribute("aria-label", "重播动画"); replay.addEventListener("click", onReplay); root.append(label, select, replay);
}
