# UNO 单机版（本地网页游戏）

> 1 名真人 + 2~9 名 AI 的 UNO 单机游戏。**宽松叠牌**（+2/+4 任意互叠、累计摸牌），
> 其余规则与 108 张牌组依照原版；AI 采用「规则引擎 + 智谱免费模型」混合决策，四档难度。
> 纯本地运行，游戏与本地 AI 可完全离线；联网时 AI 会思考、会说话。

> ⚠️ 个人非商业练习项目。UNO® 是 Mattel 的注册商标，本项目与其无关联。

## 当前状态（M0 + M1 规则引擎 + M2 本地 AI 已完成）

- ✅ 调研、开发计划、UI ↔ 引擎契约（见 `开发计划.md`、`UI开发提示词.md`）
- ✅ 54 张 CC0 卡面资源（`apps/web/cards/`）
- ✅ 工程骨架、本地服务（静态托管 + `/api/health`、`/api/config`）、智谱连通性冒烟脚本
- ✅ M1 规则引擎（闭环）：牌组/开局、回合主循环、动作牌完整规则、宽松叠牌、+4 挑战、UNO 喊与抓、牌堆耗尽与结算 `getResult`（含平局）
- ✅ UI 第一阶段（mock 驱动）：大厅/牌桌/结算 + 54 张卡面；大厅含「+4 挑战」开始前勾选项
- ✅ M2 本地 AI：候选生成 + 启发式评分 + 记牌器 + 挑战/诈唬策略 + 四档难度（休闲/简单/真实/骨灰级）+ 自对弈基准（`npm run selfplay`，700 局验收：非法动作 0、难度胜率单调、平均回合约 50）
- ⬜ 下一步：M3-2 UI 对接引擎。**当前浏览器里仍是 mock 演示，不能真打**；引擎/AI 能力可用命令行 demo、自对弈与测试验证。
- ✅ 已建 git 仓库并提交 MVP 基线（M0+M1+UI）与 M2 里程碑（本地版本控制，便于回滚）。

## 环境要求

- Node.js ≥ 22（本机 26.7.0），npm ≥ 11
- Python 3（仅用于重新处理卡面资源的 `npm run process:cards`）
- 浏览器：Chrome / Edge 最新版

## 快速开始

```bash
npm install

# 可选：配置智谱 Key（不配置也能玩，AI 自动用本地策略）
# Windows: copy .env.example .env ; macOS/Linux: cp .env.example .env
copy .env.example .env

npm run dev
# 打开 http://localhost:3000
```

> 也可以直接双击根目录的 **`启动服务.bat`** 一键启动（首次会自动安装依赖，关闭窗口即停止服务）。

- 前端页面由 `apps/web/index.html` 提供（当前为 mock 模式，可直接点开始体验界面）。
- 服务启动日志会打印端口、前端页面状态、智谱 Key 是否已配置。

## 常见问题

| 现象 | 原因 / 解决 |
|------|-------------|
| 打开 `http://localhost:3000` 什么都没有 / 无法访问 | **本地服务没有在运行**。双击 `启动服务.bat` 或命令窗执行 `npm run dev`，看到 `[uno-server] 已启动` 后再刷新页面 |
| 网页能点但不像真实对局 | 正常：M3-2 接入引擎前 UI 为 mock 演示（点击只切画面/提示）；真实对局要等 M2 本地 AI + M3-2 对接 |
| 端口被占用（`EADDRINUSE`） | 改 `.env` 里的 `PORT`，或关掉占用 3000 端口的程序 |

## 常用命令

| 命令 | 作用 |
|------|------|
| `npm run dev` | 启动本地服务（静态托管 + API，开发模式自动重启） |
| `npm start` | 同上，但不监听文件变化 |
| `npm test` | 运行单元测试（Vitest） |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint 检查 |
| `npm run smoke:ai` | 测试智谱 Key 连通性（需先配置 `.env`） |
| `npm run selfplay` | AI 自对弈基准（M2）：非法动作数、四档难度胜率单调性、平均回合数 |
| `npm run process:cards` | 重新处理 `research/cards` 里的卡面资源 |

自对弈基准示例（项目根目录）：

```bash
npm run selfplay                          # 相邻难度各 200 局 + 4 人混战 100 局
npm run selfplay -- --games 300 --mixed 200
npm run selfplay -- --games 100 --no-mixed --seed demo
```

## 目录结构

```
uno/
├─ apps/web/           # 前端（原生 HTML/CSS/JS，零构建；外部 Codex 产出）
├─ apps/server/        # 本地服务（静态托管 + 智谱 API 代理）
├─ packages/game-core/ # 规则引擎（M1）
├─ packages/ai/        # 本地启发式 AI（M2：四档难度 + 记牌 + 自对弈）
├─ scripts/            # 工具脚本（卡面处理、AI 冒烟、自对弈）
├─ research/           # 调研资料与原始卡面（CC0）
├─ 开发计划.md         # 完整开发计划（规则规格、架构、里程碑）
├─ UI开发提示词.md     # UI ↔ 引擎契约与分阶段提示词
├─ 开发约定.md         # 开发汇报约定
└─ 开发进度.md         # 进度台账
```

## 说明

- **前端零构建**：`apps/web` 由静态 HTML/CSS/JS 组成，本地服务直接托管，没有打包步骤。
- **Key 安全**：`ZHIPU_API_KEY` 只放在根目录 `.env`（已 gitignore），不会进入前端代码。
- **离线可玩**：AI 请求失败/未配置时自动降级为本地启发式 AI。
