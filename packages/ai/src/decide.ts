/**
 * AI 决策入口（M2）。
 *
 * 流程：公开视图 → 记牌 → 候选生成/评分 → 难度噪声/失误 → 挑战策略 → 排序选出。
 * 纯函数 + 显式注入 RNG：同样的局面 + 同样的随机源 ⇒ 同样的决策（可复现、可测试）。
 */
import { nextFloat, nextInt } from '@uno/game-core';
import type { GameState } from '@uno/game-core';
import type { AiDecision, Candidate, DecideOptions, DifficultyProfile } from './types.ts';
import { getDifficultyProfile } from './difficulty.ts';
import { getAiView } from './view.ts';
import { buildMemory } from './memory.ts';
import { generateCandidates } from './candidates.ts';
import { normalizeScores, weightedScore } from './scoring.ts';

/**
 * 挑战窗口的专门策略（不用通用线性评分）：
 * - casual：10% 概率"乱挑战"；
 * - easy / realistic：估算违规概率 ≥ 阈值就挑战；
 * - hardcore：按期望值（阈值更低，挑战收益 > 接受摸 4 的损失）。
 *
 * 被选中的候选会被赋予排序加成，保证它排在候选列表首位。
 */
function applyChallengeStrategy(
  challenge: Candidate,
  decline: Candidate,
  profile: DifficultyProfile,
  options: DecideOptions,
): void {
  const strategy = profile.challenge;
  const probability = challenge.features.challengeSuccess;
  const challenged =
    strategy.mode === 'random'
      ? nextFloat(options.rng) < strategy.randomChance
      : probability >= strategy.threshold;

  const best = Math.max(challenge.rawScore, decline.rawScore);
  const chosen = challenged ? challenge : decline;
  const other = challenged ? decline : challenge;
  chosen.rawScore = best + 1;
  other.rawScore = best;

  const percent = Math.round(probability * 100);
  challenge.note = `挑战 +4（估算对方违规概率 ${percent}%）`;
  decline.note = `接受 +4，摸 4 张（估算对方违规概率 ${percent}%，选择不挑战）`;
}

/** 对当前局面做一次 AI 决策 */
export function decide(state: GameState, seat: number, options: DecideOptions): AiDecision {
  if (state.phase === 'round-end') throw new Error('对局已结束，AI 不再决策');
  if (state.currentSeat !== seat) {
    throw new Error(`座位 ${seat} 不是当前行动者（当前座位 ${state.currentSeat}）`);
  }

  const profile = getDifficultyProfile(options.difficulty);
  const view = getAiView(state, seat);
  const memory = options.memory ?? buildMemory(view);
  const candidates = generateCandidates({ state, seat, view, memory, profile });

  // 基础分 + 难度噪声（噪声为 0 的档位不消耗随机数，便于确定性测试）
  for (const candidate of candidates) {
    candidate.rawScore = weightedScore(candidate, profile);
    if (profile.noise > 0) {
      candidate.rawScore += profile.noise * (nextFloat(options.rng) * 2 - 1);
    }
  }

  const challenge = candidates.find((candidate) => candidate.kind === 'challenge');
  const decline = candidates.find((candidate) => candidate.kind === 'decline-challenge');
  const isChallengeWindow = Boolean(challenge && decline);
  if (challenge && decline) {
    applyChallengeStrategy(challenge, decline, profile, options);
  }

  // 排序：同分按 id 保证确定性
  candidates.sort(
    (left, right) => right.rawScore - left.rawScore || left.id.localeCompare(right.id),
  );

  let chosen = candidates[0]!;
  if (
    !isChallengeWindow &&
    profile.mistakeRate > 0 &&
    candidates.length > 1 &&
    nextFloat(options.rng) < profile.mistakeRate
  ) {
    // 失误：从非最优候选中随机挑一个（模拟真人犯错/手滑）
    // 注意：挑战窗口是明确策略决策（挑战/接受），不叠加“手滑”，否则会冲掉难度策略
    const index = 1 + nextInt(options.rng, candidates.length - 1);
    chosen = candidates[index]!;
  }

  normalizeScores(candidates);

  return {
    seat,
    difficulty: options.difficulty,
    action: chosen.action,
    candidate: chosen,
    candidates,
    reason: chosen.note,
    source: 'local',
  };
}
