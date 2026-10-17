import { cardBack, renderCard } from "./hand.js";

export function renderHud(view) {
  const color = view.currentColor || "red";
  const colorIndicator = document.querySelector("#color-indicator"); colorIndicator.dataset.color = color; colorIndicator.style.setProperty("background", `var(--${color})`); document.querySelector("#color-label").textContent = { red: "红", yellow: "黄", green: "绿", blue: "蓝" }[color];
  const direction = document.querySelector("#direction-indicator"); direction.dataset.direction = String(view.direction); direction.textContent = view.direction === 1 ? "↻" : "↺"; direction.setAttribute("aria-label", view.direction === 1 ? "顺时针" : "逆时针"); document.querySelector("#direction-label").textContent = view.direction === 1 ? "顺时针" : "逆时针";
  document.querySelector("#table-direction").textContent = direction.textContent;
  document.querySelector("#table-direction").setAttribute("aria-label", direction.getAttribute("aria-label"));
  const runtimeLabels = { zhipu: "智谱", local: "本地", degraded: "本地·降级" };
  const configuredLabels = { zhipu: "智谱", local: "本地", auto: "自动" };
  const aiIndicator = document.querySelector("#ai-mode-indicator");
  aiIndicator.textContent = view.runtimeAiMode
    ? runtimeLabels[view.runtimeAiMode] || "自动"
    : configuredLabels[view.config?.aiMode] || "自动";
  const latency = Number(view.aiLatencyMs);
  aiIndicator.title = view.aiModel
    ? `最近在线决策：${view.aiModel}${Number.isFinite(latency) && latency > 0 ? ` · ${(latency / 1000).toFixed(1)}s` : ""}`
    : "";
  if (!aiIndicator.title) aiIndicator.removeAttribute("title");
  const draw = document.querySelector("#draw-pile"); draw.dataset.count = String(view.table.drawPileCount); draw.replaceChildren(cardBack()); document.querySelector("#draw-count").textContent = String(view.table.drawPileCount); document.querySelector("#draw-count").setAttribute("aria-label", `抽牌堆剩余 ${view.table.drawPileCount} 张`);
  const discard = document.querySelector("#discard-pile"); discard.dataset.topCard = view.table.discardTop?.faceCode || ""; discard.replaceChildren(...(view.table.discardTop3 || []).slice(1, 3).reverse().map((card) => { const node = renderCard(card); node.classList.add("discard-under"); node.setAttribute("aria-hidden", "true"); return node; }), view.table.discardTop ? renderCard(view.table.discardTop) : document.createTextNode("无"));
  const glow = document.querySelector("#color-glow"); glow.dataset.color = color; glow.style.setProperty("background", `var(--${color})`);
  const badge = document.querySelector("#stack-badge"); if (view.table.stack) { badge.hidden = false; badge.dataset.total = String(view.table.stack.total); badge.textContent = `+${view.table.stack.total}`; } else { badge.hidden = true; badge.textContent = ""; badge.dataset.total = ""; }
}
