import { renderCard } from "./hand.js";

// BUG-05：结算页展示加固（不改数据结构，仅改展示文案）
const SCORE_LEGEND = "趣味分数 = 结算时剩余手牌分值（数字面值 / 动作 20 / 万能 50），赢家出完手牌记 0 分";

export function renderResult(view, { onAction }) {
  const root = document.querySelector("#result-content"); const result = view.result || { winnerSeat: 0, players: [], turns: 0, durationMs: 0 }; const winner = result.players.find((player) => player.seat === result.winnerSeat); const isDraw = result.winnerSeat === null;
  const header = document.createElement("div"); header.className = "result-header"; const title = document.createElement("h2"); title.id = "result-title"; title.textContent = isDraw ? "🤝 平局" : `🏆 ${winner?.name || "赢家"} 获胜`; header.append(title);
  const stats = document.createElement("div"); stats.className = "result-stats"; const reasonText = result.reason === "deck-empty" ? " · 牌堆耗尽" : ""; stats.textContent = `回合 ${result.turns} · 用时 ${Math.round((result.durationMs || 0) / 1000)} 秒${reasonText}`; header.append(stats);
  const list = document.createElement("div"); list.className = "result-list";
  result.players.forEach((player) => {
    const isWinnerRow = !isDraw && player.seat === result.winnerSeat;
    const remainingCount = player.remaining?.length || 0;
    const row = document.createElement("div"); row.className = `result-row${isWinnerRow ? " is-winner" : ""}`;
    const name = document.createElement("strong"); name.textContent = player.name;
    const cards = document.createElement("span"); cards.className = "result-cards"; (player.remaining || []).forEach((card) => cards.append(renderCard(card, { mini: true })));
    // 赢家行按剩余手牌区分：出完手牌 → 「0 张 · 出完手牌」；牌堆耗尽按最少手牌判胜且仍有牌
    // → 「N 张 · 手牌最少获胜」；非赢家 → 「N 张 · 趣味分数 X」，保持趣味分数口径一致。
    const score = document.createElement("span"); score.className = "result-score";
    if (isWinnerRow && remainingCount === 0) score.textContent = "0 张 · 出完手牌";
    else if (isWinnerRow) score.textContent = `${remainingCount} 张 · 手牌最少获胜`;
    else score.textContent = `${remainingCount} 张 · 趣味分数 ${player.score}`;
    row.append(name, cards, score);
    list.append(row);
  });
  const legend = document.createElement("p"); legend.className = "result-legend"; legend.textContent = SCORE_LEGEND;
  const actions = document.createElement("div"); actions.className = "result-actions"; const restart = document.createElement("button"); restart.className = "btn btn-primary"; restart.type = "button"; restart.textContent = "再来一局"; restart.setAttribute("aria-label", "再来一局"); restart.addEventListener("click", () => onAction({ type: "RESTART" })); const lobby = document.createElement("button"); lobby.className = "btn btn-ghost"; lobby.type = "button"; lobby.textContent = "回大厅"; lobby.setAttribute("aria-label", "回大厅"); lobby.addEventListener("click", () => onAction({ type: "BACK_TO_LOBBY" })); actions.append(restart, lobby); root.replaceChildren(header, list, legend, actions);
}
