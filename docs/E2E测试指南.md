# E2E 测试指南（verify:ui / verify:online / verify:desktop）

> 自 M7-01 起，`npm run verify:ui` 是单机正式 E2E 回归套件；M9-04 起新增 `npm run verify:online` 覆盖联机双客户端；M10-06 起新增 `npm run verify:desktop` 覆盖双 Electron 实例。
> 三者都不引入 Playwright 等第三方依赖：直接用无头 Chrome/Edge（桌面套件为 Electron）+ CDP（DevTools 协议）+ Node 原生 WebSocket 实现，脚本分别是 [`scripts/verify-ui.mjs`](../scripts/verify-ui.mjs)、[`scripts/verify-online.mjs`](../scripts/verify-online.mjs) 与 [`scripts/verify-desktop.mjs`](../scripts/verify-desktop.mjs)。

## 1. 覆盖范围（约 5 分钟 / 107 项）

| # | 章节 | 覆盖内容 |
| --- | --- | --- |
| 1 | 默认入口 | 引擎模式默认开启、大厅可用 |
| 2 | 完整对局 | `?test=1` 快速模式打完 **3 局真实对局**（4 人），含开局卡面加载、事件序列、结算、再来一局、回大厅 |
| 2b | 多人布局 | 6 / 10 人真实对局布局与轮转（1440 / 1024 宽） |
| 3 | AI 思考与台词 | 「思考中」气泡、智谱在线台词（**mock**，不消耗额度）、模式指示器 |
| 3b | 智谱降级 | 拦截 `/api/ai/decide` 返回 429 → 自动降级「本地·降级」+ toast |
| 4 | 动画机制 | 事件队列串行播放、输入锁、动画关闭 / reduced-motion 降级 |
| 4a | 事件动效（M6-01） | 飞牌 / 横幅 / 动效层清理、结算彩带完整飘落 |
| 4b | 音效（M6-02） | WebAudio 合成、开关、音量、autoplay 解锁（`data-audio` 观测） |
| 4b/4c | 规则设置（M5-06） | 设置页 4 项规则保存与生效、挑战手牌展示（M5-01） |
| 5 | mock 弹窗回归 | UNO 按钮尺寸 / 单击即喊 / uno-pulse / **UNO 窗口倒计时条**、抓 UNO 确认弹窗、+4 挑战弹窗动画、牌堆边界提示 |
| 5b | 响应式（M6-05） | 760 宽布局、减少动态效果回归 |
| 5c | 对手手牌（M13/M2） | 4/5/6/10/12 张分档、`data-overflow` 与「+N」溢出徽标（`aria-hidden`）、≥10 张 `is-full`、22×33 卡背、`lastPlayed` 共存、1024/760/420 响应式与文字不遮挡 |
| 6 | 质量红线 | 控制台 0 error、网络全部同源且无 4xx/5xx、卡面加载无失败、无横向溢出、隐藏信息不外泄 |

产物：

- 报告：`review-assets/ui-m32-verify.md`（人读）+ `ui-m32-verify.json`（机器读，含逐项结果与事件统计）
- 截图：`review-assets/ui-m32-*.png`

## 2. 本地运行

前置：

1. 本地服务已启动：`npm run dev`（或 `启动服务.bat`），<http://localhost:3000> 可访问；
2. 本机装有 Chrome 或 Edge（脚本按固定路径查找，见下表）；
3. 调试端口 **9333** 空闲（同时只能跑一个实例）。

```bash
npm run verify:ui
```

### 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `UNO_BASE_URL` | `http://localhost:3000` | 被测服务地址 |
| `UNO_DEBUG_PORT` | `9333` | Chrome 远程调试端口 |
| `CHROME_PATH` | 自动查找 | Chrome/Edge 可执行文件完整路径（路径不在默认查找列表时必填） |

Windows 下的查找顺序：`CHROME_PATH` → Program Files 下 Chrome (x64/x86) → Edge (x86/x64)。

### 常见问题

| 现象 | 处理 |
| --- | --- |
| `未找到 Chrome/Edge` | 设置 `CHROME_PATH` 指向浏览器可执行文件 |
| `EADDRINUSE`（9333） | 上一次实例未退出或端口被占：等几秒重试，或改 `UNO_DEBUG_PORT` |
| 用例超时 / 对局提前结束 | 脚本已处理「结算页直接回大厅」分支；若手改了引擎/AI，先 `npm run build:web-engine` 再跑 |
| 改了 `apps/web` 静态资源 | 浏览器缓存无关（无头实例独立 profile），但需确认服务已重启加载新文件 |

## 2b. 联机双客户端验收（verify:online）

前置与 `verify:ui` 相同，但使用调试端口 **9334**（可与单机套件并行），默认输出 38 项结果到控制台（UNO 窗口未触发时只跑 34 项，套件会失败）：

- 单机隐藏表情入口；双客户端创建/加入房间；
- 双方座位框按视角座位渲染（不显示自己、名字/牌数正确、视口内且不压手牌）；
- M13：双方对手卡背按手牌数显示、22×33、不压名字/张数；
- M2：双视角对手卡背 `data-overflow` = max(0, handCount−5)、>5 张渲染「+N」徽标（`.opponent-hand-overflow`，`aria-hidden="true"`）、卡背层不泄露牌面（无 `img`/`.card`/`[data-face-code]`，子节点仅卡背与徽标）、≥10 张 `.opponent-hand.is-full` 与 handCount 一致；
- 大厅与对局表情广播、发送者提示、气泡位置；连发 5 条进入 2 秒冷却并恢复；
- 自动对局最多 3 局，直到 UNO 窗口出现，断言窗口主人只看到「UNO!」、其他座位只看到「抓他」；
- M10-05：对局中房主离开，断言服务端把房主移交给下一位在线玩家，且新房主收到「你成为新房主」提示；
- 两端控制台 0 error/exception。

```bash
npm run verify:online
```

环境变量：`UNO_BASE_URL`、`UNO_DEBUG_PORT`（默认 9334）、`CHROME_PATH`。

## 2c. 双 Electron 实例验收（verify:desktop）

前置：`npm run desktop:build`（脚本在缺少 `dist/main.cjs` 时会自动构建）；在**可交互的 Windows 桌面会话**运行；UDP 41234 未被独占。

```bash
npm run verify:desktop
```

覆盖：

- 两个 Electron 实例使用不同 `--user-data-dir`，调试端口默认 9351 / 9352；
- A 创建房间；B 的「附近房间」出现 A（UDP），失败时自动改用手动 `IP:端口` 兜底；
- B 房间面板显示「已连接主机 IP:端口」，`sessionStorage` 的 `uno:online.host` 指向 A；
- 开局后双方渲染手牌并自动推进若干步；
- A 关闭窗口后，B 收到 `server-closing` 并回到单机大厅；
- 主机退出前两端控制台 0 error/exception。

环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `UNO_DESKTOP_DEBUG_A` / `UNO_DESKTOP_DEBUG_B` | 9351 / 9352 | 两个实例的调试端口 |
| `UNO_REQUIRE_DESKTOP` | 未设置 | `1` 时 GUI 无法启动记为失败；默认输出 SKIP 并退出 0 |

本机沙箱（DSH）无法启动 Electron GUI（进程以 `0x80000003` 退出），套件会明确输出 SKIP；这**不代表通过**，需在真机桌面会话复跑。`verify:desktop` 与 `verify:ui` / `verify:online` 互不依赖。

## 3. CI 浏览器验收

[`ci.yml`](../.github/workflows/ci.yml) 的 `browser-acceptance` job（ubuntu-latest，Node 22）：

1. `npm ci` → 后台 `npm start` 起服务并轮询 `/api/health`；
2. 以 `CHROME_PATH=/usr/bin/google-chrome` 跑 `npm run verify:ui`（GitHub 托管 Runner 预装 Chrome，**无需真实智谱 Key**——在线场景是 mock 的）；
3. 无论成败，上传报告与截图为 artifact `ui-verify-report`（保留 14 天）。

触发条件与 `quality` job 相同：push 到 `main` 与所有 PR。

## 4. 如何扩展检查

- 每项断言调用 `check(name, ok, detail)`，自动汇入报告与退出码（有失败 → 退出码 1）；
- 人类回合推进用脚本内的 `autoStep`（优先点 `#hand .card.is-legal`），等待人类就绪用 `!busy && humanReady()`，不要写死手牌张数；
- 纯 UI 场景优先用 `?mock=1` 的 mock 局面（`selectMock(...)`），避免真实对局的随机性；
- 新增对局行为相关断言时，参考 §2/§4 现有写法：等事件队列空闲（`window.__verify.busy()`）再读 DOM；
- 新增设置项 / DOM 锚点后，同步本指南第 1 节的覆盖表。

## 5. 已知限制

- 真实对局中「人类挑战 AI」「AI 忘喊 UNO」是概率事件，相关 UI（挑战手牌展示、抓人按钮）走 mock 局面验证；窗口边界由引擎单测覆盖。
- 智谱「在线成功」是拦截网络请求的 mock（不消耗真实额度）；真实连通性用 `npm run smoke:ai`（需 Key）。
- 全程无头，不含真机触屏验收；移动端仅 760 宽断点回归。
- 本机沙箱（DSH）下需把 `TEMP` 指到工作区 `logs/tmp`，否则 esbuild/vitest 写系统临时目录会被拒；用户本机不受影响。
- `verify:desktop` 依赖真实 Electron GUI 与 UDP 本机回环：沙箱只能 SKIP；UDP 广播被防火墙/AP 隔离拦截时脚本会走手动地址兜底，因此「附近房间」一项失败不阻断后续断言。
- `verify:desktop` 关闭 A 时用 `window.close()` 触发正常退出路径（`server-closing`）；强杀进程不覆盖。
