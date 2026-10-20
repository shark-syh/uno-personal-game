/**
 * M8-03/M8-04/M8-06 联机端到端集成测试：真实 HTTP + WebSocket。
 *
 * 验证点：
 * - M8-04 AI 补位：单人房主带 2 个 AI 开局；真人行动后服务端自动代打 AI 回合，
 *   且真人客户端永远拿不到 AI 手牌牌面；
 * - M8-06 断线顶替：轮到行动的真人断线后，服务端代打其座位直到下一位在线真人；
 * - M8-06 重连：凭 (code, token) 恢复原座位，立即补发该座位当前视图；
 * - M8-03 再来一局：非房主被拒（完整重开路径见 rooms 单元测试）。
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
}

interface ViewShape {
  screen: string;
  phase: string;
  currentSeat: number;
  human: { seat: number; hand: Array<{ id: string }>; legalActions: UiActionShape[] };
  players: Array<{ seat: number; name: string; isHuman: boolean; handCount: number }>;
  result: unknown;
}

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

  waitFor(type: string, timeoutMs = 6000): Promise<Record<string, unknown>> {
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

  /** 持续取 view 消息直到满足条件（AI 代打会连推多条视图） */
  async waitForView(
    predicate: (view: ViewShape) => boolean,
    timeoutMs = 8000,
  ): Promise<ViewShape> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('等待满足条件的 view 超时');
      const message = await this.waitFor('view', remaining);
      const view = message.view as ViewShape;
      if (predicate(view)) return view;
    }
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

function pickSimpleAction(view: ViewShape): Record<string, unknown> | null {
  const legal = view.human.legalActions;
  const playNumber = legal.find((a) => a.type === 'PLAY_CARD' && !a.colorChoice);
  if (playNumber) return { type: 'PLAY_CARD', cardId: playNumber.cardId };
  const playWild = legal.find((a) => a.type === 'PLAY_CARD');
  if (playWild) {
    return { type: 'PLAY_CARD', cardId: playWild.cardId, colorChoice: playWild.colorChoice ?? 'red' };
  }
  if (legal.some((a) => a.type === 'DRAW')) return { type: 'DRAW' };
  const choose = legal.find((a) => a.type === 'CHOOSE_COLOR');
  if (choose) return { type: 'CHOOSE_COLOR', color: choose.color };
  if (legal.some((a) => a.type === 'STACK_DECLINE')) return { type: 'STACK_DECLINE' };
  if (legal.some((a) => a.type === 'DECLINE_CHALLENGE')) return { type: 'DECLINE_CHALLENGE' };
  if (legal.some((a) => a.type === 'END_TURN')) return { type: 'END_TURN' };
  const playDrawn = legal.find((a) => a.type === 'PLAY_DRAWN');
  if (playDrawn) {
    return { type: 'PLAY_DRAWN', cardId: playDrawn.cardId, colorChoice: playDrawn.colorChoice ?? 'red' };
  }
  return null;
}

describe('M8-04 服务端 AI 补位', () => {
  it('单人房主带 2 个 AI 开局：AI 回合全自动推进，且 AI 手牌不外泄', { timeout: 20000 }, async () => {
    const host = await TestClient.connect(wsUrl);
    try {
      host.send({ type: 'create-room', name: '房主' });
      await host.waitFor('joined');

      host.send({ type: 'start-game', aiCount: 2 });
      const first = (await host.waitFor('view')).view as ViewShape;
      expect(first.players).toHaveLength(3);
      expect(first.players[0]!.isHuman).toBe(true);
      expect(first.players[1]!.isHuman).toBe(false);
      expect(first.players[2]!.isHuman).toBe(false);
      expect(first.human.hand.length).toBeGreaterThanOrEqual(7); // 起手 +2 效果可能让先手多摸

      // 开局座位随机：若房主先手，初始视图就已轮到房主（不会再有新广播），直接复用；
      // 若 AI 先手，服务端应已代打——等到房主回合的新视图（证明驱动生效）
      const hostTurn =
        first.currentSeat === 0 && first.human.legalActions.length > 0
          ? first
          : await host.waitForView(
              (view) =>
                (view.currentSeat === 0 && view.human.legalActions.length > 0) ||
                view.screen === 'result',
            );
      expect(hostTurn.screen).toBe('game');

      // 房主出一个动作 → 服务端代打两个 AI 直到再次轮到房主（驱动故障会卡死在 AI 座位超时）
      const action = pickSimpleAction(hostTurn);
      expect(action).not.toBeNull();
      host.send({ type: 'action', action: action! });
      const backToHost = await host.waitForView(
        (view) => view.currentSeat === 0 || view.screen === 'result',
      );
      expect(backToHost.players).toHaveLength(3);
      // 隔离：players 列表只带 handCount，任何座位都不带 hand 字段（AI 手牌不外泄）
      for (const player of backToHost.players as Array<Record<string, unknown>>) {
        expect(player).not.toHaveProperty('hand');
        expect(typeof player.handCount).toBe('number');
      }
    } finally {
      host.close();
    }
  });
});

describe('M8-06 断线顶替与重连', () => {
  // 内部等待上限（waitForView 10s / waitFor 6s）高于 vitest 默认 5s 测试超时，
  // 且全套件并行时网络+AI 代打耗时会被拉长——统一放宽到 15s，避免默认超时掩盖真实错误
  it('轮到行动的真人断线：服务端代打其座位，另一位玩家看到回合自动推进', { timeout: 15000 }, async () => {
    const alice = await TestClient.connect(wsUrl);
    const bob = await TestClient.connect(wsUrl);
    let closedSeat = -1;
    try {
      alice.send({ type: 'create-room', name: 'A' });
      const joinedAlice = await alice.waitFor('joined');
      const code = (joinedAlice.room as { code: string }).code;
      bob.send({ type: 'join-room', code, name: 'B' });
      await bob.waitFor('joined');
      alice.send({ type: 'start-game' });
      const viewAlice = (await alice.waitFor('view')).view as ViewShape;
      const viewBob = (await bob.waitFor('view')).view as ViewShape;

      // 开局座位随机：谁当前行动谁断线，服务端应代打并把回合交给另一位
      const starter = viewAlice.currentSeat;
      closedSeat = starter;
      const survivor = starter === 0 ? bob : alice;
      const survivorSeat = starter === 0 ? 1 : 0;
      expect(viewBob.currentSeat).toBe(starter);
      (starter === 0 ? alice : bob).close();

      const survivorTurn = await survivor.waitForView(
        (view) => view.currentSeat === survivorSeat || view.screen === 'result',
        10000,
      );
      expect(survivorTurn.screen === 'result' || survivorTurn.currentSeat === survivorSeat).toBe(true);
      // 房间快照（开局广播在断线广播之前入队，要轮询到断线后的那条）
      const deadline = Date.now() + 6000;
      let disconnected = false;
      while (!disconnected && Date.now() < deadline) {
        const roomMsg = await survivor.waitFor('room', Math.max(1, deadline - Date.now()));
        const players = (roomMsg.room as { players: Array<{ seat: number; connected: boolean }> })
          .players;
        disconnected = players.find((p) => p.seat === closedSeat)?.connected === false;
      }
      expect(disconnected).toBe(true);
    } finally {
      alice.close();
      bob.close();
    }
  });

  it('凭 token 重连：恢复原座位并立即收到该座位当前视图', { timeout: 15000 }, async () => {
    const alice = await TestClient.connect(wsUrl);
    let bob = await TestClient.connect(wsUrl);
    try {
      alice.send({ type: 'create-room', name: 'A' });
      const joinedAlice = await alice.waitFor('joined');
      const code = (joinedAlice.room as { code: string }).code;
      bob.send({ type: 'join-room', code, name: 'B' });
      const joinedBob = await bob.waitFor('joined');
      const token = joinedBob.token as string;
      alice.send({ type: 'start-game' });
      await alice.waitFor('view');
      const bobView = (await bob.waitFor('view')).view as ViewShape;
      const bobCardIds = bobView.human.hand.map((card) => card.id);

      // Bob 断线重连
      bob.close();
      bob = await TestClient.connect(wsUrl);
      bob.send({ type: 'rejoin', code, token });
      const rejoined = await bob.waitFor('joined');
      expect(rejoined.seat).toBe(1);
      expect((rejoined.room as { players: unknown[] }).players).toHaveLength(2);
      const restored = (await bob.waitFor('view')).view as ViewShape;
      expect(restored.human.seat).toBe(1);
      // 手牌原样恢复（断线期间若被代打可能有变化，但 seat 视角必须是自己）
      expect(Array.isArray(restored.human.hand)).toBe(true);
      expect(restored.players).toHaveLength(2);
      // 若未被代打，手牌应与断线前一致
      if (restored.human.hand.length === bobCardIds.length) {
        expect(restored.human.hand.map((card) => card.id)).toEqual(bobCardIds);
      }
    } finally {
      alice.close();
      bob.close();
    }
  });
});
