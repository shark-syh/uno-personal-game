/**
 * AI 公开视图（M2 信息隔离层）。
 *
 * 引擎是"全知"的：`GameState` 里含所有玩家手牌、`wild4Info`（+4 是否合法）等隐藏信息。
 * AI 决策器只能看到**自己**的手牌与公开信息，因此所有 AI 逻辑统一从 `AiView` 取数，
 * 而不是直接读 `GameState`。这样即使将来 M3-2 的 `getPublicView` / 前端渲染层出问题，
 * AI 侧也不会偷看。
 */
import { nextSeat } from '@uno/game-core';
import type { Card, Color, GameEvent, GameState } from '@uno/game-core';
import type { AiPlayerView, AiView } from './types.ts';

/**
 * 事件脱敏：
 * - 他人 `DRAW` 事件不携带具体牌面（自己摸的牌保留，供 AI 知道自己摸到了什么）；
 * - `CHALLENGE_SUCCESS` 不携带被挑战者手牌（人类挑战者才允许看，AI 不偷看）。
 */
export function sanitizeHistory(events: readonly GameEvent[], seat: number): GameEvent[] {
  return events.map((event) => {
    if (event.type === 'DRAW') {
      if (event.seat === seat) return event;
      return { type: 'DRAW', seat: event.seat, count: event.count, cards: [] };
    }
    if (event.type === 'CHALLENGE_SUCCESS') {
      return {
        type: 'CHALLENGE_SUCCESS',
        challenger: event.challenger,
        target: event.target,
      };
    }
    return event;
  });
}

/** 最近一次 Wild+4 被打出之前的颜色（公开信息；挑战判定依据），没有则 null */
export function colorBeforeLastWild4(events: readonly GameEvent[]): Color | null {
  let playIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type === 'PLAY' && event.card.kind === 'wild4') {
      playIndex = index;
      break;
    }
  }
  if (playIndex < 0) return null;

  let color: Color | null = null;
  for (let index = 0; index < playIndex; index += 1) {
    const event = events[index]!;
    if (event.type === 'START_CARD') {
      if (event.card.color) color = event.card.color;
    } else if (event.type === 'PLAY') {
      if (event.card.color) color = event.card.color;
    } else if (event.type === 'COLOR_SET') {
      color = event.color;
    }
  }
  return color;
}

/** 下一位玩家座位 */
export function nextPlayerSeat(view: AiView): number {
  return nextSeat(view.seat, view.players.length, view.direction);
}

/** 构造某个座位的公开视图 */
export function getAiView(state: GameState, seat: number): AiView {
  const player = state.players[seat];
  if (!player) throw new RangeError(`座位 ${seat} 不存在（共 ${state.players.length} 人）`);

  const players: AiPlayerView[] = state.players.map((item) => ({
    seat: item.seat,
    name: item.name,
    isHuman: item.isHuman,
    handCount: item.hand.length,
    saidUno: item.saidUno,
  }));

  const hand: Card[] = player.hand.map((card) => ({ ...card }));
  const drawnThisTurn =
    state.currentSeat === seat && state.drawnThisTurn ? { ...state.drawnThisTurn } : null;

  return {
    seat,
    phase: state.phase,
    currentSeat: state.currentSeat,
    direction: state.direction,
    currentColor: state.currentColor,
    turnCount: state.turnCount,
    config: {
      playerCount: state.config.playerCount,
      humanSeat: state.config.humanSeat,
      deckExhaustion: state.config.deckExhaustion,
      stacking: state.config.stacking,
      challengeWild4: state.config.challengeWild4,
      twoPlayerRules: state.config.twoPlayerRules,
      unoPenalty: state.config.unoPenalty,
      wild4Legality: state.config.wild4Legality,
    },
    hand,
    players,
    discardPile: state.discardPile.map((card) => ({ ...card })),
    topCard:
      state.discardPile.length > 0 ? { ...state.discardPile[state.discardPile.length - 1]! } : null,
    drawPileCount: state.drawPile.length,
    drawnThisTurn,
    stack: state.stack
      ? {
          total: state.stack.total,
          chain: state.stack.chain.map((card) => ({ ...card })),
          lastPlayer: state.stack.lastPlayer,
          topColor: state.stack.topColor,
          awaitingSeat: state.stack.awaitingSeat,
        }
      : null,
    pendingChallenge: state.pendingChallenge ? { ...state.pendingChallenge } : null,
    unoWindow: state.unoWindow
      ? {
          seat: state.unoWindow.seat,
          canCall: state.unoWindow.canCall,
          canCatch: [...state.unoWindow.canCatch],
        }
      : null,
    history: sanitizeHistory(state.history, seat),
  };
}
