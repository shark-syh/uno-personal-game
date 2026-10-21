/**
 * M10-01：用 esbuild 打包 Electron 主进程与 preload。
 *
 * - 主进程：CJS，内联 Express/ws/@uno/*；electron 与 ws 的可选原生依赖保持 external；
 * - preload：CJS，仅保留 Electron 窄 IPC 接口；
 * - 产物在 apps/desktop/dist（gitignored）。
 *
 * 用法：npm run desktop:build
 */
import { mkdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP_DIR = resolve(REPO_ROOT, 'apps/desktop');
const DIST_DIR = resolve(DESKTOP_DIR, 'dist');

const sharedOptions = {
  bundle: true,
  platform: 'node' as const,
  format: 'cjs' as const,
  target: 'node22',
  // electron 由运行时提供；ws 的两个可选加速模块不安装时按缺失处理
  external: ['electron', 'bufferutil', 'utf-8-validate'],
  logLevel: 'warning' as const,
  // config.ts 同时兼容 ESM 与桌面 CJS；CJS 下优先走 __dirname，此警告无实际影响
  logOverride: { 'empty-import-meta': 'silent' as const },
  sourcemap: false,
};

export async function buildDesktop(): Promise<{ main: string; preload: string }> {
  mkdirSync(DIST_DIR, { recursive: true });
  const main = resolve(DIST_DIR, 'main.cjs');
  const preload = resolve(DIST_DIR, 'preload.cjs');

  await build({
    ...sharedOptions,
    entryPoints: [resolve(DESKTOP_DIR, 'src/main.ts')],
    outfile: main,
  });
  await build({
    ...sharedOptions,
    entryPoints: [resolve(DESKTOP_DIR, 'src/preload.ts')],
    outfile: preload,
  });

  return { main, preload };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { main, preload } = await buildDesktop();
  for (const file of [main, preload]) {
    const sizeKb = statSync(file).size / 1024;
    console.log(
      `[build:desktop] 已生成 ${relative(REPO_ROOT, file).replaceAll('\\', '/')}（${sizeKb.toFixed(1)} KB）`,
    );
  }
}
