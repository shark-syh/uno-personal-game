/**
 * 把 TS 规则引擎 + 本地 AI 打包成浏览器可直接 import 的 ESM 文件（M3-2）。
 *
 * 背景：前端是原生 JS（零构建、无 Vite），无法直接 import TS；
 * 因此用已安装的 esbuild 生成 `apps/web/js/vendor/uno-engine.js`，前端作为普通 ES Module 引入。
 * 该产物提交到仓库，静态服务即可直接托管；`npm run dev` / `npm start` 前会自动重新生成（predev/prestart）。
 *
 * 用法：npm run build:web-engine
 */
import { statSync } from 'node:fs';
import { relative } from 'node:path';
import { buildWebEngine, REPO_ROOT } from './web-engine-build.ts';

const outfile = await buildWebEngine();
const sizeKb = statSync(outfile).size / 1024;
console.log(
  `[build:web-engine] 已生成 ${relative(REPO_ROOT, outfile).replaceAll('\\', '/')}（${sizeKb.toFixed(1)} KB）`,
);
