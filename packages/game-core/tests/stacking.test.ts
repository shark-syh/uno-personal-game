import { describe, expect, it } from 'vitest';
import { applyAction, countCards, createInitialGame, getLegalActions } from '../src/index.ts';
import type { Card, CardKind, Color, GameState } from '../src/types.ts';

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
const draw2 = (color: Color): Card => makeCard('draw2', color, null);
const wild = (): Card => makeCard('wild', null, null, 'WC');
const wild4 = (): Card => makeCard('wild4', null, null, 'W4');

interface StateOptions {
  drawPile?: Card[];
  config?: Partial<GameState['config']>;
}

/** 默认抽牌堆：足够任何叠牌结算（20 张），内容无所谓 */
function defaultDrawPile(): Card[] {
  return Array.from({ length: 20 }, (_, index) => num('blue', index % 10));
}

/**
 * 构造可控测试局面：座位 0 先手，顶牌与各家手牌可指定。
 * 默认配置为宽松叠牌（DEFAULT_GAME_CONFIG）。
 */
function makeState(hands: Card[][], top: Card, options: StateOptions = {}): GameState {
  const state = createInitialGame({
    playerCount: hands.length,
    seed: 'stacking-test',
    names: hands.map((_, index) => `P${index}`),
  });

  state.phase = 'await-play';
  state.currentSeat = 0;
  state.direction = 1;
  state.currentColor = top.color;
  state.pendingColorChoiceSeat = null;
  state.drawnThisTurn = null;
  state.discardPile = [top];
  state.drawPile = options.drawPile ?? defaultDrawPile();
  state.players.forEach((player, seat) => {
    player.hand = hands[seat] ?? [];
  });
  state.events = [];
  state.history = [];
  state.winnerSeat = null;
  state.turnCount = 0;
  state.wild4Info = null;
  state.unoWindow = null;
  // M1-6 起：出牌剩 1 张会进入 UNO 窗口；叠牌用例默认自动喊 UNO，避免窗口干扰
  state.config = { ...state.config, autoCallUno: true, ...options.config };
  return state;
}

const threeHands = (hand0: Card[], hand1: Card[]): Card[][] => [hand0, hand1, [num('yellow', 9)]];

function lastEvents(state: GameState): string[] {
  return state.events.map((event) => event.type);
}

describe('M1-4 宽松叠牌链：进入响应与弃权结算', () => {
  it('正常回合打出 +2：进入叠牌响应，不等同于立即摸牌', () => {
    const draw2Card = draw2('red');
    const state = makeState(
      threeHands([draw2Card, num('blue', 5)], [num('green', 9)]),
      num('red', 3),
    );
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: draw2Card.id });

    expect(result.state.phase).toBe('stack-response');
    expect(result.state.stack).toMatchObject({
      total: 2,
      lastPlayer: 0,
      topColor: 'red',
      awaitingSeat: 1,
    });
    expect(result.state.stack?.chain.map((card) => card.id)).toEqual([draw2Card.id]);
    expect(result.state.currentSeat).toBe(1);
    // 下家还没有摸牌：等待其选择"叠牌或弃权"
    expect(result.state.players[1]!.hand).toHaveLength(1);
    expect(result.events.find((event) => event.type === 'STACK_PUSH')).toMatchObject({
      seat: 0,
      total: 2,
    });
    expect(lastEvents(result.state)).not.toContain('DRAW');
  });

  it('下家弃权：摸累计张数并失去回合，叠牌链清空', () => {
    const draw2Card = draw2('red');
    const state = makeState(
      threeHands([draw2Card, num('blue', 5)], [num('green', 9)]),
      num('red', 3),
    );
    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: draw2Card.id });
    const result = applyAction(entered.state, { type: 'STACK_DECLINE' });

    expect(result.state.stack).toBeNull();
    expect(result.state.phase).toBe('await-play');
    expect(result.state.currentSeat).toBe(2); // 摸牌者的下一位
    expect(result.state.players[1]!.hand).toHaveLength(3); // 1 + 2
    expect(result.events.some((event) => event.type === 'STACK_RESOLVE' && event.seat === 1)).toBe(
      true,
    );
    expect(result.events.some((event) => event.type === 'DRAW' && event.count === 2)).toBe(true);
    // 合成局面：校验牌数守恒（摸牌只移动牌，不增不减）
    expect(countCards(result.state)).toBe(countCards(state));
  });
});

describe('M1-4 宽松叠牌链：叠牌、累计与颜色', () => {
  it('下家叠 +2：累计 4，由再下家继续响应', () => {
    const first = draw2('red');
    const second = draw2('blue');
    const state = makeState(
      [[first, num('blue', 5)], [second, num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
    );
    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: first.id });
    const result = applyAction(entered.state, { type: 'STACK_PLAY', cardId: second.id });

    expect(result.state.phase).toBe('stack-response');
    expect(result.state.stack).toMatchObject({
      total: 4,
      awaitingSeat: 2,
      lastPlayer: 1,
      topColor: 'blue',
    });
    expect(result.state.stack?.chain.map((card) => card.id)).toEqual([first.id, second.id]);
    expect(result.state.currentColor).toBe('blue');
    expect(result.state.currentSeat).toBe(2);
    expect(result.state.players[1]!.hand).toHaveLength(1); // 叠牌已打出手
    expect(
      result.events.find((event) => event.type === 'STACK_PUSH' && event.seat === 1),
    ).toMatchObject({ total: 4 });
    expect(countCards(result.state)).toBe(countCards(state));
  });

  it('宽松叠法：+2 与 +4 可互叠，颜色以链上最后一张为准', () => {
    // 0 出红 +2 → 1 叠 +4（选蓝）→ 2 叠绿 +2：累计 8，颜色绿
    const first = draw2('red');
    const middle = wild4();
    const last = draw2('green');
    const state = makeState(
      [
        [first, num('blue', 5)],
        [middle, num('green', 9)],
        [last, num('yellow', 9)],
      ],
      num('red', 3),
    );
    const afterFirst = applyAction(state, { type: 'PLAY_CARD', cardId: first.id });
    const afterMiddle = applyAction(afterFirst.state, {
      type: 'STACK_PLAY',
      cardId: middle.id,
      colorChoice: 'blue',
    });
    expect(afterMiddle.state.stack?.total).toBe(6);
    expect(afterMiddle.state.currentColor).toBe('blue');

    const result = applyAction(afterMiddle.state, { type: 'STACK_PLAY', cardId: last.id });
    expect(result.state.stack).toMatchObject({ total: 8, topColor: 'green', awaitingSeat: 0 });
    expect(result.state.currentColor).toBe('green');
    expect(result.state.currentSeat).toBe(0);
    expect(result.state.discardPile.map((card) => card.id).slice(-3)).toEqual([
      first.id,
      middle.id,
      last.id,
    ]);
  });

  it('弃权结算：2+4+2 累计 8 张，之后轮到摸牌者的下一位', () => {
    const first = draw2('red');
    const middle = wild4();
    const last = draw2('green');
    const state = makeState(
      [
        [first, num('blue', 5)],
        [middle, num('green', 9)],
        [last, num('yellow', 9)],
      ],
      num('red', 3),
    );
    const afterFirst = applyAction(state, { type: 'PLAY_CARD', cardId: first.id });
    const afterMiddle = applyAction(afterFirst.state, {
      type: 'STACK_PLAY',
      cardId: middle.id,
      colorChoice: 'blue',
    });
    const afterLast = applyAction(afterMiddle.state, { type: 'STACK_PLAY', cardId: last.id });
    const resolved = applyAction(afterLast.state, { type: 'STACK_DECLINE' });

    expect(resolved.state.stack).toBeNull();
    expect(resolved.state.currentSeat).toBe(1); // 0 摸牌后轮到 1
    expect(resolved.state.players[0]!.hand).toHaveLength(1 + 8); // 出牌剩 1 张 + 摸 8
    expect(
      resolved.events.some(
        (event) => event.type === 'STACK_RESOLVE' && event.seat === 0 && event.total === 8,
      ),
    ).toBe(true);
    expect(resolved.events.some((event) => event.type === 'DRAW' && event.count === 8)).toBe(true);
    expect(countCards(resolved.state)).toBe(countCards(state));
  });

  it('叠牌链跟随当前方向（逆时针时轮到上一位）', () => {
    const draw2Card = draw2('red');
    const state = makeState(
      threeHands([draw2Card, num('blue', 5)], [num('green', 9)]),
      num('red', 3),
    );
    state.direction = -1;
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: draw2Card.id });
    expect(result.state.stack?.awaitingSeat).toBe(2);
    expect(result.state.currentSeat).toBe(2);
  });
});

describe('M1-4 叠牌响应阶段的可选动作', () => {
  it('有 +2/+4 也可弃权；合法动作只含叠牌与弃权', () => {
    const played = draw2('red');
    const heldDraw2 = draw2('green');
    const heldWild4 = wild4();
    const state = makeState(
      [[played, num('blue', 5)], [heldDraw2, heldWild4, num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
    );
    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: played.id });
    const actions = getLegalActions(entered.state);

    expect(
      actions.every((action) => action.type === 'STACK_PLAY' || action.type === 'STACK_DECLINE'),
    ).toBe(true);
    const stackPlays = actions.filter((action) => action.type === 'STACK_PLAY');
    expect(stackPlays.some((action) => action.cardId === heldDraw2.id)).toBe(true);
    expect(stackPlays.filter((action) => action.cardId === heldWild4.id)).toHaveLength(4);
    expect(actions.filter((action) => action.type === 'STACK_DECLINE')).toHaveLength(1);

    // 有叠牌也可以弃权（宽松叠法下叠牌可选）
    const declined = applyAction(entered.state, { type: 'STACK_DECLINE' });
    expect(declined.state.players[1]!.hand).toHaveLength(3 + 2);
    expect(declined.state.stack).toBeNull();
  });

  it('叠牌响应阶段：非叠牌动作全部非法', () => {
    const played = draw2('red');
    const numberCard = num('blue', 5);
    const heldWild = wild();
    const heldWild4 = wild4();
    const state = makeState(
      [[played, num('blue', 7)], [numberCard, heldWild, heldWild4], [num('yellow', 9)]],
      num('red', 3),
    );
    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: played.id });

    expect(() =>
      applyAction(entered.state, { type: 'PLAY_CARD', cardId: numberCard.id }),
    ).toThrow();
    expect(() => applyAction(entered.state, { type: 'DRAW' })).toThrow();
    expect(() => applyAction(entered.state, { type: 'END_TURN' })).toThrow();
    expect(() =>
      applyAction(entered.state, { type: 'STACK_PLAY', cardId: numberCard.id }),
    ).toThrow();
    expect(() => applyAction(entered.state, { type: 'STACK_PLAY', cardId: heldWild.id })).toThrow();
    // 叠牌链里的 +4 同样必须选色
    expect(() =>
      applyAction(entered.state, { type: 'STACK_PLAY', cardId: heldWild4.id }),
    ).toThrow();
  });
});

describe('M1-4 叠牌与 2 人规则 / +4 挑战隐藏信息', () => {
  function makeTwoPlayerState(hand0: Card[], hand1: Card[], top: Card): GameState {
    const state = makeState([hand0, hand1], top);
    state.config = { ...state.config, twoPlayerRules: true };
    return state;
  }

  it('2 人：对方弃权摸完累计牌后回合回到最后出叠牌者', () => {
    const first = draw2('red');
    const middle = wild4();
    const state = makeTwoPlayerState(
      [first, num('blue', 5)],
      [middle, num('green', 9)],
      num('red', 3),
    );

    const afterFirst = applyAction(state, { type: 'PLAY_CARD', cardId: first.id });
    expect(afterFirst.state.currentSeat).toBe(1);
    const afterMiddle = applyAction(afterFirst.state, {
      type: 'STACK_PLAY',
      cardId: middle.id,
      colorChoice: 'blue',
    });
    expect(afterMiddle.state.stack).toMatchObject({ total: 6, lastPlayer: 1, awaitingSeat: 0 });

    const resolved = applyAction(afterMiddle.state, { type: 'STACK_DECLINE' });
    expect(resolved.state.phase).toBe('await-play');
    expect(resolved.state.currentSeat).toBe(1); // 回到最后出叠牌者
    expect(resolved.state.players[0]!.hand).toHaveLength(1 + 6);
  });

  it('2 人：对方弃权单张 +2 后回合回到出牌者（连动）', () => {
    const draw2Card = draw2('red');
    const state = makeTwoPlayerState([draw2Card, num('blue', 5)], [num('green', 9)], num('red', 3));

    const afterPlay = applyAction(state, { type: 'PLAY_CARD', cardId: draw2Card.id });
    const resolved = applyAction(afterPlay.state, { type: 'STACK_DECLINE' });
    expect(resolved.state.currentSeat).toBe(0);
    expect(resolved.state.players[1]!.hand).toHaveLength(3); // 1 + 2
  });

  it('叠牌链中的 +4 不开放挑战；普通回合的 +4 仍记录可挑战', () => {
    const normalWild4 = wild4();
    const chainWild4 = wild4();
    const state = makeState(
      [[normalWild4, num('blue', 5)], [chainWild4, num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
    );

    const normal = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: normalWild4.id,
      colorChoice: 'red',
    });
    expect(normal.state.wild4Info).toMatchObject({ seat: 0, challengeable: true });
    expect(normal.state.stack).toMatchObject({ total: 4, awaitingSeat: 1 });

    const chained = applyAction(normal.state, {
      type: 'STACK_PLAY',
      cardId: chainWild4.id,
      colorChoice: 'blue',
    });
    expect(chained.state.wild4Info).toMatchObject({ seat: 1, challengeable: false });
    expect(chained.state.stack).toMatchObject({ total: 8, topColor: 'blue' });
    expect(chained.state.currentColor).toBe('blue');
  });
});

describe('M1-4 边界：最后一张获胜 / 洗回 / 关闭叠牌', () => {
  it('叠牌过程中打出最后一张 +2：立即获胜，下家仍摸累计张数', () => {
    const first = draw2('red');
    const last = draw2('green');
    const state = makeState([[first, num('blue', 5)], [last], [num('yellow', 9)]], num('red', 3));
    const afterFirst = applyAction(state, { type: 'PLAY_CARD', cardId: first.id });
    const result = applyAction(afterFirst.state, { type: 'STACK_PLAY', cardId: last.id });

    expect(result.state.phase).toBe('round-end');
    expect(result.state.winnerSeat).toBe(1);
    expect(result.state.stack).toBeNull();
    expect(result.state.players[2]!.hand).toHaveLength(1 + 4); // 仪式性摸 4 张
    expect(
      result.events.some(
        (event) => event.type === 'STACK_RESOLVE' && event.seat === 2 && event.total === 4,
      ),
    ).toBe(true);
    expect(
      result.events.some((event) => event.type === 'ROUND_END' && event.winnerSeat === 1),
    ).toBe(true);
    expect(countCards(result.state)).toBe(countCards(state));
  });

  it('普通回合打出最后一张 +2：立即获胜，下家仍摸 2 张（叠牌链不保留）', () => {
    const draw2Card = draw2('red');
    const state = makeState(threeHands([draw2Card], [num('green', 9)]), num('red', 3));
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: draw2Card.id });

    expect(result.state.phase).toBe('round-end');
    expect(result.state.winnerSeat).toBe(0);
    expect(result.state.stack).toBeNull();
    expect(result.state.players[1]!.hand).toHaveLength(3);
  });

  it('弃权摸牌时抽牌堆不足：弃牌堆洗回后继续摸', () => {
    const draw2Card = draw2('red');
    const state = makeState(
      threeHands([draw2Card, num('blue', 5)], [num('green', 9)]),
      num('red', 3),
      {
        drawPile: [],
      },
    );
    state.discardPile = [num('blue', 7), num('green', 8), num('red', 3)];
    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: draw2Card.id });
    const result = applyAction(entered.state, { type: 'STACK_DECLINE' });

    expect(result.events.some((event) => event.type === 'PILE_RESHUFFLE')).toBe(true);
    expect(result.state.players[1]!.hand).toHaveLength(3); // 1 + 2
    expect(result.state.currentSeat).toBe(2);
  });

  it("stacking='none'：回退为立即摸牌并跳过（M1-3 行为）", () => {
    const draw2Card = draw2('red');
    const state = makeState(
      threeHands([draw2Card, num('blue', 5)], [num('green', 9)]),
      num('red', 3),
      {
        config: { stacking: 'none' },
      },
    );
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: draw2Card.id });

    expect(result.state.phase).toBe('await-play');
    expect(result.state.stack).toBeNull();
    expect(result.state.players[1]!.hand).toHaveLength(3);
    expect(result.state.currentSeat).toBe(2);
    expect(result.events.some((event) => event.type === 'SKIP' && event.seat === 1)).toBe(true);
  });
});
