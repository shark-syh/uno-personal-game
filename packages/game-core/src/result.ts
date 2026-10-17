/**
 * 对局结算（M1-7，见 `开发计划.md` 4.10）。
 *
 * 引擎是纯函数、不读时钟：对局时长由调用方（UI）通过 options.durationMs 传入。
 * 趣味分数只用于结算页展示，不累计、不决定胜负。
 */
import type { Card, GameResult, GameState, PlayerResult } from './types.ts';

/** 单张牌的趣味分值：数字 = 面值，动作牌 = 20，万能牌 = 50 */
export function cardScore(card: Card): number {
  if (card.kind === 'wild' || card.kind === 'wild4') return 50;
  if (card.kind === 'number') return card.value ?? 0;
  return 20;
}

/** 一组手牌的趣味总分 */
export function scoreHand(cards: readonly Card[]): number {
  return cards.reduce((sum, card) => sum + cardScore(card), 0);
}

/**
 * 生成对局结算数据（仅对局结束后可调用）。
 * @throws Error 对局尚未结束时抛出
 */
export function getResult(state: GameState, options: { durationMs?: number } = {}): GameResult {
  if (state.phase !== 'round-end') throw new Error('对局尚未结束，无法生成结算数据');

  const players: PlayerResult[] = state.players.map((player) => ({
    seat: player.seat,
    name: player.name,
    isHuman: player.isHuman,
    remaining: player.hand.map((card) => ({ ...card })),
    score: scoreHand(player.hand),
    saidUno: player.saidUno,
  }));

  // 赢家本局得分（官方 UNO 计分口径）：赢家获得所有对手剩余手牌趣味分之和。
  // 仅作结算展示，不决定胜负；平局无赢家 → 0。
  const winnerScore =
    state.winnerSeat === null
      ? 0
      : players.reduce(
          (sum, player) => (player.seat === state.winnerSeat ? sum : sum + player.score),
          0,
        );

  let draws = 0;
  let plays = 0;
  let stackPlays = 0;
  let unoCalls = 0;
  for (const event of state.history) {
    if (event.type === 'DRAW') draws += event.count;
    else if (event.type === 'PLAY') plays += 1;
    else if (event.type === 'STACK_PUSH') stackPlays += 1;
    else if (event.type === 'UNO_CALLED') unoCalls += 1;
  }

  return {
    winnerSeat: state.winnerSeat,
    isDraw: state.winnerSeat === null,
    reason: state.endReason ?? 'empty-hand',
    players,
    winnerScore,
    turns: state.turnCount,
    actions: state.actionCount,
    draws,
    plays,
    stackPlays,
    unoCalls,
    durationMs: options.durationMs ?? 0,
  };
}
