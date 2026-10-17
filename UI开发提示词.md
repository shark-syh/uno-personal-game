# UNO 前端 UI 开发提示词与契约（原生 HTML/CSS/JS）

> 版本：v1（冻结） · 配套：[开发计划.md](./开发计划.md)
> 用途：把本文档交给外部 AI（如 GPT）实现前端 UI；也可作为我这边实现引擎/对接时的契约依据。

---

## 0. 怎么用（先看这段）

### 正确的开发顺序

```
① 冻结 UI ↔ 引擎契约（本文档第 1 节，已完成）
        │
        ├──► ② UI 静态框架（GPT，mock 数据驱动）   ← 你现在要做的
        │        · 4 个屏幕 + 弹窗 + 2/4/10 人布局 + 卡面渲染
        │        · 不写游戏逻辑、不写 AI、不发网络请求
        │
        ├──► ③ 规则引擎 + 本地 AI（我这边并行做）
        │
        └──► ④ 对接（UI 换成真实引擎数据，契约不变）
                 │
                 └──► ⑤ 动效打磨（GPT + 你的动效 skills，第二阶段提示词）
```

**建议：不要先写"完整 UI 框架"再想数据怎么来。** 先按本文档契约让 GPT 用 mock 数据把静态框架做出来，同时我写引擎；等两边都好了，对接只需要把 mockView 换成引擎 `GameView`，UI 结构基本不用返工。

### 交付文件放在哪

```
apps/web/
├─ cards/            # ✅ 已就绪：54 张卡面 PNG（240×360）+ manifest.json，不要改
├─ index.html
├─ assets/           # 卡背 SVG、桌面背景（自绘）
├─ styles/*.css
├─ js/*.js
└─ README-UI.md      # 预览方式
```

### 本地预览（ES Module 不能用 file:// 直接打开）

```bash
cd apps/web
python -m http.server 8080
# 浏览器打开 http://localhost:8080
```

### 卡面资源（已就绪）

- 路径：`apps/web/cards/{faceCode}.png`，54 张，统一 240×360。
- 映射表：`apps/web/cards/manifest.json`（每个 code 的 kind/color/value/copies；54 种唯一卡面合计 108 张牌）。
- 编码规则：颜色 `B/G/R/Y` + 牌面 `0-9` / `R`=Reverse / `S`=Skip / `A2`=Draw Two；特殊 `WC`=Wild、`W4`=Wild+4。
- 卡面加载失败时，UI 必须用 CSS 兜底绘制（色块 + 牌面文字），不允许出现破图。

---

## 1. UI ↔ 引擎契约 v1（冻结，字段名不要改）

### 1.1 卡牌 Card

```js
{
  id: "R7#0",          // 全局唯一；同面值多张用 #0/#1 区分
  kind: "number",      // number | skip | reverse | draw2 | wild | wild4
  color: "red",        // red | yellow | green | blue | null（wild/wild4 为 null）
  value: 7,           // 0-9，非数字牌为 null
  faceCode: "R7"       // 对应图片 apps/web/cards/R7.png
}
```

### 1.2 GameView —— UI 的唯一数据源

引擎每次状态变化后调用 `UnoApp.render(view)`，UI **只读**这个对象，不允许从 DOM 反推状态。

```js
{
  mock: true,                        // 是否 mock 模式（显示开发工具条）
  screen: "game",                    // lobby | game | result
  phase: "await-play",               // 见 1.2.1
  config: { playerCount: 4, difficulty: "realistic", aiMode: "auto", challengeWild4: true },

  currentSeat: 0,                    // 当前行动玩家
  direction: 1,                      // 1=顺时针，-1=逆时针
  currentColor: "red",               // 当前有效颜色

  players: [                         // 座位顺序；长度 = playerCount
    {
      seat: 0, name: "你", isHuman: true, avatar: "🧑",
      handCount: 5, saidUno: false, thinking: false,
      lastPlayed: null,              // Card | null（该玩家最近打出的牌，供桌面小图标展示）
      line: "",                      // AI 最近一句台词（气泡）
      difficulty: null               // AI 难度；人类为 null
    }
  ],

  human: {                           // 当前人类玩家（座位 0）的可交互信息
    seat: 0,
    hand: [ /* Card[] 自己的手牌，按 UI 期望顺序 */ ],
    legalActions: [ /* UiAction[]，UI 只能渲染这些动作（见 1.3） */ ],
    drawnThisTurn: null,             // Card | null：本回合刚抽到的牌（需高亮）
    mustRespondStack: false,         // 是否处于叠牌响应状态
    canCallUno: false,               // 是否该点 UNO
    canCatch: [1],                   // 可以抓 UNO 的座位号列表
    pendingChallenge: null           // null | { opponentSeat: 1 }（上家出了 +4）
  },

  table: {
    discardTop: { /* Card */ },
    discardTop3: [ /* Card[] 最近 3 张，用于视觉堆叠 */ ],
    drawPileCount: 41,
    stack: null,                     // null | { total: 8, chain: [Card...], lastPlayer: 1, topColor: "green" }
    pendingColorChoice: false,       // 是否正在等人类选色
    winnerSeat: null
  },

  events: [ /* GameEvent[]，本次渲染要播放的动画事件，播放完 UI 置空 */ ],

  result: null,                      // 结算时见 1.2.2

  settings: {
    autoCallUno: false, aiSpeed: "normal", sound: true,
    animation: true, showHint: true, aiChatter: true
  },

  dev: { mockName: "normal-play" }   // 仅 mock 模式
}
```

#### 1.2.1 phase 枚举

| phase | UI 应该做什么 |
|-------|----------------|
| `lobby` | 显示大厅 |
| `dealing` | 显示发牌动画（可用 mock 简化） |
| `turn-start` / `turn-end` | 短暂过渡状态，通常立即切换 |
| `await-play` | 人类回合：手牌可出高亮 + 抽牌按钮 |
| `choose-color` | 弹出四色选择（来自 human.legalActions 中的 CHOOSE_COLOR） |
| `stack-response` | 人类需响应叠牌：可出 +2/+4 高亮 + "摸 X 张"按钮 |
| `challenge-decide` | 人类面对 +4：弹「摸 4 张 / 挑战」 |
| `uno-window` | 显示 UNO 按钮 / 抓人按钮 |
| `round-end` | 显示结算页（screen=result） |

#### 1.2.2 result 结构

```js
{
  winnerSeat: 0,          // null = 平局（牌堆耗尽且手牌最少者并列，M1-7 起支持）
  players: [
    { seat: 0, name: "你", remaining: [], score: 0 },
    { seat: 1, name: "老王", remaining: [/* Card[] */], score: 87 }
  ],
  turns: 23,
  durationMs: 184000
}
```

> M1-7 引擎 `getResult(state, { durationMs })` 额外提供（M3-2 可按需映射，不强制）：`isDraw`、`reason`（`empty-hand` / `deck-empty`）、`actions`、`draws`、`plays`、`stackPlays`、`unoCalls`。平局时结算页应显示「平局」而不是胜者。

### 1.3 UiAction —— UI 的唯一输出

UI 在 `legalActions` 里拿到的每个动作都带 `id` 和展示信息：

```js
{
  id: "play:R7#0",                 // 唯一 id（引擎生成）
  type: "PLAY_CARD",               // 见下表
  label: "出 红7",                  // 按钮/提示文案
  cardId: "R7#0",                  // 可选，关联手牌
  colorChoice: null,               // 可选，wild/wild4 的颜色
  targetSeat: null,                // 可选，抓 UNO 目标
  disabled: false,                 // 可选，UI 置灰（一般引擎不会给非法动作）
  hint: "保留万能牌"                 // 可选，提示条文字
}
```

所有动作类型：

| type | 附带字段 | 何时出现 |
|------|----------|----------|
| `START_GAME` | `config: {playerName, playerCount, difficulty, aiMode, challengeWild4}` | 大厅开始按钮（UI 自己构造） |
| `PLAY_CARD` | `cardId`, `colorChoice?` | 正常回合出牌；wild/wild4 会展开多种 colorChoice |
| `DRAW` | — | 正常回合抽牌 |
| `PLAY_DRAWN` | `cardId`, `colorChoice?` | 抽牌后可立即出抽到的那张 |
| `END_TURN` | — | 抽牌后结束回合 |
| `CHOOSE_COLOR` | `color` | 选色弹窗（打 Wild/Wild4 后） |
| `STACK_PLAY` | `cardId`, `colorChoice?` | 叠牌响应时出 +2/+4 |
| `STACK_DECLINE` | — | 叠牌响应时放弃摸累计牌 |
| `CHALLENGE_W4` | — | 面对 +4 选择挑战 |
| `DECLINE_CHALLENGE` | — | 面对 +4 接受摸 4 |
| `CALL_UNO` | — | 人类剩 1 张时喊 UNO |
| `CATCH_UNO` | `targetSeat` | 抓某个 AI 没喊 UNO |
| `RESTART` | — | 结算页再来一局 |
| `BACK_TO_LOBBY` | — | 回大厅 |

> 2026-10-17 追加：大厅新增「+4 挑战」勾选框（默认开启），`START_GAME.config` 附带 `challengeWild4` 布尔值，对接时传给引擎 `GameConfig.challengeWild4`。该字段为契约的向后兼容扩展（只增不改），其余字段与 DOM 锚点不变。

**UI 只做一件事：把动作原样交给 `onAction(action)`。** 不判断合法性、不自己算摸牌数。

### 1.4 GameEvent —— 动画队列消费

```js
{ type: "DEAL", seat: 0, count: 7 }
{ type: "PLAY", seat: 1, card: {/* Card */} }
{ type: "DRAW", seat: 1, count: 2 }                     // 不暴露具体牌
{ type: "DRAW", seat: 0, count: 1, cards: [/* Card */] } // 人类自己抽到才带 cards
{ type: "SKIP", seat: 2 }
{ type: "REVERSE" }
{ type: "COLOR_SET", seat: 0, color: "blue" }
{ type: "STACK_PUSH", seat: 1, card: {/* Card */}, total: 6 }
{ type: "STACK_RESOLVE", seat: 2, total: 10 }
{ type: "CHALLENGE_SUCCESS", challenger: 0, target: 1, hand: [/* Card[] 仅挑战者是人类时给 */] }
{ type: "CHALLENGE_FAIL", challenger: 0, target: 1, penalty: 6 }
{ type: "UNO_CALLED", seat: 1 }
{ type: "UNO_CAUGHT", seat: 1, penalty: 2 }
{ type: "PENALTY", seat: 1, count: 2, reason: "uno" }
{ type: "PILE_RESHUFFLE" }
{ type: "PLAYER_OUT", seat: 0 }
{ type: "ROUND_END", winnerSeat: 0 }    // winnerSeat 可为 null（平局，M1-7 起）
```

### 1.5 DOM 契约（集成锚点，不要改名）

```
#app
├─ [data-screen="lobby"]#lobby-screen
├─ [data-screen="game"]#game-screen
│  ├─ #top-bar
│  │  ├─ #color-indicator[data-color="red"]
│  │  ├─ #direction-indicator[data-direction="1"]
│  │  └─ #ai-mode-indicator
│  ├─ #opponents            // 每个 AI 一个子节点 [data-seat="1"]
│  ├─ #table-center
│  │  ├─ #draw-pile[data-count="41"]
│  │  ├─ #discard-pile[data-top-card="R3"]   // 内部放当前顶牌
│  │  ├─ #color-glow[data-color="red"]
│  │  └─ #stack-badge[data-total="8"]        // 无叠牌时隐藏
│  ├─ #event-feed           // 最近事件文本
│  ├─ #speech-layer         // 每个座位一个气泡 [data-seat="1"]
│  ├─ #hand[data-seat="0"]  // 子节点：[data-card-id][data-face-code]
│  ├─ #action-bar           // 子节点：button[data-action-id]
│  └─ #hint-bar
├─ [data-screen="result"]#result-screen
├─ #dialog-root             // 选色/挑战/UNO/设置/确认弹窗都挂这里
└─ #dev-toolbar             // 仅 mock 模式显示
```

### 1.6 UI 暴露的全局 API（window.UnoApp）

```js
window.UnoApp = {
  render(view),                 // 幂等全量渲染（引擎每次变化后调用）
  playEvents(events, done),     // 按顺序播放动画，完成后回调 done()
  setActionHandler(fn),         // 引擎注册回调；UI 用 fn(action) 上报人类动作
  setMockMode(enabled, name),   // 开发用：切换 mock 局面
  getMode(),                    // "mock" | "engine"
};
```

Mock 模式约定：`?mock=1` 或开发工具条开启；此时 `onAction` 默认 `console.log` + toast，不实现规则；`playEvents` 可用定时器模拟。

---

## 2. 视觉规范速查

| 项 | 值 |
|----|-----|
| 卡牌尺寸 | 基准 120×180（2:3），CSS 变量 `--card-w: 120px; --card-h: 180px` |
| 手牌重叠 | 每张露出约 48~56px；悬停放大 1.08 并上浮 |
| 色板 | 红 `#FF5555`、黄 `#FFAA00`、绿 `#55AA55`、蓝 `#5555FF`、白 `#FFF`、黑 `#000` |
| 桌面 | 深绿渐变 `#0E4D2E → #14532D` + 径向暗角；木纹/绒布质感用 CSS 渐变实现 |
| 字体 | `"Segoe UI", "Microsoft YaHei", system-ui, sans-serif` |
| 圆角/阴影 | `--radius: 12px`；卡牌 `box-shadow: 0 6px 16px rgba(0,0,0,.35)` |
| 布局 | 桌面优先 1280×800；1024×768 可用；禁止横向滚动 |
| 动效 | 第一阶段只做基础过渡（150~250ms）；复杂动画第二阶段做 |

**牌桌布局示意（4 人）**：

```
┌──────────────────────────────────────────────┐
│ 顶栏：颜色 ● 方向 ↻ AI模式 ⚙ 设置              │
│           [AI1 7张]   [AI2 5张]              │
│                                              │
│   [AI3]      ┌─────────────┐      (空位)     │
│   6张        │ 弃牌堆 抽牌堆 │                │
│              │ [顶牌][41张]  │  ← 颜色光环    │
│              └─────────────┘                 │
│        事件流 / AI 台词气泡                   │
│  ┌──────────── 你的手牌 ────────────┐         │
│  │ [R7] [GS] [B0] [WC] [Y+2]        │         │
│  └──────────────────────────────────┘         │
│  [抽牌] [UNO!] [抓他!] [摸 8 张]   ← 按 legalActions │
└──────────────────────────────────────────────┘
```

**人数布局**：2~5 人 → AI 排上方弧形；6~10 人 → 左右两列 + 上排。

---

## 3. 第一阶段提示词（复制给 GPT）

> 复制下面整个代码块内的内容（从「你是一名…」到「自检清单」结束），直接发给 GPT。

````text
你是一名资深前端工程师，擅长原生 HTML + CSS + JavaScript（ES Modules）以及卡牌游戏 UI。
请为「UNO 单机版本地网页游戏」实现第一阶段：静态 UI 框架（无游戏逻辑、无网络、无 AI），所有数据由 mock 驱动。代码要完整可运行、可直接交付。

====================
一、硬性技术约束
====================
1. 只用原生 HTML + CSS + JavaScript（ES2022，<script type="module">）。
2. 禁止 React/Vue/任何框架；禁止 npm 依赖；禁止构建工具；禁止 CDN 外链；必须离线可运行。
3. 不用 TypeScript；不用内联 style（动态样式用 CSS 变量或 element.style.setProperty）。
4. 所有资源用本地相对路径；卡面图片在 cards/{faceCode}.png。
5. 页面通过静态服务器预览（ES Module 不能用 file:// 打开），在 README-UI.md 写清 `python -m http.server` 预览方法。
6. 桌面浏览器（Chrome/Edge）优先；1280×800 最佳，1024×768 可用，禁止横向滚动。
7. 可访问性：按钮有 aria-label；弹窗打开时焦点进入、Esc 关闭、关闭后焦点归还；键盘可操作；尊重 prefers-reduced-motion。
8. 不使用任何外部图标库/字体；图标用内联 SVG 或 emoji。

====================
二、项目与文件结构（严格按此交付）
====================
apps/web/
├─ index.html
├─ README-UI.md
├─ assets/card-back.svg            # 自己画一个 UNO 风格卡背
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
├─ js/animation/queue.js           # 第一阶段：空实现或简单过渡
├─ js/mock/mockView.js             # 10 种 mock 局面 + 切换
├─ js/state/settings.js            # localStorage：uno:settings
└─ js/state/stats.js               # localStorage：uno:stats
cards/ 目录已存在（54 张卡面 + manifest.json），不要改动。

====================
三、视觉规范
====================
- 色板：红 #FF5555、黄 #FFAA00、绿 #55AA55、蓝 #5555FF、白 #FFFFFF、黑 #000000。
- 桌面：深绿渐变（#0E4D2E → #14532D）+ 径向暗角；卡牌白色圆角描边 + 阴影。
- 卡牌 2:3，基准 120×180；手牌重叠排列（每张露出约 52px），悬停放大上浮，不可出牌压暗。
- 字体："Segoe UI", "Microsoft YaHei", system-ui, sans-serif。
- 风格：现代、干净、经典 UNO 感；主视觉就是卡面颜色，不要花哨背景。
- 移动端不做（P2），但要保证 1024 宽不错位。

====================
四、必须实现的屏幕与弹窗
====================
A) 大厅 [data-screen="lobby"]
   - 标题「UNO 单机版」+ 副标题
   - 玩家名输入（默认「你」）
   - 对战人数 2~10（按钮组或滑杆，默认 4）
   - AI 难度 4 档：休闲 / 简单 / 真实 / 骨灰级（默认「真实」）
   - AI 模式：智谱 / 本地 / 自动（默认「自动」）
   - 开始游戏主按钮 → onAction({ type:"START_GAME", config:{...} })
   - 设置按钮（打开设置弹窗）、战绩按钮（占位弹窗）
B) 牌桌 [data-screen="game"]
   - 顶栏：当前颜色指示、方向指示（↻/↺）、AI 模式、设置、退出
   - AI 玩家区：2~10 人自适应布局（2~5 人上方弧形；6~10 人左右列 + 上排）；每个座位显示头像、名字、手牌数、UNO 标记、「思考中…」气泡、最近台词、最近出的牌
   - 中央：抽牌堆（显示剩余张数）、弃牌堆（显示顶牌图片）、当前颜色光环、叠牌累计徽标（如「+8」）、方向指示
   - 事件流：最近 3 条中文事件（如「老王打出 蓝3」「你摸了 2 张」）
   - 人类手牌区：横向重叠排列；合法牌高亮可点、非法牌压暗；刚抽到的牌要标记
   - 操作栏 #action-bar：只渲染 view.human.legalActions 里的按钮；wild/wild4 点击后弹出四色选择（选项来自同一 cardId 的 legalActions）
   - 提示条 #hint-bar：显示当前要做什么（如「上家出了 +4，选择摸 4 张或挑战」）
C) 结算 [data-screen="result"]
   - 胜者、各玩家剩余手牌缩略、趣味分数、回合数、用时
   - 按钮：再来一局（RESTART）、回大厅（BACK_TO_LOBBY）
D) 弹窗层 #dialog-root
   - 选色（四色按钮 + 键盘 1-4）
   - +4 挑战（「摸 4 张」/「挑战！查看手牌」）
   - UNO 喊牌（大按钮脉冲）
   - 抓 UNO（「抓他！」）
   - 设置（音效/动画/AI 速度/自动喊 UNO 开关，本地 localStorage 保存）
   - 确认（退出对局）
E) 开发工具条 #dev-toolbar（仅 mock 模式显示）
   - 下拉切换 10 种 mock 局面，加「重播动画」按钮

====================
五、数据契约（必须严格遵守）
====================
【卡牌 Card】
{ id:"R7#0", kind:"number", color:"red", value:7, faceCode:"R7" }
kind: number | skip | reverse | draw2 | wild | wild4；color: red|yellow|green|blue|null；value: 0-9|null。

【GameView —— UI 唯一数据源】
{
  mock:true, screen:"game", phase:"await-play",
  config:{ playerCount:4, difficulty:"realistic", aiMode:"auto" },
  currentSeat:0, direction:1, currentColor:"red",
  players:[{ seat:0, name:"你", isHuman:true, avatar:"🧑", handCount:5, saidUno:false,
             thinking:false, lastPlayed:null, line:"", difficulty:null }],
  human:{ seat:0, hand:[Card...], legalActions:[UiAction...], drawnThisTurn:null,
          mustRespondStack:false, canCallUno:false, canCatch:[], pendingChallenge:null },
  table:{ discardTop:Card, discardTop3:[Card...], drawPileCount:41,
          stack:null, pendingColorChoice:false, winnerSeat:null },
  events:[GameEvent...],
  result:null,
  settings:{ autoCallUno:false, aiSpeed:"normal", sound:true, animation:true, showHint:true, aiChatter:true },
  dev:{ mockName:"normal-play" }
}
phase 枚举：lobby | dealing | turn-start | await-play | choose-color | stack-response | challenge-decide | uno-window | turn-end | round-end
result 结构：{ winnerSeat（null=平局）, players:[{seat,name,remaining:[Card],score}], turns, durationMs }

【UiAction —— UI 唯一输出】
{ id:"play:R7#0", type:"PLAY_CARD", label:"出 红7", cardId:"R7#0",
  colorChoice:null, targetSeat:null, disabled:false, hint:"" }
type: START_GAME | PLAY_CARD | DRAW | PLAY_DRAWN | END_TURN | CHOOSE_COLOR |
      STACK_PLAY | STACK_DECLINE | CHALLENGE_W4 | DECLINE_CHALLENGE |
      CALL_UNO | CATCH_UNO | RESTART | BACK_TO_LOBBY
STACK_DECLINE 的 label 里要体现要摸几张（如「摸 8 张」），数据在 table.stack.total。

【GameEvent —— 动画队列】
{ type:"PLAY", seat:1, card:Card }
{ type:"DRAW", seat:1, count:2 } / { type:"DRAW", seat:0, count:1, cards:[Card] }
{ type:"DEAL", seat:0, count:7 }
{ type:"SKIP", seat:2 } / { type:"REVERSE" }
{ type:"COLOR_SET", seat:0, color:"blue" }
{ type:"STACK_PUSH", seat:1, card:Card, total:6 } / { type:"STACK_RESOLVE", seat:2, total:10 }
{ type:"CHALLENGE_SUCCESS", challenger:0, target:1, hand:[Card] }
{ type:"CHALLENGE_FAIL", challenger:0, target:1, penalty:6 }
{ type:"UNO_CALLED", seat:1 } / { type:"UNO_CAUGHT", seat:1, penalty:2 }
{ type:"PENALTY", seat:1, count:2, reason:"uno" }
{ type:"PILE_RESHUFFLE" } / { type:"PLAYER_OUT", seat:0 } / { type:"ROUND_END", winnerSeat:0（null=平局） }

【全局 API】window.UnoApp = {
  render(view), playEvents(events, done), setActionHandler(fn),
  setMockMode(enabled, name), getMode()
}
所有人类操作必须通过动作处理器发出（默认 console.log + toast），不要在 UI 里实现规则。

【DOM 契约（集成锚点，不要改名）】
#app > [data-screen="lobby"]#lobby-screen / [data-screen="game"]#game-screen / [data-screen="result"]#result-screen
牌桌内：#top-bar（#color-indicator[data-color]、#direction-indicator[data-direction]、#ai-mode-indicator）、#opponents（子节点[data-seat]）、#table-center（#draw-pile[data-count]、#discard-pile[data-top-card]、#color-glow[data-color]、#stack-badge[data-total]）、#event-feed、#speech-layer、#hand[data-seat="0"]（子节点[data-card-id][data-face-code]）、#action-bar（button[data-action-id]）、#hint-bar、#dialog-root、#dev-toolbar

====================
六、mock 数据要求（js/mock/mockView.js）
====================
必须内置以下 10 种局面，开发工具条可切换（URL 加 ?mock=1 也可开启）：
1. lobby（大厅）
2. normal-play（4 人，人类回合，手牌 5 张，R7 可出）
3. ai-thinking（AI 回合，人类无操作，展示「思考中…」气泡）
4. stack-response（叠牌累计 8 张，人类可叠或摸 8）
5. wild-color-picker（人类打 Wild 需选色）
6. challenge-decide（上家出 +4，人类选择摸 4 或挑战）
7. uno-window（人类剩 1 张，UNO 大按钮）
8. catch-uno（某 AI 忘喊 UNO，人类可抓）
9. result（结算页数据）
10. ten-players（10 人布局 + AI 回合）
外加 2-players（2 人布局）可放在 normal-play 的切换里。
mock 卡牌数据直接按契约构造（不需要 108 张完整牌堆，手牌/弃牌堆够展示即可）。
卡面文件名必须与 faceCode 对应（如 R7 → cards/R7.png）。

====================
七、交互与动效（第一阶段）
====================
- 基础过渡：按钮 hover/active、卡牌 hover 上浮、手牌出牌 150ms 飞向弃牌堆（可用简单位移）、弹窗淡入、UNO 按钮脉冲。
- 动画统一走 js/animation/queue.js 的 playEvents(events, done)（第一阶段可简单实现：逐条 setTimeout 200ms 后 done）。
- 动画期间设置 aria-busy="true" 并禁用操作栏；尊重 prefers-reduced-motion（直接跳过动画）。
- 不做复杂粒子/彩带（第二阶段再做）。

====================
八、输出要求
====================
- 按文件逐个输出完整代码（不要省略、不要用「...」占位）。
- 如果单次回复过长，按以下批次输出并在每批结尾注明「本批完成，下一批：xxx」：
  批次1：tokens.css、layout.css、cards.css、components.css、animations.css
  批次2：index.html、mockView.js、settings.js、stats.js
  批次3：app.js、render.js、lobby.js、table.js、hand.js、players.js、hud.js
  批次4：dialogs.js、result.js、devToolbar.js、queue.js、README-UI.md
- 最后给出自检清单（见下）逐项确认。

====================
九、自检清单（交付前自己核对）
====================
1. 所有文件路径与第二节一致；无外部网络请求、无 CDN。
2. 10 种 mock 局面都能正常渲染、切换；?mock=1 可用。
3. 2 人/4 人/10 人布局都不重叠、不横向滚动（1024~1920 宽）。
4. 手牌可出/不可出状态清晰；wild/wild4 弹出四色选择。
5. 叠牌、+4 挑战、UNO、抓人、结算弹窗都能展示。
6. 卡面图片正确加载（R7/W4/WC 等），缺失时 CSS 兜底。
7. 整个 UI 无游戏规则逻辑，所有操作只调用动作处理器。
8. 浏览器控制台无报错；无 JS 全局变量泄漏（除 window.UnoApp）。
9. README-UI.md 写清预览方式与 mock 切换方式。
````

---

## 4. 第二阶段提示词：动效打磨（框架完成后用，可结合你的动效 skills）

> 等第一阶段 UI 能跑、且我这边引擎也基本可用时，再发这段。**这个阶段才允许使用你的动效技能**；仍然禁止引入任何运行时依赖/构建工具。

````text
在现有 UNO UI 代码基础上做第二阶段：动效打磨。不要改动数据契约、DOM 契约、文件结构；只增强动画与手感。

技术约束：
- 只用 CSS Transitions/Keyframes + Web Animations API；禁止引入动画库/CDN/构建工具。
- 只动画 transform 和 opacity（避免布局抖动）；10 人布局下保持 60fps。
- 所有动画由 js/animation/queue.js 的 playEvents(events, done) 串行驱动：逐条事件播放，全部完成后再调用 done()。
- 尊重 prefers-reduced-motion：检测到时跳过动画、直接 done()。
- 动画期间 #game-screen[aria-busy="true"]，操作栏禁用。

必须实现的事件动画（每条 150~450ms）：
1. DEAL：每个玩家方向逐张飞入（错峰 40ms）。
2. PLAY：牌从出牌者位置/人类手牌飞向弃牌堆，落定后翻转显示；同时手牌区用 FLIP 平滑补位。
3. DRAW：抽牌堆飞向目标玩家手牌区；DRAW 带 cards 时逐张展示。
4. SKIP：被跳过玩家座位抖动 + 出现「跳过」徽标。
5. REVERSE：中央方向箭头 180° 旋转 + 轻微缩放。
6. COLOR_SET：颜色光环颜色渐变脉冲（300ms）。
7. STACK_PUSH：叠牌徽标数字跳动增大 + 叠牌链卡片轻微抖动。
8. STACK_RESOLVE：一次性向目标玩家飞入 total 张牌（每张 60ms 错峰）。
9. CHALLENGE_SUCCESS：翻开被挑战者手牌 3D flip（仅人类可见手牌内容），然后飞入 4 张罚牌。
10. CHALLENGE_FAIL：挑战者手牌抖动 + 飞入 6 张罚牌 + 红色闪烁一次。
11. UNO_CALLED：中央「UNO!」横幅弹出（350ms）+ 该玩家座位高亮。
12. UNO_CAUGHT：被抓玩家手牌抖动 + 飞入 2 张罚牌 + 「抓到了!」提示。
13. PLAYER_OUT：该玩家座位变灰 + 金色光效。
14. ROUND_END：切到结算页，卡牌淡入 + 轻量 CSS 彩带（不超过 30 个元素）。
15. PILE_RESHUFFLE：抽牌堆做一次洗牌抖动。

另外：
- mock 工具条加「重播动画」按钮（重放当前 mock 的 events）。
- 动画时长可在 settings.js 里设置 normal/fast 两档。
- 交付时更新 README-UI.md，说明动画文件与如何调试（?mock=1&slow=1 放慢动画）。

自检：reduced-motion 下无动画且功能正常；10 人局动画期间不卡顿；无控制台报错。
````

---

## 5. 第三阶段提示词：接入真实引擎（等引擎完成后用）

```text
现在把 UI 从 mock 模式切换到真实引擎模式，不要改动现有 DOM 结构与视觉。
1. 删除/保留 mock 数据均可，但 engine 模式下不再使用 mockView。
2. 页面启动后创建引擎对局：从大厅 START_GAME 的 config 调用引擎 createGame(config)。
3. 引擎状态变化 → 调用 window.UnoApp.render(view)（view 由引擎 getView 提供，字段与契约一致）。
4. 用户操作 → window.UnoApp.setActionHandler(fn) 注册的回调 → 引擎 applyAction → 新 view + events → render + playEvents。
5. AI 回合：引擎产出动作后，先调用 /api/ai/decide（若启用）再 applyAction；失败自动本地兜底（这部分由引擎侧实现，UI 只负责调用 window.UnoBridge 暴露的接口）。
6. 保持 ?mock=1 仍可用（回归测试用）。
7. 验收：完整打完一局（含叠牌、挑战、UNO 抓人），浏览器无报错。
```

> 具体桥接代码由我在引擎完成后提供（`js/app.js` 只改启动部分），届时会给出精确的接入 diff。

---

## 6. UI 框架验收清单（第一阶段完成后逐项核对）

- [ ] `cd apps/web && python -m http.server 8080` 打开即见大厅，无报错。
- [ ] 大厅可设置人数 2~10、四档难度、AI 模式，点开始进入牌桌。
- [ ] 牌桌 2 / 4 / 10 人三种布局均正常，1024~1920 宽度无横向滚动、无元素重叠。
- [ ] 卡面图片正确显示（试 R7、W4、WC、YA2），加载失败时有 CSS 兜底。
- [ ] 10 种 mock 局面都能通过工具条切换并正常渲染。
- [ ] 人类手牌：可出高亮、不可出压暗、抽到的牌有标记、悬停放大。
- [ ] wild/wild4 弹出四色选择；叠牌响应显示「摸 X 张」；+4 挑战弹窗正确。
- [ ] UNO 按钮 / 抓他按钮能显示（mock 下点击有 console.log + toast）。
- [ ] 结算页数据完整，再来一局/回大厅可点击。
- [ ] 键盘操作可用（Tab 聚焦、Esc 关弹窗、数字键选色）；焦点管理正确。
- [ ] 无外部网络请求；无框架/构建依赖；window 上只有 UnoApp 一个全局对象。
- [ ] README-UI.md 含预览方法、文件说明、mock 切换方式。

---

## 7. 与开发计划的对应关系

| 本文档 | 开发计划.md 对应 |
|--------|------------------|
| UI 契约 / 文件结构 | 5.2、5.4（已按原生 JS 修订） |
| 视觉规范 | 7.1、7.2、5.7 |
| 动效清单 | 5.8、附录 D（事件类型） |
| 验收清单 | 9.4 人工验收（UI 部分）、M3 验收 |
| 对接方式 | 5.3、5.5、M4 |
