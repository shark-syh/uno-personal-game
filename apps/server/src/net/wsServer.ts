/**
 * M8-01/M8-02 WebSocket 接入层：连接管理、消息路由、按座位广播。
 *
 * 隔离三道保证的落实点：
 * 1. 每个连接在 joined 时绑定唯一 (roomCode, seat, token)，之后只下发该座位视图；
 * 2. 视图一律经 RoomManager.getSeatViews → getGameView(state, seat)（含 sanitizeEventsForSeat）；
 * 3. 不存在任何「全量状态 / 旁观」消息类型——协议里根本没有这个出口。
 *
 * 断线语义（M8-06 重连/清理的前置约定）：
 * - 大厅阶段断线 = 直接移除座位并重排（避免房主带着幽灵座位开局）；
 * - 对局中断线 = 保留座位并标记 connected=false（token 留给 M8-06 重连恢复）。
 */
import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { parseClientMessage, type ServerMessage } from './protocol.ts';
import { RoomError, RoomManager, toRoomSnapshot, type Room } from './rooms.ts';
import { runAiTurns } from './aiDriver.ts';

export interface WsServerOptions {
  path?: string;
  roomManager?: RoomManager;
}

interface ConnectionContext {
  roomCode: string | null;
  seat: number | null;
  token: string | null;
}

const DEFAULT_NAME = '你';

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function sendError(ws: WebSocket, code: string, message: string): void {
  send(ws, { type: 'error', code, message });
}

/** 把异常映射成协议错误（RoomError 用自身 code，其余一律 INTERNAL） */
function sendCaughtError(ws: WebSocket, error: unknown): void {
  if (error instanceof RoomError) {
    sendError(ws, error.code, error.message);
    return;
  }
  sendError(ws, 'INTERNAL', '服务器内部错误');
}

export function attachWebSocketServer(httpServer: HttpServer, options: WsServerOptions = {}) {
  const rooms = options.roomManager ?? new RoomManager();
  const wss = new WebSocketServer({ server: httpServer, path: options.path ?? '/ws' });
  /** 房间内所有活跃连接（广播用；键为 ws 实例） */
  const roomConnections = new Map<string, Map<WebSocket, ConnectionContext>>();

  function connectionsOf(code: string): Map<WebSocket, ConnectionContext> {
    let set = roomConnections.get(code);
    if (!set) {
      set = new Map();
      roomConnections.set(code, set);
    }
    return set;
  }

  function broadcastRoom(room: Room): void {
    const snapshot = toRoomSnapshot(room);
    for (const ws of roomConnections.get(room.code)?.keys() ?? []) {
      send(ws, { type: 'room', room: snapshot });
    }
  }

  /** 按座位各发各的脱敏视图（M8-02 广播核心） */
  function broadcastViews(room: Room): void {
    const views = new Map(rooms.getSeatViews(room).map((entry) => [entry.seat, entry.view]));
    for (const [ws, context] of roomConnections.get(room.code) ?? []) {
      if (context.seat === null) continue;
      const view = views.get(context.seat);
      if (view) send(ws, { type: 'view', view });
    }
  }

  /** 大厅阶段有人离开后座位重排：按 token 重新绑定每个连接的座位 */
  function resyncSeats(room: Room): void {
    for (const context of roomConnections.get(room.code)?.values() ?? []) {
      if (!context.token) continue;
      const player = room.players.find((item) => item.token === context.token);
      context.seat = player ? player.seat : null;
    }
  }

  /** 从房间摘掉当前连接（不动房间数据），返回摘掉前记住的 (code, seat) */
  function detachConnection(ws: WebSocket, context: ConnectionContext): {
    code: string | null;
    seat: number | null;
  } {
    const code = context.roomCode;
    const seat = context.seat;
    if (code) {
      const set = roomConnections.get(code);
      set?.delete(ws);
      if (set && set.size === 0) roomConnections.delete(code);
    }
    context.roomCode = null;
    context.seat = null;
    context.token = null;
    return { code, seat };
  }

  /** 连接离开房间：大厅中移除座位并重排；对局中标记断线保留座位 */
  function handleDeparture(code: string, seat: number): void {
    let room: Room;
    try {
      room = rooms.getRoom(code);
    } catch {
      return; // 房间已不存在（最后一个成员离开时已销毁）
    }
    const { closed } = rooms.leaveRoom(room, seat);
    if (closed) return;
    if (room.status === 'lobby') resyncSeats(room);
    broadcastRoom(room);
    // M8-06 顶替：对局中有人断线且轮到 TA（或后面连着 AI），服务端立即代打推进
    if (room.status === 'playing') {
      runAiTurns(room, rooms, () => broadcastViews(room));
      // 代打可能直接终局（TS 不会跨函数调用失效上面的窄化，这里显式重读）
      if ((room.status as Room['status']) === 'ended') broadcastRoom(room);
    }
  }

  /** 给单个连接补发其座位的当前视图（重连恢复用） */
  function sendSeatView(room: Room, ws: WebSocket, seat: number): void {
    const entry = rooms.getSeatViews(room).find((item) => item.seat === seat);
    if (entry) send(ws, { type: 'view', view: entry.view });
  }

  /** 动作应用后的统一推进：广播视图 → AI 代打 → 结束则广播房间状态 */
  function advanceGame(room: Room): void {
    broadcastViews(room);
    runAiTurns(room, rooms, () => broadcastViews(room));
    if (room.status === 'ended') broadcastRoom(room);
  }

  wss.on('connection', (ws) => {
    const context: ConnectionContext = { roomCode: null, seat: null, token: null };

    ws.on('message', (data) => {
      const message = parseClientMessage(String(data));
      if (!message) {
        sendError(ws, 'BAD_MESSAGE', '无法识别的消息');
        return;
      }
      try {
        switch (message.type) {
          case 'create-room': {
            const { room, player } = rooms.createRoom(message.name ?? DEFAULT_NAME);
            context.roomCode = room.code;
            context.seat = player.seat;
            context.token = player.token;
            connectionsOf(room.code).set(ws, context);
            send(ws, {
              type: 'joined',
              room: toRoomSnapshot(room),
              seat: player.seat,
              token: player.token,
            });
            break;
          }
          case 'join-room': {
            const { room, player } = rooms.joinRoom(message.code, message.name ?? DEFAULT_NAME);
            context.roomCode = room.code;
            context.seat = player.seat;
            context.token = player.token;
            connectionsOf(room.code).set(ws, context);
            send(ws, {
              type: 'joined',
              room: toRoomSnapshot(room),
              seat: player.seat,
              token: player.token,
            });
            broadcastRoom(room);
            break;
          }
          case 'start-game': {
            if (!context.roomCode || context.seat === null) {
              sendError(ws, 'NOT_IN_ROOM', '请先创建或加入房间');
              return;
            }
            const room = rooms.getRoom(context.roomCode);
            rooms.startGame(room, context.seat, message.aiCount ?? 0);
            broadcastRoom(room);
            advanceGame(room);
            break;
          }
          case 'action': {
            if (!context.roomCode || context.seat === null) {
              sendError(ws, 'NOT_IN_ROOM', '请先创建或加入房间');
              return;
            }
            const room = rooms.getRoom(context.roomCode);
            rooms.applyPlayerAction(room, context.seat, message.action);
            advanceGame(room);
            break;
          }
          case 'rematch': {
            if (!context.roomCode || context.seat === null) {
              sendError(ws, 'NOT_IN_ROOM', '请先创建或加入房间');
              return;
            }
            const room = rooms.getRoom(context.roomCode);
            rooms.rematch(room, context.seat);
            broadcastRoom(room);
            advanceGame(room);
            break;
          }
          case 'rejoin': {
            const { room, player } = rooms.rejoin(message.code, message.token);
            context.roomCode = room.code;
            context.seat = player.seat;
            context.token = player.token;
            connectionsOf(room.code).set(ws, context);
            send(ws, {
              type: 'joined',
              room: toRoomSnapshot(room),
              seat: player.seat,
              token: player.token,
            });
            broadcastRoom(room);
            // 对局进行中（或刚结束）：立即补发该座位当前视图，客户端直接恢复牌桌
            if (room.state) sendSeatView(room, ws, player.seat);
            break;
          }
          case 'emote': {
            if (!context.roomCode || context.seat === null) {
              sendError(ws, 'NOT_IN_ROOM', '请先创建或加入房间');
              return;
            }
            const room = rooms.getRoom(context.roomCode);
            const result = rooms.recordEmote(room, context.seat);
            if (!result.ok) {
              const retrySeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
              sendError(ws, 'EMOTE_RATE_LIMITED', `表情发得太快，请 ${retrySeconds} 秒后再试`);
              return;
            }
            // 广播给房间内所有人（含发送者）：客户端按「是否自己的座位」决定气泡或发送提示
            for (const client of roomConnections.get(room.code)?.keys() ?? []) {
              send(client, { type: 'emote', seat: context.seat, emoji: message.emoji });
            }
            break;
          }
          case 'leave-room': {
            if (!context.roomCode || context.seat === null) {
              sendError(ws, 'NOT_IN_ROOM', '你不在任何房间中');
              return;
            }
            const { code, seat } = detachConnection(ws, context);
            if (code !== null && seat !== null) handleDeparture(code, seat);
            break;
          }
          case 'rename': {
            if (!context.roomCode || context.seat === null) {
              sendError(ws, 'NOT_IN_ROOM', '请先创建或加入房间');
              return;
            }
            const room = rooms.getRoom(context.roomCode);
            rooms.renamePlayer(room, context.seat, message.name);
            broadcastRoom(room);
            // 对局中改名：牌桌上的玩家名即时刷新
            if (room.status === 'playing') broadcastViews(room);
            break;
          }
        }
      } catch (error) {
        sendCaughtError(ws, error);
      }
    });

    ws.on('close', () => {
      const { code, seat } = detachConnection(ws, context);
      if (code !== null && seat !== null) handleDeparture(code, seat);
    });
  });

  // M8-06 房间超时清理：每分钟扫一次（unref 不阻止进程退出，测试环境友好）
  const sweeper = setInterval(() => {
    for (const code of rooms.sweep()) roomConnections.delete(code);
  }, 60 * 1000);
  sweeper.unref();

  return { wss, rooms };
}
