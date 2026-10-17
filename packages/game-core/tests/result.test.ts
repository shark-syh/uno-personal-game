import { describe, expect, it } from 'vitest';
import {
  applyAction,
  countCards,
  createInitialGame,
  getResult,
  toPublicResult,
} from '../src/index.ts';
import type { Card, CardKind, Color, EngineAction, GameEvent, GameState } from '../src/types.ts';

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
}

function makeState(hands: Card[][], top: Card, options: StateOptions = {}): GameState {
  const state = createInitialGame({
    playerCount: hands.length,
    seed: 'result-test',
    names: hands.map((_, index) => `P${index}`),
  });

  state.phase = 'await-play';
  state.currentSeat = 0;
  state.direction = 1;
  state.currentColor = top.color;
  state.pendingColorChoiceSeat = null;
  state.drawnThisTurn = null;
  state.discardPile = options.discardPile ?? [top];
  state.drawPile =
    options.drawPile ?? Array.from({ length: 20 }, (_, index) => num('blue', index % 10));
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

describe('M1-7 对局结算 getResult', () => {
  it('对局尚未结束时抛错', () => {
    const state = makeState([[num('red', 7)], [num('green', 9)]], num('red', 3));
    expect(() => getResult(state)).toThrow();
  });

  it('出完手牌获胜：胜者、剩余手牌、操作统计与时长齐全（2026-10-18 起不再计分）', () => {
    const red7 = num('red', 7);
    const state = makeState(
      [[red7], [num('red', 9), skip('green'), wild()], [wild4(), draw2('blue')]],
      num('red', 3),
    );
    const result = applyAction(state, { type: 'PLAY_CARD', cardId: red7.id });
    const summary = getResult(result.state, { durationMs: 12345 });

    expect(summary.winnerSeat).toBe(0);
    expect(summary.isDraw).toBe(false);
    expect(summary.reason).toBe('empty-hand');
    expect(summary.players).toHaveLength(3);
    expect(summary.players[0]).toMatchObject({
      seat: 0,
      remaining: [],
      plays: 1,
      draws: 0,
      stackPlays: 0,
      unoCalls: 0,
      unoCaught: 0,
      challenges: 0,
    });
    expect(summary.players[1]!.remaining.map((card) => card.id)).toEqual(
      state.players[1]!.hand.map((card) => card.id),
    );
    expect(summary.players[1]).not.toHaveProperty('score');
    expect(summary).not.toHaveProperty('winnerScore');
    expect(summary.turns).toBe(0);
    expect(summary.actions).toBe(1);
    expect(summary.plays).toBe(1);
    expect(summary.draws).toBe(0);
    expect(summary.stackPlays).toBe(0);
    expect(summary.unoCalls).toBe(0);
    expect(summary.challenges).toBe(0);
    expect(summary.durationMs).toBe(12345);
    expect(countCards(result.state)).toBe(countCards(state));

    // 结算数据是快照：修改结果不影响引擎状态
    summary.players[1]!.remaining[0]!.value = 0;
    expect(result.state.players[1]!.hand[0]!.value).toBe(9);
  });

  it('durationMs 默认 0；牌堆耗尽平局时 winnerSeat=null、isDraw=true', () => {
    const state = makeState(
      [[num('blue', 5)], [num('green', 9)], [num('yellow', 9), num('yellow', 1)]],
      num('red', 3),
      { drawPile: [], discardPile: [num('red', 3)] },
    );
    const ended = applyAction(state, { type: 'DRAW' });
    const summary = getResult(ended.state);

    expect(ended.state.phase).toBe('round-end');
    expect(summary.winnerSeat).toBeNull();
    expect(summary.isDraw).toBe(true);
    expect(summary.reason).toBe('deck-empty');
    expect(summary.durationMs).toBe(0);
    expect(summary.actions).toBe(1);
    expect(summary.draws).toBe(0);
  });

  it('统计口径：动作数 / 摸牌 / 出牌 / UNO 次数（脚本对局）', () => {
    const red7 = num('red', 7);
    const red9 = num('red', 9);
    const green5 = num('green', 5);
    const red8 = num('red', 8);
    // pop 顺序：green5（不可出）→ red8（当前颜色红，可出，停止）
    const state = makeState([[red7, red9], [num('green', 9)]], num('red', 3), {
      drawPile: [red8, green5],
    });

    let current = state;
    const steps: GameEvent[][] = [];
    const play = (action: EngineAction) => {
      const result = applyAction(current, action);
      steps.push(result.events);
      current = result.state;
      return result;
    };

    const first = play({ type: 'PLAY_CARD', cardId: red7.id });
    expect(first.state.players[0]!.saidUno).toBe(true); // autoCallUno=true
    expect(first.events.map((event) => event.type)).toEqual(['PLAY', 'UNO_CALLED']);

    const second = play({ type: 'DRAW' }); // 座位 1 摸绿 5 不可出 → 继续摸红 8 可出即停
    expect(second.events.map((event) => event.type)).toEqual(['DRAW']);
    expect(second.events[0]).toMatchObject({ seat: 1, count: 2 });
    expect(second.state.currentSeat).toBe(1); // 停在 await-play，需要主动结束回合

    const third = play({ type: 'END_TURN' });
    expect(third.events).toEqual([]);

    const fourth = play({ type: 'PLAY_CARD', cardId: red9.id });
    expect(fourth.events.map((event) => event.type)).toEqual(['PLAY', 'PLAYER_OUT', 'ROUND_END']);

    const summary = getResult(current);
    expect(summary.winnerSeat).toBe(0);
    expect(summary.turns).toBe(2);
    expect(summary.actions).toBe(4);
    expect(summary.plays).toBe(2);
    expect(summary.draws).toBe(2);
    expect(summary.stackPlays).toBe(0);
    expect(summary.unoCalls).toBe(1);
    expect(summary.challenges).toBe(0);
    expect(steps).toHaveLength(4);

    // 每位玩家的操作统计与事件历史一致
    expect(summary.players[0]).toMatchObject({
      plays: 2,
      draws: 0,
      stackPlays: 0,
      unoCalls: 1,
      unoCaught: 0,
      challenges: 0,
    });
    expect(summary.players[1]).toMatchObject({
      plays: 0,
      draws: 2,
      stackPlays: 0,
      unoCalls: 0,
      unoCaught: 0,
      challenges: 0,
    });
  });

  it('操作统计：按历史事件汇总每位玩家的出牌/摸牌/叠牌/UNO/挑战（含被抓）', () => {
    const state = makeState([[num('red', 7)], [num('green', 9)], [num('blue', 5)]], num('red', 3));
    state.phase = 'round-end';
    state.winnerSeat = 0;
    state.endReason = 'empty-hand';
    state.players[0]!.hand = [];
    state.history = [
      { type: 'PLAY', seat: 0, card: num('red', 7) },
      { type: 'UNO_CALLED', seat: 0 },
      { type: 'DRAW', seat: 1, count: 3, cards: [] },
      { type: 'STACK_PUSH', seat: 1, card: draw2('blue'), total: 2 },
      { type: 'UNO_CAUGHT', seat: 1, penalty: 2 },
      { type: 'CHALLENGE_SUCCESS', challenger: 2, target: 1 },
      { type: 'CHALLENGE_FAIL', challenger: 1, target: 0, penalty: 6 },
    ];
    const summary = getResult(state);

    expect(summary.players[0]).toMatchObject({
      plays: 1,
      draws: 0,
      stackPlays: 0,
      unoCalls: 1,
      unoCaught: 0,
      challenges: 0,
    });
    expect(summary.players[1]).toMatchObject({
      plays: 0,
      draws: 3,
      stackPlays: 1,
      unoCalls: 0,
      unoCaught: 1,
      challenges: 1,
    });
    expect(summary.players[2]).toMatchObject({
      plays: 0,
      draws: 0,
      stackPlays: 0,
      unoCalls: 0,
      unoCaught: 0,
      challenges: 1,
    });
    expect(summary).toMatchObject({
      plays: 1,
      draws: 3,
      stackPlays: 1,
      unoCalls: 1,
      challenges: 2,
    });
  });

  it('取消计分：结算数据不再包含 score / winnerScore 字段', () => {
    const state = makeState([[num('red', 7)], [num('green', 9)]], num('red', 3));
    const ended = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: state.players[0]!.hand[0]!.id,
    });
    const summary = getResult(ended.state);

    expect(summary).not.toHaveProperty('winnerScore');
    for (const player of summary.players) expect(player).not.toHaveProperty('score');
  });

  it('toPublicResult 的玩家操作统计 / 剩余手牌与 getResult 完全一致，且不含分数', () => {
    const red7 = num('red', 7);
    const state = makeState([[red7], [num('blue', 9), skip('red')]], num('red', 3));
    const ended = applyAction(state, { type: 'PLAY_CARD', cardId: red7.id });
    const engineResult = getResult(ended.state, { durationMs: 777 });
    const publicResult = toPublicResult(ended.state, 777);

    expect(publicResult.players).toEqual(
      engineResult.players.map((player) => ({
        seat: player.seat,
        name: player.name,
        isHuman: player.isHuman,
        remaining: player.remaining,
        saidUno: player.saidUno,
        plays: player.plays,
        draws: player.draws,
        stackPlays: player.stackPlays,
        unoCalls: player.unoCalls,
        unoCaught: player.unoCaught,
        challenges: player.challenges,
      })),
    );
    expect(publicResult).not.toHaveProperty('winnerScore');
    expect(publicResult.players[0]).not.toHaveProperty('score');
    expect(publicResult).toMatchObject({
      plays: 1,
      draws: 0,
      unoCalls: 0,
      challenges: 0,
      durationMs: 777,
    });
    expect(publicResult.players[0]).toMatchObject({ plays: 1, remaining: [] });
    expect(publicResult.players[1]!.remaining).toHaveLength(2);
  });

  it('牌堆耗尽/平局结算：保留剩余手牌与操作统计，无分数', () => {
    const state = makeState(
      [[num('blue', 5)], [num('green', 9)], [num('yellow', 9), num('yellow', 1)]],
      num('red', 3),
      { drawPile: [], discardPile: [num('red', 3)] },
    );
    const ended = applyAction(state, { type: 'DRAW' });
    const summary = getResult(ended.state);

    expect(ended.state.phase).toBe('round-end');
    expect(summary.isDraw).toBe(true);
    expect(summary.reason).toBe('deck-empty');
    for (const player of summary.players) {
      expect(player.remaining.map((card) => card.id)).toEqual(
        ended.state.players[player.seat]!.hand.map((card) => card.id),
      );
      expect(player).not.toHaveProperty('score');
    }
    expect(summary.players[2]!.remaining).toHaveLength(2);
    expect(summary).not.toHaveProperty('winnerScore');
  });
});

describe('M1-7 事件日志完整性', () => {
  it('每个动作的 events 与 history 顺序一致；state.events 只保留本次动作', () => {
    const red7 = num('red', 7);
    const red9 = num('red', 9);
    const green5 = num('green', 5);
    const red8 = num('red', 8);
    // pop 顺序：green5（不可出）→ red8（可出，停止）
    const state = makeState([[red7, red9], [num('green', 9)]], num('red', 3), {
      drawPile: [red8, green5],
    });

    let current = state;
    const allEvents: GameEvent[] = [];
    const actions: EngineAction[] = [
      { type: 'PLAY_CARD', cardId: red7.id },
      { type: 'DRAW' },
      { type: 'END_TURN' },
      { type: 'PLAY_CARD', cardId: red9.id },
    ];
    for (const action of actions) {
      const result = applyAction(current, action);
      current = result.state;
      expect(result.state.events).toBe(result.events); // 本次事件引用一致
      expect(result.events).toEqual(result.state.events);
      allEvents.push(...result.events);
      expect(current.history.map((event) => event.type)).toEqual(
        allEvents.map((event) => event.type),
      );
    }

    // 最后一个动作的事件只包含最后一次出牌相关事件（不带之前历史）
    expect(current.events.map((event) => event.type)).toEqual(['PLAY', 'PLAYER_OUT', 'ROUND_END']);
    // history 完整保留全部事件
    expect(current.history.length).toBe(allEvents.length);
    expect(current.history.some((event) => event.type === 'UNO_CALLED')).toBe(true);
    expect(current.history.some((event) => event.type === 'DRAW')).toBe(true);
  });

  it('出牌事件序列：Wild 带 COLOR_SET；跳过/反转/+2 各自事件齐全', () => {
    const wildCard = wild();
    const state = makeState(
      [[wildCard, num('red', 5), num('blue', 6)], [num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
    );
    const played = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: wildCard.id,
      colorChoice: 'blue',
    });
    expect(played.events.map((event) => event.type)).toEqual(['PLAY', 'COLOR_SET']);
    expect(played.events[1]).toMatchObject({ type: 'COLOR_SET', seat: 0, color: 'blue' });

    const skipCard = skip('red');
    const skipState = makeState(
      [[skipCard, num('red', 5), num('blue', 6)], [num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
    );
    const skipped = applyAction(skipState, { type: 'PLAY_CARD', cardId: skipCard.id });
    expect(skipped.events.map((event) => event.type)).toEqual(['PLAY', 'SKIP']);

    const reverseCard = reverse('red');
    const reverseState = makeState(
      [[reverseCard, num('red', 5), num('blue', 6)], [num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
    );
    const reversed = applyAction(reverseState, { type: 'PLAY_CARD', cardId: reverseCard.id });
    expect(reversed.events.map((event) => event.type)).toEqual(['PLAY', 'REVERSE']);

    const plus2 = draw2('red');
    const plus2State = makeState(
      [[plus2, num('red', 5), num('blue', 6)], [num('green', 9)], [num('yellow', 9)]],
      num('red', 3),
    );
    const pushed = applyAction(plus2State, { type: 'PLAY_CARD', cardId: plus2.id });
    expect(pushed.events.map((event) => event.type)).toEqual(['PLAY', 'STACK_PUSH']);
    expect(pushed.events[1]).toMatchObject({ type: 'STACK_PUSH', seat: 0, total: 2 });
  });
});
