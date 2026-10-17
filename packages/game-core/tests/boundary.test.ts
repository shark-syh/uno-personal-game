import { describe, expect, it } from 'vitest';
import {
  applyAction,
  countCards,
  createInitialGame,
  getLegalActions,
  getResult,
  isTerminal,
} from '../src/index.ts';
import { createRng, nextInt } from '../src/rng.ts';
import type { Card, CardKind, Color, EngineAction, GameState } from '../src/types.ts';

let cardSequence = 0;

function makeCard(
  kind: CardKind,
  color: Color | null,
  value: number | null,
  faceCode?: string,
): Card {
  cardSequence += 1;
  return {
    id: `${faceCode ?? kind}-${cardSequence}`,
    kind,
    color,
    value,
    faceCode: faceCode ?? `${kind}-${cardSequence}`,
  };
}

const num = (color: Color, value: number): Card => makeCard('number', color, value);
const skip = (color: Color): Card => makeCard('skip', color, null);
const reverse = (color: Color): Card => makeCard('reverse', color, null);
const draw2 = (color: Color): Card => makeCard('draw2', color, null);
const wild = (): Card => makeCard('wild', null, null, 'WC');
const wild4 = (): Card => makeCard('wild4', null, null, 'W4');

interface StateOptions {
  drawPile?: Card[];
  discardPile?: Card[];
  config?: Partial<GameState['config']>;
  currentSeat?: number;
  direction?: 1 | -1;
}

function defaultDrawPile(): Card[] {
  return Array.from({ length: 30 }, (_, index) => num('blue', index % 10));
}

/** 构造可控测试局面：默认座位 0 先手、人类座位 0、自动喊 UNO（隔离 M1-6 窗口） */
function makeState(hands: Card[][], top: Card, options: StateOptions = {}): GameState {
  const state = createInitialGame({
    playerCount: hands.length,
    seed: 'boundary-test',
    names: hands.map((_, index) => `P${index}`),
  });

  state.phase = 'await-play';
  state.currentSeat = options.currentSeat ?? 0;
  state.direction = options.direction ?? 1;
  state.currentColor = top.color;
  state.pendingColorChoiceSeat = null;
  state.drawnThisTurn = null;
  state.discardPile = options.discardPile ?? [top];
  state.drawPile = options.drawPile ?? defaultDrawPile();
  state.players.forEach((player, seat) => {
    player.hand = hands[seat] ?? [];
    player.saidUno = false;
  });
  state.events = [];
  state.history = [];
  state.winnerSeat = null;
  state.endReason = null;
  state.turnCount = 0;
  state.actionCount = 0;
  state.wild4Info = null;
  state.pendingChallenge = null;
  state.unoWindow = null;
  state.config = { ...state.config, autoCallUno: true, ...options.config };
  return state;
}

const eventTypes = (state: GameState): string[] => state.events.map((event) => event.type);

describe('M1-7 牌堆耗尽（默认 reshuffle 策略）', () => {
  it('抽牌堆空、弃牌堆可回收：洗回弃牌堆（保留顶牌）后继续摸牌', () => {
    const state = makeState(
      [[num('blue', 5)], [num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
      {
        drawPile: [],
        discardPile: [num('green', 1), num('blue', 2), num('red', 3)],
      },
    );
    const result = applyAction(state, { type: 'DRAW' });

    expect(result.state.phase).toBe('await-play');
    expect(
      result.events.some((event) => event.type === 'PILE_RESHUFFLE' && event.reason === 'draw'),
    ).toBe(true);
    expect(result.state.players[0]!.hand).toHaveLength(2);
    expect(result.state.discardPile).toHaveLength(1); // 只保留顶牌
    expect(result.state.discardPile[0]).toMatchObject({ id: state.discardPile[2]!.id });
    expect(countCards(result.state)).toBe(countCards(state));
  });

  it('弃牌堆只剩顶牌无法洗回：按手牌最少者结束本局并标注 deck-empty', () => {
    const state = makeState(
      [
        [num('blue', 5)],
        [], // 手牌最少
        [num('yellow', 9), num('yellow', 1)],
      ],
      num('red', 3),
      { drawPile: [], discardPile: [num('red', 3)] },
    );
    const result = applyAction(state, { type: 'DRAW' });

    expect(result.state.phase).toBe('round-end');
    expect(result.state.endReason).toBe('deck-empty');
    expect(result.state.winnerSeat).toBe(1);
    expect(result.events.some((event) => event.type === 'DRAW')).toBe(false);
    expect(result.state.events.find((event) => event.type === 'ROUND_END')).toMatchObject({
      winnerSeat: 1,
      reason: 'deck-empty',
    });
    expect(isTerminal(result.state)).toBe(true);
  });

  it('牌堆耗尽且最少手牌并列：平局（winnerSeat = null）', () => {
    const state = makeState(
      [[num('blue', 5)], [num('green', 9)], [num('yellow', 9), num('yellow', 1)]],
      num('red', 3),
      { drawPile: [], discardPile: [num('red', 3)] },
    );
    const result = applyAction(state, { type: 'DRAW' });

    expect(result.state.phase).toBe('round-end');
    expect(result.state.winnerSeat).toBeNull();
    expect(result.state.endReason).toBe('deck-empty');
    expect(result.events.find((event) => event.type === 'ROUND_END')).toMatchObject({
      winnerSeat: null,
      reason: 'deck-empty',
    });
    expect(getResult(result.state).isDraw).toBe(true);
  });
});

describe("M1-7 牌堆耗尽（deckExhaustion='end-by-fewest'）", () => {
  it('抽牌堆一空立即按手牌最少者结束，不洗回弃牌堆', () => {
    const state = makeState(
      [
        [num('blue', 5), num('blue', 6)],
        [num('green', 9)], // 唯一最少
        [num('yellow', 9), num('yellow', 1)],
      ],
      num('red', 3),
      {
        drawPile: [],
        discardPile: [num('green', 7), num('red', 3)],
        config: { deckExhaustion: 'end-by-fewest' },
      },
    );
    const result = applyAction(state, { type: 'DRAW' });

    expect(result.state.phase).toBe('round-end');
    expect(result.state.winnerSeat).toBe(1);
    expect(result.state.endReason).toBe('deck-empty');
    expect(result.events.some((event) => event.type === 'PILE_RESHUFFLE')).toBe(false);
    expect(result.state.discardPile).toHaveLength(2); // 弃牌堆原样保留，不洗回
    expect(result.state.players[0]!.hand).toHaveLength(2); // 没有摸到牌
  });

  it('摸牌效果中途耗尽（+2 结算）：立即结束本局，不再继续摸牌', () => {
    const draw2Card = draw2('red');
    const state = makeState(
      [
        [draw2Card, num('blue', 5), num('blue', 6)],
        [num('green', 9)],
        [num('yellow', 9), num('yellow', 1)],
      ],
      num('red', 3),
      {
        drawPile: [],
        discardPile: [num('green', 7), num('red', 3)],
        config: { stacking: 'none', deckExhaustion: 'end-by-fewest' },
      },
    );
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: draw2Card.id });

    expect(result.state.phase).toBe('round-end');
    expect(result.state.winnerSeat).toBe(1); // +2 的受害者手牌最少（1 张）
    expect(result.events.some((event) => event.type === 'DRAW')).toBe(false);
    expect(result.state.players[1]!.hand).toHaveLength(1); // 未摸牌
  });

  it('默认策略下 last-card 的仪式性摸牌不会反过来改变胜负', () => {
    const draw2Card = draw2('red');
    const state = makeState(
      [[draw2Card], [num('green', 9)], [num('yellow', 9), num('yellow', 1)]],
      num('red', 3),
      { drawPile: [], discardPile: [num('red', 3)] },
    );
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: draw2Card.id });

    expect(result.state.phase).toBe('round-end');
    expect(result.state.winnerSeat).toBe(0);
    expect(result.state.endReason).toBe('empty-hand');
    expect(result.events.filter((event) => event.type === 'ROUND_END')).toHaveLength(1);
    expect(result.events.find((event) => event.type === 'ROUND_END')).toMatchObject({
      reason: 'empty-hand',
    });
    // 弃牌堆只剩顶牌、无法继续洗回：下家能仪式性摸多少算多少，不影响胜负
    expect(result.state.players[1]!.hand).toHaveLength(1 + 1);
  });
});

describe('M1-7 胜负判定：最后一张牌', () => {
  const lastCards: Array<[string, Card, Color | undefined]> = [
    ['数字牌', num('red', 7), undefined],
    ['Skip', skip('red'), undefined],
    ['Reverse', reverse('red'), undefined],
    ['+2', draw2('red'), undefined],
    ['Wild', wild(), 'green'],
    ['Wild+4', wild4(), 'green'],
  ];

  for (const [label, card, colorChoice] of lastCards) {
    it(`最后一张是 ${label}：立即获胜并产生 PLAYER_OUT + ROUND_END`, () => {
      const state = makeState([[card], [num('green', 9)], [num('yellow', 9)]], num('red', 3));
      const result = applyAction(state, {
        type: 'PLAY_CARD',
        cardId: card.id,
        ...(colorChoice ? { colorChoice } : {}),
      });

      expect(result.state.phase).toBe('round-end');
      expect(result.state.winnerSeat).toBe(0);
      expect(result.state.endReason).toBe('empty-hand');
      expect(eventTypes(result.state)).toContain('PLAYER_OUT');
      expect(eventTypes(result.state)).toContain('ROUND_END');
      expect(result.state.players[0]!.hand).toHaveLength(0);
      expect(result.state.unoWindow).toBeNull();
      expect(countCards(result.state)).toBe(countCards(state));
    });
  }

  it('最后一张 +2/+4：下家仍摸牌（仪式感），但胜者已定；+4 不进入 UNO 窗口', () => {
    const plus2 = draw2('red');
    const state2 = makeState([[plus2], [num('green', 9)], [num('yellow', 9)]], num('red', 3));
    const result2 = applyAction(state2, { type: 'PLAY_CARD', cardId: plus2.id });
    expect(result2.state.winnerSeat).toBe(0);
    expect(result2.state.players[1]!.hand).toHaveLength(1 + 2);

    const plus4 = wild4();
    const state4 = makeState([[plus4], [num('green', 9)], [num('yellow', 9)]], num('red', 3));
    const result4 = applyAction(state4, {
      type: 'PLAY_CARD',
      cardId: plus4.id,
      colorChoice: 'blue',
    });
    expect(result4.state.winnerSeat).toBe(0);
    expect(result4.state.players[1]!.hand).toHaveLength(1 + 4);
    expect(result4.state.pendingChallenge).toBeNull();
  });
});

describe('M1-7 轮转边界（6~10 人）', () => {
  it('10 人局 Skip：跳过下一位，轮到下下位', () => {
    const skipCard = skip('red');
    const hands = Array.from({ length: 10 }, (_, seat) =>
      seat === 0 ? [skipCard, num('red', 5)] : [num('yellow', 9)],
    );
    const state = makeState(hands, num('red', 3));
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: skipCard.id });

    expect(result.state.currentSeat).toBe(2);
    expect(result.state.phase).toBe('await-play');
  });

  it('10 人局 Reverse：方向反转后轮到上一位（座位 9）', () => {
    const reverseCard = reverse('red');
    const hands = Array.from({ length: 10 }, (_, seat) =>
      seat === 0 ? [reverseCard, num('red', 5)] : [num('yellow', 9)],
    );
    const state = makeState(hands, num('red', 3));
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: reverseCard.id });

    expect(result.state.direction).toBe(-1);
    expect(result.state.currentSeat).toBe(9);
  });

  it('逆时针方向的 +2 叠牌链与弃权结算按 10 人轮转', () => {
    const first = draw2('red');
    const hands = Array.from({ length: 10 }, (_, seat) =>
      seat === 0 ? [first, num('red', 5)] : [num('yellow', 9)],
    );
    const state = makeState(hands, num('red', 3), { direction: -1 });
    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: first.id });
    expect(entered.state.stack?.awaitingSeat).toBe(9);

    const declined = applyAction(entered.state, { type: 'STACK_DECLINE' });
    expect(declined.state.phase).toBe('await-play');
    expect(declined.state.players[9]!.hand).toHaveLength(3); // 1 + 2
    expect(declined.state.currentSeat).toBe(8); // 逆时针：9 的下一位是 8
    expect(countCards(declined.state)).toBe(countCards(state));
  });

  it('对局结束后不能再执行动作，合法动作列表为空', () => {
    const red7 = num('red', 7);
    const state = makeState([[red7], [num('green', 9)], [num('yellow', 9)]], num('red', 3));
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: red7.id });

    expect(result.state.phase).toBe('round-end');
    expect(getLegalActions(result.state)).toHaveLength(0);
    expect(() => applyAction(result.state, { type: 'DRAW' })).toThrow();
    expect(isTerminal(state)).toBe(false);
    expect(isTerminal(result.state)).toBe(true);
  });
});

describe('M1-7 随机整局模拟（属性测试）', () => {
  /** 有牌能出就优先出（更像真人），避免"全随机抽牌"导致的对局无限拉长 */
  function choosePlayFirst(
    legal: EngineAction[],
    policy: ReturnType<typeof createRng>,
  ): EngineAction {
    const playable = legal.filter(
      (action) =>
        action.type === 'PLAY_CARD' || action.type === 'PLAY_DRAWN' || action.type === 'STACK_PLAY',
    );
    const pool = playable.length > 0 ? playable : legal;
    return pool[nextInt(policy, pool.length)]!;
  }

  it('60 局随机对局（2~10 人 × 两种牌堆策略）：无非法动作、牌数守恒、必然终止、胜负/平局自洽', () => {
    for (let index = 0; index < 60; index += 1) {
      const playerCount = 2 + (index % 9);
      const deckExhaustion = index % 2 === 0 ? 'reshuffle' : 'end-by-fewest';
      let state = createInitialGame({
        playerCount,
        seed: `m17-game-${index}`,
        deckExhaustion,
        autoCallUno: index % 3 === 0,
      });
      const policy = createRng(`m17-policy-${index}`);
      let actions = 0;

      while (!isTerminal(state)) {
        expect(actions).toBeLessThan(2000);
        const legal = getLegalActions(state);
        expect(legal.length).toBeGreaterThan(0);
        const result = applyAction(state, choosePlayFirst(legal, policy));
        state = result.state;
        actions += 1;
        expect(countCards(state)).toBe(108);
        expect(state.actionCount).toBe(actions);
      }

      expect(state.endReason).not.toBeNull();
      if (state.endReason === 'empty-hand') {
        expect(state.winnerSeat).not.toBeNull();
        expect(state.players[state.winnerSeat!]!.hand).toHaveLength(0);
        expect(getResult(state).reason).toBe('empty-hand');
      } else {
        const counts = state.players.map((player) => player.hand.length);
        const minCount = Math.min(...counts);
        const fewest = state.players.filter((player) => player.hand.length === minCount);
        if (state.winnerSeat === null) {
          expect(fewest.length).toBeGreaterThan(1); // 平局：最少手牌并列
        } else {
          expect(fewest.map((player) => player.seat)).toContain(state.winnerSeat);
        }
        expect(getResult(state).reason).toBe('deck-empty');
      }
    }
  }, 120000);
});
