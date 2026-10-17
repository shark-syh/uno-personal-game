import { describe, expect, it, vi } from 'vitest';
import { createZhipuClient } from '../src/zhipu.ts';

interface FakeResponse {
  status: number;
  body: string;
}

function responseFactory(plan: FakeResponse[]): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = plan.shift();
    if (!next) throw new Error('fake fetch 计划用尽');
    return {
      status: next.status,
      text: async () => next.body,
    } as Response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function successBody(content: string): string {
  return JSON.stringify({ choices: [{ message: { content } }] });
}

const baseOptions = {
  apiKey: 'test-key',
  baseUrl: 'https://example.invalid/api/paas/v4',
  model: 'glm-primary',
  fallbackModels: ['glm-fallback'],
  timeoutMs: 2000,
  sleep: async () => {},
};

describe('M4 智谱客户端', () => {
  it('未配置 Key：直接返回 AI_NOT_CONFIGURED，不发请求', async () => {
    const client = createZhipuClient({ ...baseOptions, apiKey: '' });
    const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('AI_NOT_CONFIGURED');
  });

  it('成功：返回内容/模型/耗时，Authorization 使用 Bearer Key', async () => {
    const { fetchImpl, calls } = responseFactory([
      { status: 200, body: successBody('{"ok":true}') },
    ]);
    const client = createZhipuClient({ ...baseOptions, fetchImpl });
    const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe('{"ok":true}');
      expect(result.model).toBe('glm-primary');
      expect(result.attempts).toBe(1);
    }
    expect(
      String(
        calls[0]!.init.headers && (calls[0]!.init.headers as Record<string, string>).Authorization,
      ),
    ).toBe('Bearer test-key');
    const body = JSON.parse(String(calls[0]!.init.body)) as { thinking?: { type: string } };
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('模型不支持 thinking 参数（400）：去掉 thinking 重试一次', async () => {
    const { fetchImpl, calls } = responseFactory([
      {
        status: 400,
        body: JSON.stringify({ error: { code: '1211', message: 'unknown field thinking' } }),
      },
      { status: 200, body: successBody('{"ok":true}') },
    ]);
    const client = createZhipuClient({ ...baseOptions, fetchImpl });
    const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(
      (JSON.parse(String(calls[1]!.init.body)) as { thinking?: unknown }).thinking,
    ).toBeUndefined();
  });

  it('限流重试后切换备用模型成功', async () => {
    const { fetchImpl, calls } = responseFactory([
      { status: 429, body: JSON.stringify({ error: { code: '1305', message: 'overload' } }) },
      { status: 429, body: JSON.stringify({ error: { code: '1305', message: 'overload' } }) },
      { status: 200, body: successBody('{"ok":true}') },
    ]);
    const client = createZhipuClient({ ...baseOptions, fetchImpl });
    const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.model).toBe('glm-fallback');
    expect(calls).toHaveLength(3);
  });

  it('鉴权失败：401 不重试/不换模型', async () => {
    const { fetchImpl, calls } = responseFactory([
      { status: 401, body: JSON.stringify({ error: { code: '1000', message: 'auth failed' } }) },
    ]);
    const client = createZhipuClient({ ...baseOptions, fetchImpl });
    const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('AUTH_FAILED');
    expect(calls).toHaveLength(1);
  });

  it('超时：返回 TIMEOUT（AbortSignal 生效）', async () => {
    const fetchImpl = ((url: string | URL | Request, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }
      })) as typeof fetch;
    const client = createZhipuClient({ ...baseOptions, fetchImpl, timeoutMs: 60 });
    const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(['TIMEOUT', 'NETWORK_ERROR']).toContain(result.code);
  });

  it('200 但空内容：EMPTY_RESPONSE', async () => {
    const { fetchImpl } = responseFactory([
      { status: 200, body: JSON.stringify({ choices: [{ message: { content: '' } }] }) },
      { status: 200, body: JSON.stringify({ choices: [{ message: { content: '' } }] }) },
    ]);
    const client = createZhipuClient({ ...baseOptions, fetchImpl });
    const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('EMPTY_RESPONSE');
  });

  it('网络错误：NETWORK_ERROR', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const client = createZhipuClient({ ...baseOptions, fetchImpl });
    const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NETWORK_ERROR');
  });
});
