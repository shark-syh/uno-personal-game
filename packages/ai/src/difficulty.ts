/**
 * 四档难度参数表（M2，对应 `开发计划.md` 6.4 难度矩阵）。
 *
 * 设计原则：
 * - 难度只影响"策略与表现"，**不影响规则合法性**：任何难度的 AI 都只从
 *   `getLegalActions` 返回的合法动作里选择（+4 诈唬属于原版允许的行为）。
 * - 弱档通过"更大的评分噪声 + 失误率 + 不记牌"变弱；强档通过"更准的记牌、
 *   下家缺色推断、挑战概率模型、终局意识"变强。
 */
import type { Difficulty } from '@uno/game-core';
import type { DifficultyProfile } from './types.ts';

/**
 * AI 喊 UNO 概率（与 game-core M1-6 引擎内口径保持一致，单位：0~1）。
 *
 * 注意：当前引擎用 `GameConfig.aiDifficulty` 一档统一控制所有 AI 的喊/抓概率
 * （M1-6 遗留），本表在 M2 只作为文档/口径基准与自对弈说明；M4 拆成每 AI 独立
 * 难度后再交给引擎使用。
 */
export const UNO_CALL_PROBABILITY: Record<Difficulty, number> = {
  casual: 0.8,
  easy: 0.95,
  realistic: 1,
  hardcore: 1,
};

/** AI 抓 UNO 概率（与 game-core M1-6 引擎内口径保持一致） */
export const UNO_CATCH_PROBABILITY: Record<Difficulty, number> = {
  casual: 0.1,
  easy: 0.4,
  realistic: 0.8,
  hardcore: 1,
};

/** 难度从弱到强的固定顺序（自对弈阶梯用） */
export const DIFFICULTY_ORDER: readonly Difficulty[] = ['casual', 'easy', 'realistic', 'hardcore'];

/** 中文标签（日志/报告用） */
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  casual: '休闲',
  easy: '简单',
  realistic: '真实',
  hardcore: '骨灰级',
};

const casual: DifficultyProfile = {
  difficulty: 'casual',
  label: DIFFICULTY_LABEL.casual,
  mistakeRate: 0.2,
  noise: 0.35,
  memoryLevel: 'none',
  colorChoice: 'most-in-hand',
  challenge: { mode: 'random', randomChance: 0.1, threshold: 1, priorIllegal: 0.5 },
  bluffChance: 0,
  weights: {
    handReduction: 1,
    attack: 0.15,
    colorKeep: 0.2,
    followUp: 0,
    wildCost: 0.1,
    endgame: 0.2,
    threat: 0,
    stackGain: 0.25,
    drawCost: 0.5,
    bluffRisk: 0,
    nextPlayerWeakColor: 0.1,
    colorFit: 0.5,
    challengeSuccess: 0.2,
    challengeRisk: 0.2,
  },
  description: '陪你玩：会犯错、不记牌、几乎不挑战、从不诈唬',
};

const easy: DifficultyProfile = {
  difficulty: 'easy',
  label: DIFFICULTY_LABEL.easy,
  mistakeRate: 0.1,
  noise: 0.15,
  memoryLevel: 'colors',
  colorChoice: 'weighted',
  challenge: { mode: 'simple', randomChance: 0, threshold: 0.45, priorIllegal: 0.4 },
  bluffChance: 0.1,
  weights: {
    handReduction: 1,
    attack: 0.4,
    colorKeep: 0.45,
    followUp: 0.15,
    wildCost: 0.35,
    endgame: 0.5,
    threat: 0.25,
    stackGain: 0.5,
    drawCost: 0.9,
    bluffRisk: 0.4,
    nextPlayerWeakColor: 0.3,
    colorFit: 0.8,
    challengeSuccess: 0.6,
    challengeRisk: 0.5,
  },
  description: '规则正确的普通水平：只记已出颜色数量，偶尔挑战、偶尔诈唬',
};

const realistic: DifficultyProfile = {
  difficulty: 'realistic',
  label: DIFFICULTY_LABEL.realistic,
  mistakeRate: 0.03,
  noise: 0.05,
  memoryLevel: 'full',
  colorChoice: 'next-player',
  challenge: { mode: 'estimate', randomChance: 0, threshold: 0.4, priorIllegal: 0.35 },
  bluffChance: 0.3,
  weights: {
    handReduction: 1,
    attack: 0.6,
    colorKeep: 0.7,
    followUp: 0.45,
    wildCost: 0.6,
    endgame: 0.9,
    threat: 0.5,
    stackGain: 0.8,
    drawCost: 1.1,
    bluffRisk: 0.9,
    nextPlayerWeakColor: 0.7,
    colorFit: 1,
    challengeSuccess: 1,
    challengeRisk: 0.8,
  },
  description: '像普通老玩家：记全部已出牌、按概率挑战、会主动诈唬',
};

const hardcore: DifficultyProfile = {
  difficulty: 'hardcore',
  label: DIFFICULTY_LABEL.hardcore,
  mistakeRate: 0,
  noise: 0,
  memoryLevel: 'full-plus',
  colorChoice: 'bayes',
  challenge: { mode: 'ev', randomChance: 0, threshold: 0.32, priorIllegal: 0.35 },
  bluffChance: 0.5,
  weights: {
    handReduction: 1,
    attack: 0.8,
    colorKeep: 1,
    followUp: 1,
    wildCost: 0.8,
    endgame: 1.3,
    threat: 0.8,
    stackGain: 1,
    drawCost: 1.2,
    bluffRisk: 1.8,
    nextPlayerWeakColor: 1.2,
    colorFit: 1.3,
    challengeSuccess: 1.4,
    challengeRisk: 1,
  },
  description: '近乎最优：精确记牌、按期望值挑战、关键节点诈唬、零失误',
};

/** 全部难度参数 */
export const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile> = {
  casual,
  easy,
  realistic,
  hardcore,
};

/** 取难度参数（校验难度名） */
export function getDifficultyProfile(difficulty: Difficulty): DifficultyProfile {
  const profile = DIFFICULTY_PROFILES[difficulty];
  if (!profile) throw new RangeError(`未知 AI 难度：${String(difficulty)}`);
  return profile;
}
