import { describe, expect, it } from 'vitest';
import {
  applyAction,
  cardScore,
  countCards,
  createInitialGame,
  getResult,
  scoreHand,
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

describe('M1-7 趣味分数（cardScore / scoreHand）', () => {
  it('数字=面值，动作牌=20，万能牌=50', () => {
    expect(cardScore(num('red', 0))).toBe(0);
    expect(cardScore(num('red', 7))).toBe(7);
    expect(cardScore(num('blue', 9))).toBe(9);
    expect(cardScore(skip('green'))).toBe(20);
    expect(cardScore(draw2('red'))).toBe(20);
    expect(cardScore(wild())).toBe(50);
    expect(cardScore(wild4())).toBe(50);
  });

  it('scoreHand 汇总整手牌分数', () => {
    const hand = [num('red', 7), skip('green'), wild(), wild4(), num('blue', 0)];
    expect(scoreHand(hand)).toBe(7 + 20 + 50 + 50 + 0);
    expect(scoreHand([])).toBe(0);
  });
});

describe('M1-7 对局结算 getResult', () => {
  it('对局尚未结束时抛错', () => {
    const state = makeState([[num('red', 7)], [num('green', 9)]], num('red', 3));
    expect(() => getResult(state)).toThrow();
  });

  it('出完手牌获胜：胜者、剩余手牌、趣味分数、统计与时长齐全', () => {
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
    expect(summary.players[0]).toMatchObject({ seat: 0, score: 0, remaining: [] });
    expect(summary.players[1]!.score).toBe(9 + 20 + 50); // 79
    expect(summary.players[1]!.remaining.map((card) => card.id)).toEqual(
      state.players[1]!.hand.map((card) => card.id),
    );
    expect(summary.players[2]!.score).toBe(50 + 20); // 70
    expect(summary.turns).toBe(0);
    expect(summary.actions).toBe(1);
    expect(summary.plays).toBe(1);
    expect(summary.draws).toBe(0);
    expect(summary.stackPlays).toBe(0);
    expect(summary.unoCalls).toBe(0);
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
    expect(steps).toHaveLength(4);
  });

  it('BUG-05 结算分数：赢家 0 分/空手牌，非赢家按剩余手牌计分且至少一位 >0', () => {
    const red7 = num('red', 7);
    const state = makeState(
      [[red7], [num('red', 9), skip('green'), wild()], [wild4(), draw2('blue')]],
      num('red', 3),
    );
    const ended = applyAction(state, { type: 'PLAY_CARD', cardId: red7.id });
    const summary = getResult(ended.state);

    expect(summary.players[0]).toMatchObject({ score: 0, remaining: [] });
    for (const player of summary.players.slice(1)) {
      expect(player.score).toBe(scoreHand(ended.state.players[player.seat]!.hand));
      expect(player.remaining.map((card) => card.id)).toEqual(
        ended.state.players[player.seat]!.hand.map((card) => card.id),
      );
    }
    expect(summary.players.slice(1).some((player) => player.score > 0)).toBe(true);
    // 官方 UNO 计分口径：赢家本局得分 = 对手剩余手牌趣味分之和
    const opponentsScore = summary.players.slice(1).reduce((sum, player) => sum + player.score, 0);
    expect(summary.winnerScore).toBe(opponentsScore);
    expect(summary.winnerScore).toBeGreaterThan(0);
  });

  it('BUG-05 UNO 路径：剩 1 张喊 UNO 后出完最后一张，同样赢家 0 分、非赢家按手牌计分', () => {
    const red7 = num('red', 7);
    const red5 = num('red', 5);
    const wildCard = wild();
    const green9 = num('green', 9);
    const state = makeState(
      [
        [red7, red5],
        [wildCard, green9],
      ],
      num('red', 3),
    );

    // 座位 0 出到 1 张（autoCallUno=true 自动喊 UNO）→ 座位 1 出 Wild 选红 → 座位 0 出完最后一张。
    let current = applyAction(state, { type: 'PLAY_CARD', cardId: red7.id }).state;
    current = applyAction(current, {
      type: 'PLAY_CARD',
      cardId: wildCard.id,
      colorChoice: 'red',
    }).state;
    const ended = applyAction(current, { type: 'PLAY_CARD', cardId: red5.id });
    expect(ended.state.winnerSeat).toBe(0);

    const summary = getResult(ended.state);
    expect(summary.unoCalls).toBe(2); // 两位玩家各在剩 1 张时喊过 UNO
    expect(summary.players[0]).toMatchObject({ score: 0, remaining: [], saidUno: true });
    expect(summary.players[1]!.score).toBe(scoreHand([green9]));
    expect(summary.players[1]!.score).toBeGreaterThan(0);
    expect(summary.winnerScore).toBe(scoreHand([green9]));
  });

  it('BUG-05 toPublicResult 的 players[].score / remaining 与 getResult 完全一致', () => {
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
        score: player.score,
        saidUno: player.saidUno,
      })),
    );
    expect(publicResult.winnerSeat).toBe(0);
    expect(publicResult.players[0]).toMatchObject({ score: 0, remaining: [] });
    expect(publicResult.players[1]!.score).toBe(scoreHand(ended.state.players[1]!.hand));
    expect(publicResult.winnerScore).toBe(engineResult.winnerScore);
    expect(publicResult.winnerScore).toBe(scoreHand(ended.state.players[1]!.hand));
  });

  it('官方 UNO 计分：赢家本局得分 = 对手剩余手牌趣味分之和（多人局）', () => {
    const red7 = num('red', 7);
    const state = makeState(
      [
        [red7],
        [num('red', 9), skip('green')], // 9 + 20 = 29
        [wild4()], // 50
      ],
      num('red', 3),
    );
    const ended = applyAction(state, { type: 'PLAY_CARD', cardId: red7.id });
    const summary = getResult(ended.state);

    expect(summary.winnerSeat).toBe(0);
    expect(summary.winnerScore).toBe(9 + 20 + 50);
    expect(summary.winnerScore).toBe(
      summary.players.slice(1).reduce((sum, player) => sum + player.score, 0),
    );
    expect(summary.winnerScore).toBeGreaterThan(summary.players[1]!.score); // 是总和而非单个对手
  });

  it('BUG-05 牌堆耗尽/平局结算：同样按剩余手牌计分', () => {
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
      expect(player.score).toBe(scoreHand(ended.state.players[player.seat]!.hand));
      expect(player.remaining.map((card) => card.id)).toEqual(
        ended.state.players[player.seat]!.hand.map((card) => card.id),
      );
    }
    expect(summary.players[2]!.score).toBe(9 + 1); // 黄9 + 黄1
    expect(summary.winnerScore).toBe(0); // 平局无赢家 → 本局得分 0
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
