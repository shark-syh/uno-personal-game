import { describe, expect, it } from 'vitest';
import { applyAction, countCards, createInitialGame, getLegalActions } from '../src/index.ts';
import { nextFloat } from '../src/rng.ts';
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
const reverse = (color: Color): Card => makeCard('reverse', color, null);
const draw2 = (color: Color): Card => makeCard('draw2', color, null);
const wild4 = (): Card => makeCard('wild4', null, null, 'W4');

interface StateOptions {
  drawPile?: Card[];
  config?: Partial<GameState['config']>;
  currentSeat?: number;
  direction?: 1 | -1;
}

/** 默认抽牌堆：足够覆盖抓人/摸牌结算（30 张，内容无所谓） */
function defaultDrawPile(): Card[] {
  return Array.from({ length: 30 }, (_, index) => num('blue', index % 10));
}

/** 构造可控测试局面：默认座位 0 先手、人类座位 0、默认配置（autoCallUno=false） */
function makeState(hands: Card[][], top: Card, options: StateOptions = {}): GameState {
  const state = createInitialGame({
    playerCount: hands.length,
    seed: 'uno-test',
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
    player.saidUno = false;
  });
  state.events = [];
  state.history = [];
  state.winnerSeat = null;
  state.turnCount = 0;
  state.wild4Info = null;
  state.pendingChallenge = null;
  state.unoWindow = null;
  if (options.config) state.config = { ...state.config, ...options.config };
  return state;
}

/** 把 RNG 调到下一个 nextFloat 满足条件的状态（用于确定性验证 AI 概率行为） */
function forceNextFloat(state: GameState, predicate: (value: number) => boolean): void {
  for (let value = 1; value < 100000; value += 1) {
    if (predicate(nextFloat({ seed: state.rng.seed, value }))) {
      state.rng = { seed: state.rng.seed, value };
      return;
    }
  }
  throw new Error('未找到满足条件的 RNG 状态');
}

const eventTypes = (state: GameState): string[] => state.events.map((event) => event.type);

describe('M1-6 UNO 窗口：进入与喊 UNO', () => {
  it('人类出牌后剩 1 张：进入 uno-window，等待喊 UNO', () => {
    const red7 = num('red', 7);
    const state = makeState(
      [[red7, num('blue', 5)], [num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
    );
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: red7.id });

    expect(result.state.phase).toBe('uno-window');
    expect(result.state.unoWindow).toMatchObject({
      seat: 0,
      canCall: true,
      canCatch: [],
      pendingPhase: 'await-play',
    });
    expect(result.state.currentSeat).toBe(1); // 窗口关闭后轮到下家
    expect(result.state.players[0]!.hand).toHaveLength(1);
    expect(result.state.players[0]!.saidUno).toBe(false);
    expect(eventTypes(result.state)).not.toContain('UNO_CALLED');
    expect(result.state.events.some((event) => event.type === 'DRAW')).toBe(false);
  });

  it('uno-window 的合法动作：CALL_UNO + 当前下家的正常动作', () => {
    const red7 = num('red', 7);
    const state = makeState(
      [[red7, num('blue', 5)], [num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
    );
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: red7.id });
    const actions = getLegalActions(result.state);

    expect(actions.some((action) => action.type === 'CALL_UNO')).toBe(true);
    expect(actions.some((action) => action.type === 'DRAW')).toBe(true); // 下家的正常动作仍在，行动即关闭窗口
    expect(actions.some((action) => action.type === 'CATCH_UNO')).toBe(false);
  });

  it('喊 UNO：标记 saidUno，窗口关闭，不摸牌、不改变当前行动者', () => {
    const red7 = num('red', 7);
    const state = makeState(
      [[red7, num('blue', 5)], [num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
    );
    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: red7.id });
    const result = applyAction(entered.state, { type: 'CALL_UNO' });

    expect(result.state.phase).toBe('await-play');
    expect(result.state.unoWindow).toBeNull();
    expect(result.state.currentSeat).toBe(1);
    expect(result.state.players[0]!.saidUno).toBe(true);
    expect(result.state.players[0]!.hand).toHaveLength(1);
    expect(result.events.map((event) => event.type)).toEqual(['UNO_CALLED']);
    expect(result.events[0]).toMatchObject({ type: 'UNO_CALLED', seat: 0 });
  });

  it('autoCallUno=true：人类出牌剩 1 张自动喊 UNO，不打开窗口', () => {
    const red7 = num('red', 7);
    const state = makeState(
      [[red7, num('blue', 5)], [num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
      { config: { autoCallUno: true } },
    );
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: red7.id });

    expect(result.state.phase).toBe('await-play');
    expect(result.state.unoWindow).toBeNull();
    expect(result.state.players[0]!.saidUno).toBe(true);
    expect(result.state.events.some((event) => event.type === 'UNO_CALLED')).toBe(true);
  });

  it('最后一张牌出完直接获胜，不进入 UNO 窗口', () => {
    const red7 = num('red', 7);
    const state = makeState([[red7], [num('green', 9)], [num('yellow', 9)]], num('red', 3));
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: red7.id });

    expect(result.state.phase).toBe('round-end');
    expect(result.state.winnerSeat).toBe(0);
    expect(result.state.unoWindow).toBeNull();
    expect(result.state.events.some((event) => event.type === 'UNO_CALLED')).toBe(false);
  });

  it('抽牌后打出刚抽的牌剩 1 张：同样进入 UNO 窗口', () => {
    const red9 = num('red', 9);
    const state = makeState(
      [[num('blue', 5)], [num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
      { drawPile: [red9] },
    );
    const drawn = applyAction(state, { type: 'DRAW' });
    expect(drawn.state.drawnThisTurn?.id).toBe(red9.id);
    const result = applyAction(drawn.state, { type: 'PLAY_DRAWN', cardId: red9.id });

    expect(result.state.phase).toBe('uno-window');
    expect(result.state.unoWindow).toMatchObject({ seat: 0, canCall: true });
  });
});

describe('M1-6 抓 UNO：窗口关闭与罚牌', () => {
  it('人类忘喊 UNO，被 AI 抓到：罚摸 2 张，窗口关闭后下家正常行动', () => {
    const red7 = num('red', 7);
    const red9 = num('red', 9);
    const state = makeState(
      [
        [red7, num('blue', 5)],
        [red9, num('yellow', 1)],
      ],
      num('red', 3),
    );
    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: red7.id });
    expect(entered.state.phase).toBe('uno-window');
    // realistic 难度 AI 抓人概率 80%：强制命中
    forceNextFloat(entered.state, (value) => value < 0.8);

    const result = applyAction(entered.state, { type: 'PLAY_CARD', cardId: red9.id });
    const caught = result.events.find((event) => event.type === 'UNO_CAUGHT');
    expect(caught).toMatchObject({ seat: 0, penalty: 2 });
    expect(result.events.filter((event) => event.type === 'UNO_CAUGHT')).toHaveLength(1);
    expect(result.state.players[0]!.hand).toHaveLength(1 + 2); // 罚摸 2 张
    expect(result.state.players[0]!.saidUno).toBe(false);
    expect(result.state.unoWindow).toBeNull();
    expect(result.state.players[1]!.hand).toHaveLength(1); // 下家照常出牌
    expect(countCards(result.state)).toBe(countCards(state));
  });

  it('人类忘喊 UNO 但 AI 没抓到：无罚牌，窗口关闭后下家正常行动', () => {
    const red7 = num('red', 7);
    const red9 = num('red', 9);
    const state = makeState(
      [
        [red7, num('blue', 5)],
        [red9, num('yellow', 1)],
      ],
      num('red', 3),
    );
    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: red7.id });
    // realistic 难度抓人概率 80%：强制不命中（2 人局只有 seat1 一个 AI 抓人者）
    forceNextFloat(entered.state, (value) => value >= 0.8);

    const result = applyAction(entered.state, { type: 'PLAY_CARD', cardId: red9.id });
    expect(result.events.some((event) => event.type === 'UNO_CAUGHT')).toBe(false);
    expect(result.state.players[0]!.hand).toHaveLength(1);
    expect(result.state.unoWindow).toBeNull();
  });

  it('人类抓 AI 忘喊：AI 罚摸 2 张，窗口关闭且不消耗人类的行动', () => {
    const red7 = num('red', 7);
    const state = makeState(
      [[num('blue', 5)], [red7, num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
      { currentSeat: 1, config: { aiDifficulty: 'casual' } },
    );
    // casual 难度 AI 喊 UNO 概率 80%：强制错过 → 打开窗口
    forceNextFloat(state, (value) => value >= 0.8);
    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: red7.id });

    expect(entered.state.phase).toBe('uno-window');
    expect(entered.state.unoWindow).toMatchObject({
      seat: 1,
      canCall: false,
      canCatch: [1],
      pendingPhase: 'await-play',
    });
    expect(entered.state.currentSeat).toBe(2); // 下一位玩家准备行动
    const actions = getLegalActions(entered.state);
    expect(actions.some((action) => action.type === 'CATCH_UNO' && action.targetSeat === 1)).toBe(
      true,
    );

    const caught = applyAction(entered.state, { type: 'CATCH_UNO', targetSeat: 1 });
    expect(caught.events.find((event) => event.type === 'UNO_CAUGHT')).toMatchObject({
      seat: 1,
      penalty: 2,
    });
    expect(caught.state.players[1]!.hand).toHaveLength(1 + 2);
    expect(caught.state.phase).toBe('await-play');
    expect(caught.state.currentSeat).toBe(2); // 抓人不是行动，轮到的人仍需行动
    expect(caught.state.unoWindow).toBeNull();
    // 抓人之后窗口已关，重复抓/喊都非法
    expect(() => applyAction(caught.state, { type: 'CATCH_UNO', targetSeat: 1 })).toThrow();
    expect(() => applyAction(caught.state, { type: 'CALL_UNO' })).toThrow();
  });

  it('不能抓自己；AI 已经喊过 UNO 也不能抓', () => {
    const red7 = num('red', 7);
    const humanState = makeState(
      [[red7, num('blue', 5)], [num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
    );
    const humanWindow = applyAction(humanState, { type: 'PLAY_CARD', cardId: red7.id });
    expect(() => applyAction(humanWindow.state, { type: 'CATCH_UNO', targetSeat: 0 })).toThrow();

    const aiRed7 = num('red', 7);
    const aiState = makeState(
      [[num('blue', 5)], [aiRed7, num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
      { currentSeat: 1, config: { aiDifficulty: 'casual' } },
    );
    forceNextFloat(aiState, (value) => value < 0.8); // AI 成功喊出 UNO
    const called = applyAction(aiState, { type: 'PLAY_CARD', cardId: aiRed7.id });
    expect(called.state.players[1]!.saidUno).toBe(true);
    expect(called.state.unoWindow).toBeNull();
    expect(() => applyAction(called.state, { type: 'CATCH_UNO', targetSeat: 1 })).toThrow();
  });

  it('多人同时可抓只处罚一次（按座位顺序先到先得）', () => {
    const red7 = num('red', 7);
    // 4 人：人类出牌剩 1 张，3 个 AI 均有抓人资格；hardcore 抓人概率 100%
    const state = makeState(
      [
        [red7, num('blue', 5)],
        [num('green', 9), num('yellow', 1)],
        [num('green', 8), num('yellow', 2)],
        [num('green', 7), num('yellow', 3)],
      ],
      num('red', 3),
      { config: { aiDifficulty: 'hardcore' } },
    );
    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: red7.id });
    expect(entered.state.phase).toBe('uno-window');

    const result = applyAction(entered.state, { type: 'DRAW' }); // 下家行动 → 关闭窗口并抓人
    expect(result.events.filter((event) => event.type === 'UNO_CAUGHT')).toHaveLength(1);
    expect(result.state.players[0]!.hand).toHaveLength(1 + 2); // 只罚一次
    expect(result.state.unoWindow).toBeNull();
  });

  it('AI 之间也会互相抓：AI 忘喊，另一 AI 抓到罚 2 张', () => {
    const red7 = num('red', 7);
    const state = makeState(
      [[num('blue', 5)], [red7, num('green', 9)], [num('green', 8), num('yellow', 2)]],
      num('red', 3),
      { currentSeat: 1, config: { aiDifficulty: 'casual' } },
    );
    forceNextFloat(state, (value) => value >= 0.8); // 座位 1 忘喊
    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: red7.id });
    expect(entered.state.unoWindow).toMatchObject({ seat: 1, canCall: false });

    forceNextFloat(entered.state, (value) => value < 0.1); // 座位 2 抓人命中（casual 10%）
    const result = applyAction(entered.state, { type: 'DRAW' });
    expect(result.events.filter((event) => event.type === 'UNO_CAUGHT')).toHaveLength(1);
    expect(result.state.players[1]!.hand).toHaveLength(1 + 2);
  });

  it('unoPenalty 可配置：罚牌数按 GameConfig.unoPenalty 结算', () => {
    const red7 = num('red', 7);
    const state = makeState(
      [[red7, num('blue', 5)], [num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
      { config: { unoPenalty: 1, aiDifficulty: 'hardcore' } },
    );
    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: red7.id });
    const result = applyAction(entered.state, { type: 'DRAW' });

    expect(result.events.find((event) => event.type === 'UNO_CAUGHT')).toMatchObject({
      seat: 0,
      penalty: 1,
    });
    expect(result.state.players[0]!.hand).toHaveLength(1 + 1);
  });
});

describe('M1-6 UNO 与叠牌 / 挑战 / 2 人规则', () => {
  it('出 +2 后剩 1 张：UNO 窗口压在叠牌响应之上，喊完继续叠牌响应', () => {
    const draw2Card = draw2('red');
    const state = makeState(
      [[draw2Card, num('blue', 5)], [num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
    );
    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: draw2Card.id });

    expect(entered.state.phase).toBe('uno-window');
    expect(entered.state.unoWindow).toMatchObject({
      seat: 0,
      pendingPhase: 'stack-response',
    });
    expect(entered.state.stack).toMatchObject({ total: 2, awaitingSeat: 1 });

    const called = applyAction(entered.state, { type: 'CALL_UNO' });
    expect(called.state.phase).toBe('stack-response');
    expect(called.state.unoWindow).toBeNull();

    const declined = applyAction(called.state, { type: 'STACK_DECLINE' });
    expect(declined.state.phase).toBe('await-play');
    expect(declined.state.players[1]!.hand).toHaveLength(1 + 2);
  });

  it('叠牌响应时打出 +2 后剩 1 张：同样进入 UNO 窗口', () => {
    const first = draw2('red');
    const stacked = draw2('green');
    const state = makeState(
      [[first, num('blue', 5)], [stacked, num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
      { config: { aiDifficulty: 'casual' } },
    );
    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: first.id });
    // 人类先喊掉自己的 UNO，避免窗口干扰
    const called = applyAction(entered.state, { type: 'CALL_UNO' });
    // casual 难度下座位 1 的 AI 喊 UNO 概率 80%：强制错过，观察叠牌中的 UNO 窗口
    forceNextFloat(called.state, (value) => value >= 0.8);
    const result = applyAction(called.state, { type: 'STACK_PLAY', cardId: stacked.id });

    expect(result.state.phase).toBe('uno-window');
    expect(result.state.unoWindow).toMatchObject({
      seat: 1,
      canCall: false,
      canCatch: [1],
      pendingPhase: 'stack-response',
    });
    expect(result.state.stack).toMatchObject({ total: 4, awaitingSeat: 2 });
  });

  it('普通 +4 剩 1 张：UNO 窗口先于挑战窗口，弃权后进入挑战窗口', () => {
    const wild4Card = wild4();
    const state = makeState(
      [[wild4Card, num('blue', 5)], [num('red', 9)], [num('yellow', 9)]],
      num('red', 3),
    );
    // 人类手上有当前颜色牌（blue5 不是红色，这里手动给红牌确保可挑战）
    state.players[0]!.hand = [wild4Card, num('red', 5)];
    const entered = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: wild4Card.id,
      colorChoice: 'blue',
    });
    expect(entered.state.phase).toBe('uno-window');
    expect(entered.state.unoWindow).toMatchObject({ seat: 0, pendingPhase: 'stack-response' });

    // 顺延到叠牌弃权：窗口关闭（人类牌手可能被 AI 抓，强制不命中）
    forceNextFloat(entered.state, (value) => value >= 0.8);
    const declined = applyAction(entered.state, { type: 'STACK_DECLINE' });
    expect(declined.state.phase).toBe('challenge-decide');
    expect(declined.state.pendingChallenge).toMatchObject({ challengerSeat: 1, targetSeat: 0 });

    const challenged = applyAction(declined.state, { type: 'CHALLENGE_W4' });
    expect(challenged.state.phase).toBe('await-play');
    expect(challenged.state.currentSeat).toBe(1); // 挑战成功，挑战者继续
  });

  it('2 人规则连动：出 Reverse 剩 1 张时自己继续行动，窗口的 currentSeat 是自己', () => {
    const reverseCard = reverse('red');
    const red5 = num('red', 5);
    const state = makeState([[reverseCard, red5], [num('green', 9)]], num('red', 3));
    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: reverseCard.id });

    expect(entered.state.phase).toBe('uno-window');
    expect(entered.state.currentSeat).toBe(0); // 2 人 Reverse 连动
    expect(entered.state.unoWindow).toMatchObject({
      seat: 0,
      canCall: true,
      pendingPhase: 'await-play',
    });

    const called = applyAction(entered.state, { type: 'CALL_UNO' });
    expect(called.state.phase).toBe('await-play');
    expect(called.state.currentSeat).toBe(0);
    expect(called.state.players[0]!.saidUno).toBe(true);
    // 喊完后可以继续出最后一张牌（2 人连动）
    const played = applyAction(called.state, { type: 'PLAY_CARD', cardId: red5.id });
    expect(played.state.phase).toBe('round-end');
    expect(played.state.winnerSeat).toBe(0);
  });

  it("stacking='none' 的 +4 挑战与 UNO 窗口重叠：喊 UNO 后回到挑战窗口", () => {
    const wild4Card = wild4();
    const state = makeState(
      [[wild4Card, num('red', 5)], [num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
      { config: { stacking: 'none' } },
    );
    const entered = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: wild4Card.id,
      colorChoice: 'blue',
    });

    expect(entered.state.phase).toBe('uno-window');
    expect(entered.state.unoWindow).toMatchObject({
      seat: 0,
      canCall: true,
      pendingPhase: 'challenge-decide',
    });
    expect(entered.state.currentSeat).toBe(1);
    expect(entered.state.pendingChallenge).toMatchObject({ challengerSeat: 1, targetSeat: 0 });

    // UNO 窗口里同时给出挑战窗口的两个动作（执行其一即先关闭 UNO 窗口并结算抓人）
    const actions = getLegalActions(entered.state);
    expect(actions.some((action) => action.type === 'CALL_UNO')).toBe(true);
    expect(actions.some((action) => action.type === 'CHALLENGE_W4')).toBe(true);
    expect(actions.some((action) => action.type === 'DECLINE_CHALLENGE')).toBe(true);

    const called = applyAction(entered.state, { type: 'CALL_UNO' });
    expect(called.state.phase).toBe('challenge-decide');
    const declined = applyAction(called.state, { type: 'DECLINE_CHALLENGE' });
    expect(declined.state.phase).toBe('await-play');
    expect(declined.state.players[1]!.hand).toHaveLength(1 + 4);
  });
});
