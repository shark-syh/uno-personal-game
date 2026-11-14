/**
 * M8-01 联机协议：客户端 ↔ 服务端 的 WebSocket 消息定义与入参校验。
 *
 * 设计约束：
 * - 消息为 JSON 文本帧；所有校验在服务端完成（客户端不可信）；
 * - 动作只在「房间 + 座位 + 回合」都对得上时才会交给引擎 applyAction；
 * - 服务端下发的视图永远走 getGameView(state, seat)（隔离见 rooms.ts / wsServer.ts）。
 */
import type { Color, EngineAction, GameMode } from '@uno/game-core';

/** 显示名最大长度（与单机大厅名字截断一致） */
export const MAX_NAME_LENGTH = 12;
/** 房间码长度（4~6 位，计划 §8.2；实现取 6 位大写字母数字，去除易混淆字符） */
export const ROOM_CODE_LENGTH = 6;

// ---------- 客户端 → 服务端 ----------

export interface CreateRoomMessage {
  type: 'create-room';
  name?: string;
}

export interface JoinRoomMessage {
  type: 'join-room';
  code: string;
  name?: string;
}

export interface StartGameMessage {
  type: 'start-game';
  /** M8-04：AI 补位数量（0 = 不补位；开局人数 = 真人数 + aiCount） */
  aiCount?: number;
  /** M3：玩法模式（不传 = classic）；flip 方案暂缓，协议层直接拒绝 */
  mode?: GameMode;
}

/** M3：协议层允许透传的玩法模式（flip 未实现，不接受） */
export const PLAYABLE_MODES = ['classic', 'mercy'] as const satisfies readonly GameMode[];

export function isPlayableMode(value: unknown): value is GameMode {
  return typeof value === 'string' && (PLAYABLE_MODES as readonly string[]).includes(value);
}

export interface ActionMessage {
  type: 'action';
  action: EngineAction;
}

export interface LeaveRoomMessage {
  type: 'leave-room';
}

/** 房间内改名（进房后自定义名字；对局中改名会同步到牌桌） */
export interface RenameMessage {
  type: 'rename';
  name: string;
}

/** M8-03：再来一局（房主，对局结束后重开同一阵容） */
export interface RematchMessage {
  type: 'rematch';
}

/** M8-06：断线重连——凭房间码 + token 恢复原座位并补发当前视图 */
export interface RejoinMessage {
  type: 'rejoin';
  code: string;
  token: string;
}

/** M9-03：发送预置表情（仅房间内；服务端校验白名单与每座位限频） */
export interface EmoteMessage {
  type: 'emote';
  emoji: string;
}

export type ClientMessage =
  | CreateRoomMessage
  | JoinRoomMessage
  | StartGameMessage
  | ActionMessage
  | LeaveRoomMessage
  | RenameMessage
  | RematchMessage
  | RejoinMessage
  | EmoteMessage;

// ---------- 服务端 → 客户端 ----------

/** 房间快照（大厅阶段广播；不含任何隐藏信息） */
export interface RoomSnapshot {
  code: string;
  status: 'lobby' | 'playing' | 'ended';
  hostSeat: number;
  players: Array<{ seat: number; name: string; connected: boolean }>;
  /** M3：房间当前玩法模式（大厅阶段可被房主开局时改写，rematch 沿用） */
  mode?: GameMode;
}

export interface JoinedMessage {
  type: 'joined';
  room: RoomSnapshot;
  /** 本连接绑定的座位（之后只下发该座位视图） */
  seat: number;
  /** 会话 token（M8-06 断线重连恢复座位用；当前版本先下发保存） */
  token: string;
}

export interface RoomMessage {
  type: 'room';
  room: RoomSnapshot;
}

export interface ViewMessage {
  type: 'view';
  /** 按座位脱敏后的 GameView（getGameView + sanitizeEventsForSeat） */
  view: unknown;
}

/** M9-03：表情广播（seat 为发送者真实座位；客户端在对应座位框弹气泡） */
export interface EmoteBroadcastMessage {
  type: 'emote';
  seat: number;
  emoji: string;
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

/** M10-05：主机关闭游戏前广播，客户端应立刻回大厅而不是反复重连 */
export interface ServerClosingMessage {
  type: 'server-closing';
  message: string;
}

export type ServerMessage =
  | JoinedMessage
  | RoomMessage
  | ViewMessage
  | EmoteBroadcastMessage
  | ErrorMessage
  | ServerClosingMessage;

/** M9-03：预置表情白名单（纯 emoji；服务端与客户端保持一致） */
export const EMOTE_EMOJIS = [
  '😂',
  '😭',
  '😡',
  '😎',
  '🤡',
  '💀',
  '👍',
  '👎',
  '🔥',
  '🎉',
  '🙈',
  '🫠',
] as const;

export function isValidEmote(value: unknown): value is string {
  return typeof value === 'string' && (EMOTE_EMOJIS as readonly string[]).includes(value);
}

// ---------- 入参校验 ----------

const COLORS = new Set<Color>(['red', 'yellow', 'green', 'blue']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 清洗显示名：去空白、限长；空名返回 null（由调用方给默认名） */
export function sanitizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

/** 校验房间码格式（不校验是否存在） */
export function isValidRoomCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z2-9]{4,6}$/.test(value);
}

const ACTION_TYPES = new Set([
  'PLAY_CARD',
  'DRAW',
  'PLAY_DRAWN',
  'END_TURN',
  'CHOOSE_COLOR',
  'STACK_PLAY',
  'STACK_DECLINE',
  'CHALLENGE_W4',
  'DECLINE_CHALLENGE',
  'CALL_UNO',
  'CATCH_UNO',
  // M3 友尽：7 换手 / 轮盘选色（与引擎 M2 新增的两个动作对齐）
  'SWAP_HANDS',
  'CHOOSE_ROULETTE_COLOR',
]);

/**
 * 严格校验引擎动作形状（类型 + 必填字段 + 类型范围）。
 * 通过校验不代表合法——合法性仍由引擎 applyAction 裁决。
 */
export function parseEngineAction(value: unknown): EngineAction | null {
  if (!isRecord(value) || typeof value.type !== 'string' || !ACTION_TYPES.has(value.type)) {
    return null;
  }
  const colorChoice =
    value.colorChoice === undefined
      ? undefined
      : COLORS.has(value.colorChoice as Color)
        ? (value.colorChoice as Color)
        : null;
  if (colorChoice === null) return null;

  switch (value.type) {
    case 'PLAY_CARD':
    case 'PLAY_DRAWN':
    case 'STACK_PLAY': {
      if (typeof value.cardId !== 'string' || value.cardId.length === 0 || value.cardId.length > 32) {
        return null;
      }
      return colorChoice
        ? { type: value.type, cardId: value.cardId, colorChoice }
        : { type: value.type, cardId: value.cardId };
    }
    case 'CHOOSE_COLOR': {
      if (!COLORS.has(value.color as Color)) return null;
      return { type: 'CHOOSE_COLOR', color: value.color as Color };
    }
    case 'CHOOSE_ROULETTE_COLOR': {
      if (!COLORS.has(value.color as Color)) return null;
      return { type: 'CHOOSE_ROULETTE_COLOR', color: value.color as Color };
    }
    case 'SWAP_HANDS': {
      const targetSeat = value.targetSeat;
      if (!Number.isInteger(targetSeat) || (targetSeat as number) < 0 || (targetSeat as number) >= 10) {
        return null;
      }
      return { type: 'SWAP_HANDS', targetSeat: targetSeat as number };
    }
    case 'CATCH_UNO': {
      if (!Number.isInteger(value.targetSeat)) return null;
      return { type: 'CATCH_UNO', targetSeat: value.targetSeat as number };
    }
    case 'DRAW':
    case 'END_TURN':
    case 'STACK_DECLINE':
    case 'CHALLENGE_W4':
    case 'DECLINE_CHALLENGE':
    case 'CALL_UNO':
      return { type: value.type };
    default:
      return null;
  }
}

/** 解析客户端消息；不合法返回 null（调用方回 error 即可，不断开连接） */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || typeof data.type !== 'string') return null;

  switch (data.type) {
    case 'create-room':
      return { type: 'create-room', name: sanitizeName(data.name) ?? undefined };
    case 'join-room': {
      const code = typeof data.code === 'string' ? data.code.trim().toUpperCase() : '';
      if (!isValidRoomCode(code)) return null;
      return { type: 'join-room', code, name: sanitizeName(data.name) ?? undefined };
    }
    case 'rename':
      // 无效名字置空串：由服务端 renamePlayer 统一拒绝并提示
      return { type: 'rename', name: sanitizeName(data.name) ?? '' };
    case 'start-game': {
      const aiCount =
        data.aiCount === undefined
          ? 0
          : Number.isInteger(data.aiCount) && (data.aiCount as number) >= 0 && (data.aiCount as number) <= 9
            ? (data.aiCount as number)
            : null;
      if (aiCount === null) return null;
      // M3：mode 缺省保持 classic；非法值（含暂缓的 flip）一律判 BAD_MESSAGE，不静默回退
      const mode = data.mode === undefined ? undefined : isPlayableMode(data.mode) ? data.mode : null;
      if (mode === null) return null;
      return { type: 'start-game', aiCount, ...(mode ? { mode } : {}) };
    }
    case 'leave-room':
      return { type: 'leave-room' };
    case 'rematch':
      return { type: 'rematch' };
    case 'rejoin': {
      const code = typeof data.code === 'string' ? data.code.trim().toUpperCase() : '';
      if (!isValidRoomCode(code)) return null;
      const token = typeof data.token === 'string' ? data.token.trim() : '';
      if (!/^[a-f0-9]{32}$/.test(token)) return null;
      return { type: 'rejoin', code, token };
    }
    case 'emote':
      return isValidEmote(data.emoji) ? { type: 'emote', emoji: data.emoji } : null;
    case 'action': {
      const action = parseEngineAction(data.action);
      return action ? { type: 'action', action } : null;
    }
    default:
      return null;
  }
}
