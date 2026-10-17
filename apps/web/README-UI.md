# UNO 单机版 UI

这是原生 HTML/CSS/ES Module UI（零构建、无第三方依赖）。**M3-2 起默认进入「引擎模式」**：页面直接连真实规则引擎与本地 AI，可以完整打完一局；mock 模式保留用于 UI 回归。

## 预览

在仓库根目录执行：

```bash
npm run dev
```

浏览器打开 `http://localhost:3000/` 即可真打（大厅选人数/难度/+4 挑战 → 开始游戏）。
`npm run dev` / `npm start` 前会自动执行 `npm run build:web-engine`，把 TS 引擎 + AI 打包到 `js/vendor/uno-engine.js`（该产物已提交，静态服务可直接托管）。

调试参数：

- `?mock=1`：mock 开发模式（显示开发工具条，可切换 11 种局面；动作只打印/演示，不推进真实规则）。
- `?test=1`：引擎模式自动化验收用快速模式（AI 思考延迟 ~15ms、UNO 窗口 120ms、事件类型打印到 console.debug）。
- `?engine-dev=1`：引擎模式，仅打印事件/AI 决策日志。

## 引擎模式（M3-2）

- 入口：`js/engine/engineMode.js`（通过 `window.UnoApp` 契约渲染 view / 播放事件 / 接收动作）。
- 启动流程：大厅 `START_GAME` → `createInitialGame(config)`（含 `challengeWild4` / 难度 / 玩家名）→ `getGameView()` → `UnoApp.render(view)` + `playEvents` → 人类操作或 AI 调度。
- 人类操作：UI 的 UiAction → `toEngineAction()` → `applyAction`；动作合法性由引擎校验（UI 不写规则）。
- AI 回合：本地 `decide()`（M2 四档难度）+ 按难度/设置加"思考延迟"并显示「思考中」气泡；动画播放期间 `aria-busy` 锁输入。
- UNO 窗口：人类有 2.5s 点「UNO! / 抓他！」；超时后由当前行动者继续（引擎自动结算 AI 抓人）。
- 结算：`getResult` → 契约 `result`（含平局）；「再来一局」沿用大厅配置，新随机种子。
- 隐藏信息：`packages/game-core/src/public-view.ts` 统一脱敏（他人手牌 / wild4Info / 他人摸牌牌面 / AI 挑战看到的手牌），UI 只拿得到公开信息。

## 动效与交互（当前阶段）

- 事件队列 `js/animation/queue.js`：按事件逐条 200ms 播放，期间 `#game-screen[aria-busy=true]`、手牌/操作栏/弹窗按钮禁用，播放完恢复。
- 动画开关：设置里的「动画」关闭时跳过队列；系统 `prefers-reduced-motion: reduce` 时也直接完成。
- 已有 CSS 动效：卡牌悬停/合法高亮过渡、弹窗进场 `dialog-in`、UNO 按钮脉冲 `uno-pulse`、AI 思考气泡 `dots`（`js/ui/players.js` 挂 `.thinking` class）。
- 发牌/飞牌/彩带等第二阶段复杂动效尚未实现（M6 打磨阶段）。
- `?mock=1` 的开发工具条含「重播动画」按钮，可重放当前 mock 的 events。
- `npm run verify:ui`：无头 Chrome 自动验收（完整对局 3 局 / 动效队列 / reduced-motion / 动画关闭 / 控制台与网络 / 弹窗与 UNO 脉冲 / 截图），报告输出到 `review-assets/ui-m32-verify.md`。

## 文件说明

- `index.html`：三个屏幕和契约规定的 DOM 锚点。
- `styles/`：设计 token、牌桌布局、卡牌、组件和基础动画。
- `js/app.js`：启动、屏幕切换、动作分发（默认引擎模式；`?mock=1` 走 mock）。
- `js/engine/engineMode.js`：M3-2 引擎模式控制器（真实对局 / AI 调度 / UNO 窗口）。
- `js/vendor/uno-engine.js`：自动生成的浏览器引擎 ESM（`npm run build:web-engine`，请勿手改）。
- `js/mock/mockView.js`：可重复使用的 mock `GameView` 数据（UI 回归用）。
- `js/ui/`：按区域幂等渲染，不从 DOM 反推状态。
- `js/animation/queue.js`：事件队列（每条事件 200ms；尊重 reduced motion / 动画开关）。
- `js/state/`：`uno:settings` 和 `uno:stats` 的 localStorage 读写。

## 实现约定

- 牌面图片优先加载 `cards/{faceCode}.png`；图片失败时由卡牌节点绘制色块和短标签，不展示破图。
- 手牌排布：默认全部排开（间距 10px）；数量超出可用宽度时均匀折叠（每张至少露出 36px，仍放不下则手牌区横向滚动）；鼠标悬停/键盘聚焦时当前牌提到最上层并上浮。
- 大厅「规则选项 · +4 挑战」勾选框随 `START_GAME.config.challengeWild4` 传入引擎；关闭后 +4 直接摸 4、不进入挑战窗口。
- 设置弹窗保存音效、动画、AI 速度和自动喊 UNO；其中动画/AI 速度/自动喊 UNO 在引擎模式生效（音效待 M6）。
- 每个 AI 的台词与思考状态在 `speech-layer` 内按 `data-seat` 呈现；座位内展示头像、名字、手牌数、UNO 和最近出牌。
- 音效开关仅保存偏好，当前阶段没有音频资源或音频播放。
- 战绩弹窗只展示本地缓存；结算暂不写入战绩（M6 实现）。
