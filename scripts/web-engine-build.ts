/**
 * 浏览器引擎 bundle 的构建逻辑（供 CLI 与「产物是否与源码同步」回归测试复用）。
 *
 * 产物：apps/web/js/vendor/uno-engine.js（ESM，前端零构建直接 import）。
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/** 仓库根目录（本文件位于 scripts/ 下） */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 提交到仓库的浏览器引擎入口文件 */
export const WEB_ENGINE_OUTFILE = resolve(REPO_ROOT, 'apps/web/js/vendor/uno-engine.js');

export interface BuildWebEngineOptions {
  /** 输出路径（默认仓库内的 apps/web/js/vendor/uno-engine.js） */
  outfile?: string;
  /** 模块解析根目录（默认仓库根） */
  root?: string;
}

/** 打包规则引擎 + 本地 AI（纯 TS）为浏览器 ESM */
export async function buildWebEngine(options: BuildWebEngineOptions = {}): Promise<string> {
  const root = options.root ?? REPO_ROOT;
  const outfile = options.outfile ?? WEB_ENGINE_OUTFILE;
  mkdirSync(dirname(outfile), { recursive: true });

  await build({
    stdin: {
      contents: ["export * from '@uno/game-core';", "export * from '@uno/ai';", ''].join('\n'),
      resolveDir: root,
      sourcefile: 'uno-engine-browser-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outfile,
    logLevel: 'warning',
    banner: {
      js: '/* 自动生成文件：npm run build:web-engine（源 packages/game-core + packages/ai），请勿手改。 */',
    },
  });

  return outfile;
}
