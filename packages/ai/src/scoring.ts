/**
 * 候选动作评分（M2）：把特征按难度权重线性加权。
 *
 * 弱档的权重更"平"（几乎只看能不能出牌）、强档更看重颜色控制/终局/风险；
 * 噪声与失误率在 `decide()` 里处理，这里保持纯函数。
 */
import type { Candidate, DifficultyProfile } from './types.ts';

/** 特征加权原始分（越大越好） */
export function weightedScore(candidate: Candidate, profile: DifficultyProfile): number {
  const features = candidate.features;
  const weights = profile.weights;
  return (
    weights.handReduction * features.handReduction +
    weights.attack * features.attack +
    weights.colorKeep * features.colorKeep +
    weights.followUp * features.followUp -
    weights.wildCost * features.wildCost +
    weights.endgame * features.endgame +
    weights.threat * features.threat +
    weights.stackGain * features.stackGain -
    weights.drawCost * features.drawCost -
    weights.bluffRisk * features.bluffRisk +
    weights.nextPlayerWeakColor * features.nextPlayerWeakColor +
    weights.colorFit * features.colorFit +
    weights.challengeSuccess * features.challengeSuccess -
    weights.challengeRisk * features.challengeRisk
  );
}

/** 对候选集的 rawScore 做 min-max 归一化，写入展示分 score（0~1） */
export function normalizeScores(candidates: readonly Candidate[]): void {
  if (candidates.length === 0) return;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    min = Math.min(min, candidate.rawScore);
    max = Math.max(max, candidate.rawScore);
  }
  const range = max - min;
  for (const candidate of candidates) {
    candidate.score = range > 1e-9 ? (candidate.rawScore - min) / range : 1;
  }
}
