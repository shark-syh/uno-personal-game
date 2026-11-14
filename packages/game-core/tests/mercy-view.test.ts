/**
 * M3 视图与脱敏：友尽模式公开视图、换手/传手后按座位隔离、新事件显式脱敏。
 *
 * 只增断言：classic 的既有视图字段与 `public-view.test.ts` 全部保持原样。
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createInitialGame,
  createLobbyView,
  getGameView,
  sanitizeEventsForSeat,
} from '../src/index.ts';
import type { Card, CardKind, Color, GameEvent, GameState } from '../src/types.ts';

let cardSequence = 0;

function card(kind: CardKind, color: Color | null, value: number | null = null): Card {
  cardSequence += 1;
  return {
    id: `m3-${kind}-${cardSequence}`,
    kind,
    color,
    value,
    faceCode: `m3-${kind}-${cardSequence}`,
  };
}

const num = (color: Color, value: number): Card => card('number', color, value);
const draw6 = (): Card => card('draw6', null);
const roulette = (): Card => card('wildColorRoulette', null);

/** 与 mercy-effects.test.ts 同口径的可控友尽局面（座位 0 先手） */
function makeMercyState(hands: Card[][], top: Card, pileSize = 40): GameState {
  const state = createInitialGame({
    mode: 'mercy',
    playerCount: hands.length,
    seed: 'mercy-view-test',
    names: hands.map((_, index) => `P${index}`),
    autoCallUno: true,
  });
  state.phase = 'await-play';
  state.currentSeat = 0;
  state.direction = 1;
  state.currentColor = top.color;
  state.pendingColorChoiceSeat = null;
  state.drawnThisTurn = null;
  state.discardPile = [top];
  state.drawPile = Array.from({ length: pileSize }, (_, index) => num('blue', index % 10));
  state.players.forEach((player, seat) => {
    player.hand = hands[seat] ?? [];
  });
  state.events = [];
  state.history = [];
  state.stack = null;
  state.wild4Info = null;
  state.pendingChallenge = null;
  state.unoWindow = null;
  state.pendingSwap = null;
  state.roulette = null;
  state.parkedCards = [];
  state.winnerSeat = null;
  state.endReason = null;
  return state;
}

function play(state: GameState, cardId: string, colorChoice?: Color): GameState {
  return applyAction(state, { type: 'PLAY_CARD', cardId, colorChoice }).state;
}

/** 精确取出视图里的卡牌 id（避免 faceCode 子串误报，如 one-yellow#0 ⊂ skip-everyone-yellow#0） */
function idsIn(value: unknown): string[] {
  return [...JSON.stringify(value).matchAll(/"id":"([^"]+)"/g)].map((match) => match[1]!);
}

describe('M3 视图：mode / 淘汰状态 / 叠链总额（classic 零回归）', () => {
  it('classic 视图只多出 mode / mercy / stackTotal / eliminated，契约四个 config 字段不变', () => {
    const state = createInitialGame({ playerCount: 3, seed: 'm3-classic' });
    const view = getGameView(state, 0);
    expect(view.mode).toBe('classic');
    expect(view.mercy).toBeNull();
    expect(view.table.stackTotal).toBe(0);
    expect(view.players.every((player) => player.eliminated === false)).toBe(true);
    expect(view.config).toEqual({
      playerCount: 3,
      difficulty: state.config.aiDifficulty,
      aiMode: state.config.aiMode,
      challengeWild4: state.config.challengeWild4,
    });
    expect(view.table.stack).toBeNull();
  });

  it('大厅伪视图默认 classic，传入 mode 时只写顶层字段、不改 config', () => {
    expect(createLobbyView().mode).toBe('classic');
    expect(createLobbyView().mercy).toBeNull();
    expect(createLobbyView().table.stackTotal).toBe(0);
    const mercyLobby = createLobbyView({ mode: 'mercy', playerCount: 6 });
    expect(mercyLobby.mode).toBe('mercy');
    expect(mercyLobby.config).toEqual({
      playerCount: 6,
      difficulty: 'realistic',
      aiMode: 'auto',
      challengeWild4: true,
    });
  });

  it('mercy 视图暴露摘要：淘汰座位、搁置牌数、换手/轮盘待选座位', () => {
    const state = makeMercyState(
      [[num('red', 5)], [num('blue', 2)], [num('green', 1)]],
      num('red', 9),
    );
    state.players[1]!.eliminated = true;
    state.parkedCards = [num('red', 1), num('red', 2), num('red', 3)];
    state.pendingSwap = { initiatorSeat: 0 };
    state.roulette = { initiatorSeat: 2, chooserSeat: 0, targetColor: 'yellow' };

    const view = getGameView(state, 2);
    expect(view.mode).toBe('mercy');
    expect(view.players.map((player) => player.eliminated)).toEqual([false, true, false]);
    expect(view.mercy).toEqual({
      pendingSwapSeat: 0,
      rouletteChooserSeat: 0,
      rouletteTargetColor: 'yellow',
      parkedCardsCount: 3,
      eliminatedSeats: [1],
    });
    // 摘要不能携带任何牌面（搁置牌的 id 一个都不出现）
    for (const parked of state.parkedCards) {
      expect(JSON.stringify(view.mercy)).not.toContain(parked.id);
    }
  });

  it('叠链总额与 official 链顶罚值投影到 table（+6 罚牌链）', () => {
    const plus6 = draw6();
    const state = makeMercyState(
      [[plus6, num('red', 7)], [num('blue', 1)], [num('blue', 2)]],
      num('red', 9),
    );
    const after = play(state, plus6.id, 'green');
    expect(after.phase).toBe('stack-response');

    const view = getGameView(after, 1);
    expect(view.table.stackTotal).toBe(6);
    expect(view.table.stack?.total).toBe(6);
    expect(view.table.stack?.topDrawValue).toBe(6);
    expect(view.human.mustRespondStack).toBe(true);
  });

  it('轮盘选色阶段：chooser 座位在 mercy 摘要里，法律动作四个颜色都能下发', () => {
    const wheel = roulette();
    const state = makeMercyState(
      [[wheel, num('red', 7)], [num('blue', 5)], [num('blue', 6)]],
      num('red', 9),
    );
    const after = play(state, wheel.id);
    const view = getGameView(after, 1);
    expect(after.phase).toBe('choose-roulette-color');
    expect(view.mercy?.rouletteChooserSeat).toBe(1);
    expect(view.mercy?.rouletteTargetColor).toBeNull();
    expect(view.human.legalActions.map((action) => action.type)).toEqual([
      'CHOOSE_ROULETTE_COLOR',
      'CHOOSE_ROULETTE_COLOR',
      'CHOOSE_ROULETTE_COLOR',
      'CHOOSE_ROULETTE_COLOR',
    ]);
    // 非选色者拿不到选色动作
    expect(getGameView(after, 0).human.legalActions).toEqual([]);
  });
});

describe('M3 视图：换手 / 传手后按座位脱敏', () => {
  it('7 换手后每个座位只看到自己换到的手牌，事件不带任何牌面', () => {
    const seven = num('red', 7);
    const keep = num('blue', 3);
    const targetHand = [num('green', 1), num('green', 2), num('green', 3)];
    const state = makeMercyState([[seven, keep], [num('blue', 5)], targetHand], num('red', 9));

    const choosing = play(state, seven.id);
    expect(choosing.phase).toBe('choose-swap-target');
    expect(getGameView(choosing, 0).mercy?.pendingSwapSeat).toBe(0);
    expect(
      getGameView(choosing, 0).human.legalActions.every((action) => action.type === 'SWAP_HANDS'),
    ).toBe(true);

    const swapped = applyAction(choosing, { type: 'SWAP_HANDS', targetSeat: 2 }).state;
    const view0 = getGameView(swapped, 0);
    const view2 = getGameView(swapped, 2);
    expect(view0.human.hand.map((item) => item.id)).toEqual(targetHand.map((item) => item.id));
    expect(view2.human.hand.map((item) => item.id)).toEqual([keep.id]);

    // 两副手牌互不出现在对方视图里（按完整 id 精确比对）
    for (const item of targetHand) expect(idsIn(view2)).not.toContain(item.id);
    expect(idsIn(view0)).not.toContain(keep.id);
    // 换手事件只带座位号
    expect(view0.events.find((event) => event.type === 'SWAP_HANDS')).toEqual({
      type: 'SWAP_HANDS',
      seat: 0,
      targetSeat: 2,
    });
    expect(view2.events.find((event) => event.type === 'SWAP_HANDS')).toEqual({
      type: 'SWAP_HANDS',
      seat: 0,
      targetSeat: 2,
    });
  });

  it('0 传手后刚摸的牌若已转到别的座位，不再把牌面下发给原座位', () => {
    const transferred = num('red', 8);
    const state = makeMercyState([[num('blue', 4)], [num('blue', 5)]], num('red', 9));
    state.currentSeat = 0;
    state.drawnThisTurn = transferred; // 模拟传手后未清、且牌已在座位 1 手里
    state.players[1]!.hand.push(transferred);

    const view0 = getGameView(state, 0);
    expect(view0.human.drawnThisTurn).toBeNull();
    expect(view0.human.legalActions.some((action) => action.type === 'PLAY_DRAWN')).toBe(false);
    expect(idsIn(view0)).not.toContain(transferred.id);
    // classic 仍按原口径（没有传手，不会触发这层校验）
    const classic = createInitialGame({ playerCount: 2, seed: 'm3-classic-drawn' });
    classic.currentSeat = 0;
    classic.drawnThisTurn = transferred;
    expect(getGameView(classic, 0).human.drawnThisTurn?.id).toBe(transferred.id);
  });

  it('M2 八类新事件按定义字段显式重建，额外夹带的牌面一律丢弃', () => {
    const leaked = num('yellow', 6);
    const dirty = [
      { type: 'SWAP_HANDS', seat: 0, targetSeat: 1, cards: [leaked] },
      { type: 'PASS_HANDS', direction: 1, hand: [leaked] },
      { type: 'SKIP_EVERYONE', seat: 0, cards: [leaked] },
      { type: 'DISCARD_ALL', seat: 0, count: 3, cards: [leaked] },
      { type: 'COLOR_ROULETTE', seat: 1, color: 'blue', cards: [leaked] },
      { type: 'ROULETTE_EXHAUSTED', seat: 1, cards: [leaked] },
      { type: 'MERCY_ELIMINATED', seat: 2, count: 25, hand: [leaked] },
      { type: 'DRAW', seat: 1, count: 1, cards: [leaked] },
    ] as unknown as GameEvent[];

    const sanitized = sanitizeEventsForSeat(dirty, 0);
    expect(sanitized).toEqual([
      { type: 'SWAP_HANDS', seat: 0, targetSeat: 1 },
      { type: 'PASS_HANDS', direction: 1 },
      { type: 'SKIP_EVERYONE', seat: 0 },
      { type: 'DISCARD_ALL', seat: 0, count: 3 },
      { type: 'COLOR_ROULETTE', seat: 1, color: 'blue' },
      { type: 'ROULETTE_EXHAUSTED', seat: 1 },
      { type: 'MERCY_ELIMINATED', seat: 2, count: 25 },
      { type: 'DRAW', seat: 1, count: 1, cards: [] },
    ]);
    expect(JSON.stringify(sanitized)).not.toContain(leaked.id);
    // 本人摸牌仍保留牌面
    const own = sanitizeEventsForSeat(
      [{ type: 'DRAW', seat: 0, count: 1, cards: [leaked] }],
      0,
    );
    expect(own[0]).toMatchObject({ cards: [leaked] });
  });
});
