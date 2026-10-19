/**
 * 服务装配：Express app + HTTP server + WebSocket（M8-01）。
 * 从 index.ts 抽出来，方便测试用 ephemeral port 起完整服务（含 /ws）。
 */
import { createServer, type Server } from 'node:http';
import { createApp, type CreateAppOptions } from './app.ts';
import { attachWebSocketServer } from './net/wsServer.ts';
import type { RoomManager } from './net/rooms.ts';

export interface UnoServer {
  server: Server;
  rooms: RoomManager;
}

export function createUnoServer(options: CreateAppOptions = {}): UnoServer {
  const app = createApp(options);
  const server = createServer(app);
  const { rooms } = attachWebSocketServer(server);
  server.on('close', () => {
    // ws 连接随 http server 关闭由 Node 一并销毁（测试里 close 即可退出）
  });
  return { server, rooms };
}
