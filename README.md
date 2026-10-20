# UNO 单机版 · 本地网页游戏

![Node](https://img.shields.io/badge/Node-%E2%89%A5%2022-3c873a)
![Tests](https://img.shields.io/badge/tests-303%20passed-brightgreen)
![E2E](https://img.shields.io/badge/browser--checks-103%20passed-blue)
![AI](https://img.shields.io/badge/AI-%E6%99%BA%E8%B0%B1%20%2B%20%E6%9C%AC%E5%9C%B0-8a2be2)
[![CI](https://github.com/shark-syh/uno-personal-game/actions/workflows/ci.yml/badge.svg)](https://github.com/shark-syh/uno-personal-game/actions/workflows/ci.yml)
![Version](https://img.shields.io/badge/version-v1.1-blue)
![Status](https://img.shields.io/badge/M0%7EM8-%E5%B7%B2%E5%AE%8C%E6%88%90-informational)

> 一张牌桌，108 张牌，一个你，和 2~9 个 AI。
>
> 不用登录，不用联网，也没有分数——只有下一张牌，和谁先喊出那句 UNO。

这是一个可以在本地浏览器里安静打完一局的 UNO。它没有复杂的启动流程：`npm install`，`npm run dev`，然后打开 `http://localhost:3000`。剩下的事，交给洗牌和 AI。

它也不是一个「演示」：完整规则引擎、四档本地 AI、可选的大模型决策、6~10 人牌桌、动效与音效、设置与战绩，都在这里。断网时，本地 AI 仍然会认真出牌；接入智谱之后，牌友会多一层「思考」，偶尔还会说一句台词。

规则大体照着原版，但有几处按手感做了取舍。它们被写进文档、做成了设置项，也都有测试兜底——下文会慢慢讲到。

**当前版本：v1.1**（2026-10-20，局域网联机版）· 仓库：<https://github.com/shark-syh/uno-personal-game> · 变更摘要见 [CHANGELOG.md](CHANGELOG.md)。

<p align="center">
  <img src="docs/images/game-4p.webp" width="900" alt="4 人对局">
</p>

<p align="center"><em>一局 4 人对局的牌桌：左边是 AI，中间是牌堆，下方是你的手牌。</em></p>

**目录**：[一局是怎样的](#一局是怎样的) · [牌友](#牌友四档-ai-与智谱) · [规则](#让牌局有性格的规则) · [胜利之后](#胜利之后) · [动效与音效](#动效音效与设置) · [多人与小屏](#多人与小屏) · [局域网联机](#局域网联机) · [快速开始](#快速开始) · [智谱配置](#ai-模式与智谱配置) · [命令](#常用命令) · [架构](#技术架构) · [FAQ](#常见问题) · [版本](#版本与更新) · [免责声明](#免责声明)

## 一局是怎样的

从大厅开始。选人数，选难度，决定 AI 是「智谱」「本地」还是「自动」，再决定要不要打开 +4 挑战。点下「开始游戏」，发牌动画从牌堆飞向每个座位，然后轮到牌桌上的某一个人。

<p align="center">
  <img src="docs/images/lobby.webp" width="760" alt="游戏大厅">
</p>

<p align="center"><em>大厅：人数、难度、AI 模式、+4 挑战，都从这里开始。</em></p>

轮到你的时候，可出的牌会亮起来。点一下手牌就是出牌；没有能出的牌，就点「摸牌」。摸牌不是摸一张就停——你会一直摸，直到摸到一张能打的牌为止，中途摸到的牌都留在手里。这个改动让牌局变长了，但也让「摸到能打的那张」多了一点小小的期待。

出完牌后，AI 会短暂思考。接入智谱后，它们偶尔会留下一句话，台词只停 2.6 秒，随后消失；轮到下一位时，上一位的话不会再留在桌上。牌堆、颜色、方向、UNO 窗口、叠牌累计数，都在属于它们的位置上。

一局结束得很快，也可能很慢。有人出完手牌，或者牌堆见底，游戏就停。没有下一关，也没有必须完成的日常。想再来一局，点一下就行。

## 牌友：四档 AI 与智谱

<img align="right" width="420" src="docs/images/ai-thinking.webp" alt="AI 思考中">

AI 不是陪练，也不是一个只会「能出就出」的脚本。它们分四档：休闲、简单、真实、骨灰级。档位会改变记牌、留牌、叠牌、挑战与抓 UNO 的选择，也会改变「思考」的时长。同一手牌，交给不同档位的 AI，得到的下一步可能完全不同。

本地 AI 完全离线。它生成候选、给牌打分、记住已经出现过的牌，然后从合法动作里挑一个——通常只需要几毫秒。没有网络、没有 Key、没有额度，它也能把一局牌打完。

<p align="center">
  <img src="docs/images/ai-line.webp" width="760" alt="AI 台词">
</p>

<p align="center"><em>在线模式下，AI 会在思考后留一句话，但不会让上一句台词留在桌上。</em></p>

接入智谱之后，流程多了一步：把公开信息和自己的手牌整理成候选，交给模型选择，再回到本地校验。模型选错了、超时了、额度用完了，都自动降级回本地 AI——牌局不会因此停下。真实/骨灰级每个回合都尝试在线决策，休闲与简单则按比例参与。

在线决策会慢一些：思考型模型单次大约 3~4 秒。为此，下一步的请求会在上一步动画播放时提前发出；动画结束，回答往往已经在路上。状态栏悬停可以看到最近一次决策的模型与耗时。想要即时响应，把 AI 切成「本地」即可。

## 让牌局有性格的规则

<img align="left" width="440" src="docs/images/challenge-hand.webp" alt="挑战查看手牌">

这个项目最核心的差异是**宽松叠牌**：+2 可以压 +2，+4 可以压 +2，反过来也可以。叠牌链累计的摸牌数会一直长下去，直到有人选择放弃，然后把那一摞数字一次性摸走。颜色规则在叠牌阶段被暂时放下，胜负常常因此翻转。

另一处是 **+4 挑战**。被 +4 指向的人可以选择摸 4 张，也可以挑战查看对方手牌。人类挑战 AI 时，对方的手牌会完整展示 2.6 秒；AI 挑战人类时，只留一句「XX 查看了你的手牌」。这不只是为了公平，也让「他到底有没有赖」变成一个可以看、可以赌的瞬间。

如果你在 2 人桌上打开「2 人特殊规则」，Reverse 会变成 Skip，Skip 和动作牌会带来连动——刚出完牌的人可能立刻又轮到自己。这个开关可以关掉，关掉后就回到多人桌的轮转方式。

其余规则差异都放在一张表里，方便快速对照：

| 项目 | 本作默认 | 说明 |
| --- | --- | --- |
| 叠牌 | **宽松叠牌** | +2 / +4 可任意互叠（不看颜色），累计摸牌；叠牌链中的 +4 不开放挑战 |
| 主动摸牌 | **摸到能打出的牌为止** | 一次摸牌可能摸多张，过程牌进手牌；停下的牌只能打出或结束回合（官方为摸 1 张） |
| 起手动作牌 | 照常生效 | 可切「忽略动作牌，继续翻牌」 |
| 牌堆耗尽 | 洗回弃牌堆 | 可切「耗尽即结束（手牌最少者胜）」，并列最少为平局 |
| +4 判定 | 经典口径 | 手上有当前颜色牌时出 +4 属违规；「Wild 也算匹配」保留为引擎配置 |
| 2 人规则 | 开启 | Reverse 等同 Skip、连动；可关闭 |
| UNO 罚牌 | 2 张 | 设置页可选 1/2/3 张 |
| +4 挑战 | 开启 | 大厅可关闭；关闭后 +4 直接摸 4 张 |
| 计分 | **无分数** | 结算页只展示最终结算与操作统计图表 |

完整规则规格见 [`docs/开发计划.md`](docs/开发计划.md) 第 4 章；规则决策表在 §4.12。

## 胜利之后

<img align="right" width="440" src="docs/images/result.webp" alt="结算页操作统计图表">

有人出完最后一张牌，屏幕会切到结算页。这里没有分数，也没有「本局得分」——这是这个项目一个刻意的决定。

我们更想让你看到这一局发生了什么：每个人出了几次牌、摸了几张、叠了几次；全体动作如何构成；大家手里剩下的牌是什么颜色。赢了，结算行会写「出完手牌」；牌堆耗尽时，则写「手牌最少获胜」。平局就是平局，没有赢家行。

图表是纯 CSS 画的，不依赖任何图表库。数字来自引擎对整局事件历史的统计，而不是 UI 自己算的。

## 动效、音效与设置

<img align="left" width="390" src="docs/images/effects.webp" alt="出牌动效">

发牌、出牌、摸牌、跳过、反转、叠牌、挑战、UNO、洗牌、结算彩带——15 类事件动效由事件队列串行播放。动效只改 `transform` 和 `opacity`，10 人桌上也不会堆出几十个同时飞行的元素；队列结束时，临时元素与定时器会被清理干净。

音效是现场合成的：16 类事件音，全部由 WebAudio 的振荡器和噪声拼出来，没有外部音频素材。浏览器不允许自动播放，所以第一次点击/按键之后才解锁声音。音效可以单独关闭，也可以调「低 / 中 / 高」三档音量。

设置页里有动画开关与「正常 / 快速」两档速度；`?slow=1` 可以把动画整体放慢，方便观察。系统开启「减少动态效果」时，动效会被跳过，但挑战时对方手牌仍然会以静态方式展示——该看到的信息不会因为动效关闭而消失。

<p align="center">
  <img src="docs/images/settings.webp" width="760" alt="设置页">
</p>

<p align="center"><em>设置页：动效、音效、AI 速度，以及 4 项规则开关。</em></p>

## 多人与小屏

<img align="right" width="420" src="docs/images/game-10p.webp" alt="10 人对局">

最多 10 个座位。人一多，牌桌就变成另一种东西：一圈头像，此起彼伏的「思考中」，还有你几乎记不过来的出牌速度。10 人真实对局在 1440 与 1024 宽度下都不会重叠、溢出；每个座位都在自己的位置上，手牌数、UNO 状态和最近出的牌都能看见。

小屏幕也能玩。760 宽度下，座位会折成网格，手牌区允许横向滚动；布局不横向溢出，操作栏仍然可用。移动端目前是基础适配，还没有做真机验收——桌面仍是主要场景。

<p align="center">
  <img src="docs/images/mobile-760.webp" width="340" alt="760 宽布局">
</p>

<p align="center"><em>760 宽度：座位折行、手牌横向滚动，功能不缺席。</em></p>

## 局域网联机

v1.1 起，牌桌可以分给同一局域网里的朋友。一台电脑开服务（双击 `启动服务.bat`，或 `npm start`），其他设备打开它打印的局域网地址（如 `http://192.168.x.x:3000`），输入 6 位房间码就坐到了同一张桌上。

进房后可以改自己的名字；房主可以给空位补上 0~9 个 AI——一个人也能先开一局。对局由服务端统一裁决：每个人只看到自己的手牌，别人摸了几张能数、但看不到牌面；掉线了会自动重连坐回原位，刷新页面也能静默恢复；实在回不来，服务端 AI 会替你顶着。一局结束，房主点「再来一局」，原班人马直接重开。

> 联机模式的 AI 固定为本地启发式（智谱在线决策暂未接入联机）；房间只存在于服务器进程内存，服务重启后需要重新开房。

## 快速开始

### 环境要求

- Windows 10/11（其他系统未验证，但 Node 部分跨平台）
- Node.js **≥ 22**（开发机 26.7）、npm ≥ 11
- 最新版 Chrome / Edge
- 联网仅在首次 `npm install` 和启用智谱 AI 时需要；本地 AI 完全离线可用

### 安装与启动

```bash
git clone https://github.com/shark-syh/uno-personal-game.git uno
cd uno
npm install

# 可选：启用智谱 AI（不配置也能玩，自动使用本地 AI）
# Windows: copy .env.example .env   macOS/Linux: cp .env.example .env
# 然后编辑 .env，填入 ZHIPU_API_KEY

npm run dev
# 打开 http://localhost:3000
```

Windows 也可以直接双击 **`启动服务.bat`**（首次运行会自动 `npm install`）。

> 修改 `apps/web` 静态资源后浏览器 `Ctrl+F5` 强刷；修改 `packages/game-core` / `packages/ai` 后必须执行 `npm run build:web-engine`（`npm run dev` 启动前会自动重建）。

## AI 模式与智谱配置

| 模式 | 行为 |
| --- | --- |
| 智谱 | AI 回合优先调用服务端代理的智谱 API（本地构造候选 → 大模型选择 → 合法性校验）；失败/超时/限流自动降级本地 AI |
| 本地 | 完全离线，启发式 AI（记牌、叠牌、挑战/诈唬策略），单次决策毫秒级 |
| 自动 | 有可用 Key 时优先智谱，否则自动使用本地 |

智谱相关环境变量（`.env`，Key 只在服务端读取，**不会**进入前端代码或网络请求）：

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `ZHIPU_API_KEY` | 智谱开放平台 API Key（[获取地址](https://bigmodel.cn/usercenter/proj-mgmt/apikeys)） | 空（仅本地 AI） |
| `ZHIPU_BASE_URL` | API Base URL | `https://open.bigmodel.cn/api/paas/v4` |
| `ZHIPU_MODEL` | 首选模型 | `glm-4.7-flash`（免费） |
| `ZHIPU_FALLBACK_MODELS` | 失败/下线时自动切换的备用模型（逗号分隔） | `glm-4.5-flash,glm-4-flash` |
| `AI_DECISION_TIMEOUT_MS` | 单次决策超时（毫秒），超时降级本地 | `6000` |
| `PORT` | 本地服务端口（页面与 API 共用） | `3000` |

> **关于智谱模式偏慢**：`glm-4.7-flash` 是思考型模型，单次决策实测约 3~4 秒（真实/骨灰级每个 AI 回合都调用，休闲 30% / 简单 60%）。本作已把智谱请求提前到上一步动画期间预取，并可在状态栏悬停查看最近模型与耗时；想要即时响应可在设置/大厅切换「本地」模式，或调低 `AI_DECISION_TIMEOUT_MS` 以更快回退。

## 设置项

设置保存在浏览器 `localStorage`（`uno:settings`），规则项仅对**之后新开**的对局生效：

- 通用：音效、音效音量、动画、动画速度（正常/快速）、AI 速度、自动喊 UNO、AI 闲聊、提示条
- 规则：2 人特殊规则、UNO 罚牌张数、牌堆耗尽策略、起始动作牌处理
- 大厅选项：对战人数、AI 难度、AI 模式、「+4 挑战」开关
- 本地战绩：仅记录对局数与胜场（`uno:stats`），不涉及任何分数

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动本地服务（开发模式，自动重建浏览器引擎包）→ <http://localhost:3000> |
| `npm start` | 启动本地服务（不监听文件变化） |
| `npm test` | 单元测试（24 文件 / 281 用例） |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint 检查 |
| `npm run build:web-engine` | 把 TS 引擎 + AI 打包成浏览器 ESM（`apps/web/js/vendor/uno-engine.js`） |
| `npm run verify:ui` | 浏览器自动验收（103 项，无头 Chrome + CDP，需服务已启动） |
| `npm run perf` | 性能检查（首屏 / 帧率 / 内存 / AI 耗时），输出 `review-assets/perf-report.md` |
| `npm run selfplay` | AI 自对弈基准（难度单调性 / 混战排名 / 非法动作数） |
| `npm run profile:ai` | 各难度 AI 打牌实测 |
| `npm run smoke:ai` | 智谱连通性冒烟（需 Key） |
| `npm run demo:turn -- --players 4 --seed m17-demo` | 命令行整局回放 |
| `npm run demo:deal -- --players 4 --seed hello` | 命令行发牌演示 |
| `npm run process:cards` | 重新处理 `research/cards` 原始卡面 |

## 测试与质量

| 项目 | 当前结果 |
| --- | --- |
| `npm test` | 24 文件 / 281 用例全部通过（引擎规则、公开视图隐藏信息、结算统计、AI 自对弈等） |
| `npm run typecheck` / `npm run lint` | 0 错误 |
| `npm run verify:ui` | 103 / 103 通过（3 局完整真实对局 + 6/10 人布局轮转 + 挑战手牌 + 抓 UNO + UNO 窗口倒计时 + 规则设置 + 动效/音效/响应式 + 控制台/网络/隐藏信息） |
| `npm run selfplay` | 700 局通过（非法动作 0、异常 0；难度胜率单调、混战排名单调） |
| `npm run perf` | 首屏 FCP 160ms / FPS 60 / 内存平稳（详见 `review-assets/perf-report.md`） |

浏览器验收报告与截图：`review-assets/ui-m32-verify.md` 与 `review-assets/ui-m32-*.png`；套件的使用、CI 浏览器验收与扩展方法见 [`docs/E2E测试指南.md`](docs/E2E测试指南.md)。

## 技术架构

```
浏览器（原生 HTML/CSS/JS，零构建）
  ├─ UI：大厅 / 牌桌 / 手牌 / 事件动画 / 结算图表（apps/web）
  ├─ engineMode：对局调度、AI 决策、UNO 窗口、台词、动效事件队列
  └─ uno-engine.js：打包后的规则引擎 + 本地 AI（ESM）
本地服务（Node/Express，apps/server）
  ├─ 静态托管前端
  └─ /api/health、/api/config、/api/ai/decide（智谱代理，Key 只在服务端）
规则与 AI（TypeScript，packages/）
  ├─ game-core：纯函数 reducer（applyAction(state, action) → { state, events }），可复现 seed
  └─ ai：候选生成 / 特征评分 / 记牌 / 四档难度 / 自对弈
```

- 引擎是 UI 的唯一数据出口：`public-view.ts` 负责隐藏信息过滤（他人手牌、牌面、+4 判定信息、挑战查看的手牌等）。
- 前端 UI 只消费 `window.UnoApp` 契约（`render` / `playEvents` / `setActionHandler` / …），事件队列串行播放动画并锁输入。
- 无数据库、无账号、无遥测；所有状态在内存与 `localStorage`。

## 目录结构

```
uno/
├─ apps/
│  ├─ web/                    # 前端（原生 HTML/CSS/JS，零构建）
│  │  ├─ js/engine/           # 引擎模式控制器（对局/AI/UNO 窗口/动效队列）
│  │  ├─ js/ui/               # 界面渲染
│  │  ├─ js/animation/        # 事件动效与队列
│  │  ├─ js/audio/            # WebAudio 合成音效
│  │  ├─ cards/               # 54 张处理后的卡面
│  │  └─ js/vendor/           # 自动生成的浏览器引擎 ESM（勿手改）
│  └─ server/                 # 本地 Express 服务（静态托管 + 智谱代理）
├─ packages/
│  ├─ game-core/              # 规则引擎（纯函数 reducer + 公开视图 + 结算）
│  └─ ai/                     # 本地启发式 AI（四档难度 + 自对弈）
├─ scripts/                   # 自对弈 / 浏览器验收 / 打包 / 卡面处理等脚本
├─ docs/                      # 项目文档与 README 截图（见 docs/README.md）
├─ review-assets/             # 浏览器验收报告与截图（verify:ui 产物）
├─ research/                  # 原始卡面素材与来源说明（见 research/README.md）
├─ .github/workflows/ci.yml   # GitHub Actions：typecheck / lint / test
├─ README.md
├─ 启动服务.bat                # Windows 双击启动
└─ package.json
```

## 版本与更新

当前版本 **v1.1.0**（2026-10-20）：M0~M8 完成 + M9-01 修复，局域网联机版发布。

- v1.1：局域网联机（房间码、改名、AI 补位、断线重连、再来一局、按座位信息隔离）、UNO 窗口按钮按座位过滤等修复；单机模式不变。
- v1.0：UNO 规则引擎、四档本地 AI、智谱混合决策与自动降级、事件动效与合成音效、规则设置页、6~10 人布局、结算操作统计（无分数）。
- 完整变更摘要见 [`CHANGELOG.md`](CHANGELOG.md)；版本通过 git tag 标注（`v1.0` / `v1.1`，已推送远端）。
- 后续计划见「已知限制与路线图」（M9 联机体验打磨与表情包互动）。

## 文档

| 文档 | 内容 |
| --- | --- |
| [`docs/开发计划.md`](docs/开发计划.md) | 需求、规则规格书、技术架构、里程碑（含 M8 本地联机）、测试计划 |
| [`docs/开发进度.md`](docs/开发进度.md) | 精炼台账：里程碑状态、红线约定与已知限制（M0~M7） |
| [`docs/开发约定.md`](docs/开发约定.md) | 开发汇报与协作约定（优先级最高） |
| [`docs/UI开发提示词.md`](docs/UI开发提示词.md) | UI ↔ 引擎契约（冻结）、视觉规范、分阶段提示词 |
| [`docs/UI验收报告.md`](docs/UI验收报告.md) | UI 各阶段验收报告 |
| [`docs/E2E测试指南.md`](docs/E2E测试指南.md) | verify:ui 浏览器 E2E 的使用、CI 与扩展 |
| [`docs/交接文档-2026-10-19.md`](docs/交接文档-2026-10-19.md) | 当前状态、红线约定、坑位与 M8 待办 |
| [`docs/README.md`](docs/README.md) | 文档索引与阅读顺序 |

## 常见问题

| 现象 | 解决 |
| --- | --- |
| 打开 <http://localhost:3000> 无页面 | 本地服务没启动：`npm run dev` 或双击 `启动服务.bat`，看到 `[uno-server] 已启动` 后刷新 |
| 提示 `EADDRINUSE` | 端口被占用：改 `.env` 的 `PORT`，或关闭占用 3000 端口的程序 |
| AI 不动 / 页面报旧版本 | `Ctrl+F5` 强刷；确认 `apps/web/js/vendor/uno-engine.js` 存在，或重新 `npm run dev` |
| 智谱模式 AI 反应慢 | 免费思考型模型单次约 3~4s；可切「本地」AI、选休闲/简单难度或调低 `AI_DECISION_TIMEOUT_MS` |
| 智谱报错 / 显示「本地·降级」 | 检查 `.env` 的 Key、网络与额度；失败会自动降级本地 AI，不影响对局 |
| 想回到纯 UI 演示模式 | 打开 `http://localhost:3000/?mock=1`（开发工具条可切换 mock 局面） |
| 刷新页面后对局消失 | 当前未实现对局快照恢复（P2），刷新会中断对局 |
| 端口 / Key 配置后不生效 | `.env` 改动需重启服务 |

## 已知限制与路线图

**已知限制**

- 单机刷新中断对局（无快照恢复）；无账号系统。联机房间在服务器内存中，服务重启即失效。
- 联机 AI 固定本地启发式（智谱在线决策未接入联机）。
- 移动端仅基础响应式（760/1024 断点），未做真机验收；桌面优先。
- 音效为 WebAudio 实时合成（无外部音频素材）；动效为 CSS/Web Animations 轻量实现。
- M6-03（AI 台词人设库）与 M6-04（战绩统计页/结算统计）按项目负责人要求未开发；结算页不含任何分数。
- `wild4Legality`（+4 判定含 Wild）未暴露到设置页，仅引擎配置与单测覆盖。
- 未附开源许可证（个人学习项目）；第三方素材来源见 `research/README.md`。

**路线图**

- M9（进行中）：联机多玩家布局对齐单机（对手框 + 摸牌牌飞向对应座位）、表情包互动、联机交互 E2E 加固。
- 可选：联机智谱在线决策、对局快照恢复、移动端适配、音效素材替换、Tauri 桌面打包（M7-06 遗留）。

## 免责声明

- 本项目为**个人非商业学习项目**，与 Mattel / UNO 官方无任何关联；UNO® 是 Mattel 的注册商标。
- 仓库内卡面素材来自 CC0 资源（见 [`research/README.md`](research/README.md)），仅用于个人学习演示；如公开传播/商用请自行评估商标与版权风险。
- 请勿将本项目用于商业用途或对外提供 UNO 游戏服务。
