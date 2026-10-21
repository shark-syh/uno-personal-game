import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDesktopPaths } from '../src/paths.ts';

const APP_DIR = path.resolve('C:/uno-build/apps/desktop/dist');
const RESOURCES = path.resolve('C:/uno-build/resources');

describe('resolveDesktopPaths', () => {
  it('开发模式复用仓库内的 apps/web 与根 .env', () => {
    const paths = resolveDesktopPaths({
      appDir: APP_DIR,
      isPackaged: false,
      resourcesPath: RESOURCES,
      env: {},
    });
    expect(paths.repoRoot).toBe(path.resolve('C:/uno-build'));
    expect(paths.webDir).toBe(path.resolve('C:/uno-build/apps/web'));
    expect(paths.envFile).toBe(path.resolve('C:/uno-build/.env'));
    expect(paths.preloadFile).toBe(path.join(APP_DIR, 'preload.cjs'));
  });

  it('打包模式从 resources 读取前端，且环境变量可覆盖', () => {
    const packaged = resolveDesktopPaths({
      appDir: APP_DIR,
      isPackaged: true,
      resourcesPath: RESOURCES,
      env: {},
    });
    expect(packaged.webDir).toBe(path.join(RESOURCES, 'web'));
    expect(packaged.envFile).toBe(path.join(RESOURCES, '.env'));

    const overridden = resolveDesktopPaths({
      appDir: APP_DIR,
      isPackaged: true,
      resourcesPath: RESOURCES,
      env: {
        UNO_WEB_DIR: 'C:/custom/web',
        UNO_ENV_FILE: 'D:/config/uno.env',
      },
    });
    expect(overridden.webDir).toBe(path.resolve('C:/custom/web'));
    expect(overridden.envFile).toBe(path.resolve('D:/config/uno.env'));
  });
});
