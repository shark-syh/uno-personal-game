# 验收产物目录

本目录存放浏览器自动验收（`npm run verify:ui`）与历史 UI 验收的**产物**，内容会随每次运行重新生成/覆盖：

- `ui-m32-verify.md` / `ui-m32-verify.json`：最新一次 `npm run verify:ui` 的报告（102 项检查明细）与原始 JSON。
- `ui-*.png`：验收截图（大厅 / 4 人与 10 人牌桌 / 结算页 / 挑战手牌 / 抓 UNO / 设置页 / 动效 / 响应式等）。
- `ai-profile-2026-10-17.md`：AI 打牌实测记录（历史留档）。

说明：

- 运行 `npm run verify:ui` 前需先启动本地服务（`npm run dev`）。
- 该目录下的截图主要用于开发验收留档，根目录 README 使用 `docs/images/` 中压缩后的图片，避免 README 加载大图。
- 历史截图文件名带 `m3`/`m4`/`m5`/`m6` 前缀，对应不同里程碑的验收阶段。
