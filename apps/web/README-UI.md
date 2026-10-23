# UNO 单机版 UI

这是原生 HTML/CSS/ES Module UI（零构建、无第三方依赖）。默认进入「引擎模式」：页面直接连真实规则引擎与本地 AI，可以完整打完一局；mock 模式保留用于 UI 回归。

## 预览

在仓库根目录执行：

```bash
npm run dev
```

浏览器打开 `http://localhost:3000/` 即可真打（大厅选人数/难度/+4 挑战 → 开始游戏）。
`npm run dev` / `npm start` 前会自动执行 `npm run build:web-engine`，把 TS 引擎 + AI 打包到 `js/vendor/uno-engine.js`（该产物已提交，静态服务可直接托管）。

调试参数：

- `?mock=1`：mock 开发模式（显示开发工具条，可切换 14 种局面；动作只打印/演示，不推进真实规则）。
- `?test=1`：引擎模式自动化验收用快速模式（AI 思考延迟 ~15ms、UNO 窗口 120ms、事件类型打印到 console.debug）。
- `?engine-dev=1`：引擎模式，仅打印事件/AI 决策日志。

## 引擎模式

- 入口：`js/engine/engineMode.js`（通过 `window.UnoApp` 契约渲染 view / 播放事件 / 接收动作）。
- 启动流程：大厅 `START_GAME` → `createInitialGame(config)`（含 `challengeWild4` / 难度 / 玩家名）→ `getGameView()` → `UnoApp.render(view)` + `playEvents` → 人类操作或 AI 调度。
- 人类操作：UI 的 UiAction → `toEngineAction()` → `applyAction`；动作合法性由引擎校验（UI 不写规则）。
- AI 回合：本地 `decide()`（M2 四档难度）+ 按难度/设置加"思考延迟"并显示「思考中」气泡；动画播放期间 `aria-busy` 锁输入。
- UNO 窗口：人类有 4s 点「UNO! / 抓他！」（`?test=1` 下 120ms）；超时后由当前行动者继续（引擎自动结算 AI 抓人）。
- 结算：`getResult` → 契约 `result`（含平局）；「再来一局」沿用大厅配置，新随机种子。
- 隐藏信息：`packages/game-core/src/public-view.ts` 统一脱敏（他人手牌 / wild4Info / 他人摸牌牌面 / AI 挑战看到的手牌），UI 只拿得到公开信息。

## M4 智谱混合 AI（浏览器侧）

- 大厅「AI 模式」可选 智谱 / 本地 / 自动：自动=有 Key 时用智谱、失败降级本地；本地=纯 M2 启发式 AI。
- AI 回合：先由本地 AI 生成候选动作 → 请求本地服务 `/api/ai/decide`（服务端持 Key、调智谱、校验 action_id）→ 成功则执行并显示台词气泡；超时(8s 预算)/429/401/输出非法时自动降级 M2 本地 AI，对局不中断。
- 状态栏 `#ai-mode-indicator` 显示运行时来源：智谱 / 本地 / 本地·降级（`view.runtimeAiMode` / `view.aiModel` 为契约向后兼容扩展字段）。
- 设置弹窗新增「测试智谱连接」按钮（调 `/api/ai/test`，显示模型与耗时）；未配置 Key 时提示改用本地 AI。

## 动效与交互（当前阶段）

- 事件队列 `js/animation/queue.js`：按事件逐条 200ms 播放，期间 `#game-screen[aria-busy=true]`、手牌/操作栏/弹窗按钮禁用，播放完恢复。
- 动画开关：设置里的「动画」关闭时跳过队列；系统 `prefers-reduced-motion: reduce` 时也直接完成。
- 已有 CSS 动效：卡牌悬停/合法高亮过渡、弹窗进场 `dialog-in`、UNO 按钮脉冲 `uno-pulse`、AI 思考气泡 `dots`（`js/ui/players.js` 挂 `.thinking` class）。
- UNO（BUG-02）：只剩一张牌时操作栏出现显著放大的黄橙渐变「UNO!」按钮，单击立即喊出（不再弹二次确认框）；`uno-pulse` 扩散 + 轻微放大脉冲保留并加强，`prefers-reduced-motion` / 关闭动画时静止。
- 发牌/飞牌/彩带等动效已实现（`js/animation/effects.js`），随动画开关与 `prefers-reduced-motion` 降级。
- `?mock=1` 的开发工具条含「重播动画」按钮，可重放当前 mock 的 events。
- `npm run verify:ui`：无头 Chrome 自动验收（完整对局 / 动效队列 / reduced-motion / 动画关闭 / 控制台与网络 / 弹窗与 UNO / v2 品牌与圆桌 / 溢出与 10 人局等，共 117 项），报告输出到 `review-assets/ui-verify.md`。

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
- 出牌交互（BUG-06）：只通过点击手牌出牌——单击合法牌直接出；万能牌 / 多颜色动作弹出选色窗。操作栏只保留摸牌、结束回合、叠牌弃权、UNO、抓 UNO、+4 挑战、选色兜底等功能按钮，不再渲染「出 X / 出刚抽的牌 / 叠 X」按钮；手牌区上方的「你的手牌」标题与张数文字已移除。
- 状态提示（BUG-06）：`#hint-bar` 只在叠牌响应 / +4 挑战 / 选色 / UNO 窗口等特殊阶段显示必要提示，正常回合（含 AI 回合）为空且通过 `:empty` 不占高度；`settings.showHint=false` 时同样清空。
- 左上角当前颜色（BUG-03）：22px 色点（白边 + 按颜色发光）+ 18px 加粗颜色名，DOM 锚点 `#color-indicator` / `#color-label` 不变。
- 手牌排布：默认全部排开（间距 10px）；数量超出可用宽度时均匀折叠（每张至少露出 36px，仍放不下则手牌区横向滚动）；鼠标悬停/键盘聚焦时当前牌提到最上层并上浮。
- AI 台词生命周期（BUG-04）：LLM 台词写入 `speech-layer` 后按 2.6s TTL 自动消失，TTL 定时器纳入运行时 `rt.timers` 统一清理；下一次 AI 决策开始 / 新局 / 回大厅 / 退出引擎模式 / 结算时都会清空（map + 定时器 + 气泡 DOM），不长期残留；`aiChatter=false` 时不显示。
- 结算页（2026-10-18 用户要求）：**取消分数计算**，保留最终结算并改为数据图表总结操作——总览数字（回合/用时/动作/出牌/摸牌/叠牌/喊 UNO/挑战）+ 三张图表（每位玩家操作堆叠条、全体动作构成环形图、剩余手牌颜色构成堆叠条）+ 玩家结算行（仅剩余手牌缩略与张数；赢家标注「出完手牌 / 手牌最少获胜」）。所有图表数据来自 `result.players[]` 的 plays/draws/stackPlays/unoCalls/unoCaught/challenges 与全局统计，UI 不算分。
- 大厅「规则选项 · +4 挑战」勾选框随 `START_GAME.config.challengeWild4` 传入引擎；关闭后 +4 直接摸 4、不进入挑战窗口。
- 设置弹窗保存音效、动画、AI 速度和自动喊 UNO；四者在引擎模式均生效（音效由 `js/audio/sfx.js` WebAudio 实时合成）。
- 每个 AI 的台词与思考状态在 `speech-layer` 内按 `data-seat` 呈现；座位内展示头像、名字、手牌数、UNO 和最近出牌。
- 音效由 `js/audio/sfx.js` 用 WebAudio 实时合成，无外部音频文件；关闭开关后不播放。
- 战绩弹窗读取本地缓存；结算结果会写入战绩（`js/state/stats.js` 的 `recordResult`）。
