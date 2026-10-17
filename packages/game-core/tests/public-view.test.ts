import { describe, expect, it } from 'vitest';
import { applyAction, createInitialGame, getLegalActions } from '../src/index.ts';
import {
  createLobbyView,
  DEFAULT_VIEW_SETTINGS,
  getGameView,
  getHumanLegalActions,
  sanitizeEventsForSeat,
  toEngineAction,
  toPublicResult,
  toUiAction,
} from '../src/index.ts';
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
const skip = (color: Color): Card => makeCard('skip', color, null);
const draw2 = (color: Color): Card => makeCard('draw2', color, null);
const wild = (): Card => makeCard('wild', null, null, 'WC');
const wild4 = (): Card => makeCard('wild4', null, null, 'W4');

function defaultDrawPile(): Card[] {
  return Array.from({ length: 30 }, (_, index) => num('blue', index % 10));
}

function makeState(hands: Card[][], top: Card, options: { drawPile?: Card[] } = {}): GameState {
  const state = createInitialGame({
    playerCount: hands.length,
    seed: 'public-view-test',
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
  state.stack = null;
  state.config = { ...state.config, autoCallUno: true };
  return state;
}

describe('M3-2 公开视图：隐藏信息隔离', () => {
  it('只暴露自己的手牌 + 公开信息，不含其他玩家手牌 / wild4Info', () => {
    const state = makeState(
      [[num('red', 5), wild4()], [num('green', 9), skip('blue')], [num('yellow', 7)]],
      num('red', 3),
    );
    const view = getGameView(state, 0);
    const opponents = state.players.slice(1).flatMap((player) => player.hand);

    expect(view.human.hand.map((card) => card.id)).toEqual(
      state.players[0]!.hand.map((card) => card.id),
    );
    expect(view.players.map((player) => player.handCount)).toEqual([2, 2, 1]);
    expect(view.players[1]).not.toHaveProperty('hand');
    const serialized = JSON.stringify(view);
    for (const card of opponents) {
      expect(serialized).not.toContain(card.id);
    }
    expect(serialized).not.toContain('wild4Info');
    expect(serialized).not.toContain('wasLegal');
  });

  it('事件脱敏：他人摸牌无牌面、AI 挑战不暴露手牌；人类挑战保留手牌', () => {
    const ownDraw = num('red', 8);
    const otherDraw = num('green', 4);
    const challengeHand = [num('blue', 9)];
    const events = [
      { type: 'DRAW' as const, seat: 1, count: 1, cards: [otherDraw] },
      { type: 'DRAW' as const, seat: 0, count: 1, cards: [ownDraw] },
      { type: 'CHALLENGE_SUCCESS' as const, challenger: 1, target: 0, hand: challengeHand },
      { type: 'CHALLENGE_SUCCESS' as const, challenger: 0, target: 1, hand: challengeHand },
    ];
    const sanitized = sanitizeEventsForSeat(events, 0);
    expect(sanitized[0]).toEqual({ type: 'DRAW', seat: 1, count: 1, cards: [] });
    expect(sanitized[1]).toEqual({ type: 'DRAW', seat: 0, count: 1, cards: [ownDraw] });
    expect(sanitized[2]).toEqual({ type: 'CHALLENGE_SUCCESS', challenger: 1, target: 0 });
    expect(sanitized[3]).toMatchObject({ type: 'CHALLENGE_SUCCESS', challenger: 0 });
    expect((sanitized[3] as { hand?: Card[] }).hand).toHaveLength(1);
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain(otherDraw.id);
  });

  it('多张摸牌聚合事件脱敏：他人视角 cards=[] 但 count 保留实际张数', () => {
    const drawnCards = [num('green', 1), num('yellow', 2), num('red', 9)];
    const events = [{ type: 'DRAW' as const, seat: 1, count: 3, cards: drawnCards }];
    const sanitized = sanitizeEventsForSeat(events, 0);
    expect(sanitized[0]).toEqual({ type: 'DRAW', seat: 1, count: 3, cards: [] });
    expect(JSON.stringify(sanitized)).not.toContain(drawnCards[2]!.id);
  });

  it('实际多张摸牌：一次 DRAW 事件，本人视角带全部牌面、他人视角只有 count', () => {
    const state = makeState([[num('blue', 5)], [num('green', 9)]], num('red', 3), {
      // pop 顺序：green1（不可出）→ red9（可出，停止）
      drawPile: [num('red', 9), num('green', 1)],
    });
    const drawn = applyAction(state, { type: 'DRAW' });
    const drawEvents = drawn.events.filter((event) => event.type === 'DRAW');
    expect(drawEvents).toHaveLength(1);
    expect(drawEvents[0]).toMatchObject({ seat: 0, count: 2 });

    const ownView = getGameView(drawn.state, 0);
    const ownDraw = ownView.events.find((event) => event.type === 'DRAW');
    expect(ownDraw?.type === 'DRAW' ? ownDraw.count : -1).toBe(2);
    expect(ownDraw?.type === 'DRAW' ? ownDraw.cards : []).toHaveLength(2);

    const otherView = getGameView(drawn.state, 1);
    expect(otherView.events.find((event) => event.type === 'DRAW')).toMatchObject({
      seat: 0,
      count: 2,
      cards: [],
    });
  });
});

describe('M3-2 公开视图：结构与契约字段', () => {
  it('正常回合视图字段完整（screen/phase/config/players/human/table/events）', () => {
    const top = num('red', 3);
    const state = makeState([[num('red', 5), wild(), num('blue', 3)], [num('green', 9)]], top);
    state.history = [
      { type: 'PLAY', seat: 1, card: num('green', 9) },
      { type: 'PLAY', seat: 0, card: num('red', 7) },
    ];
    const view = getGameView(state, 0);

    expect(view.mock).toBe(false);
    expect(view.screen).toBe('game');
    expect(view.phase).toBe('await-play');
    expect(view.config).toEqual({
      playerCount: 2,
      difficulty: state.config.aiDifficulty,
      aiMode: state.config.aiMode,
      challengeWild4: state.config.challengeWild4,
    });
    expect(view.currentSeat).toBe(0);
    expect(view.direction).toBe(1);
    expect(view.currentColor).toBe('red');
    expect(view.players).toHaveLength(2);
    expect(view.players[0]).toMatchObject({
      seat: 0,
      isHuman: true,
      handCount: 3,
      thinking: false,
    });
    expect(view.players[0]!.lastPlayed?.value).toBe(7);
    expect(view.players[1]!.lastPlayed?.value).toBe(9);
    expect(view.human.seat).toBe(0);
    expect(view.human.hand).toHaveLength(3);
    expect(view.human.legalActions.length).toBeGreaterThan(0);
    expect(view.table.discardTop?.id).toBe(top.id);
    expect(view.table.discardTop3).toHaveLength(1);
    expect(view.table.drawPileCount).toBe(30);
    expect(view.table.stack).toBeNull();
    expect(view.table.pendingColorChoice).toBe(false);
    expect(view.table.winnerSeat).toBeNull();
    expect(view.events).toEqual([]);
    expect(view.result).toBeNull();
    expect(view.settings).toEqual(DEFAULT_VIEW_SETTINGS);
    expect(view.dev).toEqual({});
  });

  it('discardTop3 按新→旧排列，最多 3 张', () => {
    const top = num('red', 3);
    const state = makeState([[num('red', 5)], [num('green', 9)]], top);
    state.discardPile = [num('green', 1), num('blue', 2), num('yellow', 3), num('red', 4), top];
    const view = getGameView(state, 0);
    expect(view.table.discardTop3.map((card) => card.value)).toEqual([3, 4, 3]);
  });

  it('AI 回合人类合法动作为空；人类回合为完整映射', () => {
    const state = makeState([[num('red', 5), num('blue', 3)], [num('green', 9)]], num('red', 3));
    state.currentSeat = 1;
    expect(getGameView(state, 0).human.legalActions).toEqual([]);

    state.currentSeat = 0;
    const actions = getGameView(state, 0).human.legalActions;
    expect(actions.some((action) => action.type === 'PLAY_CARD')).toBe(true);
    expect(actions.some((action) => action.type === 'DRAW')).toBe(true);
    expect(new Set(actions.map((action) => action.id)).size).toBe(actions.length);
    for (const action of actions) {
      expect(action.label.length).toBeGreaterThan(0);
    }
  });

  it('Wild 展开 4 个颜色动作，label 中带颜色名', () => {
    const state = makeState([[wild(), num('red', 5)], [num('green', 9)]], num('red', 3));
    const actions = getGameView(state, 0).human.legalActions.filter(
      (action) => action.type === 'PLAY_CARD' && action.cardId,
    );
    const wildActions = actions.filter((action) => action.cardId?.startsWith('WC'));
    expect(wildActions).toHaveLength(4);
    expect(new Set(wildActions.map((action) => action.colorChoice))).toEqual(
      new Set(['red', 'yellow', 'green', 'blue']),
    );
    expect(wildActions.some((action) => action.label.includes('红'))).toBe(true);
  });

  it('DRAW 文案：label「摸牌」、hint「摸到能打出的牌为止」', () => {
    const state = makeState([[num('red', 5)], [num('green', 9)]], num('red', 3));
    const drawAction = getGameView(state, 0).human.legalActions.find(
      (action) => action.type === 'DRAW',
    );
    expect(drawAction).toMatchObject({ label: '摸牌', hint: '摸到能打出的牌为止' });
  });

  it('叠牌响应：弃权按钮 label 带累计张数', () => {
    const state = makeState(
      [
        [draw2('red'), num('blue', 4)],
        [draw2('blue'), num('green', 2)],
      ],
      num('red', 3),
    );
    const played = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: state.players[0]!.hand[0]!.id,
    });
    expect(played.state.phase).toBe('stack-response');
    const view = getGameView(played.state, 1);
    const decline = view.human.legalActions.find((action) => action.type === 'STACK_DECLINE');
    expect(decline?.label).toContain('2');
    expect(view.human.mustRespondStack).toBe(true);
    expect(view.table.stack?.total).toBe(2);
  });

  it('+4 挑战窗口：human.pendingChallenge / 两个动作 / table.pendingColorChoice', () => {
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
    expect(declined.state.phase).toBe('challenge-decide');

    const view = getGameView(declined.state, 1);
    expect(view.human.pendingChallenge).toEqual({ opponentSeat: 0 });
    expect(view.human.legalActions.map((action) => action.type).sort()).toEqual([
      'CHALLENGE_W4',
      'DECLINE_CHALLENGE',
    ]);

    const colorState = makeState([[num('red', 5)], [num('blue', 2)]], num('red', 3));
    colorState.phase = 'choose-color';
    colorState.pendingColorChoiceSeat = 0;
    colorState.currentColor = null;
    const colorView = getGameView(colorState, 0);
    expect(colorView.table.pendingColorChoice).toBe(true);
    expect(colorView.human.legalActions).toHaveLength(4);
    expect(colorView.human.legalActions.every((action) => action.type === 'CHOOSE_COLOR')).toBe(
      true,
    );
  });

  it('UNO 窗口：人类喊/抓动作映射（CALL_UNO / CATCH_UNO targetSeat）', () => {
    const state = makeState(
      [
        [num('red', 5), num('blue', 2)],
        [num('green', 9), num('yellow', 4)],
      ],
      num('red', 3),
    );
    // 人类忘记喊 UNO：窗口 seat=0，currentSeat 仍是人类（2 人局极端时序）
    state.phase = 'uno-window';
    state.currentSeat = 0;
    state.unoWindow = { seat: 0, canCall: true, canCatch: [], pendingPhase: 'await-play' };
    const humanView = getGameView(state, 0);
    expect(humanView.human.canCallUno).toBe(true);
    expect(humanView.human.legalActions.some((action) => action.type === 'CALL_UNO')).toBe(true);

    // AI 忘记喊 UNO：人类可抓
    state.unoWindow = { seat: 1, canCall: false, canCatch: [1], pendingPhase: 'await-play' };
    state.phase = 'uno-window';
    state.currentSeat = 0;
    const catchView = getGameView(state, 0);
    expect(catchView.human.canCatch).toEqual([1]);
    const catchAction = catchView.human.legalActions.find((action) => action.type === 'CATCH_UNO');
    expect(catchAction).toMatchObject({ targetSeat: 1, id: 'catch:1' });
  });
});

describe('M3-2 公开视图：结算映射（含平局）', () => {
  it('出完手牌：screen=result，result 含胜者/剩余手牌/趣味分/时长', () => {
    const state = makeState([[num('red', 5)], [num('green', 9), num('blue', 2)]], num('red', 3));
    const played = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: state.players[0]!.hand[0]!.id,
    });
    const view = getGameView(played.state, 0, { durationMs: 12345 });
    expect(view.screen).toBe('result');
    expect(view.phase).toBe('round-end');
    expect(view.table.winnerSeat).toBe(0);
    expect(view.result).not.toBeNull();
    expect(view.result!.winnerSeat).toBe(0);
    expect(view.result!.isDraw).toBe(false);
    expect(view.result!.reason).toBe('empty-hand');
    expect(view.result!.durationMs).toBe(12345);
    expect(view.result!.players).toHaveLength(2);
    expect(view.result!.players[0]!.remaining).toHaveLength(0);
    expect(view.result!.players[1]!.remaining).toHaveLength(2);
    expect(view.result!.players[1]!.score).toBeGreaterThan(0);
    // 赢家本局得分（官方 UNO 口径）= 对手剩余手牌趣味分之和；本局只有 1 位对手
    expect(view.result!.winnerScore).toBe(view.result!.players[1]!.score);
    expect(view.human.legalActions).toEqual([]);
  });

  it('toPublicResult 在平局时 winnerSeat=null、isDraw=true', () => {
    const state = createInitialGame({ playerCount: 2, seed: 'draw-view' });
    state.phase = 'round-end';
    state.winnerSeat = null;
    state.endReason = 'deck-empty';
    state.players.forEach((player) => {
      player.hand = [num('green', 2)];
    });
    state.discardPile = [num('red', 1)];
    state.drawPile = [];
    const result = toPublicResult(state, 500);
    expect(result.winnerSeat).toBeNull();
    expect(result.isDraw).toBe(true);
    expect(result.reason).toBe('deck-empty');
    expect(result.durationMs).toBe(500);
    expect(result.winnerScore).toBe(0); // 平局无赢家
  });
});

describe('M3-2 公开视图：UiAction ↔ EngineAction', () => {
  it('toEngineAction 与引擎合法动作一致（人类回合所有动作可回放）', () => {
    const state = makeState(
      [[num('red', 5), wild(), num('blue', 3)], [num('green', 9)]],
      num('red', 3),
    );
    const legal = getLegalActions(state);
    const uiActions = getHumanLegalActions(state, 0);
    for (const uiAction of uiActions) {
      const engineAction = toEngineAction(uiAction);
      expect(
        legal.some(
          (candidate) =>
            candidate.type === engineAction.type &&
            ('cardId' in candidate ? candidate.cardId : undefined) ===
              ('cardId' in engineAction ? engineAction.cardId : undefined) &&
            ('colorChoice' in candidate ? (candidate.colorChoice ?? null) : null) ===
              ('colorChoice' in engineAction ? (engineAction.colorChoice ?? null) : null),
        ),
      ).toBe(true);
    }
  });

  it('toEngineAction 缺少必填字段时抛错', () => {
    expect(() => toEngineAction({ id: 'x', type: 'PLAY_CARD', label: '出牌' })).toThrow();
    expect(() => toEngineAction({ id: 'x', type: 'CHOOSE_COLOR', label: '红色' })).toThrow();
    expect(() => toEngineAction({ id: 'x', type: 'CATCH_UNO', label: '抓他' })).toThrow();
  });

  it('toUiAction 保留卡片/颜色/目标座位字段', () => {
    const state = makeState([[wild(), num('red', 5)], [num('green', 9)]], num('red', 3));
    const uiActions = getHumanLegalActions(state, 0);
    const wildAction = uiActions.find((action) => action.cardId?.startsWith('WC'));
    expect(wildAction?.colorChoice).toBeDefined();
    const catchAction = toUiAction({ type: 'CATCH_UNO', targetSeat: 2 }, state);
    expect(catchAction.targetSeat).toBe(2);
  });
});

describe('M3-2 公开视图：大厅伪视图', () => {
  it('createLobbyView 提供大厅渲染所需字段', () => {
    const view = createLobbyView(
      { playerCount: 6, difficulty: 'hardcore', challengeWild4: false },
      { animation: false },
    );
    expect(view.screen).toBe('lobby');
    expect(view.phase).toBe('lobby');
    expect(view.config).toEqual({
      playerCount: 6,
      difficulty: 'hardcore',
      aiMode: 'auto',
      challengeWild4: false,
    });
    expect(view.settings.animation).toBe(false);
    expect(view.players).toEqual([]);
    expect(view.result).toBeNull();
  });
});
