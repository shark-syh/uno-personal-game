const KEY = "uno:stats";

export function getStats() {
  try { return { games: 0, wins: 0, bestScore: null, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return { games: 0, wins: 0, bestScore: null }; }
}

export function recordResult(result) {
  const current = getStats();
  const won = result?.winnerSeat === 0;
  const next = { games: current.games + 1, wins: current.wins + (won ? 1 : 0), bestScore: current.bestScore == null ? 0 : Math.min(current.bestScore, result?.players?.[0]?.score ?? current.bestScore) };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 本地存储不可用时忽略，不影响对局 */ }
  return next;
}
