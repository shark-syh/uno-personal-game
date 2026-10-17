# 给 Codex 的提示词（UI 第一阶段：静态框架）

> 用法：把下面横线以下的全部内容整段粘贴到 Codex（在当前仓库 `C:\Users\hw\Desktop\uno` 下运行）。
> Codex 会自动读取 `.docs/UI开发提示词.md` 和 `.docs/开发计划.md`，然后按契约把 UI 框架写进 `apps/web/`。

---

你是本项目「UNO 单机版本地网页游戏」的前端工程师 Agent。请直接在当前仓库中完成**前端第一阶段：静态 UI 框架（mock 数据驱动）**，并把代码写入文件。这不是完整游戏，不是规则引擎，不是 AI 接入。

## 0. 先读这些文件（按顺序，必须读）

1. `.docs/UI开发提示词.md`
   - 第 0 节：开发顺序与文件放置
   - 第 1 节：UI ↔ 引擎契约（GameView / UiAction / GameEvent / DOM 锚点 / `window.UnoApp` API）← **必须严格遵守，字段名一个都不能改**
   - 第 2 节：视觉规范
   - 第 3 节：第一阶段提示词（把里面的要求当作你的实现清单）
   - 第 6 节：验收清单
2. `.docs/开发计划.md` 的 4.12（规则决策表）、5.2（目录结构）、5.4（前端架构）、7（UI/UX）、9.4（人工验收）
3. `apps/web/cards/manifest.json`（54 张卡面映射：faceCode / kind / color / value / copies）

## 1. 项目定位（重要，防止越界）

- 整个项目分阶段：规则引擎 + 本地 AI（Lead 并行开发中）→ **前端 UI 框架（你现在做）** → 对接 → 动效打磨（第二阶段）。
- 你的产物必须严格按契约实现：后续引擎会调用 `window.UnoApp.render(view)`、通过 `setActionHandler(fn)` 接收人类动作、调用 `playEvents(events, done)` 播放动画。所以**你不能改契约字段名、DOM 锚点、文件路径**，也不要自己发明数据结构。
- 你只做「纯渲染层 + mock 数据」：不实现发牌 / 合法性判断 / 叠牌累计 / UNO 判定 / 回合推进；所有按钮点击只把动作交给动作处理器（mock 模式下 `console.log` + toast 即可）。

## 2. 写权限边界（严格遵守）

- 只能新建/修改 `apps/web/` 下的文件。
- **不要修改**：`apps/web/cards/`（图片与 manifest.json）、`.docs/开发计划.md`、`.docs/UI开发提示词.md`、`research/`、`scripts/`、`packages/`、`apps/server/`、根目录 `package.json`（不存在也不要创建）。
- 不要运行 `npm install`，不要安装任何依赖，不要初始化 git。
- 可以创建 `apps/web/README-UI.md`，记录预览方式、mock 切换方式、你的实现假设。

## 3. 技术约束（硬性，逐条遵守）

1. 只用原生 HTML + CSS + JavaScript（ES2022，`<script type="module">`）。
2. 禁止 React/Vue/任何框架；禁止 npm 依赖；禁止构建工具；禁止 CDN/外链；必须离线可运行。
3. 不用 TypeScript；不用内联 style（动态样式用 CSS 变量或 `style.setProperty`）；不用内联事件属性（如 `onclick=`）。
4. 所有资源本地相对路径；卡面 `cards/{faceCode}.png`；加载失败时用 CSS 兜底绘制（色块 + 文字），不能出现破图。
5. 中文界面；字体 `"Segoe UI", "Microsoft YaHei", system-ui, sans-serif`。
6. 桌面优先 1280×800；1024×768 可用；不允许横向滚动；目标浏览器 Chrome/Edge 最新版。
7. 可访问性：按钮/弹窗有 `aria-label` 与 `aria-live`；弹窗 focus trap、Esc 关闭、关闭后焦点归还；键盘可操作（Tab 聚焦、数字键 1~4 选色）；尊重 `prefers-reduced-motion`。
8. 第一阶段只做基础过渡（150~250ms：按钮 hover/active、卡牌 hover 上浮、弹窗淡入、UNO 按钮脉冲）；**不做**复杂飞牌/粒子/彩带（第二阶段才做）；**不要引入动画库**。

## 4. 交付文件（严格按此结构，路径不要改）

```
apps/web/
├─ index.html
├─ README-UI.md
├─ assets/card-back.svg            # 自绘 UNO 风格卡背
├─ styles/tokens.css               # CSS 变量：色板/尺寸/间距/层级/阴影
├─ styles/layout.css               # 页面骨架、牌桌布局、响应式
├─ styles/cards.css                # 卡牌、手牌扇形、牌堆
├─ styles/components.css           # 按钮/弹窗/HUD/气泡/工具条
├─ styles/animations.css           # 基础过渡与 keyframes
├─ js/app.js                       # 入口：mock 启动、render 分发、动作处理
├─ js/ui/render.js                 # render(view)：按区域渲染
├─ js/ui/lobby.js
├─ js/ui/table.js
├─ js/ui/hand.js
├─ js/ui/players.js
├─ js/ui/hud.js
├─ js/ui/dialogs.js
├─ js/ui/result.js
├─ js/ui/devToolbar.js
├─ js/animation/queue.js           # 第一阶段：简单实现 playEvents(events, done)
├─ js/mock/mockView.js             # 10 种 mock 局面 + 切换
├─ js/state/settings.js            # localStorage：uno:settings
└─ js/state/stats.js               # localStorage：uno:stats
```

`apps/web/cards/` 已存在（54 张卡面 + manifest.json），**不要改动**。

## 5. 功能清单

A) 大厅 `[data-screen="lobby"]`
- 标题「UNO 单机版」+ 副标题（个人练习项目，非官方）
- 玩家名输入（默认「你」）
- 对战人数 2~10（按钮组或滑杆，默认 4）
- AI 难度 4 档：休闲 / 简单 / 真实 / 骨灰级（默认「真实」）
- AI 模式：智谱 / 本地 / 自动（默认「自动」）
- 「开始游戏」主按钮 → `onAction({ type:"START_GAME", config:{...} })`（mock 下切到 game 局面）
- 设置按钮（打开设置弹窗）、战绩按钮（占位弹窗）

B) 牌桌 `[data-screen="game"]`
- 顶栏：当前颜色、方向（↻/↺）、AI 模式、设置、退出
- AI 玩家区：2~10 人自适应布局（2~5 人上方弧形；6~10 人左右列 + 上排）；每个座位显示头像、名字、手牌数、UNO 标记、「思考中…」气泡、最近台词、最近出的牌
- 中央：抽牌堆（显示剩余张数）、弃牌堆（显示顶牌图片）、当前颜色光环、叠牌累计徽标（如「+8」）、方向指示
- 事件流：最近 3 条中文事件（如「老王打出 蓝3」「你摸了 2 张」）
- 人类手牌区：横向重叠排列；合法牌高亮、非法牌压暗；刚抽到的牌有标记；悬停放大上浮
- 操作栏 `#action-bar`：只渲染 `view.human.legalActions` 里的按钮；wild/wild4 点击后弹出四色选择（选项来自同一 `cardId` 的 legalActions）
- 提示条 `#hint-bar`：显示当前要做什么（如「上家出了 +4，选择摸 4 张或挑战」）

C) 结算 `[data-screen="result"]`
- 胜者、各玩家剩余手牌缩略、趣味分数、回合数、用时
- 按钮：再来一局（`RESTART`）、回大厅（`BACK_TO_LOBBY`）

D) 弹窗层 `#dialog-root`
- 选色（四色按钮 + 数字键 1~4）
- +4 挑战（「摸 4 张」/「挑战！查看手牌」）
- UNO 喊牌（大按钮脉冲）
- 抓 UNO（「抓他！」）
- 设置（音效/动画/AI 速度/自动喊 UNO 开关，localStorage 保存）
- 确认（退出对局）

E) 开发工具条 `#dev-toolbar`（仅 mock 模式显示）
- 下拉切换 10 种 mock 局面 + 「重播动画」按钮
- `?mock=1` 或工具条开启 mock 模式

mock 局面（`js/mock/mockView.js` 内置，必须齐全）：
`lobby`、`normal-play`（4 人人类回合）、`ai-thinking`、`stack-response`（累计 8 张）、`wild-color-picker`、`challenge-decide`、`uno-window`、`catch-uno`、`result`、`ten-players`（10 人布局），另加 `two-players`（2 人布局）可放在 normal-play 变体里。
mock 卡牌数据按契约构造即可，不需要 108 张完整牌堆。

## 6. 自检与验证（每批完成后必须运行，如实报告结果）

1. JS 语法检查（Node 26 会自动识别 ESM 语法）：
   ```powershell
   Get-ChildItem -Recurse -Filter *.js apps/web | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { throw "syntax error: $($_.FullName)" } }
   ```
2. 外链检查（SVG 的 `xmlns` 和 README 里的 localhost 不算）：
   ```powershell
   Select-String -Path apps\web\*.html,apps\web\styles\*.css,apps\web\js\**\*.js -Pattern '(src|href)="https?://|url\(https?://' 
   ```
   应无结果。
3. 静态托管冒烟（在 `apps/web` 目录）：
   ```bash
   python -m http.server 8080
   ```
   用 curl 验证 `/`、`/cards/R7.png`、`/styles/tokens.css` 都返回 200。
4. 检查 `index.html` 引用的所有 css/js 文件都存在；检查 `manifest.json` 里 54 个 code 对应的 `cards/{code}.png` 都存在。
5. 不要声称做过视觉/交互验收（人类会做），只报告你**实际验证过**的内容。

## 7. 明确不要做（防止越界）

- 不写任何游戏规则逻辑（发牌、合法动作、叠牌累计、UNO 判定、胜负结算）——这些属于规则引擎。
- 不写 AI / LLM / 网络请求 / API Key / 后端代码。
- 不做第二阶段复杂动效；不引入任何第三方库。
- 不改契约字段名 / DOM 锚点 / 文件路径；不修改 `cards/`；不改计划文档。
- 不做移动端深度适配、多语言、账号、存档后端。
- 不要把全部代码一次性贴在聊天里——直接写文件。

## 8. 工作方式

1. 读完文件后，先列实现 todo（建议 4 批：CSS → `index.html` + `mockView` + `state` → `app/render/table/hand/players/hud/lobby` → `dialogs/result/devToolbar/queue/README`）。
2. 逐批写文件，每批结束运行第 6 节自检。
3. 契约没有定义到的细节（例如设置弹窗具体排版），按最小实现自行决定，并记录到 `README-UI.md` 的「实现假设」清单，不要擅自改契约。
4. 最终回复内容：完成文件列表、预览命令、10 种 mock 局面的自检结果、未完成/风险项、等待人工验收项。

## 9. 验收标准

逐项对照 `.docs/UI开发提示词.md` 第 6 节验收清单（12 项），在最终回复中逐条报告是否满足；未满足的写明原因和下一步。
