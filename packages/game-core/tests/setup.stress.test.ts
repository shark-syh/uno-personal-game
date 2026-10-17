import { describe, expect, it } from 'vitest';
import { countCards, createInitialGame } from '../src/setup.ts';
import type { CardKind, GameState } from '../src/types.ts';

const topCard = (state: GameState) => state.discardPile[state.discardPile.length - 1]!;

const hasEvent = (state: GameState, type: string): boolean =>
  state.events.some((event) => event.type === type);

/**
 * 开局压力校验：多人 × 多种子，验证不变量。
 * 不验证具体随机结果，只验证规则不变量与牌数守恒。
 */
describe('开局压力校验（多人数 × 多种子）', () => {
  it('1500 局开局：牌数守恒、id 唯一、手牌数正确、起始牌型合理', () => {
    const playerCounts = [2, 5, 10];
    const startKinds = new Map<CardKind, number>();
    let reshuffleSeen = 0;

    for (const playerCount of playerCounts) {
      for (let index = 0; index < 500; index += 1) {
        const state = createInitialGame({ playerCount, seed: `stress-${playerCount}-${index}` });

        // 1) 牌数守恒：手牌 + 抽牌堆 + 弃牌堆 = 108
        expect(countCards(state)).toBe(108);

        // 2) 全牌 id 唯一（没有复制/丢牌）
        const allCards = [
          ...state.players.flatMap((player) => player.hand),
          ...state.drawPile,
          ...state.discardPile,
        ];
        expect(allCards).toHaveLength(108);
        expect(new Set(allCards.map((card) => card.id)).size).toBe(108);

        // 3) 弃牌堆只有起手牌一张
        expect(state.discardPile).toHaveLength(1);

        // 4) 手牌数量：基础每人 7 张；起手 +2 时首位玩家 9 张
        const drawEffect = hasEvent(state, 'DRAW');
        const totalHands = state.players.reduce((sum, player) => sum + player.hand.length, 0);
        expect(totalHands).toBe(playerCount * 7 + (drawEffect ? 2 : 0));

        // 5) 起手牌型统计（wild4 一定被重洗，不应出现）
        const card = topCard(state);
        startKinds.set(card.kind, (startKinds.get(card.kind) ?? 0) + 1);
        expect(card.kind).not.toBe('wild4');

        if (hasEvent(state, 'PILE_RESHUFFLE')) reshuffleSeen += 1;
      }
    }

    // 6) 1500 局里，各种合法起手牌型都应该出现过
    for (const kind of ['number', 'skip', 'reverse', 'draw2', 'wild'] as const) {
      expect(startKinds.get(kind) ?? 0, `起手牌型 ${kind} 应该出现过`).toBeGreaterThan(0);
    }
    // 数字牌占绝对多数（76/104），数量应在合理区间
    const numberCount = startKinds.get('number') ?? 0;
    expect(numberCount).toBeGreaterThan(900);
    expect(numberCount).toBeLessThan(1350);
    // 起手 Wild+4 重洗至少发生过
    expect(reshuffleSeen).toBeGreaterThan(0);
  }, 30000);

  it('同一 seed 重复创建 20 次，状态完全一致（可复现）', () => {
    for (let index = 0; index < 20; index += 1) {
      const seed = `replay-${index}`;
      const first = createInitialGame({ playerCount: 4, seed });
      const second = createInitialGame({ playerCount: 4, seed });
      expect(first).toEqual(second);
    }
  }, 15000);
});
