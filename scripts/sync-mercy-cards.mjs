/* global console, process */
/**
 * M4：把 research/open-mercy/cards-webp/ 的 68 张 B 版卡面同步到本机运行时目录。
 *
 * 合规（research/open-mercy/README-来源与裁剪.md §6.5）：卡面仅供本机个人学习/演示，
 * 不随安装包（exe）、GitHub Release 或任何公开分发渠道外传。因此目标目录
 * `apps/web/cards-mercy/` 同时被 .gitignore 与 electron-builder.yml 的
 * extraResources.filter 排除；本脚本只搬运素材、自身不含任何卡面。
 * 桌面打包版没有该目录时，renderCard() 会自动降级为色块 + 文字牌面。
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'research', 'open-mercy', 'cards-webp');
const dest = join(root, 'apps', 'web', 'cards-mercy');

if (!existsSync(src)) {
  console.error(`[sync-mercy-cards] 找不到源目录：${src}`);
  process.exit(1);
}

const files = readdirSync(src).filter((name) => name.endsWith('.webp'));
if (files.length !== 68) {
  console.error(`[sync-mercy-cards] 期望 68 张唯一卡面，实际 ${files.length} 张`);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
for (const name of files) cpSync(join(src, name), join(dest, name));
console.log(`[sync-mercy-cards] 已同步 ${files.length} 张卡面到 ${dest}`);
