import { afterEach, describe, expect, it } from 'vitest';
import {
  createApiKeyStore,
  getAiKeyStatus,
  getEffectiveApiKey,
  setDesktopApiKey,
} from '../src/ai-key.ts';

afterEach(() => {
  setDesktopApiKey(null);
});

describe('M10-03 智谱 Key 运行时来源', () => {
  it('默认使用 .env Key，自填 Key 优先，清除后回退', () => {
    const store = createApiKeyStore('env-key');
    expect(store.getKey()).toBe('env-key');
    expect(store.getSource()).toBe('env');

    store.setDesktopKey('desktop-key');
    expect(store.getKey()).toBe('desktop-key');
    expect(store.getSource()).toBe('desktop');

    store.setDesktopKey(null);
    expect(store.getKey()).toBe('env-key');
    expect(store.getSource()).toBe('env');
  });

  it('空白 Key 视为未配置，不会覆盖已有来源', () => {
    const store = createApiKeyStore('env-key');
    store.setDesktopKey('   ');
    expect(store.getKey()).toBe('env-key');
    expect(store.getSource()).toBe('env');

    store.setDesktopKey('  desktop-key  ');
    expect(store.getKey()).toBe('desktop-key');

    const empty = createApiKeyStore('  ');
    expect(empty.getKey()).toBe('');
    expect(empty.getSource()).toBe('none');
  });

  it('模块级状态只暴露来源与模型，不含 Key', () => {
    setDesktopApiKey('desktop-key');
    expect(getEffectiveApiKey()).toBe('desktop-key');
    const status = getAiKeyStatus();
    expect(status).toMatchObject({ configured: true, source: 'desktop' });
    expect(JSON.stringify(status)).not.toContain('desktop-key');
  });
});
