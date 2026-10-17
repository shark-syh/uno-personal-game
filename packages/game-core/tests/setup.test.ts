import { describe, expect, it } from 'vitest';
import { countCards, createInitialGame, nextSeat, prevSeat } from '../src/setup.ts';
import type { Card, GameConfig, GameState } from '../src/types.ts';

const BASE: Partial<GameConfig> = { playerCount: 4 };

/** 扫描确定性种子，找到满足条件的开局（用于测试特定起手牌场景） */
function findGame(
  predicate: (state: GameState) => boolean,
  options: Partial<GameConfig> = {},
  maxSeeds = 5000,
): GameState {
  for (let index = 0; index < maxSeeds; index += 1) {
    const state = createInitialGame({ ...BASE, ...options, seed: `test-seed-${index}` });
    if (predicate(state)) return state;
  }
  throw new Error('未找到满足条件的随机种子（测试辅助函数失败）');
}

const hasEvent = (state: GameState, type: string): boolean =>
  state.events.some((event) => event.type === type);

const topCard = (state: GameState): Card => state.discardPile[state.discardPile.length - 1]!;

const nominalFirstSeat = (state: GameState): number =>
  nextSeat(state.dealerSeat, state.config.playerCount, 1);

describe('createInitialGame 默认开局', () => {
  it('4 人：每人 7 张、弃牌堆 1 张、全牌 108 张', () => {
    const state = createInitialGame({ playerCount: 4, seed: 'default' });
    expect(state.players).toHaveLength(4);
    for (const player of state.players) expect(player.hand).toHaveLength(7);
    expect(state.discardPile).toHaveLength(1);
    expect(countCards(state)).toBe(108);
  });

  it('人类座位是「你」且 isHuman 正确', () => {
    const state = createInitialGame({ playerCount: 3, humanSeat: 0, seed: 'human-seat' });
    expect(state.players[0]!.isHuman).toBe(true);
    expect(state.players[0]!.name).toBe('你');
    expect(state.players.slice(1).every((player) => !player.isHuman)).toBe(true);
  });

  it('2~10 人开局全牌守恒：每人 7 张（起手 +2 时首位多 2 张）', () => {
    for (let playerCount = 2; playerCount <= 10; playerCount += 1) {
      const state = createInitialGame({ playerCount, seed: `players-${playerCount}` });
      const extra = hasEvent(state, 'DRAW') ? 2 : 0;
      expect(state.players).toHaveLength(playerCount);
      expect(countCards(state)).toBe(108);
      expect(state.players.reduce((sum, player) => sum + player.hand.length, 0)).toBe(
        playerCount * 7 + extra,
      );
      for (const player of state.players) {
        expect(player.hand.length === 7 || player.hand.length === 9).toBe(true);
      }
    }
  });

  it('相同 seed 完全一致，不同 seed 不同', () => {
    const first = createInitialGame({ playerCount: 4, seed: 'same-seed' });
    const second = createInitialGame({ playerCount: 4, seed: 'same-seed' });
    const other = createInitialGame({ playerCount: 4, seed: 'other-seed' });
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(other));
  });

  it('随机先手：庄家座位合法，先手是庄家下一位', () => {
    const state = createInitialGame({ playerCount: 5, seed: 'dealer-seat' });
    expect(state.dealerSeat).toBeGreaterThanOrEqual(0);
    expect(state.dealerSeat).toBeLessThan(5);
    expect(nominalFirstSeat(state)).toBeGreaterThanOrEqual(0);
  });

  it('human 先手模式：庄家是人类的右手边', () => {
    const state = createInitialGame({ playerCount: 4, startingPlayer: 'human', seed: 'human-first' });
    expect(state.dealerSeat).toBe(prevSeat(state.config.humanSeat, 4));
  });

  it('默认规则值正确（宽松叠牌 / 2 人规则 / UNO 罚 2 张 / 牌堆洗回）', () => {
    const state = createInitialGame({ playerCount: 4, seed: 'defaults' });
    expect(state.config.stacking).toBe('loose');
    expect(state.config.twoPlayerRules).toBe(true);
    expect(state.config.unoPenalty).toBe(2);
    expect(state.config.challengeWild4).toBe(true);
    expect(state.config.wild4Legality).toBe('color-only');
    expect(state.config.startCardRule).toBe('classic');
    expect(state.config.deckExhaustion).toBe('reshuffle');
    expect(state.config.aiDifficulty).toBe('realistic');
  });

  it('非法配置抛 RangeError', () => {
    expect(() => createInitialGame({ playerCount: 1 })).toThrow(RangeError);
    expect(() => createInitialGame({ playerCount: 11 })).toThrow(RangeError);
    expect(() => createInitialGame({ playerCount: 4, humanSeat: 4 })).toThrow(RangeError);
    expect(() => createInitialGame({ playerCount: 4, unoPenalty: -1 })).toThrow(RangeError);
    expect(() =>
      createInitialGame({ playerCount: 4, names: ['只有两个', '名字'] }),
    ).toThrow(RangeError);
  });
});

describe('起手翻牌规则', () => {
  it('起手数字牌：确定当前颜色，进入正常回合', () => {
    const state = findGame((candidate) => topCard(candidate).kind === 'number');
    expect(state.currentColor).toBe(topCard(state).color);
    expect(state.phase).toBe('await-play');
    expect(state.pendingColorChoiceSeat).toBeNull();
  });

  it('起手 Wild：等待首位玩家选色', () => {
    const state = findGame((candidate) => topCard(candidate).kind === 'wild');
    expect(state.phase).toBe('choose-color');
    expect(state.currentColor).toBeNull();
    expect(state.pendingColorChoiceSeat).toBe(state.currentSeat);
    expect(state.events.some((event) => event.type === 'START_CARD')).toBe(true);
  });

  it('起手 Skip：首位玩家被跳过，轮到其下一位', () => {
    const state = findGame((candidate) => hasEvent(candidate, 'SKIP'));
    const first = nominalFirstSeat(state);
    expect(state.currentSeat).toBe(nextSeat(first, state.config.playerCount, 1));
    expect(state.currentColor).toBe(topCard(state).color);
    expect(countCards(state)).toBe(108);
  });

  it('起手 Reverse：方向反转，由庄家先手', () => {
    const state = findGame((candidate) => hasEvent(candidate, 'REVERSE'));
    expect(state.direction).toBe(-1);
    expect(state.currentSeat).toBe(prevSeat(nominalFirstSeat(state), state.config.playerCount));
    expect(countCards(state)).toBe(108);
  });

  it('起手 +2：首位玩家摸 2 张并被跳过', () => {
    const state = findGame((candidate) => hasEvent(candidate, 'DRAW'));
    const first = nominalFirstSeat(state);
    const drawEvent = state.events.find((event) => event.type === 'DRAW');
    const drawCount = drawEvent?.type === 'DRAW' ? drawEvent.count : 0;

    expect(drawCount).toBe(2);
    expect(state.players[first]!.hand).toHaveLength(9);
    expect(state.currentSeat).toBe(nextSeat(first, state.config.playerCount, 1));
    expect(countCards(state)).toBe(108);
  });

  it('起手 Wild+4：放回重洗重翻，最终起手不是 Wild+4', () => {
    const state = findGame((candidate) => hasEvent(candidate, 'PILE_RESHUFFLE'));
    expect(topCard(state).kind).not.toBe('wild4');
    expect(state.discardPile.filter((card) => card.kind === 'wild4')).toHaveLength(0);
    expect(countCards(state)).toBe(108);
  });

  it('ignore-action 模式：忽略动作牌重新翻，最终起手为数字或 Wild', () => {
    const state = findGame((candidate) => hasEvent(candidate, 'START_CARD_IGNORED'), {
      startCardRule: 'ignore-action',
    });
    expect(['number', 'wild']).toContain(topCard(state).kind);
    expect(hasEvent(state, 'SKIP')).toBe(false);
    expect(hasEvent(state, 'REVERSE')).toBe(false);
    expect(hasEvent(state, 'DRAW')).toBe(false);
    for (const player of state.players) expect(player.hand).toHaveLength(7);
    expect(countCards(state)).toBe(108);
  });
});
