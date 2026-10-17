import { describe, expect, it } from 'vitest';
import { applyAction, createInitialGame } from '@uno/game-core';
import {
  buildMemory,
  estimatePlayerHasColor,
  getAiView,
  INITIAL_COLOR_COUNTS,
  INITIAL_KIND_COUNTS,
  probabilityAtLeastOne,
} from '../src/index.ts';
import { draw2, makeState, num, skip, wild, wild4 } from './helpers.ts';

describe('M2 记牌器：初始牌组口径', () => {
  it('初始张数由引擎牌组推导：4 色各 25 张、Wild/Wild4 各 4 张、总数 108', () => {
    const colors = Object.values(INITIAL_COLOR_COUNTS);
    expect(colors).toEqual([25, 25, 25, 25]);
    expect(colors.reduce((sum, count) => sum + count, 0)).toBe(100);
    expect(INITIAL_KIND_COUNTS.wild).toBe(4);
    expect(INITIAL_KIND_COUNTS.wild4).toBe(4);
    expect(INITIAL_KIND_COUNTS.draw2).toBe(8);
    expect(Object.values(INITIAL_KIND_COUNTS).reduce((sum, count) => sum + count, 0)).toBe(108);
  });
});

describe('M2 记牌器：公开信息统计', () => {
  it('remainingByColor = 初始张数 - 已公开（弃牌堆 + 自己手牌）', () => {
    const state = makeState(
      [
        [num('red', 5), wild4()],
        [num('green', 9), draw2('blue')],
      ],
      num('red', 3),
      {
        discardPile: [num('red', 3), num('red', 8), wild(), skip('green')],
        drawPile: Array.from({ length: 20 }, (_, index) => num('yellow', index % 10)),
      },
    );
    const view = getAiView(state, 0);
    const memory = buildMemory(view);

    // 已公开：弃牌堆 4 张（红3、红8、Wild、绿Skip）+ 自己手牌 2 张（红5、Wild4）
    expect(memory.seenCards).toBe(6);
    expect(memory.remainingByColor.red).toBe(25 - 3);
    expect(memory.remainingByColor.green).toBe(25 - 1);
    expect(memory.remainingByColor.yellow).toBe(25);
    expect(memory.remainingByColor.blue).toBe(25);
    expect(memory.wildsRemaining).toBe(4 - 1);
    expect(memory.wild4Remaining).toBe(4 - 1);
    expect(memory.unknownCards).toBe(20 + state.players[1]!.hand.length);
  });

  it('真实对局中：已公开 + 未公开 = 108（守恒）', () => {
    for (const playerCount of [2, 4, 7]) {
      const state = createInitialGame({ playerCount, seed: `memory-${playerCount}` });
      const view = getAiView(state, 0);
      const memory = buildMemory(view);
      expect(memory.seenCards + memory.unknownCards).toBe(108);
      for (const color of ['red', 'yellow', 'green', 'blue'] as const) {
        expect(memory.remainingByColor[color]).toBeGreaterThanOrEqual(0);
        expect(memory.remainingByColor[color]).toBeLessThanOrEqual(25);
      }
    }
  });

  it('只依赖公开信息：交换其他玩家的手牌内容（数量不变）不影响记牌结果', () => {
    const stateA = makeState(
      [
        [num('red', 5), num('blue', 2)],
        [num('green', 9), skip('green')],
        [num('yellow', 7), draw2('yellow')],
      ],
      num('red', 3),
    );
    const stateB = makeState(
      [
        [num('red', 5), num('blue', 2)],
        [num('yellow', 7), draw2('yellow')],
        [num('green', 9), skip('green')],
      ],
      num('red', 3),
    );
    // 仅交换座位 1 / 2 的整手牌（数量相同），不改变任何公开信息
    const memoryA = buildMemory(getAiView(stateA, 0));
    const memoryB = buildMemory(getAiView(stateB, 0));
    expect(memoryA).toEqual(memoryB);
  });

  it('记录公开行为统计：出牌颜色、动作牌、被挑战成功/失败', () => {
    const state = makeState([[num('red', 5)], [num('blue', 2)]], num('red', 1));
    state.history = [
      { type: 'PLAY', seat: 1, card: num('green', 9) },
      { type: 'PLAY', seat: 1, card: draw2('blue') },
      { type: 'PLAY', seat: 1, card: wild4() },
      { type: 'DRAW', seat: 1, count: 3, cards: [] },
      { type: 'CHALLENGE_SUCCESS', challenger: 0, target: 1 },
      { type: 'CHALLENGE_FAIL', challenger: 0, target: 1, penalty: 6 },
    ];
    const memory = buildMemory(getAiView(state, 0));
    const player1 = memory.players.find((player) => player.seat === 1)!;
    expect(player1.plays).toBe(3);
    expect(player1.colorsPlayed.green).toBe(1);
    expect(player1.colorsPlayed.blue).toBe(1);
    expect(player1.actionCardsPlayed).toBe(2);
    expect(player1.wild4Played).toBe(1);
    expect(player1.draws).toBe(3);
    expect(player1.wild4BluffsCaught).toBe(1);
    expect(player1.wild4LegalProven).toBe(1);
    expect(memory.challengeSuccesses).toBe(1);
    expect(memory.challengeFails).toBe(1);
  });

  it('挑战窗口：能从历史重建 +4 前的颜色（用于挑战概率估计）', () => {
    const state = makeState(
      [
        [wild4(), num('red', 5)],
        [num('green', 9), num('blue', 2)],
      ],
      num('red', 3),
    );
    state.history = [{ type: 'START_CARD', card: state.discardPile[0]! }];
    const played = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: state.players[0]!.hand[0]!.id,
      colorChoice: 'blue',
    });
    const declined = applyAction(played.state, { type: 'STACK_DECLINE' });
    const memory = buildMemory(getAiView(declined.state, 1));
    expect(memory.colorBeforeLastWild4).toBe('red');
  });
});

describe('M2 记牌器：概率工具', () => {
  it('probabilityAtLeastOne 边界与单调性', () => {
    expect(probabilityAtLeastOne(0, 30, 5)).toBe(0);
    expect(probabilityAtLeastOne(10, 30, 0)).toBe(0);
    expect(probabilityAtLeastOne(30, 30, 1)).toBe(1);
    expect(probabilityAtLeastOne(30, 30, 5)).toBe(1);
    const low = probabilityAtLeastOne(5, 100, 3);
    const high = probabilityAtLeastOne(20, 100, 3);
    expect(high).toBeGreaterThan(low);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeLessThan(1);
  });

  it('estimatePlayerHasColor：不记牌档用均匀值，其余档随剩余张数单调', () => {
    const state = makeState([[num('red', 5)], [num('blue', 2)]], num('red', 1), {
      discardPile: [num('red', 1)],
    });
    const memory = buildMemory(getAiView(state, 0));

    expect(estimatePlayerHasColor(memory, 3, 'red', 'none')).toBe(0.5);
    expect(estimatePlayerHasColor(memory, 0, 'red', 'full')).toBe(0);

    const withManyRed = { ...memory, remainingByColor: { ...memory.remainingByColor, red: 24 } };
    const withFewRed = { ...memory, remainingByColor: { ...memory.remainingByColor, red: 2 } };
    expect(estimatePlayerHasColor(withManyRed, 3, 'red', 'full')).toBeGreaterThan(
      estimatePlayerHasColor(withFewRed, 3, 'red', 'full'),
    );
    expect(estimatePlayerHasColor(withManyRed, 3, 'red', 'colors')).toBeGreaterThan(
      estimatePlayerHasColor(withFewRed, 3, 'red', 'colors'),
    );
  });
});
