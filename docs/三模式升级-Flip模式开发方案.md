# 三模式升级 · Flip（进阶）模式开发方案

> 状态：📝 **方案已写，后续考虑 / 暂缓**（2026-11-13）。
> **顺序调整（2026-11-13）**：用户决定**先做友尽版，Flip 版后续考虑**。友尽规则契约与开发依据见 [`三模式升级-友尽模式规则契约.md`](./三模式升级-友尽模式规则契约.md)；本方案保留作后续参考，暂不排期。
> 按 [`开发约定.md`](./开发约定.md) §5，须用户明确说「开始 F1」后才写实现代码；批准时按 §7 **先 commit 上一阶段成果 + 打 tag，再开工，不 push**。纯方案与文档类工作不受「开始 Mx」限制，故本文件先行落盘。

## 0. 范围与决策

- 目标：基础（classic）/ 进阶（flip）/ 友尽（mercy）**三模式可切换**，操作逻辑相同（点手牌出牌、摸牌、选颜色），规则与卡牌效果不同。
- **两种新模式分开做**：本方案只排 Flip（建议编号 F1~F5）；友尽另起模块，共用同一 `mode` 配置位、左下角切换器与卡面资源基址机制，不重复开发 UI。
- 用户已拍板：B 版官方卡面矢量描摹（open-mercy 的 `cards-svgs/` 与其四色 `cards-webp/`）**直接采用，仅个人非商业学习使用，末尾附权限申明**。完整申明见 [`../research/open-mercy/README-来源与裁剪.md`](../research/open-mercy/README-来源与裁剪.md) §6 与 [`card-gallery.html`](../research/open-mercy/card-gallery.html) 页脚。
- 三模式卡面资产划分（**需确认**）：
  | 模式 | 牌堆 | 卡面来源 | 现状 |
  | --- | --- | --- | --- |
  | 基础 classic | 108 张 | 现有 `apps/web/cards/*.png`（CC0，54 唯一面） | 现成，红线保护不得修改 |
  | 进阶 flip | 112 张双面 | **待做**：新增第三套卡面 | B 版无 Flip 牌，见 §1 |
  | 友尽 mercy | 168 张 | B 版 `cards-webp/` 68 唯一面 | 现成，已提取到 `research/open-mercy/cards-webp/` |

## 1. B 版卡面覆盖核查（2026-11-13 实跑）

从完整备份 `research/open-mercy-main.zip` 提取 `frontend/src/assets/cards-webp/` 共 **68 个 webp / 2,751,166 B**，逐文件分类：

| 类别 | 文件 | 数量 | 对应友尽版牌型 |
| --- | --- | --- | --- |
| 数字牌 | `zero/two/three/four/five/six/eight/nine` + `seven-swap` / `one` × 4 色 | 40 | 0~9；7 带换手、0 带传手符号 |
| 彩色功能牌 | `two-draw` / `four-draw` / `skip` / `reverse` / `skip-everyone` / `discard-all` × 4 色 | 24 | +2 / +4 / Skip / Reverse / 全员跳过 / 全弃 |
| 万能牌 | `wild-draw-six` / `wild-ten-draw` / `wild-reverse-four-draw` / `wild-roulette` | 4 | +6 / +10 / 反转+4 / 颜色轮盘 |

`svgCardMapping.ts` 注释为 "Maps all 168 UNO No Mercy cards"，68 唯一面按份数复制即 168 张。

**结论：B 版 100% 是友尽版卡面，0 张 Flip 专属牌。**

- Flip 缺失且必须另做：`draw-one`（+1）、`wild-draw-two`（Wild +2）、`draw-five`（+5）、`wild-draw-color`（抽到指定色）、`flip`（翻面牌，明暗面各一套）、**普通 Wild**、以及暗面四色（粉 / 青 / 橙 / 紫）。
- 名义可借但语义/配色不对：数字 1~9（Flip 无 0，且 B 版 7 带换手箭头）、`skip` / `reverse` / `skip-everyone`（Flip 暗面也有全员跳过）、`wild-roulette`（Flip 是**出牌者**指定颜色，轮盘是**下家**选色，规则不同）。
- 因此「先做 Flip」的第一个现实工作是**补第三套卡面**：建议「现有 CC0 基础卡面 + 显示层叠加自绘徽记/换色」，或新增 `apps/web/cards-flip/` 完全自绘 SVG，两条路都不改现有 54 张 PNG（红线）。

## 2. 左下角模式切换（新增 UI 契约）

**位置与锚点**：在 `#app` 内新增独立节点 `#mode-switch`（**DOM 锚点只增不改**，不改 `window.UnoApp` 五个 API），三档分段控件 `基础 / 进阶 / 友尽`，固定左下角 `left: max(16px, env(safe-area-inset-left)); bottom: max(16px, env(safe-area-inset-bottom))`。**用户 2026-11-14 反馈拍板：只在大厅屏显示，进入对局 / 结算屏立即隐藏**（原先固定浮层会压住手牌区）；**同日二次拍板：整体放大（宽 184~300px、档位 ≥64×52px），作废原 ≤184px 口径**。

**现有左下角环境（已核对 `apps/web/index.html` 与 `styles/layout.css`）**：
- 左栏 `.phase-rail` 是 TURN 数据列；`#event-feed` 在牌桌底部**居中**（`left:50%; bottom:4px`，宽 min(560px,80%)）；`#hand-zone.player-zone` 占满底宽；`.toast-region` 固定**右下角**。
- 冲突规避：控件靠最左、宽度小、不压 `#event-feed` 居中区；不与右下 toast 冲突；`z-index` 低于 `#dialog-root`/toast、高于牌桌；≤760 断点降级为图标或收进设置面板，避免与手牌坞抢一屏高度。**九档断点断言需实跑**（1480/1440/1200/1080/1000/760/420 + 1366×657 / 1024×600）。

**状态与数据流**：
```
#mode-switch 点击 → UiAction { type:'SET_MODE', mode }
  → localStorage('uno:mode') 持久化（与 uno:settings 同源）
  → lobby.js 的 START_GAME.config 带 mode
  → 单机 engineMode.js:531~576 normalizeGameConfig 透传
  → 联机 rooms.ts:277~299 buildGameState 透传（当前只用默认配置，必须补）
  → packages/game-core GameConfig.mode
  → GameView 顶层 mode / mercy（M3 已落地；side 属 Flip 后续，PublicConfig 四字段未改）
```
- **生效时机**：与现有「规则设置只对新开对局生效」一致——**模式只在大厅选、只对新开对局生效**；对局 / 结算屏隐藏控件，不存在中途切换，不破坏联机权威状态（`syncModeSwitch()` 按 `view.screen` 设 `root.hidden`）。
- **联机**：房主选模式，房间开局时广播；服务端 `rooms.ts` 必须把 mode 写进 `GameState`，否则联机永远跑默认基础版。
- **UI 硬规定（用户 2026-11-14 拍板覆盖原「建议直角」）**：标签做高级质感，**圆角一律用连续曲率 squircle**（`apps/web/assets/squircle.svg` 遮罩 + `mask-size: 100% 100%`），禁止任何 `border-radius` 普通圆弧；外层负责定位与 `drop-shadow`（含荧光），用 `inset` 描边代替会被裁掉的 `border`。触控目标 ≥44px、Tab/Enter 可达、`reduced-motion` 下新增装饰无动画名。
- **M4（2026-11-14）落地 + 同日两次按用户反馈改版**：`#mode-switch` 为 `#app` 内独立节点，三档各 ≥44px（改版后 ≥64×52px）、Flip 禁用标暂缓；**仅大厅显示，对局 / 结算屏隐藏**；状态用独立 key `uno:mode`（未混进 `uno:settings`）；单机 `START_GAME.config.mode` / `RESTART`、联机 `start-game.mode` 三处透传。**视觉终版（同日二次拍板）：无底板悬浮**——surface 不铺背景 / 描边 / 遮罩，整组靠父容器 `drop-shadow`（投影 + 荧光）浮起；**滑动指示器**——绝对定位荧光 squircle 荧块 `.mode-switch__indicator` 垫在档位下方，`--indicator-x/--indicator-w` 由 JS 按选中档位 `offsetLeft/offsetWidth` 测量写入，切换时 `transform` 平滑滑动（resize / 字体加载会重测）；档位透明、选中文字变深色。九档断点 `verify:ui` 208/208 未回退。

## 3. Flip 规则契约摘要

- **牌堆 112 张双面**（Mattel 官方 GDR44 / unoflip.com 说明书）：
  - 明面白框：红黄蓝绿，1~9 各色 2 张（**无 0**）；`Draw One` / `Reverse` / `Skip` / `Flip` 各色 2 张；`Wild` 4 张；`Wild Draw Two` 4 张。
  - 暗面黑框：粉 / 青 / 橙 / 紫，1~9 各色 2 张；`Draw Five` / `Reverse` / `Skip Everyone` / `Flip` 各色 2 张；`Wild` 4 张；`Wild Draw Color` 4 张。
- **核心机制**：打出 Flip 时，弃牌堆、抽牌堆、全体手牌**全部翻面**，颜色与功能牌整套切换；下一张 Flip 翻回。翻面是自动状态变化，玩家操作不变（仍是点牌 / 摸牌 / 选颜色），符合「操作逻辑相同」。
- **效果**：+1 / +5 令下家抽牌并跳过；全员跳过令其他人全部跳过、自己再来一回合；Wild Draw Color 由**出牌者**指定颜色，下家一直抽到该色（Wild 不计）并跳过。
- **限制与质疑**：`Wild Draw Two` 与 `Wild Draw Color` 仅在手里没有当前颜色牌时可出，可被质疑；质疑成立出牌者自己受罚，失败被罚者多抽 2 张。可复用现有 `wild4Legality` / `challengeWild4` 分支。
- **计分**：官方按当局所在面计分，先到 500 分胜。

**与项目红线的四处冲突（开工前必须拍板）**：
1. §4 红线 4「结算无算分」vs Flip 官方 500 分制 → 建议**单局胜负**（沿用项目结算页，不加计分），否则要破红线。
2. §4 红线 1「主动摸牌逐张、摸到可出为止」vs Flip 官方只摸 1 张 → 建议沿用项目统一手感（操作逻辑相同），在规则契约里标注与官方差异。
3. 官方桌游罚牌**不叠加** vs《一起优诺》手游 +2 / +5 可叠；项目当前 `stacking='loose'` → 建议 Flip 模式独立设 `stacking='none'` 或按官方，不影响基础模式。
4. 对手手牌背面：物理 Flip 能看到对手暗面牌，数字版建议**不展示**（保持现有「只见卡背数量」与联机脱敏），需确认。

## 4. 分阶段计划（F1~F5，每阶段做完即停）

| 阶段 | 产出 | 主要文件 | 验收 |
| --- | --- | --- | --- |
| **F1 契约与数据层** | 定稿本方案口径；`GameConfig` 加 `mode: classic\|flip\|mercy`；`Card` 加双面 `side`/`faceCode` 对；`createDeck(config)` 参数化三套牌表；`Color` 扩暗面四色 | `packages/game-core/src/types.ts` / `config.ts` / `deck.ts` / `setup.ts` | 单元测试：三模式牌堆分别 108 / 112（双面）/ 168 张，基础模式 108 断言不变 |
| **F2 引擎效果** | `playCard()` 效果 switch 按 `mode` 分发；`isPlayable()` 按当前面判定；+1 / +5 / 全员跳过 / 抽到指定色 / Flip 全桌翻面；质疑分支复用 | `packages/game-core/src/engine.ts` / `legal.ts` | selfplay 700 局非法 0；翻面后手牌总数守恒、颜色映射正确 |
| **F3 视图与协议** | `GameView` 暴露 `mode` / `side`；新增翻面事件；颜色选择器支持暗面四色；`PublicConfig` 加字段；联机按座位脱敏并透传 mode | `public-view.ts` / `apps/server/src/net/rooms.ts` / `onlineMode.js` | `verify:online` 44/44 不回退；两客户端同步翻面 |
| **F4 卡面与左下角切换** | 新增 `apps/web/cards-flip/` + manifest；按 mode 切 `faceCode` 资源基址（`hand.js` 已有间接层）；`#mode-switch` 落地；明暗面视觉与翻面动效 | `apps/web/index.html`（只增锚点）/ 新 `styles/mode-switch.css` / 新 `js/ui/modeSwitch.js` / `lobby.js` / `engineMode.js` / `hand.js` | `verify:ui` 208/208 不回退 + 新增三模式切换/九档断点断言；数据卡直角、squircle/reduced-motion/触控 44px 全过 |
| **F5 回归与归档** | 全量回归，更新台账与 CHANGELOG | `docs/开发进度.md` / `CHANGELOG.md` | lint/typecheck 0、`npm test` 334/335 不恶化、`verify:ui` 208+、44/44、FCP/FPS 不回退 |

**前置条件**：F1 必须先解除 [`接口与架构.md`](./接口与架构.md) §1 与 [`开发总档.md`](./开发总档.md) §5 的 v2 硬边界「不改 `packages/game-core`」，否则 F1/F2/F3 无法落地。

## 5. 权限申明

本方案涉及的 B 版官方卡面（`research/open-mercy/cards-svgs/`、`cards-webp/`、`cards/`）仅用于**作者本人个人学习、研究与非商业演示**，不用于任何商业活动、不对外提供 UNO 游戏服务。UNO® 与 UNO Show 'Em No Mercy® 为 Mattel, Inc. 注册商标，卡面美术、图形、符号与 trade dress 的权利归 Mattel 或原权利人；上游 MIT 许可证只覆盖软件与文档，不构成对美术/商标的授权，矢量描摹属复制性演绎，本项目不主张原创权利、不标注为开源卡面、与 Mattel 无关联。上述官方卡面**不随 exe 安装包、GitHub Release 或任何公开分发渠道外传**；如需公开分发，改用项目自有 CC0 基础卡面或自绘素材并重新评估风险。完整申明见 [`../research/open-mercy/README-来源与裁剪.md`](../research/open-mercy/README-来源与裁剪.md) §6。
