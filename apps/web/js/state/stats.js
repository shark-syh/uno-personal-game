const KEY = "uno:stats";

/** 本地战绩（2026-10-18 起取消分数，只记录对局数与胜场；写入逻辑暂为 M6 预留） */
export function getStats() {
  try {
    return { games: 0, wins: 0, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { games: 0, wins: 0 };
  }
}

export function recordResult(result) {
  const current = getStats();
  const won = result?.winnerSeat === 0;
  const next = { games: current.games + 1, wins: current.wins + (won ? 1 : 0) };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 本地存储不可用时忽略，不影响对局 */
  }
  return next;
}
