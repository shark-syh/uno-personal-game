/**
 * UNO 本地启发式 AI（M2）。
 *
 * 定位：
 * - 四档难度（休闲 / 简单 / 真实 / 骨灰级）的纯本地策略；
 * - 离线可玩，同时作为智谱 LLM 失败/超时时的兜底决策器（M4 接入）；
 * - 只能使用公开信息 + 自己的手牌：所有决策输入都是 `getAiView()` 的脱敏视图。
 *
 * 常用入口：
 * - `decide(state, seat, { difficulty, rng })`：对当前局面做一次决策；
 * - `runDifficultyLadder({ gamesPerPairing })` / `runMixedTable({ games })`：自对弈基准；
 * - `playSelfPlayGame(config)`：单局 AI vs AI。
 */
export const AI_VERSION = '0.2.0';

export * from './types.ts';
export * from './difficulty.ts';
export * from './view.ts';
export * from './memory.ts';
export * from './features.ts';
export * from './scoring.ts';
export * from './candidates.ts';
export * from './decide.ts';
export * from './selfplay.ts';
