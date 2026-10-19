import { describe, expect, it } from 'vitest';
import {
  createSelfPlayGame,
  DIFFICULTY_ORDER,
  playSelfPlayGame,
  runDifficultyLadder,
  runMixedTable,
  sameAction,
} from '../src/index.ts';

describe('M2 自对弈：局面创建', () => {
  it('全 AI 局面：没有人类座位，难度表长度校验', () => {
    const { state } = createSelfPlayGame({
      playerCount: 2,
      seed: 'selfplay-create',
      difficulties: ['casual', 'hardcore'],
    });
    expect(state.config.humanSeat).toBe(-1);
    expect(state.players).toHaveLength(2);
    expect(state.players.every((player) => player.isHuman === false)).toBe(true);

    expect(() =>
      createSelfPlayGame({
        playerCount: 3,
        seed: 'bad',
        difficulties: ['casual', 'easy'],
      }),
    ).toThrow(RangeError);
  });

  it('sameAction 判等：类型/牌/颜色/目标座位', () => {
    const cardId = 'R5#0';
    expect(
      sameAction(
        { type: 'PLAY_CARD', cardId, colorChoice: 'red' },
        { type: 'PLAY_CARD', cardId, colorChoice: 'red' },
      ),
    ).toBe(true);
    expect(
      sameAction({ type: 'PLAY_CARD', cardId }, { type: 'PLAY_CARD', cardId, colorChoice: 'red' }),
    ).toBe(false);
    expect(sameAction({ type: 'PLAY_CARD', cardId: 'a' }, { type: 'PLAY_CARD', cardId: 'b' })).toBe(
      false,
    );
    expect(sameAction({ type: 'DRAW' }, { type: 'DRAW' })).toBe(true);
    expect(sameAction({ type: 'DRAW' }, { type: 'END_TURN' })).toBe(false);
    expect(
      sameAction({ type: 'CATCH_UNO', targetSeat: 1 }, { type: 'CATCH_UNO', targetSeat: 2 }),
    ).toBe(false);
  });
});

describe('M2 自对弈：单局质量', () => {
  it('每档难度单局都能正常结束：无非法动作、牌数守恒、结果自洽', () => {
    for (const difficulty of DIFFICULTY_ORDER) {
      const result = playSelfPlayGame({
        playerCount: 2,
        seed: `selfplay-single-${difficulty}`,
        difficulties: [difficulty, difficulty],
      });
      expect(result.errors).toEqual([]);
      expect(result.illegalActions).toBe(0);
      expect(result.conservationOk).toBe(true);
      expect(result.isDraw).toBe(false);
      expect(result.winnerSeat).not.toBeNull();
      expect(result.winnerSeat!).toBeGreaterThanOrEqual(0);
      expect(result.winnerSeat!).toBeLessThan(2);
      expect(result.turns).toBeGreaterThan(0);
      expect(result.actions).toBeGreaterThan(0);
      expect(result.reason).toBe('empty-hand');
      expect(result.remainingHandCounts).toHaveLength(2);
    }
  });

  it('4 人混战单局正常结束（含多种难度混合）', () => {
    const result = playSelfPlayGame({
      playerCount: 4,
      seed: 'selfplay-4p',
      difficulties: ['casual', 'easy', 'realistic', 'hardcore'],
    });
    expect(result.errors).toEqual([]);
    expect(result.illegalActions).toBe(0);
    expect(result.conservationOk).toBe(true);
    expect(result.winnerSeat).not.toBeNull();
    expect(result.remainingHandCounts).toHaveLength(4);
  });

  it('相同 seed 的两局结果完全一致（可复现）', () => {
    const options = {
      playerCount: 2 as const,
      seed: 'selfplay-repro',
      difficulties: ['easy', 'hardcore'] as const,
    };
    const first = playSelfPlayGame({
      ...options,
      difficulties: [...options.difficulties],
    });
    const second = playSelfPlayGame({
      ...options,
      difficulties: [...options.difficulties],
    });
    expect(second.winnerSeat).toBe(first.winnerSeat);
    expect(second.actions).toBe(first.actions);
    expect(second.turns).toBe(first.turns);
    expect(second.draws).toBe(first.draws);
  });
});

describe('M2 自对弈：批量基准聚合', () => {
  // 逐张摸牌规则使对局明显变长（24 局批量约 5s+），显式放宽超时以避免误判失败
  it('难度阶梯：每组局数/胜负平/回合数统计自洽，无非法动作', { timeout: 30000 }, () => {
    const ladder = runDifficultyLadder({ gamesPerPairing: 8, baseSeed: 'selfplay-ladder-test' });
    expect(ladder.pairings).toHaveLength(3);
    expect(ladder.games).toBe(24);
    expect(ladder.illegalActions).toBe(0);
    expect(ladder.errorCount).toBe(0);
    for (const pairing of ladder.pairings) {
      expect(pairing.games).toBe(8);
      expect(pairing.strongWins + pairing.weakWins + pairing.draws).toBe(8);
      expect(pairing.strongWinRate).toBeGreaterThanOrEqual(0);
      expect(pairing.strongWinRate).toBeLessThanOrEqual(1);
      expect(pairing.avgTurns).toBeGreaterThan(0);
      expect(pairing.avgActions).toBeGreaterThan(0);
    }
  });

  it('4 人混战：胜场/名次统计自洽', () => {
    const mixed = runMixedTable({ games: 8, baseSeed: 'selfplay-mixed-test' });
    expect(mixed.games).toBe(8);
    expect(mixed.illegalActions).toBe(0);
    expect(mixed.errorCount).toBe(0);
    const wins = DIFFICULTY_ORDER.reduce((sum, difficulty) => sum + mixed.winCounts[difficulty], 0);
    expect(wins + mixed.draws).toBe(8);
    for (const difficulty of DIFFICULTY_ORDER) {
      expect(mixed.averagePositions[difficulty]).toBeGreaterThanOrEqual(1);
      expect(mixed.averagePositions[difficulty]).toBeLessThanOrEqual(4);
    }
    expect(mixed.avgTurns).toBeGreaterThan(0);
  });
});
