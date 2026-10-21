/**
 * 桌面版智谱 Key 安全存储（M10-03）。
 *
 * 只保存加密后的二进制；Windows 下由 Electron safeStorage 走 DPAPI。
 * 本模块不依赖 Electron，便于用假 crypto 做单测。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface SecretCrypto {
  /** 系统安全存储是否可用（safeStorage.isEncryptionAvailable） */
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(cipher: Buffer): string;
}

export interface SecretStore {
  isAvailable(): boolean;
  /** 读取并解密；文件不存在、解密失败或为空时返回 null */
  read(): string | null;
  /** 写入加密文件；空 Key 抛错，避免保存无效内容 */
  save(key: string): void;
  /** 删除已保存的 Key（不存在时静默） */
  clear(): void;
}

function normalizeKey(raw: string): string {
  return raw.trim();
}

export function createSecretStore(filePath: string, crypto: SecretCrypto): SecretStore {
  return {
    isAvailable() {
      try {
        return crypto.isAvailable();
      } catch {
        return false;
      }
    },
    read() {
      try {
        if (!existsSync(filePath)) return null;
        const key = normalizeKey(crypto.decrypt(readFileSync(filePath)));
        return key.length > 0 ? key : null;
      } catch {
        // 文件损坏 / 换了 Windows 账户：按未配置处理，由用户在设置页重填
        return null;
      }
    },
    save(key) {
      const normalized = normalizeKey(key);
      if (!normalized) throw new Error('API Key 不能为空');
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, crypto.encrypt(normalized), { mode: 0o600 });
    },
    clear() {
      try {
        rmSync(filePath, { force: true });
      } catch {
        // 删除失败不阻塞清除动作：内存中的 Key 仍会被调用方清空
      }
    },
  };
}
