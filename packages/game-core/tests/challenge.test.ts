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
  currentSeat?: number;
  direction?: 1 | -1;
}

/** 默认抽牌堆：足够任何挑战结算（30 张），内容无所谓 */
function defaultDrawPile(): Card[] {
  return Array.from({ length: 30 }, (_, index) => num('blue', index % 10));
}

/**
 * 构造可控测试局面（座位 0 默认先手，顶牌与各家手牌可指定）。
 * 默认配置 = DEFAULT_GAME_CONFIG（宽松叠牌、+4 可挑战、2 人规则开）。
 */
function makeState(hands: Card[][], top: Card, options: StateOptions = {}): GameState {
  const state = createInitialGame({
    playerCount: hands.length,
    seed: 'challenge-test',
    names: hands.map((_, index) => `P${index}`),
  });

  state.phase = 'await-play';
  state.currentSeat = options.currentSeat ?? 0;
  state.direction = options.direction ?? 1;
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
  state.pendingChallenge = null;
  state.unoWindow = null;
  // M1-6 起：出牌剩 1 张会进入 UNO 窗口；挑战/叠牌用例默认自动喊 UNO，避免窗口干扰
  state.config = { ...state.config, autoCallUno: true, ...options.config };
  return state;
}

/** 标准 3 人牌局：座位 0 出牌，1 为挑战者，2 为再下家 */
const threeHands = (hand0: Card[], hand1: Card[]): Card[][] => [hand0, hand1, [num('yellow', 9)]];

/** 让座位 0 打出 +4（选蓝），并让下家弃权叠牌，返回进入挑战窗口的状态 */
function enterChallenge(state: GameState, colorChoice: Color = 'blue'): GameState {
  const wild4Card = state.players[state.currentSeat]!.hand.find((card) => card.kind === 'wild4')!;
  const played = applyAction(state, {
    type: 'PLAY_CARD',
    cardId: wild4Card.id,
    colorChoice,
  });
  expect(played.state.phase).toBe('stack-response');
  const declined = applyAction(played.state, { type: 'STACK_DECLINE' });
  expect(declined.state.phase).toBe('challenge-decide');
  return declined.state;
}

describe('M1-5 +4 挑战：进入挑战窗口', () => {
  it('普通回合 +4 下家弃权：进入 challenge-decide，尚未摸牌', () => {
    const state = makeState(threeHands([wild4(), num('red', 5)], [num('green', 9)]), num('red', 3));
    const entered = enterChallenge(state);

    expect(entered.phase).toBe('challenge-decide');
    expect(entered.stack).toBeNull();
    expect(entered.pendingChallenge).toMatchObject({
      challengerSeat: 1,
      targetSeat: 0,
      total: 4,
    });
    expect(entered.currentSeat).toBe(1);
    // 挑战尚未做出选择：挑战者没有摸牌
    expect(entered.players[1]!.hand).toHaveLength(1);
    // +4 隐藏信息保留到挑战结算时才清空，并记录"违规"（手上有当前颜色红 5）
    expect(entered.wild4Info).toMatchObject({
      seat: 0,
      wasLegal: false,
      previousColor: 'red',
      challengeable: true,
    });
    expect(entered.events.some((event) => event.type === 'DRAW')).toBe(false);
    expect(countCards(entered)).toBe(countCards(state));
  });

  it('挑战窗口的合法动作只有「挑战」与「接受摸 4」，其他动作全部非法', () => {
    const state = makeState(threeHands([wild4(), num('red', 5)], [num('green', 9)]), num('red', 3));
    const entered = enterChallenge(state);
    const actions = getLegalActions(entered);

    expect(actions).toHaveLength(2);
    expect(new Set(actions.map((action) => action.type))).toEqual(
      new Set(['CHALLENGE_W4', 'DECLINE_CHALLENGE']),
    );

    expect(() => applyAction(entered, { type: 'DRAW' })).toThrow();
    expect(() => applyAction(entered, { type: 'END_TURN' })).toThrow();
    expect(() =>
      applyAction(entered, { type: 'PLAY_CARD', cardId: entered.players[1]!.hand[0]!.id }),
    ).toThrow();
    expect(() => applyAction(entered, { type: 'STACK_DECLINE' })).toThrow();
  });

  it('非挑战阶段不能执行挑战动作；挑战结算后也不能重复挑战', () => {
    const state = makeState(threeHands([wild4(), num('red', 5)], [num('green', 9)]), num('red', 3));
    expect(() => applyAction(state, { type: 'CHALLENGE_W4' })).toThrow();
    expect(() => applyAction(state, { type: 'DECLINE_CHALLENGE' })).toThrow();

    const entered = enterChallenge(state);
    const resolved = applyAction(entered, { type: 'CHALLENGE_W4' });
    expect(() => applyAction(resolved.state, { type: 'CHALLENGE_W4' })).toThrow();
  });
});

describe('M1-5 +4 挑战：挑战成功（出牌者违规）', () => {
  it('挑战成功：出牌者摸 4，挑战者不摸并继续回合', () => {
    const state = makeState(
      threeHands([wild4(), num('red', 5)], [num('blue', 7), num('green', 8)]),
      num('red', 3),
      { currentSeat: 0 },
    );
    const entered = enterChallenge(state);
    const result = applyAction(entered, { type: 'CHALLENGE_W4' });

    expect(result.state.phase).toBe('await-play');
    expect(result.state.currentSeat).toBe(1); // 挑战者继续自己的回合
    expect(result.state.currentColor).toBe('blue'); // 仍按 +4 所选颜色
    expect(result.state.turnCount).toBe(1);
    expect(result.state.stack).toBeNull();
    expect(result.state.pendingChallenge).toBeNull();
    expect(result.state.wild4Info).toBeNull();
    expect(result.state.players[0]!.hand).toHaveLength(1 + 4); // 出牌者摸 4 张罚牌
    expect(result.state.players[1]!.hand).toHaveLength(2); // 挑战者不摸
    expect(result.events.map((event) => event.type)).toEqual(['CHALLENGE_SUCCESS', 'DRAW']);
    expect(result.events.find((event) => event.type === 'CHALLENGE_SUCCESS')).toMatchObject({
      challenger: 1,
      target: 0,
    });
    expect(result.events.find((event) => event.type === 'DRAW')).toMatchObject({
      seat: 0,
      count: 4,
    });
    expect(countCards(result.state)).toBe(countCards(state));
  });

  it('挑战成功后挑战者可继续按所选颜色出牌', () => {
    const state = makeState(
      threeHands([wild4(), num('red', 5)], [num('blue', 7), num('green', 8)]),
      num('red', 3),
    );
    const entered = enterChallenge(state);
    const result = applyAction(entered, { type: 'CHALLENGE_W4' });
    const blue7Id = result.state.players[1]!.hand.find((card) => card.value === 7)!.id;

    const actions = getLegalActions(result.state);
    expect(actions.some((action) => action.type === 'PLAY_CARD' && action.cardId === blue7Id)).toBe(
      true,
    );
    expect(actions.some((action) => action.type === 'DRAW')).toBe(true);

    const played = applyAction(result.state, { type: 'PLAY_CARD', cardId: blue7Id });
    expect(played.state.currentSeat).toBe(2);
  });

  it('人类挑战 AI 时，事件才携带被挑战者的完整手牌（快照）', () => {
    // 座位 0 = 人类（humanSeat 默认 0），座位 2 打出违规 +4，挑战者是座位 0
    const offending = num('red', 5);
    const state = makeState(
      [[num('blue', 7), num('green', 8)], [num('yellow', 9)], [wild4(), offending]],
      num('red', 3),
      { currentSeat: 2 },
    );
    const entered = enterChallenge(state);
    expect(entered.currentSeat).toBe(0);

    const result = applyAction(entered, { type: 'CHALLENGE_W4' });
    const success = result.events.find((event) => event.type === 'CHALLENGE_SUCCESS')!;
    expect(success).toMatchObject({ challenger: 0, target: 2 });
    if (success.type === 'CHALLENGE_SUCCESS') {
      expect(success.hand?.map((card) => card.id)).toEqual([offending.id]);
      // 事件里的手牌是快照，不随摸牌变化
      expect(success.hand).toHaveLength(1);
    }
    expect(result.state.players[2]!.hand).toHaveLength(1 + 4);
  });

  it('AI 挑战 AI 时，事件不携带被挑战者手牌（隐藏信息）', () => {
    const state = makeState(threeHands([wild4(), num('red', 5)], [num('green', 9)]), num('red', 3));
    const entered = enterChallenge(state);
    const result = applyAction(entered, { type: 'CHALLENGE_W4' });
    const success = result.events.find((event) => event.type === 'CHALLENGE_SUCCESS')!;
    expect(success.type === 'CHALLENGE_SUCCESS' && success.hand).toBeFalsy();
  });

  it('wild4Legality=new-version：手里只有 Wild 也算违规，挑战成功', () => {
    const state = makeState(
      threeHands([wild4(), wild(), num('blue', 5)], [num('green', 9)]),
      num('red', 3),
      { config: { wild4Legality: 'new-version' } },
    );
    const entered = enterChallenge(state);
    expect(entered.wild4Info).toMatchObject({ wasLegal: false });

    const result = applyAction(entered, { type: 'CHALLENGE_W4' });
    expect(result.events.some((event) => event.type === 'CHALLENGE_SUCCESS')).toBe(true);
    expect(result.state.players[0]!.hand).toHaveLength(2 + 4);
  });

  it('挑战成功时牌堆耗尽：按手牌最少者结束本局，不再推进回合', () => {
    const state = makeState(
      threeHands([wild4(), num('red', 5)], [num('green', 9)]),
      num('red', 3),
      { drawPile: [] },
    );
    const entered = enterChallenge(state);
    const result = applyAction(entered, { type: 'CHALLENGE_W4' });

    expect(result.state.phase).toBe('round-end');
    expect(result.state.pendingChallenge).toBeNull();
    expect(result.state.endReason).toBe('deck-empty');
    expect(
      result.events.some((event) => event.type === 'ROUND_END' && event.reason === 'deck-empty'),
    ).toBe(true);
    // M1-7：座位 1/2 手牌并列最少（各 1 张）→ 平局（winnerSeat = null）
    expect(result.state.winnerSeat).toBeNull();
    expect(result.events.find((event) => event.type === 'ROUND_END')).toMatchObject({
      winnerSeat: null,
      reason: 'deck-empty',
    });
  });
});

describe('M1-5 +4 挑战：挑战失败（出牌合法）', () => {
  it('挑战失败：挑战者摸 6 并失去回合', () => {
    const state = makeState(
      threeHands([wild4(), num('blue', 5)], [num('green', 9)]),
      num('red', 3),
    );
    const entered = enterChallenge(state);
    const result = applyAction(entered, { type: 'CHALLENGE_W4' });

    expect(result.state.phase).toBe('await-play');
    expect(result.state.currentSeat).toBe(2); // 挑战者的下一位
    expect(result.state.turnCount).toBe(1);
    expect(result.state.pendingChallenge).toBeNull();
    expect(result.state.wild4Info).toBeNull();
    expect(result.state.players[1]!.hand).toHaveLength(1 + 6); // 4 + 2 罚牌
    expect(result.state.players[0]!.hand).toHaveLength(1); // 出牌者不摸
    expect(result.events.map((event) => event.type)).toEqual(['CHALLENGE_FAIL', 'DRAW']);
    expect(result.events.find((event) => event.type === 'CHALLENGE_FAIL')).toMatchObject({
      challenger: 1,
      target: 0,
      penalty: 6,
    });
    expect(result.events.find((event) => event.type === 'DRAW')).toMatchObject({
      seat: 1,
      count: 6,
    });
    expect(countCards(result.state)).toBe(countCards(state));
  });

  it('挑战失败后按当前方向轮到挑战者的下一位（逆时针）', () => {
    const state = makeState(
      threeHands([wild4(), num('blue', 5)], [num('green', 9)]),
      num('red', 3),
      { direction: -1 },
    );
    const entered = enterChallenge(state);
    expect(entered.pendingChallenge).toMatchObject({ challengerSeat: 2, targetSeat: 0 });

    const result = applyAction(entered, { type: 'CHALLENGE_W4' });
    expect(result.state.currentSeat).toBe(1); // 逆时针：2 的下一位是 1
    expect(result.state.players[2]!.hand).toHaveLength(1 + 6);
  });

  it('2 人：挑战失败后回合回到 +4 出牌者（连动规则自然成立）', () => {
    const state = makeState([[wild4(), num('blue', 5)], [num('green', 9)]], num('red', 3));
    const entered = enterChallenge(state);
    const result = applyAction(entered, { type: 'CHALLENGE_W4' });

    expect(result.state.currentSeat).toBe(0);
    expect(result.state.players[1]!.hand).toHaveLength(1 + 6);
  });

  it('2 人：挑战成功时挑战者继续行动，出牌者摸 4', () => {
    const state = makeState([[wild4(), num('red', 5)], [num('green', 9)]], num('red', 3));
    const entered = enterChallenge(state);
    const result = applyAction(entered, { type: 'CHALLENGE_W4' });

    expect(result.state.currentSeat).toBe(1);
    expect(result.state.players[0]!.hand).toHaveLength(1 + 4);
  });

  it('牌堆不足时挑战失败的 6 张罚牌会先洗回弃牌堆', () => {
    const state = makeState(
      threeHands([wild4(), num('blue', 5)], [num('green', 9)]),
      num('red', 3),
      { drawPile: [] },
    );
    state.discardPile = [
      num('red', 9),
      num('blue', 8),
      num('green', 7),
      num('yellow', 6),
      num('red', 5),
      num('blue', 4),
      num('red', 3),
    ];
    const entered = enterChallenge(state);
    const result = applyAction(entered, { type: 'CHALLENGE_W4' });

    expect(result.events.some((event) => event.type === 'PILE_RESHUFFLE')).toBe(true);
    expect(result.state.players[1]!.hand).toHaveLength(1 + 6);
    expect(result.state.currentSeat).toBe(2);
    expect(countCards(result.state)).toBe(countCards(state));
  });
});

describe('M1-5 +4 挑战：接受摸 4（不挑战）', () => {
  it('接受摸 4：挑战者摸 4 并失去回合', () => {
    const state = makeState(
      threeHands([wild4(), num('blue', 5)], [num('green', 9)]),
      num('red', 3),
    );
    const entered = enterChallenge(state);
    const result = applyAction(entered, { type: 'DECLINE_CHALLENGE' });

    expect(result.state.phase).toBe('await-play');
    expect(result.state.currentSeat).toBe(2);
    expect(result.state.turnCount).toBe(1);
    expect(result.state.pendingChallenge).toBeNull();
    expect(result.state.wild4Info).toBeNull();
    expect(result.state.players[1]!.hand).toHaveLength(1 + 4);
    expect(result.events.some((event) => event.type === 'DRAW' && event.count === 4)).toBe(true);
    expect(result.events.some((event) => event.type === 'CHALLENGE_FAIL')).toBe(false);
    expect(countCards(result.state)).toBe(countCards(state));
  });
});

describe('M1-5 挑战边界：哪些 +4 不能挑战 / 开关', () => {
  it('叠牌链中已有叠牌时弃权：直接摸累计张数，不进入挑战窗口', () => {
    const stackedDraw2 = draw2('green');
    const state = makeState(
      [[wild4(), num('red', 5)], [stackedDraw2, num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
    );
    const played = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: state.players[0]!.hand[0]!.id,
      colorChoice: 'blue',
    });
    const stacked = applyAction(played.state, {
      type: 'STACK_PLAY',
      cardId: stackedDraw2.id,
    });
    expect(stacked.state.stack).toMatchObject({ total: 6, awaitingSeat: 2 });

    const declined = applyAction(stacked.state, { type: 'STACK_DECLINE' });
    expect(declined.state.phase).toBe('await-play');
    expect(declined.state.pendingChallenge).toBeNull();
    expect(declined.state.wild4Info).toBeNull();
    expect(declined.state.currentSeat).toBe(0); // 2 摸牌后轮到 0
    expect(declined.state.players[2]!.hand).toHaveLength(1 + 6);
    expect(
      declined.events.some(
        (event) => event.type === 'CHALLENGE_SUCCESS' || event.type === 'CHALLENGE_FAIL',
      ),
    ).toBe(false);
    expect(countCards(declined.state)).toBe(countCards(state));
  });

  it('普通 +2 弃权：直接摸 2，不进入挑战窗口', () => {
    const draw2Card = draw2('red');
    const state = makeState(
      threeHands([draw2Card, num('blue', 5)], [num('green', 9)]),
      num('red', 3),
    );
    const played = applyAction(state, { type: 'PLAY_CARD', cardId: draw2Card.id });
    const declined = applyAction(played.state, { type: 'STACK_DECLINE' });

    expect(declined.state.phase).toBe('await-play');
    expect(declined.state.pendingChallenge).toBeNull();
    expect(declined.state.currentSeat).toBe(2);
    expect(declined.state.players[1]!.hand).toHaveLength(1 + 2);
  });

  it('challengeWild4=false：普通 +4 弃权直接摸 4，不进入挑战窗口', () => {
    const state = makeState(
      threeHands([wild4(), num('red', 5)], [num('green', 9)]),
      num('red', 3),
      { config: { challengeWild4: false } },
    );
    const played = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: state.players[0]!.hand[0]!.id,
      colorChoice: 'blue',
    });
    const declined = applyAction(played.state, { type: 'STACK_DECLINE' });

    expect(declined.state.phase).toBe('await-play');
    expect(declined.state.pendingChallenge).toBeNull();
    expect(declined.state.currentSeat).toBe(2);
    expect(declined.state.players[1]!.hand).toHaveLength(1 + 4);
    expect(declined.state.wild4Info).toBeNull();
  });

  it('最后一张是 +4：立即获胜，不进入挑战窗口，下家仍仪式性摸 4 张', () => {
    const state = makeState([[wild4()], [num('green', 9)], [num('yellow', 9)]], num('red', 3));
    const result = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: state.players[0]!.hand[0]!.id,
      colorChoice: 'blue',
    });

    expect(result.state.phase).toBe('round-end');
    expect(result.state.winnerSeat).toBe(0);
    expect(result.state.pendingChallenge).toBeNull();
    expect(result.state.players[1]!.hand).toHaveLength(1 + 4);
  });

  it("叠牌关闭（stacking='none'）时普通 +4 也开放挑战", () => {
    const state = makeState(
      threeHands([wild4(), num('blue', 5)], [num('green', 9)]),
      num('red', 3),
      { config: { stacking: 'none' } },
    );
    const played = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: state.players[0]!.hand[0]!.id,
      colorChoice: 'yellow',
    });

    expect(played.state.phase).toBe('challenge-decide');
    expect(played.state.stack).toBeNull();
    expect(played.state.pendingChallenge).toMatchObject({
      challengerSeat: 1,
      targetSeat: 0,
      total: 4,
    });
    expect(played.state.currentSeat).toBe(1);
    expect(played.state.players[1]!.hand).toHaveLength(1); // 尚未摸牌
    expect(played.state.wild4Info).toMatchObject({ challengeable: true });

    const accepted = applyAction(played.state, { type: 'DECLINE_CHALLENGE' });
    expect(accepted.state.phase).toBe('await-play');
    expect(accepted.state.currentSeat).toBe(2);
    expect(accepted.state.players[1]!.hand).toHaveLength(1 + 4);
    expect(countCards(accepted.state)).toBe(countCards(state));
  });

  it("叠牌关闭且挑战关闭（stacking='none', challengeWild4=false）：立即摸 4 并跳过", () => {
    const state = makeState(
      threeHands([wild4(), num('blue', 5)], [num('green', 9)]),
      num('red', 3),
      { config: { stacking: 'none', challengeWild4: false } },
    );
    const played = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: state.players[0]!.hand[0]!.id,
      colorChoice: 'yellow',
    });

    expect(played.state.phase).toBe('await-play');
    expect(played.state.pendingChallenge).toBeNull();
    expect(played.state.currentSeat).toBe(2);
    expect(played.state.players[1]!.hand).toHaveLength(1 + 4);
    expect(played.events.some((event) => event.type === 'SKIP' && event.seat === 1)).toBe(true);
  });
});
