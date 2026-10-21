import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSecretStore, type SecretCrypto } from '../src/secretStore.ts';

const tempDirs: string[] = [];

function tempFile(name = 'zhipu-secret.bin'): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'uno-secret-'));
  tempDirs.push(dir);
  return path.join(dir, name);
}

function fakeCrypto(available = true): SecretCrypto {
  return {
    isAvailable: () => available,
    encrypt: (plain) => Buffer.from(`enc:${Buffer.from(plain, 'utf8').toString('base64')}`),
    decrypt: (cipher) => {
      const text = cipher.toString('utf8');
      if (!text.startsWith('enc:')) throw new Error('bad cipher');
      return Buffer.from(text.slice(4), 'base64').toString('utf8');
    },
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('M10-03 桌面 Key 安全存储', () => {
  it('保存后写入加密内容，读取还原并自动去空白', () => {
    const file = tempFile();
    const store = createSecretStore(file, fakeCrypto());
    store.save('  test-key-123  ');

    expect(existsSync(file)).toBe(true);
    const raw = readFileSync(file).toString('utf8');
    expect(raw).not.toContain('test-key-123');
    expect(store.read()).toBe('test-key-123');
  });

  it('清除后文件删除且读取返回 null', () => {
    const file = tempFile();
    const store = createSecretStore(file, fakeCrypto());
    store.save('test-key');
    expect(store.read()).toBe('test-key');

    store.clear();
    expect(existsSync(file)).toBe(false);
    expect(store.read()).toBeNull();
  });

  it('文件缺失 / 损坏 / 解密失败都按未配置处理', () => {
    const missing = createSecretStore(tempFile(), fakeCrypto());
    expect(missing.read()).toBeNull();

    const file = tempFile();
    writeFileSync(file, 'not-a-valid-cipher');
    expect(createSecretStore(file, fakeCrypto()).read()).toBeNull();
  });

  it('空 Key 拒绝保存；isAvailable 异常时按不可用处理', () => {
    const store = createSecretStore(tempFile(), fakeCrypto());
    expect(() => store.save('   ')).toThrow();

    const broken: SecretCrypto = {
      ...fakeCrypto(),
      isAvailable: () => {
        throw new Error('no safeStorage');
      },
    };
    expect(createSecretStore(tempFile(), broken).isAvailable()).toBe(false);
  });
});
