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
const wild4 = (): Card => makeCard('wild4', null, null, 'W4');

interface StateOptions {
  drawPile?: Card[];
  discardPile?: Card[];
  config?: Partial<GameState['config']>;
}

function defaultDrawPile(): Card[] {
  return Array.from({ length: 20 }, (_, index) => num('blue', index % 10));
}

/** 构造可控 2 人测试局面：座位 0 先手、人类座位 0、默认自动喊 UNO（隔离 UNO 窗口） */
function makeTwoPlayerState(
  hand0: Card[],
  hand1: Card[],
  top: Card,
  options: StateOptions = {},
): GameState {
  const state = createInitialGame({
    playerCount: 2,
    seed: 'two-player-test',
    names: ['P0', 'P1'],
  });

  state.phase = 'await-play';
  state.currentSeat = 0;
  state.direction = 1;
  state.currentColor = top.color;
  state.pendingColorChoiceSeat = null;
  state.drawnThisTurn = null;
  state.discardPile = options.discardPile ?? [top];
  state.drawPile = options.drawPile ?? defaultDrawPile();
  state.players[0]!.hand = hand0;
  state.players[1]!.hand = hand1;
  state.players.forEach((player) => {
    player.saidUno = false;
  });
  state.events = [];
  state.history = [];
  state.winnerSeat = null;
  state.endReason = null;
  state.turnCount = 0;
  state.wild4Info = null;
  state.pendingChallenge = null;
  state.unoWindow = null;
  state.config = { ...state.config, autoCallUno: true, ...options.config };
  return state;
}

const eventTypes = (state: GameState): string[] => state.events.map((event) => event.type);

// ===========================================================================
// M5-02：2 人特殊规则与叠牌 / UNO / 挑战 / 牌堆耗尽叠加
// ===========================================================================
describe('M5-02 2 人规则 × 叠牌 × UNO', () => {
  it('叠牌中出牌者剩 1 张：UNO 窗口压在叠牌响应上，喊完弃权后回合回到出牌者并可出最后一张获胜', () => {
    const plus2 = draw2('red');
    const last = num('red', 5);
    const state = makeTwoPlayerState(
      [plus2, last],
      [num('green', 9)],
      num('red', 3),
      { config: { autoCallUno: false } }, // 人类手动喊 UNO
    );

    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: plus2.id });
    expect(entered.state.phase).toBe('uno-window');
    expect(entered.state.unoWindow).toMatchObject({
      seat: 0,
      canCall: true,
      pendingPhase: 'stack-response',
    });
    expect(entered.state.currentSeat).toBe(1); // 下家要响应叠牌
    expect(entered.state.stack).toMatchObject({ total: 2, lastPlayer: 0, awaitingSeat: 1 });

    const called = applyAction(entered.state, { type: 'CALL_UNO' });
    expect(called.state.phase).toBe('stack-response');
    expect(called.state.currentSeat).toBe(1);

    const declined = applyAction(called.state, { type: 'STACK_DECLINE' });
    expect(declined.state.phase).toBe('await-play');
    expect(declined.state.currentSeat).toBe(0); // 2 人：对方摸完后回合回到出牌者（连动）
    expect(declined.state.players[0]).toMatchObject({ saidUno: true });
    expect(declined.state.players[1]!.hand).toHaveLength(1 + 2);

    const won = applyAction(declined.state, { type: 'PLAY_CARD', cardId: last.id });
    expect(won.state.phase).toBe('round-end');
    expect(won.state.winnerSeat).toBe(0);
    expect(won.state.endReason).toBe('empty-hand');
    expect(countCards(won.state)).toBe(countCards(state));
  });

  it('2 人叠牌弃权摸牌触发牌堆耗尽：按手牌最少者结束，回合不推进', () => {
    const plus2 = draw2('red');
    const state = makeTwoPlayerState([plus2, num('blue', 5)], [num('green', 9)], num('red', 3), {
      drawPile: [],
    });
    // 出牌后弃牌堆 = [顶牌, +2]，只有顶牌可回收：罚摸第 2 张时耗尽

    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: plus2.id });
    expect(entered.state.phase).toBe('stack-response');
    const resolved = applyAction(entered.state, { type: 'STACK_DECLINE' });

    expect(resolved.state.phase).toBe('round-end');
    expect(resolved.state.endReason).toBe('deck-empty');
    expect(resolved.state.winnerSeat).toBe(0); // 出牌者手牌 1 张最少
    expect(eventTypes(resolved.state)).toContain('STACK_RESOLVE');
    expect(eventTypes(resolved.state).slice(-3)).toEqual(['PILE_RESHUFFLE', 'DRAW', 'ROUND_END']);
    expect(resolved.state.currentSeat).toBe(1); // 牌堆耗尽不推进回合
    expect(countCards(resolved.state)).toBe(countCards(state));
  });

  it('2 人最后一张 +2 获胜：对手仪式性摸牌即使耗尽牌堆也不改变胜负', () => {
    const plus2 = draw2('red');
    const state = makeTwoPlayerState([plus2], [num('green', 9)], num('red', 3), { drawPile: [] });
    // 出牌后弃牌堆 = [顶牌, +2]：仪式性摸牌最多只能摸到 1 张

    const result = applyAction(state, { type: 'PLAY_CARD', cardId: plus2.id });

    expect(result.state.phase).toBe('round-end');
    expect(result.state.winnerSeat).toBe(0);
    expect(result.state.endReason).toBe('empty-hand');
    expect(eventTypes(result.state)).toEqual([
      'PLAY',
      'STACK_PUSH',
      'STACK_RESOLVE',
      'PILE_RESHUFFLE',
      'DRAW',
      'PLAYER_OUT',
      'ROUND_END',
    ]);
    expect(result.state.players[1]!.hand).toHaveLength(1 + 1); // 只摸到 1 张，不影响胜负
    expect(result.events.find((event) => event.type === 'STACK_RESOLVE')).toMatchObject({
      seat: 1,
      total: 2,
    });
    expect(countCards(result.state)).toBe(countCards(state));
  });

  it('2 人抓 UNO 罚摸触发牌堆耗尽：平局且原动作不执行', () => {
    const red7 = num('red', 7);
    const state = makeTwoPlayerState(
      [red7, num('blue', 5)],
      [num('green', 9), num('yellow', 1)],
      num('red', 3),
      { drawPile: [], config: { autoCallUno: false, aiDifficulty: 'hardcore' } },
    );

    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: red7.id });
    expect(entered.state.phase).toBe('uno-window');
    // 座位 1 行动 → 关窗时 hardcore AI 100% 抓到人类；罚款 2 张时牌堆耗尽
    const result = applyAction(entered.state, { type: 'DRAW' });

    expect(result.state.phase).toBe('round-end');
    expect(result.state.endReason).toBe('deck-empty');
    expect(result.state.winnerSeat).toBeNull(); // 罚款后双方均 2 张 → 平局
    expect(eventTypes(result.state)).toEqual(['UNO_CAUGHT', 'PILE_RESHUFFLE', 'DRAW', 'ROUND_END']);
    expect(result.state.players[0]!.hand).toHaveLength(1 + 1);
    expect(result.state.players[1]!.hand).toHaveLength(2); // 原 DRAW 未执行
    expect(countCards(result.state)).toBe(countCards(state));
  });
});

describe('M5-02 2 人规则 × +4 挑战 × 牌堆耗尽', () => {
  it('挑战成功罚摸 4 触发耗尽：本局立即结束，挑战者不再继续行动（AI 挑战事件不泄露手牌）', () => {
    const plus4 = wild4();
    const state = makeTwoPlayerState([plus4, num('red', 5)], [num('green', 9)], num('red', 3), {
      drawPile: [],
    });
    // 出牌后弃牌堆 = [顶牌, +4]：挑战成功罚摸 4 时只够摸 1 张即耗尽

    const played = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: plus4.id,
      colorChoice: 'blue',
    });
    expect(played.state.phase).toBe('stack-response');
    const declined = applyAction(played.state, { type: 'STACK_DECLINE' });
    expect(declined.state.phase).toBe('challenge-decide');
    expect(declined.state.pendingChallenge).toMatchObject({ challengerSeat: 1, targetSeat: 0 });

    const challenged = applyAction(declined.state, { type: 'CHALLENGE_W4' });
    expect(challenged.state.phase).toBe('round-end');
    expect(challenged.state.endReason).toBe('deck-empty');
    expect(challenged.state.winnerSeat).toBe(1); // 挑战者 1 张最少
    expect(eventTypes(challenged.state)).toEqual([
      'CHALLENGE_SUCCESS',
      'PILE_RESHUFFLE',
      'DRAW',
      'ROUND_END',
    ]);
    // AI 挑战者：不携带被挑战者手牌（隐藏信息）
    expect(
      challenged.events.find((event) => event.type === 'CHALLENGE_SUCCESS'),
    ).not.toHaveProperty('hand');
    expect(challenged.state.players[0]!.hand).toHaveLength(1 + 1);
    expect(countCards(challenged.state)).toBe(countCards(state));
  });

  it('挑战失败罚摸 6 触发耗尽：本局立即结束，不按正常回合推进', () => {
    const plus4 = wild4();
    const state = makeTwoPlayerState([plus4, num('blue', 5)], [num('green', 9)], num('red', 3), {
      drawPile: [],
    });

    const played = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: plus4.id,
      colorChoice: 'blue',
    });
    const declined = applyAction(played.state, { type: 'STACK_DECLINE' });
    expect(declined.state.phase).toBe('challenge-decide');

    // 座位 0 出 +4 前手上没有当前颜色（红）→ 合法出牌，挑战必然失败
    const challenged = applyAction(declined.state, { type: 'CHALLENGE_W4' });
    expect(challenged.state.phase).toBe('round-end');
    expect(challenged.state.endReason).toBe('deck-empty');
    expect(challenged.state.winnerSeat).toBe(0); // 出牌者 1 张最少
    expect(eventTypes(challenged.state)).toEqual([
      'CHALLENGE_FAIL',
      'PILE_RESHUFFLE',
      'DRAW',
      'ROUND_END',
    ]);
    expect(challenged.state.players[1]!.hand).toHaveLength(1 + 1); // 只摸到 1 张罚牌
    expect(countCards(challenged.state)).toBe(countCards(state));
  });

  it('2 人 end-by-fewest：叠牌弃权时不洗回弃牌堆，直接按手牌最少者结束', () => {
    const plus2 = draw2('red');
    const state = makeTwoPlayerState([plus2, num('blue', 5)], [num('green', 9)], num('red', 3), {
      drawPile: [],
      config: { deckExhaustion: 'end-by-fewest' },
    });
    state.discardPile = [num('red', 8), num('red', 3)]; // 有可回收牌也不洗回

    const entered = applyAction(state, { type: 'PLAY_CARD', cardId: plus2.id });
    const resolved = applyAction(entered.state, { type: 'STACK_DECLINE' });

    expect(resolved.state.phase).toBe('round-end');
    expect(resolved.state.endReason).toBe('deck-empty');
    expect(resolved.state.winnerSeat).toBeNull(); // 双方均剩 1 张 → 平局
    expect(eventTypes(resolved.state)).toEqual(['STACK_RESOLVE', 'ROUND_END']);
    expect(resolved.state.discardPile).toHaveLength(3); // 弃牌堆原样保留（含刚打出的 +2），未洗回
    expect(resolved.state.players[1]!.hand).toHaveLength(1); // 没有摸牌
    expect(getLegalActions(resolved.state)).toHaveLength(0);
  });
});
