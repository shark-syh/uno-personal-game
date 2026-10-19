import { describe, expect, it } from 'vitest';
import {
  applyAction,
  countCards,
  createInitialGame,
  getLegalActions,
  isGameOver,
  isPlayable,
  topCard,
} from '../src/index.ts';
import { createRng, nextInt } from '../src/rng.ts';
import type { Card, CardKind, Color, EngineAction, GameState, RngState } from '../src/types.ts';

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
  currentColor?: Color | null;
  direction?: 1 | -1;
  config?: Partial<GameState['config']>;
}

/** 构造一个可控的测试局面（手牌/顶牌/牌堆可指定） */
function makeState(hands: Card[][], top: Card, options: StateOptions = {}): GameState {
  const playerCount = hands.length;
  const state = createInitialGame({
    playerCount,
    seed: 'engine-test',
    names: hands.map((_, index) => `P${index}`),
  });

  state.phase = 'await-play';
  state.currentSeat = 0;
  state.direction = options.direction ?? 1;
  state.currentColor = options.currentColor === undefined ? top.color : options.currentColor;
  state.pendingColorChoiceSeat = null;
  state.drawnThisTurn = null;
  state.discardPile = [top];
  state.drawPile = options.drawPile ?? [
    num('blue', 1),
    num('green', 2),
    num('yellow', 3),
    num('red', 4),
    num('blue', 8),
  ];
  state.players.forEach((player, seat) => {
    player.hand = hands[seat] ?? [];
  });
  state.events = [];
  state.history = [];
  state.winnerSeat = null;
  state.turnCount = 0;
  // M1-6 起：出牌剩 1 张会进入 UNO 窗口；旧用例默认自动喊 UNO，避免窗口干扰
  state.config = { ...state.config, autoCallUno: true, ...options.config };
  return state;
}

/** 3 人标准手牌：座位 0 为被测玩家，其他两家各 1 张 */
const threeHands = (hand0: Card[]): Card[][] => [hand0, [num('blue', 9)], [num('yellow', 9)]];

describe('getLegalActions / isPlayable', () => {
  it('按颜色/数字/图案生成可出牌，并始终包含抽牌', () => {
    const top = num('red', 3);
    const red7 = num('red', 7);
    const blue3 = num('blue', 3);
    const blue5 = num('blue', 5);
    const greenSkip = skip('green');
    const wildCard = wild();
    const wild4Card = wild4();
    const state = makeState(threeHands([red7, blue3, blue5, greenSkip, wildCard, wild4Card]), top);

    const actions = getLegalActions(state);
    // red7 + blue3 + wild(4色) + wild4(4色) + draw = 11
    expect(actions).toHaveLength(11);
    expect(actions.some((action) => action.type === 'DRAW')).toBe(true);
    const playableIds = new Set(
      actions.filter((action) => action.type === 'PLAY_CARD').map((action) => action.cardId),
    );
    expect(playableIds.has(red7.id)).toBe(true);
    expect(playableIds.has(blue3.id)).toBe(true);
    expect(playableIds.has(blue5.id)).toBe(false);
    expect(playableIds.has(greenSkip.id)).toBe(false);
    expect(playableIds.has(wildCard.id)).toBe(true);
    expect(playableIds.has(wild4Card.id)).toBe(true);
  });

  it('图案匹配：跳过牌可跨色压在跳过牌上', () => {
    const topSkip = skip('green');
    const state = makeState(threeHands([num('red', 2)]), topSkip, { currentColor: 'green' });
    expect(isPlayable(state, skip('red'))).toBe(true);
    expect(isPlayable(state, reverse('red'))).toBe(false);
    expect(isPlayable(state, num('green', 2))).toBe(true); // 颜色匹配
    expect(isPlayable(state, num('red', 2))).toBe(false); // 颜色/数字/图案都不匹配
  });
});

describe('出牌与效果结算', () => {
  it('出数字牌：进弃牌堆、换色、轮转下一位', () => {
    const red7 = num('red', 7);
    const state = makeState(
      [[red7, num('blue', 5)], [num('blue', 9)], [num('yellow', 9)]],
      num('red', 3),
    );
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: red7.id });

    expect(result.state.players[0]!.hand).toHaveLength(1);
    expect(topCard(result.state)!.id).toBe(red7.id);
    expect(result.state.currentColor).toBe('red');
    expect(result.state.currentSeat).toBe(1);
    expect(result.events.some((event) => event.type === 'PLAY')).toBe(true);
    // 原状态不被修改（纯函数）
    expect(state.players[0]!.hand).toHaveLength(2);
  });

  it('非法出牌抛错：不可出的牌 / 万能牌不选色', () => {
    const blue5 = num('blue', 5);
    const wildCard = wild();
    const state = makeState(threeHands([blue5, wildCard]), num('red', 3));

    expect(() => applyAction(state, { type: 'PLAY_CARD', cardId: blue5.id })).toThrow();
    expect(() => applyAction(state, { type: 'PLAY_CARD', cardId: wildCard.id })).toThrow();
  });

  it('万能牌选色：颜色更新并记录 COLOR_SET 事件', () => {
    const wildCard = wild();
    const state = makeState(threeHands([wildCard, num('blue', 5)]), num('red', 3));
    const result = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: wildCard.id,
      colorChoice: 'blue',
    });

    expect(result.state.currentColor).toBe('blue');
    expect(result.state.currentSeat).toBe(1);
    expect(
      result.events.some((event) => event.type === 'COLOR_SET' && event.color === 'blue'),
    ).toBe(true);
  });

  it('Skip：下一位被跳过', () => {
    const skipCard = skip('red');
    const state = makeState(threeHands([skipCard, num('blue', 5)]), num('red', 3));
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: skipCard.id });

    expect(result.state.currentSeat).toBe(2);
    expect(result.events.some((event) => event.type === 'SKIP' && event.seat === 1)).toBe(true);
  });

  it('Reverse：方向反转，轮到上一位', () => {
    const reverseCard = reverse('red');
    const state = makeState(threeHands([reverseCard, num('blue', 5)]), num('red', 3));
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: reverseCard.id });

    expect(result.state.direction).toBe(-1);
    expect(result.state.currentSeat).toBe(2);
    expect(result.events.some((event) => event.type === 'REVERSE')).toBe(true);
  });

  it('+2：进入叠牌响应，下家弃权后摸 2 张并失去回合', () => {
    const draw2Card = draw2('red');
    const state = makeState(threeHands([draw2Card, num('blue', 5)]), num('red', 3));
    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: draw2Card.id });

    expect(entered.state.phase).toBe('stack-response');
    expect(entered.state.stack?.total).toBe(2);
    expect(entered.state.currentSeat).toBe(1);
    expect(entered.state.players[1]!.hand).toHaveLength(1); // 等待响应，尚未摸牌

    const result = applyAction(entered.state, { type: 'STACK_DECLINE' });
    expect(result.state.players[1]!.hand).toHaveLength(3); // 原 1 张 + 2
    expect(result.state.currentSeat).toBe(2);
    expect(result.events.some((event) => event.type === 'DRAW' && event.count === 2)).toBe(true);
    expect(result.events.some((event) => event.type === 'STACK_RESOLVE' && event.seat === 1)).toBe(
      true,
    );
  });

  it('Wild+4：进入叠牌响应，颜色为所选颜色；弃权后进入 +4 挑战窗口', () => {
    const wild4Card = wild4();
    const state = makeState(threeHands([wild4Card, num('blue', 5)]), num('red', 3));
    const entered = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: wild4Card.id,
      colorChoice: 'yellow',
    });

    expect(entered.state.phase).toBe('stack-response');
    expect(entered.state.stack?.total).toBe(4);
    expect(entered.state.currentColor).toBe('yellow');
    expect(entered.state.currentSeat).toBe(1);

    // M1-5：单张 +4 链在下家弃权时先给一次挑战机会，不直接摸牌
    const declined = applyAction(entered.state, { type: 'STACK_DECLINE' });
    expect(declined.state.phase).toBe('challenge-decide');
    expect(declined.state.pendingChallenge).toMatchObject({
      challengerSeat: 1,
      targetSeat: 0,
      total: 4,
    });
    expect(declined.state.players[1]!.hand).toHaveLength(1);

    const accepted = applyAction(declined.state, { type: 'DECLINE_CHALLENGE' });
    expect(accepted.state.players[1]!.hand).toHaveLength(5); // 原 1 张 + 4
    expect(accepted.state.currentSeat).toBe(2);
    expect(accepted.events.some((event) => event.type === 'DRAW' && event.count === 4)).toBe(true);
  });

  it('出完最后一张牌：本局立即结束', () => {
    const red7 = num('red', 7);
    const state = makeState(threeHands([red7]), num('red', 3));
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: red7.id });

    expect(result.state.phase).toBe('round-end');
    expect(result.state.winnerSeat).toBe(0);
    expect(isGameOver(result.state)).toBe(true);
    expect(getLegalActions(result.state)).toHaveLength(0);
    expect(
      result.events.some((event) => event.type === 'ROUND_END' && event.winnerSeat === 0),
    ).toBe(true);
    expect(() => applyAction(result.state, { type: 'DRAW' })).toThrow();
  });
});

describe('抽牌与回合结束', () => {
  it('第一张就摸到可出牌：摸到即停并可立即打出或结束回合', () => {
    const top = num('red', 3);
    const blue5 = num('blue', 5);
    const red9 = num('red', 9);
    // pop 顺序：red9（颜色匹配，第一张就可出）
    const state = makeState(threeHands([blue5]), top, { drawPile: [num('green', 1), red9] });
    const result = applyAction(state, { type: 'DRAW' });

    expect(result.state.drawnThisTurn?.id).toBe(red9.id);
    expect(result.state.currentSeat).toBe(0);
    expect(result.state.turnCount).toBe(0); // 摸到可出即停，不推进回合
    expect(result.state.players[0]!.hand).toHaveLength(2);
    const drawEvents = result.events.filter((event) => event.type === 'DRAW');
    expect(drawEvents).toHaveLength(1);
    expect(drawEvents[0]).toMatchObject({ seat: 0, count: 1 });

    const actions = getLegalActions(result.state);
    expect(actions).toHaveLength(2); // 打出刚抽的牌 + 结束回合
    expect(actions.some((action) => action.type === 'PLAY_DRAWN')).toBe(true);
    expect(actions.some((action) => action.type === 'END_TURN')).toBe(true);

    const played = applyAction(result.state, { type: 'PLAY_DRAWN', cardId: red9.id });
    expect(topCard(played.state)!.id).toBe(red9.id);
    expect(played.state.currentSeat).toBe(1);
    expect(played.state.drawnThisTurn).toBeNull();
  });

  it('摸到不可出的牌：只摸 1 张，drawnThisTurn 为空，可继续摸牌', () => {
    const top = num('red', 3);
    const green1 = num('green', 1);
    const red9 = num('red', 9);
    // pop 顺序：green1（不可出）→ red9（颜色匹配，需再摸一次才能拿到）
    const state = makeState(threeHands([num('blue', 5)]), top, { drawPile: [red9, green1] });
    const result = applyAction(state, { type: 'DRAW' });

    expect(result.state.players[0]!.hand).toHaveLength(2); // 1 + 摸到的 1 张
    expect(result.state.drawnThisTurn).toBeNull(); // 不可出，不锁定
    expect(result.state.phase).toBe('await-play');
    expect(result.state.currentSeat).toBe(0);
    expect(result.state.turnCount).toBe(0);

    // 一次 DRAW 只摸 1 张
    const drawEvents = result.events.filter((event) => event.type === 'DRAW');
    expect(drawEvents).toHaveLength(1);
    expect(drawEvents[0]).toMatchObject({ seat: 0, count: 1 });
    expect(
      drawEvents[0]!.type === 'DRAW' ? drawEvents[0]!.cards.map((card) => card.id) : [],
    ).toEqual([green1.id]);

    // 仍可继续摸牌
    const actions = getLegalActions(result.state);
    expect(actions.some((action) => action.type === 'DRAW')).toBe(true);
  });

  it('连续不可出的牌需逐次摸：每次 DRAW 只摸 1 张，摸到可出的才锁定', () => {
    const top = num('red', 3);
    const green1 = num('green', 1);
    const yellow2 = num('yellow', 2);
    const blue4 = num('blue', 4);
    const red9 = num('red', 9);
    // pop 顺序：blue4 → yellow2 → green1（均不可出）→ red9（颜色匹配）
    const state = makeState(threeHands([num('blue', 5)]), top, {
      drawPile: [red9, green1, yellow2, blue4],
    });

    // 第 1 次摸：blue4（不可出）
    let result = applyAction(state, { type: 'DRAW' });
    expect(result.state.drawnThisTurn).toBeNull();
    expect(result.state.players[0]!.hand).toHaveLength(2);

    // 第 2 次摸：yellow2（不可出）
    result = applyAction(result.state, { type: 'DRAW' });
    expect(result.state.drawnThisTurn).toBeNull();
    expect(result.state.players[0]!.hand).toHaveLength(3);

    // 第 3 次摸：green1（不可出）
    result = applyAction(result.state, { type: 'DRAW' });
    expect(result.state.drawnThisTurn).toBeNull();
    expect(result.state.players[0]!.hand).toHaveLength(4);

    // 第 4 次摸：red9（可出）→ 锁定
    result = applyAction(result.state, { type: 'DRAW' });
    expect(result.state.drawnThisTurn?.id).toBe(red9.id);
    expect(result.state.players[0]!.hand).toHaveLength(5);
    const lastDraw = result.events.find((event) => event.type === 'DRAW');
    expect(lastDraw).toMatchObject({ seat: 0, count: 1 });
  });

  it('摸到不可出的牌后牌堆未耗尽：不洗回、不结束，玩家可继续摸', () => {
    const top = num('red', 3);
    const green1 = num('green', 1);
    const red9 = num('red', 9);
    const state = makeState(threeHands([num('blue', 5)]), top, { drawPile: [green1] });
    state.discardPile = [red9, top]; // 弃牌堆可回收 red9，但本次只摸 1 张用不上
    const result = applyAction(state, { type: 'DRAW' });

    expect(result.state.phase).toBe('await-play');
    expect(result.events.some((event) => event.type === 'PILE_RESHUFFLE')).toBe(false);
    expect(result.state.players[0]!.hand).toHaveLength(2); // 1 + green1
    expect(result.state.drawnThisTurn).toBeNull();
    expect(result.state.currentSeat).toBe(0);
    expect(result.events.find((event) => event.type === 'DRAW')).toMatchObject({
      seat: 0,
      count: 1,
    });
    expect(result.state.drawPile).toHaveLength(0);
    expect(result.state.discardPile).toHaveLength(2); // 未触发洗回
    expect(countCards(result.state)).toBe(countCards(state));
  });

  it('摸到不可出的牌且弃牌堆只剩顶牌：本次不结束，下次摸牌才耗尽', () => {
    const top = num('red', 3);
    const green1 = num('green', 1);
    const state = makeState(threeHands([num('blue', 5)]), top, { drawPile: [green1] });
    // 弃牌堆只剩顶牌：本次摸完后下次摸牌才耗尽
    const first = applyAction(state, { type: 'DRAW' });

    expect(first.state.phase).toBe('await-play');
    expect(first.state.drawnThisTurn).toBeNull();
    expect(first.state.players[0]!.hand).toHaveLength(2);
    expect(first.state.turnCount).toBe(0);
    expect(first.events.find((event) => event.type === 'DRAW')).toMatchObject({
      seat: 0,
      count: 1,
    });
    expect(first.events.some((event) => event.type === 'PILE_RESHUFFLE')).toBe(false);

    // 第二次摸牌：抽牌堆已空、弃牌堆只剩顶牌 → 耗尽结束
    const second = applyAction(first.state, { type: 'DRAW' });
    expect(second.state.phase).toBe('round-end');
    expect(second.state.endReason).toBe('deck-empty');
    expect(second.state.winnerSeat).toBeNull(); // 座位 1/2 并列最少（各 1 张）→ 平局
    expect(second.state.currentSeat).toBe(0);
    expect(second.events.map((event) => event.type)).toEqual(['ROUND_END']);
  });

  it('end-by-fewest：摸到不可出的牌后本次不结束，下次摸牌才耗尽', () => {
    const top = num('red', 3);
    const green1 = num('green', 1);
    const red9 = num('red', 9);
    const state = makeState(threeHands([num('blue', 5)]), top, {
      drawPile: [green1],
      config: { deckExhaustion: 'end-by-fewest' },
    });
    state.discardPile = [red9, top]; // 弃牌堆本来可洗回，但 end-by-fewest 不洗
    const first = applyAction(state, { type: 'DRAW' });

    expect(first.state.phase).toBe('await-play');
    expect(first.state.drawnThisTurn).toBeNull();
    expect(first.events.some((event) => event.type === 'PILE_RESHUFFLE')).toBe(false);
    expect(first.state.players[0]!.hand).toHaveLength(2); // 只摸到不可出的 green1

    // 第二次摸牌：end-by-fewest 直接耗尽
    const second = applyAction(first.state, { type: 'DRAW' });
    expect(second.state.phase).toBe('round-end');
    expect(second.state.endReason).toBe('deck-empty');
    expect(second.state.currentSeat).toBe(0);
    expect(second.events.map((event) => event.type)).toEqual(['ROUND_END']);
  });

  it('极端局面：整副牌都不可出，第一次摸牌只摸 1 张，需逐次摸到耗尽才结束', () => {
    const top = num('red', 3);
    const values = [1, 2, 4, 5, 6, 7, 8, 9];
    const makeUnplayableBlue = (index: number): Card => num('blue', values[index % values.length]!);
    const unplayableDrawPile = Array.from({ length: 20 }, (_, index) => makeUnplayableBlue(index));
    const unplayableDiscard = Array.from({ length: 30 }, (_, index) =>
      num('green', values[index % values.length]!),
    );
    const state = makeState([[num('blue', 5)], [num('green', 9)], [num('yellow', 9)]], top, {
      drawPile: unplayableDrawPile,
    });
    state.discardPile = [...unplayableDiscard, top];

    // 第一次摸牌：只摸 1 张，drawnThisTurn 为空
    const first = applyAction(state, { type: 'DRAW' });
    expect(first.state.phase).toBe('await-play');
    expect(first.state.drawnThisTurn).toBeNull();
    expect(first.state.players[0]!.hand).toHaveLength(2);
    const firstDraw = first.events.find((event) => event.type === 'DRAW');
    expect(firstDraw).toMatchObject({ seat: 0, count: 1 });
    expect(first.events.some((event) => event.type === 'ROUND_END')).toBe(false);
  });

  it('没有抽牌时不能结束回合；抽牌后可结束回合', () => {
    const state = makeState(threeHands([num('blue', 5)]), num('red', 3), {
      drawPile: [num('green', 1), num('red', 9)],
    });
    expect(() => applyAction(state, { type: 'END_TURN' })).toThrow();

    const drawn = applyAction(state, { type: 'DRAW' });
    const ended = applyAction(drawn.state, { type: 'END_TURN' });
    expect(ended.state.currentSeat).toBe(1);
    expect(ended.events.some((event) => event.type === 'PLAY')).toBe(false);
  });

  it('抽牌堆耗尽：弃牌堆洗回抽牌堆继续摸到可出牌', () => {
    const state = makeState(threeHands([num('blue', 5)]), num('red', 3), { drawPile: [] });
    state.discardPile = [num('red', 7), num('red', 3)]; // 顶部 red3
    const result = applyAction(state, { type: 'DRAW' });

    expect(result.events.some((event) => event.type === 'PILE_RESHUFFLE')).toBe(true);
    expect(result.state.drawPile.length).toBe(0);
    expect(result.state.discardPile).toHaveLength(1);
    expect(result.state.players[0]!.hand).toHaveLength(2);
    expect(result.state.drawnThisTurn?.id).toBe(state.discardPile[0]!.id); // 洗回的 red7
    expect(result.state.currentSeat).toBe(0);
  });
});

describe('起手 Wild 的选色流程', () => {
  function findWildStart(): GameState {
    for (let index = 0; index < 500; index += 1) {
      const state = createInitialGame({ playerCount: 4, seed: `engine-wild-${index}` });
      if (topCard(state)?.kind === 'wild') return state;
    }
    throw new Error('未找到起手 Wild 的种子');
  }

  it('等待选色：只给 4 个颜色动作，无抽牌', () => {
    const state = findWildStart();
    const actions = getLegalActions(state);
    expect(actions).toHaveLength(4);
    expect(actions.every((action) => action.type === 'CHOOSE_COLOR')).toBe(true);
    expect(() => applyAction(state, { type: 'DRAW' })).toThrow();
  });

  it('选完颜色后由首位玩家正常出牌', () => {
    const state = findWildStart();
    const chooseAction = getLegalActions(state)[0] as { type: 'CHOOSE_COLOR'; color: Color };
    const result = applyAction(state, chooseAction);

    expect(result.state.phase).toBe('await-play');
    expect(result.state.currentColor).toBe(chooseAction.color);
    expect(result.state.currentSeat).toBe(state.currentSeat);
    expect(result.events.some((event) => event.type === 'COLOR_SET')).toBe(true);
  });
});

describe('随机整局模拟（回合主循环健壮性）', () => {
  /** 有牌能出就优先出牌（更像真人），避免"全随机抽牌"导致的对局无限拉长 */
  function choosePlayFirst(legal: EngineAction[], policy: RngState): EngineAction {
    const playable = legal.filter(
      (action) =>
        action.type === 'PLAY_CARD' || action.type === 'PLAY_DRAWN' || action.type === 'STACK_PLAY',
    );
    const pool = playable.length > 0 ? playable : legal;
    return pool[nextInt(policy, pool.length)]!;
  }

  function playRandomGame(
    seed: string,
    playerCount: number,
  ): { state: GameState; actions: number } {
    let state = createInitialGame({ playerCount, seed });
    const policy = createRng(`policy-${seed}`);
    let actions = 0;

    while (!isGameOver(state)) {
      if (actions > 1500) {
        throw new Error(
          `对局未结束 seed=${seed} players=${playerCount} actions=${actions} phase=${state.phase} ` +
            `方向=${state.direction} 当前=${state.currentSeat} 颜色=${String(state.currentColor)} ` +
            `手牌=[${state.players.map((player) => player.hand.length).join(',')}] ` +
            `抽牌堆=${state.drawPile.length} 弃牌堆=${state.discardPile.length} ` +
            `最近事件=${state.events.map((event) => event.type).join('→')}`,
        );
      }
      const legal = getLegalActions(state);
      expect(legal.length).toBeGreaterThan(0);
      const action = choosePlayFirst(legal, policy);
      state = applyAction(state, action).state;
      actions += 1;
      expect(countCards(state)).toBe(108);
    }
    return { state, actions };
  }

  it('12 局随机对局全部正常结束，牌数始终 108', () => {
    for (let index = 0; index < 12; index += 1) {
      const playerCount = 2 + (index % 5);
      const { state, actions } = playRandomGame(`full-game-${index}-p${playerCount}`, playerCount);
      expect(actions).toBeGreaterThan(5);
      expect(state.winnerSeat).not.toBeNull();
      expect(state.players[state.winnerSeat!]!.hand).toHaveLength(0);
      expect(state.phase).toBe('round-end');
    }
  }, 60000);

  it('相同 seed 与策略可复现同一局结果', () => {
    const first = playRandomGame('replay-game', 2);
    const second = playRandomGame('replay-game', 2);
    expect(second.actions).toBe(first.actions);
    expect(second.state.winnerSeat).toBe(first.state.winnerSeat);
    expect(second.state.turnCount).toBe(first.state.turnCount);
  }, 30000);
});

describe('M1-3 动作牌完整规则', () => {
  /** 2 人测试局面：座位 0 持有 hand0，座位 1 持有 1 张牌 */
  function makeTwoPlayerState(hand0: Card[], top: Card, options: StateOptions = {}): GameState {
    const state = makeState([hand0, [num('green', 9)]], top, options);
    state.config = { ...state.config, twoPlayerRules: true };
    return state;
  }

  it('2 人规则：Reverse 等同 Skip，出牌者立即继续行动', () => {
    const reverseCard = reverse('red');
    const state = makeTwoPlayerState([reverseCard, num('blue', 5)], num('red', 3));
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: reverseCard.id });

    expect(result.state.direction).toBe(-1);
    expect(result.state.currentSeat).toBe(0); // 出牌者继续
    expect(result.events.some((event) => event.type === 'SKIP' && event.seat === 1)).toBe(true);
  });

  it('2 人规则关闭：Reverse 只反转方向，轮到对手', () => {
    const reverseCard = reverse('red');
    const state = makeTwoPlayerState([reverseCard, num('blue', 5)], num('red', 3));
    state.config = { ...state.config, twoPlayerRules: false };
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: reverseCard.id });

    expect(result.state.currentSeat).toBe(1);
    expect(result.events.some((event) => event.type === 'SKIP')).toBe(false);
  });

  it('2 人规则：Skip 立即连动；+2/Wild+4 对方摸牌后回到出牌者', () => {
    const skipCard = skip('red');
    const skipState = makeTwoPlayerState([skipCard, num('blue', 5)], num('red', 3));
    const skipResult = applyAction(skipState, { type: 'PLAY_CARD', cardId: skipCard.id });
    expect(skipResult.state.currentSeat).toBe(0);

    const draw2Card = draw2('red');
    const draw2State = makeTwoPlayerState([draw2Card, num('blue', 5)], num('red', 3));
    const draw2Entered = applyAction(draw2State, { type: 'PLAY_CARD', cardId: draw2Card.id });
    expect(draw2Entered.state.currentSeat).toBe(1); // 对方先响应叠牌
    const draw2Result = applyAction(draw2Entered.state, { type: 'STACK_DECLINE' });
    expect(draw2Result.state.currentSeat).toBe(0); // 摸完回到出牌者（连动）
    expect(draw2Result.state.players[1]!.hand).toHaveLength(3); // 1 + 2

    const wild4Card = wild4();
    const wild4State = makeTwoPlayerState([wild4Card, num('blue', 5)], num('red', 3));
    const wild4Entered = applyAction(wild4State, {
      type: 'PLAY_CARD',
      cardId: wild4Card.id,
      colorChoice: 'blue',
    });
    expect(wild4Entered.state.currentSeat).toBe(1);
    // M1-5：弃权叠牌后先进入挑战窗口，接受摸 4 后回到出牌者（连动）
    const wild4Declined = applyAction(wild4Entered.state, { type: 'STACK_DECLINE' });
    expect(wild4Declined.state.phase).toBe('challenge-decide');
    const wild4Result = applyAction(wild4Declined.state, { type: 'DECLINE_CHALLENGE' });
    expect(wild4Result.state.currentSeat).toBe(0); // 摸完回到出牌者（连动）
    expect(wild4Result.state.players[1]!.hand).toHaveLength(5); // 1 + 4
  });

  it('Wild+4 合法性记录：手上有当前颜色牌 → 违规（wasLegal=false）', () => {
    const wild4Card = wild4();
    const state = makeState(threeHands([wild4Card, num('red', 5)]), num('red', 3));
    const result = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: wild4Card.id,
      colorChoice: 'blue',
    });

    expect(result.state.wild4Info).toMatchObject({
      seat: 0,
      wasLegal: false,
      previousColor: 'red',
      challengeable: true,
    });
    // 原版允许诈唬：即使不合法，牌也照常打出并生效
    expect(result.state.currentColor).toBe('blue');
    expect(topCard(result.state)!.kind).toBe('wild4');
    expect(result.state.stack?.total).toBe(4); // 正常回合的 +4 开启叠牌链，等对方响应
    // M1-5：下家弃权后可以挑战，挑战成功 → 出牌者摸 4、挑战者继续
    const declined = applyAction(result.state, { type: 'STACK_DECLINE' });
    expect(declined.state.phase).toBe('challenge-decide');
    const challenged = applyAction(declined.state, { type: 'CHALLENGE_W4' });
    expect(challenged.state.players[0]!.hand).toHaveLength(1 + 4);
    expect(challenged.state.players[1]!.hand).toHaveLength(1);
    expect(challenged.events.some((event) => event.type === 'CHALLENGE_SUCCESS')).toBe(true);
  });

  it('Wild+4 合法性记录：手上没有当前颜色牌 → 合法（wasLegal=true）', () => {
    const wild4Card = wild4();
    const state = makeState(threeHands([wild4Card, num('blue', 5)]), num('red', 3));
    const result = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: wild4Card.id,
      colorChoice: 'yellow',
    });

    expect(result.state.wild4Info?.wasLegal).toBe(true);
    expect(result.state.wild4Info?.previousColor).toBe('red');
  });

  it('wild4Legality=new-version：手里有 Wild 也算不合法（默认经典口径算合法）', () => {
    const classicWild4 = wild4();
    const classicState = makeState(
      threeHands([classicWild4, wild(), num('blue', 5)]),
      num('red', 3),
    );
    const classicResult = applyAction(classicState, {
      type: 'PLAY_CARD',
      cardId: classicWild4.id,
      colorChoice: 'blue',
    });
    expect(classicResult.state.wild4Info?.wasLegal).toBe(true);

    const newVersionWild4 = wild4();
    const newVersionState = makeState(
      threeHands([newVersionWild4, wild(), num('blue', 5)]),
      num('red', 3),
    );
    newVersionState.config = { ...newVersionState.config, wild4Legality: 'new-version' };
    const newVersionResult = applyAction(newVersionState, {
      type: 'PLAY_CARD',
      cardId: newVersionWild4.id,
      colorChoice: 'blue',
    });
    expect(newVersionResult.state.wild4Info?.wasLegal).toBe(false);
  });

  it('最后一张是 +2：下家仍摸 2 张，然后本局结束', () => {
    const draw2Card = draw2('red');
    const state = makeState(threeHands([draw2Card]), num('red', 3));
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: draw2Card.id });

    expect(result.state.phase).toBe('round-end');
    expect(result.state.winnerSeat).toBe(0);
    expect(result.state.players[1]!.hand).toHaveLength(3);
    expect(result.events.some((event) => event.type === 'DRAW' && event.count === 2)).toBe(true);
    expect(result.events.some((event) => event.type === 'ROUND_END')).toBe(true);
  });

  it('最后一张是 Skip / Wild+4：本局正常结束', () => {
    const skipCard = skip('red');
    const skipState = makeState(threeHands([skipCard]), num('red', 3));
    const skipResult = applyAction(skipState, { type: 'PLAY_CARD', cardId: skipCard.id });
    expect(skipResult.state.phase).toBe('round-end');
    expect(skipResult.state.winnerSeat).toBe(0);

    const wild4Card = wild4();
    const wild4State = makeState(threeHands([wild4Card]), num('red', 3));
    const wild4Result = applyAction(wild4State, {
      type: 'PLAY_CARD',
      cardId: wild4Card.id,
      colorChoice: 'green',
    });
    expect(wild4Result.state.phase).toBe('round-end');
    expect(wild4Result.state.winnerSeat).toBe(0);
    expect(wild4Result.state.players[1]!.hand).toHaveLength(5); // 下家仍摸 4 张
  });

  it('+2 结算时抽牌堆耗尽：弃牌堆洗回后继续给下家摸牌', () => {
    const draw2Card = draw2('red');
    const state = makeState(threeHands([draw2Card, num('blue', 5)]), num('red', 3), {
      drawPile: [],
    });
    state.discardPile = [num('blue', 7), num('green', 8), num('red', 3)]; // 顶部 red3
    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: draw2Card.id });
    const result = applyAction(entered.state, { type: 'STACK_DECLINE' });

    expect(result.events.some((event) => event.type === 'PILE_RESHUFFLE')).toBe(true);
    expect(result.state.players[1]!.hand).toHaveLength(3); // 1 + 2 张罚牌
    expect(result.state.currentSeat).toBe(2);
  });
});
