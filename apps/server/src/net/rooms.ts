/**
 * M8-01/M8-02 房间管理与服务端权威游戏循环。
 *
 * 职责：
 * - 房间生命周期：创建 / 加入 / 座位分配 / 房主开始 / 离开与断线标记；
 * - 服务端权威对局：房间持有唯一 GameState（createInitialGame），
 *   上行动作先校验「座位是否允许行动」，再交 applyAction 裁决并应用；
 * - 回合推进、UNO 窗口、+4 挑战窗口全部由引擎状态机裁决（服务端不另写规则）。
 *
 * 隔离（计划 §8.2 三道保证之一）：本模块只暴露房间快照与「按座位取视图」的
 * getSeatViews()，调用方（wsServer）按连接绑定的座位各发各的视图。
 */
import { randomBytes } from 'node:crypto';
import {
  applyAction,
  createInitialGame,
  getGameView,
  isGameOver,
  normalizeGameConfig,
  type EngineAction,
  type GameState,
  type GameView,
} from '@uno/game-core';
import { ROOM_CODE_LENGTH, type RoomSnapshot } from './protocol.ts';

export const MAX_SEATS = 10;
export const MIN_SEATS = 2;

/** 房间码字符集：去掉 0/O/1/I 等易混淆字符 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface RoomPlayer {
  seat: number;
  name: string;
  /** 会话 token（M8-06 重连恢复用；只在 joined 消息里发给本人） */
  token: string;
  connected: boolean;
}

export interface Room {
  code: string;
  status: 'lobby' | 'playing' | 'ended';
  hostSeat: number;
  players: RoomPlayer[];
  /** 服务端权威对局状态（playing 后非 null） */
  state: GameState | null;
  /** 开局时间戳（结算视图 durationMs 用） */
  startedAt: number;
}

export type RoomErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_ALREADY_PLAYING'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'NOT_ENOUGH_PLAYERS'
  | 'GAME_NOT_STARTED'
  | 'GAME_ALREADY_ENDED'
  | 'NOT_YOUR_TURN'
  | 'ILLEGAL_ACTION';

export class RoomError extends Error {
  constructor(
    public readonly code: RoomErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RoomError';
  }
}

function generateRoomCode(): string {
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  let code = '';
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[bytes[index]! % CODE_ALPHABET.length];
  }
  return code;
}

function generateToken(): string {
  return randomBytes(16).toString('hex');
}

export function toRoomSnapshot(room: Room): RoomSnapshot {
  return {
    code: room.code,
    status: room.status,
    hostSeat: room.hostSeat,
    players: room.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      connected: player.connected,
    })),
  };
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  /** 创建房间：创建者坐 0 号位并成为房主 */
  createRoom(hostName: string): { room: Room; player: RoomPlayer } {
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();
    const player: RoomPlayer = { seat: 0, name: hostName, token: generateToken(), connected: true };
    const room: Room = {
      code,
      status: 'lobby',
      hostSeat: 0,
      players: [player],
      state: null,
      startedAt: 0,
    };
    this.rooms.set(code, room);
    return { room, player };
  }

  /** 加入房间：分配最小空座位 */
  joinRoom(code: string, name: string): { room: Room; player: RoomPlayer } {
    const room = this.getRoom(code);
    if (room.status !== 'lobby') {
      throw new RoomError('ROOM_ALREADY_PLAYING', '该房间的对局已开始');
    }
    if (room.players.length >= MAX_SEATS) {
      throw new RoomError('ROOM_FULL', '房间已满（最多 10 人）');
    }
    const player: RoomPlayer = {
      seat: room.players.length,
      name,
      token: generateToken(),
      connected: true,
    };
    room.players.push(player);
    return { room, player };
  }

  getRoom(code: string): Room {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在，请检查房间码');
    return room;
  }

  /**
   * 房主开始游戏（M8-02 起点）：
   * - 人数 = 当前房间内真人人数（AI 补位由 M8-04 提供服务端驱动）；
   * - 所有座位都是真人：创建后把 isHuman 全部置 true（同 selfplay 置 false 的手法），
   *   这样 UNO 喊/抓、挑战手牌展示都按「人类」口径由各自客户端触发。
   */
  startGame(room: Room, requesterSeat: number): GameState {
    if (requesterSeat !== room.hostSeat) {
      throw new RoomError('NOT_HOST', '只有房主可以开始游戏');
    }
    if (room.status !== 'lobby') {
      throw new RoomError('ROOM_ALREADY_PLAYING', '对局已开始');
    }
    if (room.players.length < MIN_SEATS) {
      throw new RoomError('NOT_ENOUGH_PLAYERS', '至少 2 名玩家才能开始（AI 补位将在后续版本提供）');
    }
    const config = normalizeGameConfig({
      playerCount: room.players.length,
      humanSeat: 0,
      seed: `room-${room.code}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    });
    const state = createInitialGame(config);
    // 引擎 buildPlayerNames 会自动起名（单机口径）；联机直接以房间显示名为准
    for (const player of state.players) {
      player.isHuman = true;
      player.name = room.players[player.seat]!.name;
    }
    room.state = state;
    room.status = 'playing';
    room.startedAt = Date.now();
    return state;
  }

  /**
   * 应用一次上行动作（M8-02 核心）。
   * 先做「座位权限」校验（动作不携带行为者，必须由服务端把连接座位与状态机对齐），
   * 再交 applyAction 做完整规则裁决；引擎抛错一律映射为 ILLEGAL_ACTION，状态不变。
   */
  applyPlayerAction(room: Room, seat: number, action: EngineAction): GameState {
    const state = room.state;
    if (!state || room.status !== 'playing') {
      throw new RoomError('GAME_NOT_STARTED', '对局尚未开始');
    }
    if (isGameOver(state)) {
      throw new RoomError('GAME_ALREADY_ENDED', '对局已结束');
    }
    this.assertActorAllowed(state, seat, action);
    try {
      const applied = applyAction(state, action);
      room.state = applied.state;
      if (isGameOver(applied.state)) room.status = 'ended';
      return applied.state;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new RoomError('ILLEGAL_ACTION', `动作不被接受：${detail}`);
    }
  }

  /**
   * 座位权限：UNO 窗口的喊/抓按窗口状态判定，其余动作只有当前行动座位能发。
   * （引擎动作不携带行为者——单机只有一个人类；联机必须由服务端补上这层校验。）
   */
  private assertActorAllowed(state: GameState, seat: number, action: EngineAction): void {
    if (action.type === 'CALL_UNO') {
      if (state.phase === 'uno-window' && state.unoWindow?.seat === seat) return;
      throw new RoomError('NOT_YOUR_TURN', '现在轮不到你喊 UNO');
    }
    if (action.type === 'CATCH_UNO') {
      if (state.phase === 'uno-window' && state.unoWindow?.canCatch.includes(seat)) return;
      throw new RoomError('NOT_YOUR_TURN', '你现在不能抓 UNO');
    }
    if (state.currentSeat !== seat) {
      throw new RoomError('NOT_YOUR_TURN', '还没轮到你行动');
    }
  }

  /** 标记连接断开（保留座位与 token，M8-06 将支持凭 token 重连恢复） */
  markDisconnected(room: Room, seat: number): void {
    const player = room.players[seat];
    if (player) player.connected = false;
  }

  /** 主动离开：大厅阶段移除座位并重排；对局中仅标记断开（顶替/判负由 M8-06 定稿） */
  leaveRoom(room: Room, seat: number): { closed: boolean } {
    if (room.status === 'lobby') {
      room.players = room.players
        .filter((player) => player.seat !== seat)
        .map((player, index) => ({ ...player, seat: index }));
      if (room.hostSeat === seat) room.hostSeat = 0;
      else if (room.hostSeat > seat) room.hostSeat -= 1;
      if (room.players.length === 0) {
        this.rooms.delete(room.code);
        return { closed: true };
      }
      return { closed: false };
    }
    this.markDisconnected(room, seat);
    return { closed: false };
  }

  /** 按座位生成脱敏视图（隔离第二道保证的落点；只读，不改状态） */
  getSeatViews(room: Room): Array<{ seat: number; view: GameView }> {
    if (!room.state) return [];
    const durationMs =
      room.status === 'ended' && room.startedAt > 0 ? Date.now() - room.startedAt : 0;
    return room.players.map((player) => ({
      seat: player.seat,
      view: getGameView(room.state as GameState, player.seat, { durationMs }),
    }));
  }
}
