import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import type { ChatResult, ZhipuClient } from '../src/zhipu.ts';

function validPayload(): Record<string, unknown> {
  return {
    difficulty: 'realistic',
    seat: 1,
    playerName: '老王',
    you: { hand: ['R7'], handCount: 1 },
    table: {
      topCard: 'B3',
      currentColor: 'blue',
      direction: 'clockwise',
      drawPileCount: 40,
      discardTop3: ['B3'],
      stack: null,
      phase: 'await-play',
    },
    players: [
      { seat: 0, name: '你', handCount: 3, saidUno: false, isHuman: true },
      { seat: 1, name: '老王', handCount: 1, saidUno: false, isHuman: false },
    ],
    candidates: [
      {
        id: 'play:R7#0:-',
        kind: 'play',
        action: 'PLAY_CARD',
        card: 'R7',
        color: null,
        score: 1,
        note: '出红7',
      },
      {
        id: 'DRAW',
        kind: 'draw',
        action: 'DRAW',
        card: null,
        color: null,
        score: 0,
        note: '摸一张',
      },
    ],
    historySummary: ['DEAL', 'DRAW'],
  };
}

function makeClient(
  chat: (request: unknown) => Promise<ChatResult>,
  overrides: Partial<ZhipuClient> = {},
): ZhipuClient {
  return {
    isConfigured: true,
    model: 'glm-test',
    fallbackModels: ['glm-fallback'],
    chat: chat as ZhipuClient['chat'],
    ...overrides,
  };
}

function successClient(content: string): ZhipuClient {
  return makeClient(async () => ({
    ok: true,
    content,
    model: 'glm-test',
    latencyMs: 12,
    attempts: 1,
  }));
}

async function withServer<T>(
  client: ZhipuClient,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const app = createApp({ aiClient: client });
  const instance = app.listen(0);
  await new Promise<void>((resolve) => instance.once('listening', () => resolve()));
  const address = instance.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      instance.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe('M4 /api/ai/decide', () => {
  it('正常返回模型选择的 actionId / reason / line', async () => {
    const client = successClient(
      JSON.stringify({ action_id: 'play:R7#0:-', reason: '打红7', line: '看我的' }),
    );
    await withServer(client, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ai/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPayload()),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        ok: true,
        actionId: 'play:R7#0:-',
        reason: '打红7',
        line: '看我的',
        model: 'glm-test',
      });
    });
  });

  it('请求体非法 → 400 INVALID_REQUEST（不打智谱）', async () => {
    let called = 0;
    const client = makeClient(async () => {
      called += 1;
      return { ok: true, content: '{}', model: 'glm-test', latencyMs: 0, attempts: 1 };
    });
    await withServer(client, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ai/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty: 'nope' }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('INVALID_REQUEST');
    });
    expect(called).toBe(0);
  });

  it('模型返回候选外动作 → 502 AI_INVALID_ACTION（前端据此降级）', async () => {
    const client = successClient(JSON.stringify({ action_id: 'HACK', reason: '', line: '' }));
    await withServer(client, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ai/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPayload()),
      });
      expect(res.status).toBe(502);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('AI_INVALID_ACTION');
    });
  });

  it('限流失败 → 429 RATE_LIMIT', async () => {
    const client = makeClient(async () => ({
      ok: false,
      code: 'RATE_LIMIT',
      message: '繁忙',
      latencyMs: 20,
      attempts: 2,
    }));
    await withServer(client, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ai/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPayload()),
      });
      expect(res.status).toBe(429);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('RATE_LIMIT');
    });
  });

  it('未配置 Key → 503 AI_NOT_CONFIGURED', async () => {
    const client = makeClient(async () => ({
      ok: false,
      code: 'AI_NOT_CONFIGURED',
      message: '',
      latencyMs: 0,
      attempts: 0,
    }));
    client.isConfigured = false;
    await withServer(client, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ai/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPayload()),
      });
      expect(res.status).toBe(503);
    });
  });
});

describe('M4 /api/ai/test 与 /api/config', () => {
  it('/api/ai/test 成功返回模型与耗时', async () => {
    const client = successClient('{"ok":true}');
    await withServer(client, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ai/test`, { method: 'POST' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; model: string; reply: string };
      expect(body.ok).toBe(true);
      expect(body.model).toBe('glm-test');
      expect(body.reply).toContain('ok');
    });
  });

  it('/api/ai/test 失败返回结构化错误', async () => {
    const client = makeClient(async () => ({
      ok: false,
      code: 'AUTH_FAILED',
      message: 'Key 无效',
      latencyMs: 5,
      attempts: 1,
    }));
    await withServer(client, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ai/test`, { method: 'POST' });
      expect(res.status).toBe(502);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('AUTH_FAILED');
    });
  });

  it('/api/config 暴露 aiEnabled/model 与 aiDecisionImplemented=true，且不含 Key', async () => {
    await withServer(successClient('{}'), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/config`);
      const text = await res.text();
      expect(text).not.toContain('apiKey');
      expect(text).not.toContain('ZHIPU_API_KEY');
      const body = JSON.parse(text) as Record<string, unknown>;
      expect(body.aiEnabled).toBe(true);
      expect(body.aiDecisionImplemented).toBe(true);
      expect(body.model).toBe('glm-test');
    });
  });
});
