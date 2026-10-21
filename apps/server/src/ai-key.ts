/**
 * 智谱 Key 运行时来源（M10-03）。
 *
 * 优先级：桌面版自填 Key（safeStorage）> `.env` 中的 ZHIPU_API_KEY。
 * 自填 Key 只保存在 Electron 主进程内存与加密文件里，服务端只通过本模块取值，
 * 不记录、不返回明文；状态查询只暴露 configured / source / model。
 */
import { config } from './config.ts';

export type AiKeySource = 'desktop' | 'env' | 'none';

export interface AiKeyStore {
  /** 设置/清除桌面版自填 Key（null 表示清除） */
  setDesktopKey(key: string | null): void;
  /** 当前生效的 Key（可能为空字符串） */
  getKey(): string;
  getSource(): AiKeySource;
}

function normalizeKey(raw: string | null | undefined): string {
  return raw?.trim() ?? '';
}

/** 纯逻辑存储：默认 Key 来自 `.env`，便于单测注入 */
export function createApiKeyStore(defaultKey: string): AiKeyStore {
  const envKey = normalizeKey(defaultKey);
  let desktopKey = '';

  return {
    setDesktopKey(key) {
      desktopKey = normalizeKey(key);
    },
    getKey() {
      return desktopKey || envKey;
    },
    getSource() {
      if (desktopKey) return 'desktop';
      return envKey ? 'env' : 'none';
    },
  };
}

const keyStore = createApiKeyStore(config.zhipu.apiKey);

/** 桌面主进程启动时加载加密文件、保存/清除 Key 后调用 */
export function setDesktopApiKey(key: string | null): void {
  keyStore.setDesktopKey(key);
}

export function getEffectiveApiKey(): string {
  return keyStore.getKey();
}

export function getAiKeySource(): AiKeySource {
  return keyStore.getSource();
}

export interface AiKeyStatus {
  configured: boolean;
  source: AiKeySource;
  model: string;
}

/** 供桌面 IPC / `/api/config` 使用；永远不包含 Key 本身 */
export function getAiKeyStatus(): AiKeyStatus {
  return {
    configured: getEffectiveApiKey().length > 0,
    source: getAiKeySource(),
    model: config.zhipu.model,
  };
}
