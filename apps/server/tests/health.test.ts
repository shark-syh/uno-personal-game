import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';

let server: Server | undefined;
let baseUrl = '';

beforeAll(async () => {
  const app = createApp();
  const instance = app.listen(0);
  await new Promise<void>((resolve) => instance.once('listening', () => resolve()));
  server = instance;
  const address = instance.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  const current = server;
  if (!current) return;
  await new Promise<void>((resolve, reject) => {
    current.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('GET /api/health', () => {
  it('返回 200 与 status=ok', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('uno-server');
  });
});

describe('GET /api/config', () => {
  it('返回 AI 配置状态，且绝不泄漏 API Key', async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('apiKey');
    expect(text).not.toContain('ZHIPU_API_KEY');
    const body = JSON.parse(text) as { aiEnabled: boolean; aiDecisionImplemented: boolean };
    expect(typeof body.aiEnabled).toBe('boolean');
    expect(body.aiDecisionImplemented).toBe(true);
  });
});

describe('AI 接口入参校验', () => {
  it('POST /api/ai/decide 非法请求体返回 400（不会触发真实智谱请求）', async () => {
    const res = await fetch(`${baseUrl}/api/ai/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_REQUEST');
  });
});

describe('未知路径', () => {
  it('返回 404 JSON', async () => {
    const res = await fetch(`${baseUrl}/api/does-not-exist`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('NOT_FOUND');
  });
});

describe('静态资源（M3-2 引擎模式）', () => {
  it('GET / 返回 UNO 页面并加载 app.js', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('UNO 单机版');
    expect(html).toContain('js/app.js');
  });

  it('GET /js/vendor/uno-engine.js 返回可用的浏览器 ES Module', async () => {
    const res = await fetch(`${baseUrl}/js/vendor/uno-engine.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') || '').toContain('javascript');
    const text = await res.text();
    expect(text).toContain('export {');
    expect(text).toContain('getGameView');
    expect(text).toContain('decide');
  });
});
