/**
 * 候选生成测试辅助：给定局面与难度，产出全部 AI 候选。
 */
import type { Difficulty, GameState } from '@uno/game-core';
import { buildMemory, generateCandidates, getAiView, getDifficultyProfile } from '../src/index.ts';
import type { Candidate } from '../src/index.ts';

export function candidatesFor(
  state: GameState,
  seat: number,
  difficulty: Difficulty = 'realistic',
): Candidate[] {
  const profile = getDifficultyProfile(difficulty);
  const view = getAiView(state, seat);
  const memory = buildMemory(view);
  return generateCandidates({ state, seat, view, memory, profile });
}
