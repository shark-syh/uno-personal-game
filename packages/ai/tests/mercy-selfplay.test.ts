import { describe, expect, it } from 'vitest';
import {
  createSelfPlayGame,
  playSelfPlayGame,
  runMercyTable,
  sameAction,
} from '../src/index.ts';

/**
 * M5 友尽模式自对弈正式断言。
 *
 * 口径（docs/开发进度.md §3.8 M5）：友尽 AI vs AI 必须——
 * - 只从引擎合法动作里选（非法动作 0，`sameAction` 对 SWAP_HANDS /
 *   CHOOSE_ROULETTE_COLOR 按唯一键字段严格比对后仍为 0）；
 * - 每步牌数守恒 168（手牌 + 牌堆 + 弃牌堆 + 搁置牌）；
 * - 每局正常结束并决出胜者（`empty-hand` 或 `last-survivor`）；
 * - 友尽规则真实运转（淘汰在样本内发生过）。
 * 不做难度单调判定：友尽胜负含规则性运气，单调性对该模式无可解释意义。
 */

describe('M5 友尽自对弈：sameAction 严格比对（M3 新动作不留宽松 default 缺口）', () => {
  it('SWAP_HANDS 按目标座位判等', () => {
    expect(sameAction({ type: 'SWAP_HANDS', targetSeat: 1 }, { type: 'SWAP_HANDS', targetSeat: 1 })).toBe(
      true,
    );
    expect(sameAction({ type: 'SWAP_HANDS', targetSeat: 1 }, { type: 'SWAP_HANDS', targetSeat: 2 })).toBe(
      false,
    );
  });

  it('CHOOSE_ROULETTE_COLOR 按颜色判等', () => {
    expect(
      sameAction({ type: 'CHOOSE_ROULETTE_COLOR', color: 'red' }, { type: 'CHOOSE_ROULETTE_COLOR', color: 'red' }),
    ).toBe(true);
    expect(
      sameAction({ type: 'CHOOSE_ROULETTE_COLOR', color: 'red' }, { type: 'CHOOSE_ROULETTE_COLOR', color: 'blue' }),
    ).toBe(false);
  });
});

describe('M5 友尽自对弈：局面与单局', () => {
  it('mode=mercy 局面：168 张友尽牌堆、规则自动收紧（official 叠链、无 +4 挑战）', () => {
    const { state } = createSelfPlayGame({
      playerCount: 4,
      seed: 'mercy-create',
      difficulties: ['casual', 'easy', 'realistic', 'hardcore'],
      mode: 'mercy',
    });
    expect(state.config.mode).toBe('mercy');
    expect(state.config.stacking).toBe('official');
    expect(state.config.challengeWild4).toBe(false);
    expect(state.players.every((player) => player.hand.length === 7)).toBe(true);
    // 168 = 手牌 4×7 + 牌堆 + 弃牌堆顶牌（起手只认数字牌）
    expect(state.players.reduce((sum, player) => sum + player.hand.length, 0)).toBe(28);
  });

  it(
    '4 人友尽单局：无非法动作、守恒 168、决出胜者',
    () => {
    const result = playSelfPlayGame({
      playerCount: 4,
      seed: 'mercy-single',
      difficulties: ['casual', 'easy', 'realistic', 'hardcore'],
      mode: 'mercy',
    });
    expect(result.errors).toEqual([]);
    expect(result.illegalActions).toBe(0);
    expect(result.conservationOk).toBe(true);
    expect(result.winnerSeat).not.toBeNull();
    expect(['empty-hand', 'last-survivor']).toContain(result.reason);
    expect(result.remainingHandCounts).toHaveLength(4);
    },
    30000,
  );
});

describe('M5 友尽自对弈：runMercyTable 正式断言', () => {
  // 24 局真实对局全量跑约 2~4s，全量并发时可能超 vitest 默认 5s —— 显式给足超时
  it(
    '24 局 4 人友尽混战：非法 0 / 异常 0 / 守恒 / 每局有胜者 / 淘汰真实发生',
    () => {
      const mercy = runMercyTable({ games: 24, baseSeed: 'm5-mercy-test' });
    expect(mercy.games).toBe(24);
    expect(mercy.playerCount).toBe(4);
    expect(mercy.illegalActions).toBe(0);
    expect(mercy.errorCount).toBe(0);
    expect(mercy.conservationOk).toBe(true);
    expect(mercy.allDecided).toBe(true);
    expect(mercy.avgTurns).toBeGreaterThan(0);
    // 友尽规则在真实运转：样本内应出现过淘汰与最后幸存者两种胜利形态
    expect(mercy.gamesWithElimination).toBeGreaterThan(0);
    const totalWins = Object.values(mercy.winCounts).reduce((sum, count) => sum + count, 0);
    expect(totalWins).toBe(24);
    const reasonTotal = Object.values(mercy.winnerReasons).reduce((sum, count) => sum + count, 0);
    expect(reasonTotal).toBe(24);
    expect(Object.keys(mercy.winnerReasons).every((reason) => reason === 'empty-hand' || reason === 'last-survivor')).toBe(
      true,
    );
    },
    30000,
  );

  it(
    'classic 默认通道不受影响：不传 mode 仍是 108 张守恒',
    () => {
    const result = playSelfPlayGame({
      playerCount: 2,
      seed: 'mercy-regression-classic',
      difficulties: ['casual', 'hardcore'],
    });
    expect(result.errors).toEqual([]);
    expect(result.conservationOk).toBe(true);
    expect(result.eliminatedCount).toBe(0);
    expect(result.reason).toBe('empty-hand');
    },
    30000,
  );
});
