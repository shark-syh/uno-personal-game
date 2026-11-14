import { describe, expect, it } from 'vitest';
import {
  MERCY_HAND_LIMIT,
  applyAction,
  countCards,
  createInitialGame,
  getLegalActions,
  getResult,
  isGameOver,
  isPlayable,
  normalizeGameConfig,
} from '../src/index.ts';
import type { Card, CardKind, Color, GameState } from '../src/types.ts';

let cardSequence = 0;

/** 构造一张可控的牌（id 全局唯一，faceCode 与 B 版命名无关，测试只看 kind/color/value） */
function card(kind: CardKind, color: Color | null, value: number | null = null): Card {
  cardSequence += 1;
  return {
    id: `${kind}-${cardSequence}`,
    kind,
    color,
    value,
    faceCode: `${kind}-${cardSequence}`,
  };
}

const num = (color: Color, value: number): Card => card('number', color, value);
const draw2 = (color: Color): Card => card('draw2', color);
const draw4 = (color: Color): Card => card('draw4', color);
const draw6 = (): Card => card('draw6', null);
const draw10 = (): Card => card('draw10', null);
const reverseDraw4 = (): Card => card('wildReverseDraw4', null);
const roulette = (): Card => card('wildColorRoulette', null);
const skipEveryone = (color: Color): Card => card('skipEveryone', color);
const discardAll = (color: Color): Card => card('discardAll', color);

interface StateOptions {
  drawPile?: Card[];
  direction?: 1 | -1;
  /** 额外的备用牌堆张数（默认 40 张蓝数字牌，足够叠链与轮盘） */
  pileSize?: number;
}

/**
 * 构造友尽可控局面：座位 0 先手、顶牌与各手牌可指定。
 * autoCallUno=true 让 UNO 窗口不打断测试（所有玩家自动喊，引擎不开窗口）。
 */
function makeMercyState(hands: Card[][], top: Card, options: StateOptions = {}): GameState {
  const state = createInitialGame({
    mode: 'mercy',
    playerCount: hands.length,
    seed: 'mercy-test',
    names: hands.map((_, index) => `P${index}`),
    autoCallUno: true,
  });
  state.phase = 'await-play';
  state.currentSeat = 0;
  state.direction = options.direction ?? 1;
  state.currentColor = top.color;
  state.pendingColorChoiceSeat = null;
  state.drawnThisTurn = null;
  state.discardPile = [top];
  state.drawPile =
    options.drawPile ??
    Array.from({ length: options.pileSize ?? 40 }, (_, index) => num('blue', index % 10));
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

describe('M2 友尽引擎 · 配置与合法性', () => {
  it('友尽模式自动切 official 叠链、关闭 +4 挑战；基础模式一个字段都不变', () => {
    const mercy = normalizeGameConfig({ mode: 'mercy' });
    expect(mercy.stacking).toBe('official');
    expect(mercy.challengeWild4).toBe(false);
    expect(mercy.wild4Legality).toBe('color-only');

    const classic = normalizeGameConfig();
    expect(classic.mode).toBe('classic');
    expect(classic.stacking).toBe('loose');
    expect(classic.challengeWild4).toBe(true);
  });

  it('四类万能牌随时可出；彩色牌按颜色 / 数字 / 符号匹配', () => {
    const state = makeMercyState([[], [], []], num('red', 7));
    for (const wildCard of [draw6(), draw10(), reverseDraw4(), roulette()]) {
      expect(isPlayable(state, wildCard)).toBe(true);
    }
    expect(isPlayable(state, num('red', 3))).toBe(true);
    expect(isPlayable(state, num('blue', 7))).toBe(true); // 同数字跨色
    expect(isPlayable(state, num('blue', 3))).toBe(false);
    expect(isPlayable(state, skipEveryone('blue'))).toBe(false);

    const actionTop = makeMercyState([[], [], []], skipEveryone('red'));
    expect(isPlayable(actionTop, skipEveryone('blue'))).toBe(true); // 同符号跨色
    expect(isPlayable(actionTop, draw2('blue'))).toBe(false);
  });

  it('MERCY_HAND_LIMIT 为官方 25 张', () => {
    expect(MERCY_HAND_LIMIT).toBe(25);
  });
});

describe('M2 友尽引擎 · 7 换手 / 0 传手', () => {
  it('打出 7 进入选目标阶段，只列出其他在局座位；换手后手牌互换且回合推进', () => {
    const seven = num('red', 7);
    const keep = num('blue', 3);
    const targetHand = [num('green', 1), num('green', 2), num('green', 3)];
    const state = makeMercyState([[seven, keep], [num('blue', 5)], targetHand], num('red', 9));

    const after = play(state, seven.id);
    expect(after.phase).toBe('choose-swap-target');
    expect(after.currentSeat).toBe(0);
    expect(getLegalActions(after)).toEqual([
      { type: 'SWAP_HANDS', targetSeat: 1 },
      { type: 'SWAP_HANDS', targetSeat: 2 },
    ]);

    const swapped = applyAction(after, { type: 'SWAP_HANDS', targetSeat: 2 });
    expect(swapped.events).toContainEqual({ type: 'SWAP_HANDS', seat: 0, targetSeat: 2 });
    expect(swapped.state.players[0]!.hand).toEqual(targetHand);
    expect(swapped.state.players[2]!.hand.map((item) => item.id)).toEqual([keep.id]);
    expect(swapped.state.currentSeat).toBe(1);
    expect(swapped.state.phase).toBe('await-play');
  });

  it('最后一牌是 7 先判胜，换手效果不再发生', () => {
    const seven = num('red', 7);
    const state = makeMercyState([[seven], [num('blue', 5)], []], num('red', 9));
    const after = play(state, seven.id);
    expect(after.phase).toBe('round-end');
    expect(after.winnerSeat).toBe(0);
    expect(after.events.some((event) => event.type === 'SWAP_HANDS')).toBe(false);
  });

  it('打出 0 全体按当前方向传手（顺时针 / 逆时针各一例），淘汰者不参与', () => {
    const zero = num('red', 0);
    const state = makeMercyState(
      [[zero, num('red', 1)], [num('yellow', 2)], [num('green', 3), num('green', 4)]],
      num('red', 9),
    );
    const after = play(state, zero.id);
    expect(after.events).toContainEqual({ type: 'PASS_HANDS', direction: 1 });
    // 方向 1：P0 收到 P2 的手牌，P1 收到 P0 的，P2 收到 P1 的
    expect(after.players[0]!.hand.map((item) => item.color)).toEqual(['green', 'green']);
    expect(after.players[1]!.hand.map((item) => item.color)).toEqual(['red']);
    expect(after.players[2]!.hand.map((item) => item.color)).toEqual(['yellow']);
    expect(after.currentSeat).toBe(1);

    const reverse = makeMercyState(
      [[zero, num('red', 1)], [num('yellow', 2)], [num('green', 3)]],
      num('red', 9),
      { direction: -1 },
    );
    const afterReverse = play(reverse, zero.id);
    expect(afterReverse.events).toContainEqual({ type: 'PASS_HANDS', direction: -1 });
    // 方向 -1：P0 收到 P1 的手牌
    expect(afterReverse.players[0]!.hand.map((item) => item.color)).toEqual(['yellow']);
    expect(afterReverse.currentSeat).toBe(2);
  });
});

describe('M2 友尽引擎 · 全员跳过 / 全弃 / 颜色轮盘', () => {
  it('全员跳过：出牌者立即再来一回合，方向不变', () => {
    const all = skipEveryone('red');
    const state = makeMercyState([[all, num('red', 3)], [num('blue', 1)], []], num('red', 9));
    const after = play(state, all.id);
    expect(after.events).toContainEqual({ type: 'SKIP_EVERYONE', seat: 0 });
    expect(after.currentSeat).toBe(0);
    expect(after.direction).toBe(1);
    expect(after.phase).toBe('await-play');
    expect(after.turnCount).toBe(state.turnCount + 1);
  });

  it('全弃：同色牌压在该牌下方，顶牌与颜色不变；清空手牌可直接获胜', () => {
    const all = discardAll('red');
    const redA = num('red', 2);
    const redB = num('red', 4);
    const blue = num('blue', 6);
    const state = makeMercyState([[all, redA, redB, blue], [num('blue', 1)], []], num('red', 9));
    const after = play(state, all.id);
    expect(after.events).toContainEqual({ type: 'DISCARD_ALL', seat: 0, count: 2 });
    expect(after.players[0]!.hand.map((item) => item.id)).toEqual([blue.id]);
    expect(after.discardPile[after.discardPile.length - 1]!.id).toBe(all.id);
    expect(after.discardPile.slice(-3, -1).map((item) => item.id)).toEqual([redA.id, redB.id]);
    expect(after.currentColor).toBe('red');
    expect(after.phase).toBe('await-play');

    const lastCard = discardAll('red');
    const winState = makeMercyState([[lastCard], [num('blue', 1)], []], num('red', 9));
    const won = play(winState, lastCard.id);
    expect(won.phase).toBe('round-end');
    expect(won.events.some((event) => event.type === 'DISCARD_ALL')).toBe(false);
  });

  it('颜色轮盘由下家选色，逐张抽到该色为止、全部入手并被跳过', () => {
    const wheel = roulette();
    // pop 顺序：蓝 → 蓝 → 绿 → 红（数组末尾是堆顶）
    const pile = [num('red', 4), num('green', 3), num('blue', 2), num('blue', 1)];
    const state = makeMercyState(
      [[wheel, num('red', 7)], [num('blue', 5)], [num('blue', 6)], [num('blue', 8)]],
      num('red', 9),
      { drawPile: pile },
    );
    const after = play(state, wheel.id);
    expect(after.phase).toBe('choose-roulette-color');
    expect(after.currentSeat).toBe(1);
    expect(getLegalActions(after)).toEqual([
      { type: 'CHOOSE_ROULETTE_COLOR', color: 'red' },
      { type: 'CHOOSE_ROULETTE_COLOR', color: 'yellow' },
      { type: 'CHOOSE_ROULETTE_COLOR', color: 'green' },
      { type: 'CHOOSE_ROULETTE_COLOR', color: 'blue' },
    ]);

    const result = applyAction(after, { type: 'CHOOSE_ROULETTE_COLOR', color: 'blue' });
    expect(result.events).toContainEqual({ type: 'COLOR_ROULETTE', seat: 1, color: 'blue' });
    expect(result.events.filter((event) => event.type === 'DRAW')).toHaveLength(1);
    expect(result.events).toContainEqual({ type: 'COLOR_SET', seat: 1, color: 'blue' });
    expect(result.state.currentColor).toBe('blue');
    expect(result.state.players[1]!.hand).toHaveLength(2);
    expect(result.state.currentSeat).toBe(2); // 选色者被跳过
    expect(result.state.roulette).toBeNull();

    // 用绿色复测：需要抽 3 张才命中
    const greenState = makeMercyState(
      [[wheel, num('red', 7)], [num('blue', 5)], [num('blue', 6)], [num('blue', 8)]],
      num('red', 9),
      { drawPile: [num('red', 4), num('green', 3), num('blue', 2), num('blue', 1)] },
    );
    const greenAfter = play(greenState, wheel.id);
    const greenResult = applyAction(greenAfter, { type: 'CHOOSE_ROULETTE_COLOR', color: 'green' });
    expect(greenResult.events.filter((event) => event.type === 'DRAW')).toHaveLength(3);
    expect(greenResult.state.players[1]!.hand).toHaveLength(4);
    expect(greenResult.state.currentColor).toBe('green');
  });

  it('轮盘牌堆与弃牌堆同时耗尽：按兜底停止抽牌并跳过回合，不误判胜负', () => {
    const state = makeMercyState([[num('red', 7)], [num('blue', 5)], []], num('red', 9));
    state.phase = 'choose-roulette-color';
    state.currentSeat = 1;
    state.roulette = { initiatorSeat: 0, chooserSeat: 1, targetColor: null };
    state.discardPile = [roulette()];
    state.drawPile = [];

    const result = applyAction(state, { type: 'CHOOSE_ROULETTE_COLOR', color: 'red' });
    expect(result.events.some((event) => event.type === 'ROULETTE_EXHAUSTED')).toBe(true);
    expect(result.state.phase).toBe('await-play');
    expect(result.state.endReason).toBeNull();
    expect(result.state.currentSeat).toBe(2);
  });
});

describe('M2 友尽引擎 · 罚牌与 official 叠链', () => {
  it('+2 / 彩色+4 / +6 / +10 / 反转+4 都创建对应总额的叠链', () => {
    const cases: Array<{ label: string; card: Card; total: number; color?: Color }> = [
      { label: '+2', card: draw2('red'), total: 2 },
      { label: '彩色+4', card: draw4('red'), total: 4 },
      { label: '+6', card: draw6(), total: 6, color: 'green' },
      { label: '+10', card: draw10(), total: 10, color: 'green' },
      { label: '反转+4', card: reverseDraw4(), total: 4, color: 'green' },
    ];
    for (const item of cases) {
      const state = makeMercyState(
        [[item.card, num('red', 7)], [num('blue', 1)], [num('blue', 2)]],
        num('red', 9),
      );
      const after = play(state, item.card.id, item.color);
      expect(after.phase, item.label).toBe('stack-response');
      expect(after.stack!.total, item.label).toBe(item.total);
      expect(after.stack!.topDrawValue, item.label).toBe(item.total);
      expect(after.events).toContainEqual({
        type: 'STACK_PUSH',
        seat: 0,
        card: item.card,
        total: item.total,
      });
    }
  });

  it('official：只能叠等值或更高罚牌，+10 之后只剩 +10 或弃权；低值直接抛错', () => {
    const plus2 = draw2('red');
    const low1 = draw2('blue');
    const plus4 = draw4('blue');
    const plus6 = draw6();
    const plus10 = draw10();
    const low2 = draw2('green');
    const plus10b = draw10();
    const low3 = draw2('yellow');
    const plus10c = draw10();
    const state = makeMercyState(
      [
        [plus2, num('red', 7)],
        [low1, plus4, plus6, plus10, num('blue', 3)],
        [low2, plus10b, num('blue', 4)],
        [low3, plus10c, num('green', 5)],
      ],
      num('red', 9),
    );

    const after = play(state, plus2.id);
    expect(after.stack!.total).toBe(2);
    expect(after.currentSeat).toBe(1);
    const firstLegal = getLegalActions(after).filter((action) => action.type === 'STACK_PLAY');
    expect(firstLegal.some((action) => action.cardId === low1.id)).toBe(true);
    expect(firstLegal).toHaveLength(10); // +2×1、彩色+4×1、+6×4 色、+10×4 色

    // 座位 1 打出彩色 +4 → 链顶变成 4，轮到座位 2
    const chained4 = applyAction(after, { type: 'STACK_PLAY', cardId: plus4.id }).state;
    expect(chained4.stack!.total).toBe(6);
    expect(chained4.stack!.topDrawValue).toBe(4);
    expect(chained4.currentSeat).toBe(2);
    expect(
      getLegalActions(chained4).some((a) => a.type === 'STACK_PLAY' && a.cardId === low2.id),
    ).toBe(false);
    expect(() => applyAction(chained4, { type: 'STACK_PLAY', cardId: low2.id })).toThrow(
      /罚牌数值不足/,
    );

    // 座位 2 打出 +10（链顶 10，累计 16），轮到座位 3
    const chained10 = applyAction(chained4, {
      type: 'STACK_PLAY',
      cardId: plus10b.id,
      colorChoice: 'green',
    }).state;
    expect(chained10.stack!.total).toBe(16);
    expect(chained10.stack!.topDrawValue).toBe(10);
    expect(chained10.currentColor).toBe('green');
    const topLegal = getLegalActions(chained10).filter((a) => a.type === 'STACK_PLAY');
    expect(topLegal).toHaveLength(4); // 只剩 +10 的 4 个颜色选项，+2 已被过滤
    expect(topLegal.every((a) => a.cardId === plus10c.id)).toBe(true);
    expect(getLegalActions(chained10)).toContainEqual({ type: 'STACK_DECLINE' });

    // 弃权：座位 3 摸 16 张，不开放 +4 挑战，回合交给下一位
    const declined = applyAction(chained10, { type: 'STACK_DECLINE' }).state;
    expect(declined.stack).toBeNull();
    expect(declined.phase).toBe('await-play');
    expect(declined.players[3]!.hand).toHaveLength(19); // 原 3 张 + 摸 16 张
    expect(declined.currentSeat).toBe(0);
  });

  it('反转+4 先反转方向；2 人局罚牌指向出牌者自己，可立即叠牌回敬', () => {
    const rev = reverseDraw4();
    const three = makeMercyState(
      [[rev, num('red', 7)], [num('blue', 1)], [num('blue', 2)]],
      num('red', 9),
    );
    const afterThree = play(three, rev.id, 'green');
    expect(afterThree.direction).toBe(-1);
    expect(afterThree.stack!.awaitingSeat).toBe(2);
    expect(afterThree.events).toContainEqual({ type: 'REVERSE', direction: -1 });

    const two = makeMercyState([[rev, num('red', 7)], [num('blue', 1)]], num('red', 9));
    const afterTwo = play(two, rev.id, 'green');
    expect(afterTwo.stack!.awaitingSeat).toBe(0);
    expect(afterTwo.currentSeat).toBe(0);
  });

  it('最后一牌是罚牌：判胜同时下家仍摸累计张数', () => {
    const last = draw10();
    const state = makeMercyState([[last], [num('blue', 1)], []], num('red', 9));
    const after = play(state, last.id, 'green');
    expect(after.phase).toBe('round-end');
    expect(after.winnerSeat).toBe(0);
    expect(after.events).toContainEqual({ type: 'STACK_RESOLVE', seat: 1, total: 10 });
    expect(after.players[1]!.hand).toHaveLength(11);
  });
});

describe('M2 友尽引擎 · 25 张淘汰与最后幸存者', () => {
  it('摸牌导致手牌 ≥25 立即出局，手牌搁置且牌数守恒，回合跳过淘汰者', () => {
    const plus2 = draw2('red');
    const bigHand = Array.from({ length: 24 }, (_, index) => num('blue', index % 10));
    const state = makeMercyState(
      [[plus2, num('red', 7)], bigHand, [num('green', 3)]],
      num('red', 9),
    );
    const initialTotal = countCards(state);
    const chained = play(state, plus2.id);
    const declined = applyAction(chained, { type: 'STACK_DECLINE' });

    expect(declined.events).toContainEqual({ type: 'MERCY_ELIMINATED', seat: 1, count: 26 });
    expect(declined.state.players[1]!.eliminated).toBe(true);
    expect(declined.state.players[1]!.hand).toHaveLength(0);
    expect(declined.state.parkedCards).toHaveLength(26);
    expect(countCards(declined.state)).toBe(initialTotal);
    expect(declined.state.currentSeat).toBe(2);
    expect(declined.state.endReason).toBeNull();
    expect(getLegalActions(declined.state).length).toBeGreaterThan(0);
  });

  it('淘汰后只剩一人：最后幸存者获胜，结算 reason 为 last-survivor', () => {
    const plus10 = draw10();
    const bigHand = Array.from({ length: 24 }, (_, index) => num('blue', index % 10));
    const state = makeMercyState([[plus10, num('red', 7)], bigHand], num('red', 9));
    const chained = play(state, plus10.id, 'green');
    const declined = applyAction(chained, { type: 'STACK_DECLINE' });

    expect(declined.state.players[1]!.eliminated).toBe(true);
    expect(isGameOver(declined.state)).toBe(true);
    expect(declined.state.winnerSeat).toBe(0);
    expect(declined.state.endReason).toBe('last-survivor');
    expect(declined.events).toContainEqual({
      type: 'ROUND_END',
      winnerSeat: 0,
      reason: 'last-survivor',
    });
    expect(getResult(declined.state).reason).toBe('last-survivor');
  });

  it('淘汰者不参与 7 换手目标，也不参与 0 传手旋转', () => {
    const seven = num('red', 7);
    const state = makeMercyState([[seven, num('red', 1)], [num('blue', 2)], [num('green', 3)]], num('red', 9));
    state.players[1]!.eliminated = true;
    state.players[1]!.hand = [];
    const after = play(state, seven.id);
    expect(getLegalActions(after)).toEqual([{ type: 'SWAP_HANDS', targetSeat: 2 }]);

    const zero = num('red', 0);
    const rotateState = makeMercyState(
      [[zero, num('red', 1)], [num('blue', 2)], [num('green', 3), num('green', 4)]],
      num('red', 9),
    );
    rotateState.players[1]!.eliminated = true;
    rotateState.players[1]!.hand = [];
    const rotated = play(rotateState, zero.id);
    expect(rotated.players[0]!.hand.map((item) => item.color)).toEqual(['green', 'green']);
    expect(rotated.players[2]!.hand.map((item) => item.color)).toEqual(['red']);
    expect(rotated.players[1]!.hand).toHaveLength(0);
  });

  it('抽牌堆耗尽重洗时把搁置手牌放回抽牌堆', () => {
    const state = makeMercyState(
      [[num('red', 7)], [num('blue', 5)], [num('green', 3)]],
      num('red', 9),
      { drawPile: [] },
    );
    state.parkedCards = [num('yellow', 1), num('yellow', 2)];
    state.discardPile = [num('red', 9), num('red', 8)];
    state.players[0]!.hand = [];
    state.currentColor = 'red';
    const before = countCards(state);
    const after = applyAction(state, { type: 'DRAW' }).state;
    expect(after.events.some((event) => event.type === 'PILE_RESHUFFLE')).toBe(true);
    expect(after.parkedCards).toHaveLength(0);
    expect(countCards(after)).toBe(before);
    expect(after.players[0]!.hand).toHaveLength(1);
  });
});

describe('M2 友尽引擎 · 完整对局与基础模式回归', () => {
  it('友尽模式可从开局被合法动作驱动到结束，中途不卡死、不抛异常', () => {
    let state = createInitialGame({
      mode: 'mercy',
      playerCount: 4,
      seed: 'm2-mercy-playout',
      autoCallUno: true,
    });
    for (let step = 0; step < 3000 && !isGameOver(state); step += 1) {
      const legal = getLegalActions(state);
      expect(legal.length).toBeGreaterThan(0);
      // 固定取第一个合法动作：覆盖出牌 / 摸牌 / 叠牌响应 / 换手 / 轮盘选色
      state = applyAction(state, legal[0]!).state;
    }
    expect(isGameOver(state)).toBe(true);
    expect(state.endReason).not.toBeNull();
    expect(state.history.some((event) => event.type === 'ROUND_END')).toBe(true);
  });

  it('基础模式零回归：108 张、loose 叠链、+4 挑战窗口仍可用', () => {
    const classic = createInitialGame({ seed: 'm2-classic' });
    expect(classic.config.mode).toBe('classic');
    expect(classic.config.stacking).toBe('loose');
    expect(classic.config.challengeWild4).toBe(true);
    expect(countCards(classic)).toBe(108);
    expect(classic.parkedCards).toEqual([]);
    expect(classic.players.every((player) => player.eliminated === false)).toBe(true);

    // classic 的 +2 上可以叠 Wild+4（宽松叠法不看数值）
    const state = makeMercyState(
      [[draw2('red'), num('red', 7)], [card('wild4', null), num('blue', 1)], [num('blue', 2)]],
      num('red', 9),
    );
    state.config.mode = 'classic';
    state.config.stacking = 'loose';
    state.config.challengeWild4 = true;
    const classicDraw2 = state.players[0]!.hand.find((item) => item.kind === 'draw2')!;
    const chained = play(state, classicDraw2.id);
    expect(chained.stack!.total).toBe(2);
    const wild4 = state.players[1]!.hand.find((item) => item.kind === 'wild4')!;
    const stacked = applyAction(chained, {
      type: 'STACK_PLAY',
      cardId: wild4.id,
      colorChoice: 'green',
    }).state;
    expect(stacked.stack!.total).toBe(6);
    expect(stacked.currentColor).toBe('green');
  });
});
