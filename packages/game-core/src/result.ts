/**
 * 对局结算（M1-7 / M3-3，见 `开发计划.md` 4.10）。
 *
 * 引擎是纯函数、不读时钟：对局时长由调用方（UI）通过 options.durationMs 传入。
 * 2026-10-18 用户要求：取消趣味分数计算，改为按事件历史汇总每位玩家的操作统计，
 * 供结算页数据图表展示（不决定胜负、不累计）。
 */
import type { GameResult, GameState, PlayerResult } from './types.ts';

/** 单个座位的累计操作统计（从 state.history 汇总） */
interface SeatStats {
  plays: number;
  draws: number;
  stackPlays: number;
  unoCalls: number;
  unoCaught: number;
  challenges: number;
}

function emptyStats(): SeatStats {
  return { plays: 0, draws: 0, stackPlays: 0, unoCalls: 0, unoCaught: 0, challenges: 0 };
}

/**
 * 生成对局结算数据（仅对局结束后可调用）。
 * 玩家的 plays/draws/stackPlays/unoCalls/unoCaught/challenges 与全局统计均来自历史事件，
 * UI 可直接用于结算页图表（不做分数计算）。
 * @throws Error 对局尚未结束时抛出
 */
export function getResult(state: GameState, options: { durationMs?: number } = {}): GameResult {
  if (state.phase !== 'round-end') throw new Error('对局尚未结束，无法生成结算数据');

  const stats: SeatStats[] = state.players.map(() => emptyStats());
  for (const event of state.history) {
    switch (event.type) {
      case 'PLAY':
        stats[event.seat]!.plays += 1;
        break;
      case 'DRAW':
        stats[event.seat]!.draws += event.count;
        break;
      case 'STACK_PUSH':
        stats[event.seat]!.stackPlays += 1;
        break;
      case 'UNO_CALLED':
        stats[event.seat]!.unoCalls += 1;
        break;
      case 'UNO_CAUGHT':
        stats[event.seat]!.unoCaught += 1;
        break;
      case 'CHALLENGE_SUCCESS':
      case 'CHALLENGE_FAIL':
        stats[event.challenger]!.challenges += 1;
        break;
      default:
        break;
    }
  }

  const players: PlayerResult[] = state.players.map((player) => ({
    seat: player.seat,
    name: player.name,
    isHuman: player.isHuman,
    remaining: player.hand.map((card) => ({ ...card })),
    saidUno: player.saidUno,
    ...stats[player.seat]!,
  }));

  const total = (key: keyof SeatStats): number =>
    stats.reduce((sum, seatStats) => sum + seatStats[key], 0);

  return {
    winnerSeat: state.winnerSeat,
    isDraw: state.winnerSeat === null,
    reason: state.endReason ?? 'empty-hand',
    players,
    turns: state.turnCount,
    actions: state.actionCount,
    draws: total('draws'),
    plays: total('plays'),
    stackPlays: total('stackPlays'),
    unoCalls: total('unoCalls'),
    challenges: total('challenges'),
    durationMs: options.durationMs ?? 0,
  };
}
