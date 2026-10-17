/**
 * AI 测试共用工具：构造可控局面。
 *
 * 做法与 game-core 的测试一致：用 `createInitialGame` 创建合法初始状态后覆写手牌/牌堆，
 * 保证 GameState 字段完整（rng/history/config 等），避免手写残缺对象。
 */
import { applyAction, createInitialGame, createRng } from '@uno/game-core';
import type { Card, CardKind, Color, GameState, RngState } from '@uno/game-core';

let cardSequence = 0;

/** 构造一张测试用牌（id 全局唯一） */
export function makeCard(
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

export const num = (color: Color, value: number): Card => makeCard('number', color, value);
export const skip = (color: Color): Card => makeCard('skip', color, null);
export const reverse = (color: Color): Card => makeCard('reverse', color, null);
export const draw2 = (color: Color): Card => makeCard('draw2', color, null);
export const wild = (): Card => makeCard('wild', null, null, 'WC');
export const wild4 = (): Card => makeCard('wild4', null, null, 'W4');

/** 默认抽牌堆（30 张，内容不影响大部分 AI 决策测试） */
export function defaultDrawPile(): Card[] {
  return Array.from({ length: 30 }, (_, index) => num('blue', index % 10));
}

export interface StateOptions {
  drawPile?: Card[];
  discardPile?: Card[];
  config?: Partial<GameState['config']>;
  currentSeat?: number;
  direction?: 1 | -1;
}

/** 构造可控局面（座位 0 默认先手；history 清空，必要时测试自行补事件） */
export function makeState(hands: Card[][], top: Card, options: StateOptions = {}): GameState {
  const state = createInitialGame({
    playerCount: hands.length,
    seed: 'ai-test',
    names: hands.map((_, index) => `P${index}`),
  });

  state.phase = 'await-play';
  state.currentSeat = options.currentSeat ?? 0;
  state.direction = options.direction ?? 1;
  state.currentColor = top.color;
  state.pendingColorChoiceSeat = null;
  state.drawnThisTurn = null;
  state.discardPile = options.discardPile ?? [top];
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
  // 默认自动喊 UNO：隔离 UNO 窗口，避免影响 M2 决策测试（UNO 窗口单独构造）
  state.config = { ...state.config, autoCallUno: true, ...options.config };
  return state;
}

/** AI 决策用随机源（与引擎随机源分离） */
export function decisionRng(seed = 'ai-test-rng'): RngState {
  return createRng(seed);
}

/**
 * 构造 +4 挑战窗口（challenge-decide）局面：
 * 座位 0 打出 [Wild+4, 红5] 里的 +4（选蓝），座位 1 弃权叠牌 → 进入挑战窗口。
 * `extraSeenRed` 控制弃牌堆里额外已公开的红牌数（用于调节"红牌剩余"）。
 */
export function makeChallengeState(extraSeenRed = 0): GameState {
  const state = makeState(
    [
      [wild4(), num('red', 5)],
      [num('green', 9), num('blue', 2)],
    ],
    num('red', 3),
    {
      discardPile: [
        num('red', 3),
        ...Array.from({ length: extraSeenRed }, (_, index) => num('red', index % 10)),
      ],
    },
  );
  // 补上起手牌事件，让" +4 前的颜色"可以从历史重建
  state.history = [{ type: 'START_CARD', card: state.discardPile[0]! }];
  const played = applyAction(state, {
    type: 'PLAY_CARD',
    cardId: state.players[0]!.hand[0]!.id,
    colorChoice: 'blue',
  });
  const declined = applyAction(played.state, { type: 'STACK_DECLINE' });
  return declined.state;
}
