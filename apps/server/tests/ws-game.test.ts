/**
 * M8-01/M8-02 联机端到端集成测试：真实 HTTP + WebSocket，双客户端同局。
 *
 * 验证点：
 * - 创建/加入房间、房间快照广播、房主权限；
 * - 服务端权威循环：上行动作 → applyAction → 按座位广播脱敏视图；
 * - 用户隔离：客户端 B 收到的任何数据里都不含 A 的手牌（协议没有全量出口）。
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUnoServer } from '../src/server.ts';

interface UiActionShape {
  id: string;
  type: string;
  cardId?: string;
  colorChoice?: string;
  color?: string;
  targetSeat?: number;
}

interface ViewShape {
  screen: string;
  phase: string;
  currentSeat: number;
  human: { seat: number; hand: Array<{ id: string }>; legalActions: UiActionShape[] };
  players: Array<{ seat: number; handCount: number }>;
  events: Array<{ type: string; seat?: number; count?: number; cards?: unknown[] }>;
}

/** 最小 WS 客户端：收消息入队，按类型等待 */
class TestClient {
  readonly ws: WebSocket;
  private readonly queue: Array<Record<string, unknown>> = [];
  private readonly waiters: Array<{
    type: string;
    resolve: (message: Record<string, unknown>) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
      const index = this.waiters.findIndex((waiter) => waiter.type === message.type);
      if (index >= 0) {
        const [waiter] = this.waiters.splice(index, 1);
        clearTimeout(waiter!.timer);
        waiter!.resolve(message);
      } else {
        this.queue.push(message);
      }
    });
  }

  static connect(url: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const client = new TestClient(ws);
      ws.addEventListener('open', () => resolve(client), { once: true });
      ws.addEventListener('error', () => reject(new Error('WS 连接失败')), { once: true });
    });
  }

  send(message: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(message));
  }

  waitFor(type: string, timeoutMs = 4000): Promise<Record<string, unknown>> {
    const queued = this.queue.findIndex((message) => message.type === type);
    if (queued >= 0) {
      const [message] = this.queue.splice(queued, 1);
      return Promise.resolve(message!);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待 ${type} 超时`)), timeoutMs);
      this.waiters.push({ type, resolve, reject, timer });
    });
  }

  close(): void {
    this.ws.close();
  }
}

let server: Server | undefined;
let wsUrl = '';

beforeAll(async () => {
  const uno = createUnoServer();
  server = uno.server;
  await new Promise<void>((resolve) => server!.listen(0, () => resolve()));
  const address = server!.address() as AddressInfo;
  wsUrl = `ws://127.0.0.1:${address.port}/ws`;
});

afterAll(async () => {
  const current = server;
  if (!current) return;
  await new Promise<void>((resolve, reject) => {
    current.closeAllConnections?.();
    current.close((error) => (error ? reject(error) : resolve()));
  });
});

/** 从当前座位 view 里挑一个最简单的合法动作（优先出数字牌，其次摸牌/选色/弃权） */
function pickSimpleAction(view: ViewShape): Record<string, unknown> | null {
  const legal = view.human.legalActions;
  const playNumber = legal.find(
    (action) => action.type === 'PLAY_CARD' && !action.colorChoice,
  );
  if (playNumber) return { type: 'PLAY_CARD', cardId: playNumber.cardId };
  const playWild = legal.find((action) => action.type === 'PLAY_CARD');
  if (playWild) {
    return { type: 'PLAY_CARD', cardId: playWild.cardId, colorChoice: playWild.colorChoice ?? 'red' };
  }
  if (legal.some((action) => action.type === 'DRAW')) return { type: 'DRAW' };
  const choose = legal.find((action) => action.type === 'CHOOSE_COLOR');
  if (choose) return { type: 'CHOOSE_COLOR', color: choose.color };
  if (legal.some((action) => action.type === 'STACK_DECLINE')) return { type: 'STACK_DECLINE' };
  if (legal.some((action) => action.type === 'DECLINE_CHALLENGE'))
    return { type: 'DECLINE_CHALLENGE' };
  if (legal.some((action) => action.type === 'END_TURN')) return { type: 'END_TURN' };
  const playDrawn = legal.find((action) => action.type === 'PLAY_DRAWN');
  if (playDrawn) {
    return { type: 'PLAY_DRAWN', cardId: playDrawn.cardId, colorChoice: playDrawn.colorChoice ?? 'red' };
  }
  return null;
}

describe('M8 联机双客户端同局', () => {
  it('创建/加入/开始/行动全链路，且视图按座位隔离', async () => {
    const alice = await TestClient.connect(wsUrl);
    const bob = await TestClient.connect(wsUrl);
    try {
      // 1. Alice 创建房间
      alice.send({ type: 'create-room', name: 'Alice' });
      const joinedAlice = await alice.waitFor('joined');
      const roomInfo = joinedAlice.room as { code: string; players: unknown[] };
      expect(roomInfo.code).toMatch(/^[A-Z2-9]{6}$/);
      expect(joinedAlice.seat).toBe(0);
      expect(typeof joinedAlice.token).toBe('string');

      // 2. Bob 加入，双方都收到 2 人房间快照
      bob.send({ type: 'join-room', code: roomInfo.code, name: 'Bob' });
      const joinedBob = await bob.waitFor('joined');
      expect(joinedBob.seat).toBe(1);
      const roomForAlice = await alice.waitFor('room');
      expect((roomForAlice.room as { players: unknown[] }).players).toHaveLength(2);

      // 3. 非房主不能开始
      bob.send({ type: 'start-game' });
      const notHost = await bob.waitFor('error');
      expect(notHost.code).toBe('NOT_HOST');

      // 4. 房主开始：双方收到各自座位视图
      alice.send({ type: 'start-game' });
      const viewAliceMsg = await alice.waitFor('view');
      const viewBobMsg = await bob.waitFor('view');
      const viewAlice = viewAliceMsg.view as ViewShape;
      const viewBob = viewBobMsg.view as ViewShape;

      expect(viewAlice.screen).toBe('game');
      expect(viewAlice.human.seat).toBe(0);
      expect(viewBob.human.seat).toBe(1);
      // 起手效果（如开局翻 +2）由首位玩家承受，其手牌会多于 7 张
      expect(viewAlice.human.hand.length).toBeGreaterThanOrEqual(7);
      expect(viewBob.human.hand.length).toBeGreaterThanOrEqual(7);
      for (const handCount of viewAlice.players.map((player) => player.handCount)) {
        expect(handCount).toBeGreaterThanOrEqual(7);
      }

      // 5. 隔离：Bob 收到的原始消息里不得包含 Alice 任何手牌 id（反之亦然）
      const rawBob = JSON.stringify(viewBobMsg);
      for (const card of viewAlice.human.hand) expect(rawBob).not.toContain(card.id);
      const rawAlice = JSON.stringify(viewAliceMsg);
      for (const card of viewBob.human.hand) expect(rawAlice).not.toContain(card.id);

      // 6. 非当前座位行动 → NOT_YOUR_TURN
      const currentIsAlice = viewAlice.currentSeat === 0;
      const idleClient = currentIsAlice ? bob : alice;
      idleClient.send({ type: 'action', action: { type: 'DRAW' } });
      const notTurn = await idleClient.waitFor('error');
      expect(notTurn.code).toBe('NOT_YOUR_TURN');

      // 7. 当前座位执行一个合法动作：双方都收到新视图，且手牌仍按座位隔离
      const actorClient = currentIsAlice ? alice : bob;
      const actorView = currentIsAlice ? viewAlice : viewBob;
      const action = pickSimpleAction(actorView);
      expect(action).not.toBeNull();
      actorClient.send({ type: 'action', action: action! });
      const nextAlice = (await alice.waitFor('view')).view as ViewShape;
      const nextBob = (await bob.waitFor('view')).view as ViewShape;
      expect(nextAlice.players).toHaveLength(2);
      expect(nextBob.players).toHaveLength(2);
      const rawNextBob = JSON.stringify(nextBob);
      for (const card of nextAlice.human.hand) expect(rawNextBob).not.toContain(card.id);
    } finally {
      alice.close();
      bob.close();
    }
  });

  it('非法消息与坏房间码会收到 error，连接不被断开', async () => {
    const client = await TestClient.connect(wsUrl);
    try {
      client.ws.send('not-json');
      const bad = await client.waitFor('error');
      expect(bad.code).toBe('BAD_MESSAGE');

      client.send({ type: 'join-room', code: 'ABCDEF' });
      const notFound = await client.waitFor('error');
      expect(notFound.code).toBe('ROOM_NOT_FOUND');
    } finally {
      client.close();
    }
  });
});
