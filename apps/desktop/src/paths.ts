import path from 'node:path';

export interface DesktopPathOptions {
  /** 打包产物所在目录（开发时为 apps/desktop/dist，打包后为 resources/app.asar/dist） */
  appDir: string;
  /** Electron app.isPackaged */
  isPackaged: boolean;
  /** Electron process.resourcesPath */
  resourcesPath: string;
  env?: NodeJS.ProcessEnv;
}

export interface DesktopPaths {
  appDir: string;
  repoRoot: string;
  webDir: string;
  envFile: string;
  preloadFile: string;
}

function nonEmpty(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null;
  return value.trim();
}

/**
 * 解析桌面版路径：
 * - 开发模式：前端与 .env 直接复用仓库内的 apps/web、根 .env；
 * - 打包模式：前端由 electron-builder 放到 resources/web，安装包内不再携带 .env；
 * - 两者都允许 UNO_WEB_DIR / UNO_ENV_FILE 覆盖，方便测试与便携部署。
 */
export function resolveDesktopPaths(options: DesktopPathOptions): DesktopPaths {
  const env = options.env ?? process.env;
  const appDir = path.resolve(options.appDir);
  const repoRoot = path.resolve(appDir, '../../..');

  const webDir =
    nonEmpty(env.UNO_WEB_DIR) ??
    (options.isPackaged ? path.join(options.resourcesPath, 'web') : path.join(repoRoot, 'apps/web'));
  const envFile =
    nonEmpty(env.UNO_ENV_FILE) ??
    (options.isPackaged
      ? path.join(options.resourcesPath, '.env')
      : path.join(repoRoot, '.env'));

  return {
    appDir,
    repoRoot,
    webDir: path.resolve(webDir),
    envFile: path.resolve(envFile),
    preloadFile: path.join(appDir, 'preload.cjs'),
  };
}
