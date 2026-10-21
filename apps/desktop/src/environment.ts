import { app } from 'electron';
import { resolveDesktopPaths, type DesktopPaths } from './paths.ts';

function setIfEmpty(name: string, value: string): void {
  if (!process.env[name]?.trim()) process.env[name] = value;
}

/**
 * 必须在 server/config.ts 求值前执行：config 在模块加载时读取这些环境变量。
 * main.ts 把本模块放在 server 导入之前，ESM 会先求值本模块的副作用。
 */
export const DESKTOP_PATHS: DesktopPaths = resolveDesktopPaths({
  appDir: __dirname,
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
});

setIfEmpty('UNO_ROOT_DIR', DESKTOP_PATHS.repoRoot);
setIfEmpty('UNO_WEB_DIR', DESKTOP_PATHS.webDir);
setIfEmpty('UNO_ENV_FILE', DESKTOP_PATHS.envFile);
process.env.UNO_DESKTOP = '1';
