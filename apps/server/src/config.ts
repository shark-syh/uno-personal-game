import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 桌面版主进程用 esbuild 打成 CJS 后 __dirname 可用；网页版经 tsx 以 ESM 运行时回退到 import.meta.url
const currentDir =
  typeof __dirname === 'string' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

function readPath(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : path.resolve(value.trim());
}

/** 仓库根目录（apps/server/src -> ../../..；打包后由 UNO_ROOT_DIR 覆盖） */
export const ROOT_DIR = readPath('UNO_ROOT_DIR', path.resolve(currentDir, '../../..'));
/** 前端静态资源目录（由外部 Codex 零构建产出，服务直接托管；桌面版用 UNO_WEB_DIR 指向 extraResources） */
export const WEB_DIR = readPath('UNO_WEB_DIR', path.join(ROOT_DIR, 'apps/web'));
/** .env 路径（桌面安装包内不存在 .env，UNO_ENV_FILE 可用于指向外部配置） */
export const ENV_FILE = readPath('UNO_ENV_FILE', path.join(ROOT_DIR, '.env'));

// Node >= 21.7 内置 .env 读取；没有 .env 时静默跳过（游戏与本地 AI 不依赖它）
const loadEnvFile = (process as unknown as { loadEnvFile?: (file?: string) => void }).loadEnvFile;
try {
  loadEnvFile?.(ENV_FILE);
} catch {
  // .env 不存在：使用默认配置
}

function readString(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function readNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readList(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export const config = {
  port: readNumber('PORT', 3000),
  webDir: WEB_DIR,
  hasWebUi: existsSync(path.join(WEB_DIR, 'index.html')),
  zhipu: {
    apiKey: readString('ZHIPU_API_KEY', ''),
    baseUrl: readString('ZHIPU_BASE_URL', 'https://open.bigmodel.cn/api/paas/v4'),
    model: readString('ZHIPU_MODEL', 'glm-4.7-flash'),
    fallbackModels: readList('ZHIPU_FALLBACK_MODELS', ['glm-4.5-flash', 'glm-4-flash']),
    timeoutMs: readNumber('AI_DECISION_TIMEOUT_MS', 6000),
  },
} as const;

export const isAiConfigured = config.zhipu.apiKey.length > 0;
