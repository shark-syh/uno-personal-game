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
  createRng,
  getGameView,
  isGameOver,
  normalizeGameConfig,
  type EngineAction,
  type GameState,
  type GameView,
  type RngState,
} from '@uno/game-core';
import { MAX_NAME_LENGTH, ROOM_CODE_LENGTH, type RoomSnapshot } from './protocol.ts';

export const MAX_SEATS = 10;
export const MIN_SEATS = 2;
/** M9-03：每座位一轮最多可发 5 条表情，发满后进入 2 秒冷却 */
export const EMOTE_BURST = 5;
export const EMOTE_COOLDOWN_MS = 2000;

/** 房间码字符集：去掉 0/O/1/I 等易混淆字符 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface RoomPlayer {
  seat: number;
  name: string;
  /** 会话 token（M8-06 重连恢复用；只在 joined 消息里发给本人） */
  token: string;
  connected: boolean;
}

/** M9-03：单座位表情限频状态（服务端权威，客户端倒计时只做提示） */
interface EmoteLimitState {
  count: number;
  cooldownUntil: number;
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
  /** M8-04：开局时的 AI 补位数量（rematch 沿用） */
  aiCount: number;
  /** M8-04：AI 决策专用随机源（与引擎 rng 分离，不破坏对局可复现性） */
  aiRng: RngState | null;
  /** M9-03：各座位的表情发送限频状态 */
  emoteLimits: Map<number, EmoteLimitState>;
  /** M8-06：最近活动时间（房间超时清理依据） */
  lastActivityAt: number;
}

export type RoomErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_ALREADY_PLAYING'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'NOT_ENOUGH_PLAYERS'
  | 'BAD_MESSAGE'
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
      aiCount: 0,
      aiRng: null,
      emoteLimits: new Map(),
      lastActivityAt: Date.now(),
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

  /**
   * 房间内改名（用户实测反馈：进房后可自定义名字，顶替缺省的「你」）。
   * 对局中改名会同步写进 GameState 的玩家名，牌桌名字即时刷新。
   */
  renamePlayer(room: Room, seat: number, rawName: string): RoomPlayer {
    const player = room.players[seat];
    if (!player) throw new RoomError('NOT_IN_ROOM', '你不在这个房间里');
    const name = rawName.trim().slice(0, MAX_NAME_LENGTH);
    if (!name) throw new RoomError('BAD_MESSAGE', '名字不能为空');
    player.name = name;
    const statePlayer = room.state?.players[seat];
    if (statePlayer) statePlayer.name = name;
    return player;
  }

  /**
   * M9-03：记录一次表情发送并做每座位限频。
   * 连续发满 EMOTE_BURST 条后进入 EMOTE_COOLDOWN_MS 冷却；冷却期内拒绝并返回剩余毫秒。
   * 服务端为唯一裁决方，客户端倒计时只负责禁用按钮。
   */
  recordEmote(
    room: Room,
    seat: number,
    now = Date.now(),
  ): { ok: true } | { ok: false; retryAfterMs: number } {
    if (!room.players[seat]) throw new RoomError('NOT_IN_ROOM', '你不在这个房间里');
    const limit = room.emoteLimits.get(seat) ?? { count: 0, cooldownUntil: 0 };
    if (now < limit.cooldownUntil) {
      const retryAfterMs = limit.cooldownUntil - now;
      room.emoteLimits.set(seat, limit);
      return { ok: false, retryAfterMs };
    }
    if (limit.cooldownUntil > 0) {
      limit.count = 0;
      limit.cooldownUntil = 0;
    }
    limit.count += 1;
    if (limit.count >= EMOTE_BURST) {
      limit.count = 0;
      limit.cooldownUntil = now + EMOTE_COOLDOWN_MS;
    }
    room.emoteLimits.set(seat, limit);
    room.lastActivityAt = now;
    return { ok: true };
  }

  getRoom(code: string): Room {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) {
      // 常见误因：每台电脑各开了一个服务，浏览器连的是自己电脑的 localhost（房间不互通）
      throw new RoomError(
        'ROOM_NOT_FOUND',
        '房间不存在：请核对房间码，并确认浏览器打开的是房主电脑的局域网地址（而不是自己电脑的 localhost）；若房主刚重启过服务，请让房主重新创建房间',
      );
    }
    return room;
  }

  /** M10-04：供 UDP 发现服务广播的开放房间（仅大厅阶段、不含玩家隐私信息） */
  getOpenRooms(limit = 32): Array<{ code: string; players: number }> {
    const result: Array<{ code: string; players: number }> = [];
    for (const room of this.rooms.values()) {
      if (room.status !== 'lobby') continue;
      result.push({ code: room.code, players: room.players.length });
      if (result.length >= limit) break;
    }
    return result;
  }

  /**
   * 房主开始游戏（M8-02 起点 + M8-04 AI 补位）：
   * - 开局人数 = 真人数 + aiCount；真人占据前 N 个座位，AI 补后面的座位；
   * - 真人座位 isHuman=true 并以房间显示名为准；AI 座位保留引擎默认（isHuman=false），
   *   其 UNO 喊叫/抓人概率、被挑战判定全部由引擎既有 AI 口径裁决。
   */
  startGame(room: Room, requesterSeat: number, aiCount = 0): GameState {
    if (requesterSeat !== room.hostSeat) {
      throw new RoomError('NOT_HOST', '只有房主可以开始游戏');
    }
    if (room.status !== 'lobby') {
      throw new RoomError('ROOM_ALREADY_PLAYING', '对局已开始');
    }
    const humanCount = room.players.length;
    const total = humanCount + aiCount;
    if (total < MIN_SEATS) {
      throw new RoomError('NOT_ENOUGH_PLAYERS', '真人 + AI 至少 2 人才能开始');
    }
    if (total > MAX_SEATS) {
      throw new RoomError('BAD_MESSAGE', `最多 ${MAX_SEATS} 人（含 AI）`);
    }
    room.aiCount = aiCount;
    room.emoteLimits.clear();
    room.state = this.buildGameState(room);
    room.status = 'playing';
    room.startedAt = Date.now();
    room.lastActivityAt = Date.now();
    return room.state;
  }

  /** M8-03 再来一局：同一阵容（含 AI 补位）重开；只有房主能发起，且须等对局结束 */
  rematch(room: Room, requesterSeat: number): GameState {
    if (requesterSeat !== room.hostSeat) {
      throw new RoomError('NOT_HOST', '只有房主可以再来一局');
    }
    if (room.status !== 'ended') {
      throw new RoomError('BAD_MESSAGE', '对局还没结束，不能再来一局');
    }
    room.emoteLimits.clear();
    room.state = this.buildGameState(room);
    room.status = 'playing';
    room.startedAt = Date.now();
    room.lastActivityAt = Date.now();
    return room.state;
  }

  /** 建局共用：按当前房间成员 + aiCount 生成新对局（名字以最新显示名为准） */
  private buildGameState(room: Room): GameState {
    const config = normalizeGameConfig({
      playerCount: room.players.length + room.aiCount,
      humanSeat: 0,
      seed: `room-${room.code}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    });
    const state = createInitialGame(config);
    for (const player of state.players) {
      const roomPlayer = room.players[player.seat];
      if (roomPlayer) {
        player.isHuman = true;
        player.name = roomPlayer.name;
      }
    }
    // 联机没有单一「人类座位」：humanSeat 置 -1（仅作比较用途，无索引引用），
    // 使引擎开窗时 canCatch=[窗口主人]，任何其他人都能抓忘喊 UNO 者（含 0 号位）。
    state.config.humanSeat = -1;
    room.aiRng = createRng(
      `ai-${room.code}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    );
    return state;
  }

  /** M8-06：凭 token 恢复原座位（重连）；凭证无效时拒绝，让客户端走重新加入 */
  rejoin(code: string, token: string): { room: Room; player: RoomPlayer } {
    const room = this.getRoom(code);
    const player = room.players.find((item) => item.token === token);
    if (!player) {
      throw new RoomError('BAD_MESSAGE', '重连凭证无效（服务可能已重启），请重新加入房间');
    }
    player.connected = true;
    room.lastActivityAt = Date.now();
    return { room, player };
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
      room.lastActivityAt = Date.now();
      if (isGameOver(applied.state)) room.status = 'ended';
      return applied.state;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new RoomError('ILLEGAL_ACTION', `动作不被接受：${detail}`);
    }
  }

  /**
   * M8-04/M8-06 系统动作：服务端 AI 驱动（含顶替断线真人）时使用。
   * 决策侧（@uno/ai decide）已保证是当前座位的合法候选，这里不再做座位权限校验，
   * 但规则裁决仍全部走 applyAction——AI 与真人同一条规则路径。
   */
  applySystemAction(room: Room, action: EngineAction): GameState {
    const state = room.state;
    if (!state || room.status !== 'playing') {
      throw new RoomError('GAME_NOT_STARTED', '对局尚未开始');
    }
    if (isGameOver(state)) {
      throw new RoomError('GAME_ALREADY_ENDED', '对局已结束');
    }
    try {
      const applied = applyAction(state, action);
      room.state = applied.state;
      room.lastActivityAt = Date.now();
      if (isGameOver(applied.state)) room.status = 'ended';
      return applied.state;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new RoomError('ILLEGAL_ACTION', `AI 动作不被接受：${detail}`);
    }
  }

  /**
   * M8-06 房间超时清理：
   * - 无人连接的房间（全员断线）超过 5 分钟 → 销毁；
   * - 已结束房间超过 30 分钟 → 销毁（结算页早该离开）。
   * 返回被销毁的房间码（调用方顺带清理连接表）。
   */
  sweep(now = Date.now()): string[] {
    const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
    const ENDED_TIMEOUT_MS = 30 * 60 * 1000;
    const deleted: string[] = [];
    for (const room of this.rooms.values()) {
      const nobodyConnected = room.players.every((player) => !player.connected);
      const idleTooLong = nobodyConnected && now - room.lastActivityAt > IDLE_TIMEOUT_MS;
      const endedTooLong = room.status === 'ended' && now - room.lastActivityAt > ENDED_TIMEOUT_MS;
      if (idleTooLong || endedTooLong) {
        this.rooms.delete(room.code);
        deleted.push(room.code);
      }
    }
    return deleted;
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
      const win = state.phase === 'uno-window' ? state.unoWindow : null;
      // 注意引擎 canCatch 的语义是「可被抓的目标」（开窗时 = [窗口主人]），不是抓人者名单；
      // 权限判断：窗口开着 + 抓的不是自己 + 目标是窗口主人（引擎 applyAction 还会再裁决一次）
      if (win && win.seat !== seat && action.targetSeat === win.seat) return;
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
      // 大厅座位已重排，旧的座位限频状态不再对应原玩家，直接清空
      room.emoteLimits.clear();
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
