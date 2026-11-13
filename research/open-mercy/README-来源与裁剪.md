# open-mercy 参考仓库：来源、许可与裁剪说明

> 归档时间：2026-11-13 · 用途：为「基础 / 进阶 / 友尽」三模式中的**友尽模式**提供规则依据与卡面。
> 本目录是第三方资料，**不参与构建、不被 `apps/web` 引用**；B 版卡面按用户决定用于本人个人学习，见 §6 权限申明。

## 1. 来源与下载

- 上游：`https://github.com/alii13/open-mercy`（原名 `Uno-no-mercy`，2026 年改名为 Open Mercy），MIT License，Copyright (c) 2026 alii13。
- 下载方式：`https://ghfast.top/https://github.com/alii13/open-mercy/archive/refs/heads/main.zip`（国内镜像）。
  `ghproxy.net` 首个镜像下载中途截断（8,477,726 B 且 ZIP 无中央目录），已弃用；`ghfast.top` / `gh-proxy.com` 均可用。
- 完整原始包备份：`research/open-mercy-main.zip`（21,755,199 B，745 个条目，ZIP 校验通过），需要其它文件时可从这里还原。
- 本目录为裁剪后的资料集：先保留 81 个文件 / 15,178,309 B，后从备份补提取 `cards-webp/` 68 个四色 webp / 2,751,166 B，另加 2 份自建说明与预览；临时完整解压目录已清理。

## 2. 保留了什么

| 路径 | 内容 | 用途 |
| --- | --- | --- |
| `RULES-REFERENCE.md` | 官方 No Mercy 规则参考长文（含标准 UNO 对照、逐条卡牌效果与示例） | **友尽模式规则权威依据** |
| `shared/engine/` | 纯 TypeScript 规则引擎：`types.ts` / `deck.ts` / `rules.ts` / `engine.ts` / `bot.ts` / `botSearch.ts` / `playout.ts` / `sim.ts` + 测试 | 规则实现、自对弈与 AI 参考 |
| `frontend/src/utils/cardGenerator/` | `index.ts` + `assets/cardImages.ts` / `svgCardMapping.ts` / `icons.ts` + `helpers/colorUtils.ts` | 卡面映射逻辑参考 |
| `cards/` | 12 张 PNG（官方卡面实物照片/扫描） | 卡面设计参考 |
| `cards-svgs/` | 20 个 SVG（官方卡面矢量描摹，单个 60~756 KB） | B 版矢量源，个人学习采用 |
| `cards-webp/` | **68 个四色 webp**（2,751,166 B，从备份包提取） | **友尽模式完整唯一卡面，可拼 168 张牌堆** |
| `cards-images/` | 12 张 PNG 渲染图 | 卡面设计参考 |
| `frontend/public/rules/` | 规则说明静态页（含卡面页） | 文案与牌面说明参考 |
| `docs/design-guidelines.md` | 上游视觉/设计规范 | 风格参考 |
| `LICENSE` / `README.md` / `CONTRIBUTING.md` | 许可与项目说明 | 合规核对 |

未保留：Vue 前端主体、`game-server`、`mobile`（Flutter）、`supabase*`、`.github`、宣传视频与运营文档等与本项目无关的全栈代码。

## 3. 能不能直接用 / 轻微改写

### 规则：有，且可复用程度高

- **可以直接用**：`RULES-REFERENCE.md`（规则本身不受版权保护，文件开头亦明确声明）；`deck.ts` 的 168 张牌组构成表（注释标明 Mattel HWV18 盒装，无普通 Wild）；`rules.ts` 里 `getDrawValue` / `checkMercyRule` / `rotateHands` / `calculateScore` / `reshuffleDeck` 等纯函数，改个类型名即可。
- **需要移植，不算轻微改写**：`engine.ts` 主体。上游是「可变 `EngineState` + host 驱动 + 9 个 `TurnState`」，本项目是「纯函数 `applyAction` + `structuredClone` + `GameView` 事件 + 按座位脱敏」，状态模型、事件协议、阶段机都不同，只能照着规则与边界条件重写到 `packages/game-core`。
- 值得借鉴的边界处理：轮盘抽牌直到指定颜色（Wild 不计）、全弃后选择哪张压顶、开局翻到功能牌的处理、7 换手 / 0 传手方向、25 张淘汰后「最后幸存者」胜利、`STACKING_RESPONSE` 阶段。
- **本仓库不含 UNO Flip 规则**：`CardType` 只有 number/skip/reverse/draw2/skipEveryone/discardAll/wild/draw4/draw6/draw10/wildReverseDraw4/wildColorRoulette，没有 flip / light side / dark side / draw five / wild draw color。进阶模式必须另按 Mattel 官方 UNO Flip 说明书实现，见 `docs/三模式升级-Flip模式开发方案.md`。

### 卡面：B 版按用户决定**直接采用（仅个人非商业学习）**

- 事实核对：`cards/` 是官方 Mattel 卡牌实物照片（可见划痕）；`cards-svgs/` 是官方卡面矢量描摹（20 个文件共 5,489,747 B，`<text>` 元素 0 个、每个 27~984 条路径）；`cardImages.ts` 注释写明 "Uses the actual UNO No Mercy SVG card files"；上游 README 声称 "art and trade dress are our own" 与文件本身矛盾，其 `LICENSE`（MIT）只授权 "this software and associated documentation files"，**不构成对卡面美术与商标的授权**。
- 用户 2026-11-13 决定：**直接使用 B 版（矢量描摹及其四色渲染），仅本人个人学习、不涉任何商业活动，在文件末尾申明权限即可**。据此本目录卡面不再是「仅参考」，但使用范围严格受 §6 约束，且**不得随安装包 / Release 公开分发**。
- `cardGenerator` 并非 README 所称「程序化自绘」，实际只是查表返回资源 URL；`svgCardMapping.ts` import 的是 `@/assets/cards-webp/*.webp?url`（四色齐全），`cards-svgs/` 只是单色参考源。
- 项目红线不变：`apps/web/cards/*.png` 与 `assets/card-back.svg` 保持原样，基础模式 54 张 CC0 卡面零改动；友尽模式卡面走新增目录，不覆盖基础素材。

## 4. 与本项目现有素材对照

- 现有基础版卡面：`research/cards/`（54 张原始）→ `apps/web/cards/`（54 张 240×360 运行时 PNG + manifest），来源 `github.com/celsiusnarhwal/uno`（CC0 / public domain，切自 Wikimedia Commons `UNO_cards_deck.svg`）。
- 上游 MIT 与本项目的 CC0 素材是两套独立授权，不要混用；本项目 `research/README.md` 已补记 MIT 出处与采用口径。
- 三模式卡面划分：基础 = 现有 CC0；友尽 = B 版 68 唯一面；进阶 Flip = **B 版不含，需另做第三套**（见 §5）。

## 5. B 版覆盖核查（2026-11-13 实跑）

`cards-webp/` 68 个文件逐项分类：数字牌 0~9 × 4 色 = 40（7 为 `seven-swap`，0 带传手符号）；彩色功能牌 `two-draw` / `four-draw` / `skip` / `reverse` / `skip-everyone` / `discard-all` × 4 色 = 24；万能牌 `wild-draw-six` / `wild-ten-draw` / `wild-reverse-four-draw` / `wild-roulette` = 4。合计 68 唯一面，按份数复制为官方 168 张。

**结论：B 版 100% 是友尽版卡面，0 张 Flip 专属牌。** Flip 缺失 `draw-one`(+1)、`wild-draw-two`、`draw-five`(+5)、`wild-draw-color`、`flip` 牌、普通 Wild 与暗面四色（粉/青/橙/紫）；名义可借的数字 1~9 / Skip / Reverse / 全员跳过也存在语义或配色差异（Flip 无 0；轮盘是下家选色、Flip 是出牌者选色）。因此先做 Flip 模式，第一项工作就是补第三套卡面。

`card-gallery.html` 并排展示 A 实物 / B 矢量描摹 / B+ 四色 webp / C 现有 CC0，便于肉眼比对。

## 6. 使用决定与权限申明

1. **使用者与用途**：本项目作者本人，仅用于个人学习、研究与非商业演示；**不用于任何商业活动**，不对外提供 UNO 游戏服务，不单独售卖、转授权或声称拥有上述卡面素材。
2. **素材来源**：A / B / B+ 组卡面取自开源仓库 alii13/open-mercy（MIT，Copyright (c) 2026 alii13）的 `cards/`、`cards-svgs/`、`frontend/src/assets/cards-webp/`；该仓库规则引擎、规则参考与文档按 MIT 使用。C 组为项目原有 CC0 / public domain 素材。
3. **权利归属**：UNO® 与 UNO Show 'Em No Mercy® 为 Mattel, Inc. 的注册商标；卡面美术、图形、符号与 trade dress 的著作权及商标权归 Mattel 或原权利人所有。上游 MIT 许可证仅覆盖软件与文档文件，**不构成对上述美术与商标的授权**；B 组矢量描摹属复制性演绎，本项目不主张任何原创权利，也不将其标注为「开源卡面」。
4. **独立性**：本项目为个人独立学习项目，与 Mattel 无关联，未获其授权、背书或赞助。
5. **分发限制**：上述官方卡面仅供本地个人使用，**不随安装包（exe）、GitHub Release 或任何公开分发渠道外传**；若日后需要公开分发，改用项目自有 CC0 基础卡面或完全自绘素材，并在发布前重新评估商标与版权风险。项目根 README 的「请勿用于商业用途或对外提供 UNO 游戏服务」口径继续有效。
6. 同一申明同步置于 `card-gallery.html` 页脚与 `docs/三模式升级-Flip模式开发方案.md` 末尾。
