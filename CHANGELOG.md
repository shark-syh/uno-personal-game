# 更新日志

> v1.0~v1.3 的逐条历史已压缩；完整原文见 git 历史与 [`docs/v1-开发归档.md`](docs/v1-开发归档.md)。当前开发阶段为 v2.0.0 UI 升级。

## 未发布

### M3 圆形牌桌与座位（2026-10-23）

- 牌桌升级为自适应椭圆桌面（`.arena` + `.arena-rail` 装饰内圈），中心固定上一手牌/颜色/行动状态；`#game-screen` 占满视口高度、中行弹性收缩，无竖向溢出。
- 对手改为贴合圆周锚点的「座位 chip」（`--seat-x/--seat-y/--seat-angle` 由 `players.js` 按视角座位计算，1~9 个对手角度表覆盖 2~10 人局）；新增 `data-relative-seat` / `data-current` / `data-uno` / `data-thinking` 状态属性，`#game-screen` 同步 `data-phase` / `data-current-seat` / `data-viewer-seat`。
- 中心新增 `#turn-stamp`（当前行动者常显）与 `#phase-label`（仅选色/叠牌/挑战/UNO 窗口等特殊阶段出现）；座位按 `--v2-seat-w/h` 缩放，420 隐藏头像与卡背、保留姓名与精确牌数。
- M13 对手卡背、`handCount`、`lastPlayed`、视角换位、联机脱敏逻辑零改动；不触碰 GameView/协议/引擎。
- 验证：`verify:ui` 117/117（新增 M3 圆桌/行动状态/10 人/420 断言与座位不压中心牌堆）、`verify:online` 30/30（新增 A/B 双视角圆桌与状态同步断言）、lint/typecheck 0；`npm test` 334/335，唯一失败为 `web-engine-bundle`（本机安全策略拦截 esbuild.exe，winapi error #5，与改动无关，引擎与 vendor 产物本次零改动）。

### M2 大厅与顶部品牌（2026-10-23）

- 品牌收敛为 `UNO Local` + 版本号（`#lobby-version` / `#game-version`，取 `/api/health.version`，失败隐藏）；删除「个人练习项目，非官方」等宣传副文案，主内容改为「v2.0.0 UI 重构与交互升级」（`#lobby-lead`）。
- 单机/联机开局按钮统一「开启对局」（`#lobby-start` / `#room-start`，文本与 aria 一致）；牌桌顶栏新增 `#game-brand`/`#brand-name`；主操作色切换 `--v2-gold`。
- 顶部无音效按钮；设置页音效开关与 `uno:settings` 存储契约不变。
- 验证：`verify:ui` 113/113（新增 6 项品牌断言：文案/版本号/Tab 顺序/旧文案清除/无音效按钮/四档宽度）。

### M13 对手手牌可视化（2026-10-23）

- 对手座位框左下角新增 1~5 张缩小卡背，按 `handCount` 显示；`0` 隐藏，`≥6` 封顶 5 张，精确数量仍看「N 张」。
- 保留右上角 `lastPlayed` 与右下角 UNO 标签；卡背 `aria-hidden`，不改变 GameView、服务端或 WebSocket 协议。
- 1024 保持 22×33；760 缩为 18×27；420 隐藏卡背。当前回合卡背堆静态上移 2px。
- 验证：`verify:ui` 107/107、`verify:online` 26/26、`npm test` 335 用例、lint/typecheck 0。

## v1.3.0（2026-10-21）

桌面安装版（M10 全部模块代码完成）。

- **桌面壳与安装包**：Electron 内嵌随机端口 HTTP/WS、单实例、独立 userData；自建 `installer.nsi` 产出 `UNO-Setup-1.3.0.exe`（当前用户安装、快捷方式、静默安装/卸载、保留 userData）。
- **智谱自填 Key**：设置页桌面专属区域，经窄 IPC 存入 `safeStorage`/DPAPI；自填 > `.env`，IPC 不回传明文。
- **UDP 发现**：`41234` 广播/监听（2 秒广播、7 秒 TTL、协议校验）；附近房间、房间码匹配、手动 `IP:端口` 兜底；`joined.host` 支持重连。
- **远程异常**：房主迁移、`server-closing`、8 秒握手超时、加入被拒释放连接、远程主机信息。
- **E2E 与发布**：`verify:desktop` 双实例；版本统一 1.3.0；tag `v1.3` 与 Release（安装包、`SHA256SUMS.txt`、源码包）已推送。
- 已知限制：UDP 仅同网段；防火墙/AP 隔离会拦截广播；强杀不发关闭通知；真实 GUI/安装/DPAPI 尚未验收。

## v1.2.0（2026-10-20）

联机体验打磨版（M9）。

- 联机按视角座位渲染对手框，摸牌/出牌动画飞向对应座位；服务端逐视图动画队列，AI 连续行动逐步播放。
- 房间面板与对局顶栏新增 12 个预置 emoji 表情；服务端座位校验、白名单与限频（5 条后冷却 2 秒），气泡 2.2 秒。
- 新增 `verify:online` 双客户端 E2E 22 项；`npm test` 306 用例、`verify:ui` 103/103。
- 已知限制：表情仅纯 emoji；联机 AI 固定本地；房间状态在内存；刷新中断单机对局。

## v1.1.0（2026-10-20）

局域网联机版（M8 + M9-01 修复）。

- 房间制联机：6 位房间码、房主可选 AI 补位、服务端权威、按座位脱敏广播。
- 断线重连（token 恢复座位、刷新静默恢复）、房间超时清理、房主按原阵容再来一局。
- 修复 UNO 窗口按座位过滤、联机抓 UNO 误判、`drawnThisTurn` 视图泄露。
- 已知限制：联机 AI 固定本地；房间在进程内存；多玩家布局与表情尚未完成（M9）。

## v1.0.0（2026-10-18）

本地单机版首个发布版本（M0~M7）。

- 完整 UNO 规则：108 张、颜色/数字/图案匹配、动作牌、Wild/+4、+4 挑战、UNO 喊与抓、牌堆耗尽、单局定胜负。
- 宽松叠牌、主动摸牌摸到可出、2 人特殊规则、6~10 人布局、结算与操作统计（无分数）。
- 四档本地 AI + 可选智谱混合决策（候选 → 决策 → 校验 → 自动降级）；动效/音效/响应式。
- 质量基线：`npm test` 281 用例、`verify:ui` 102/102、selfplay 700 局、typecheck/lint 0。
- 已知限制：刷新中断对局、无联机/账号、移动端未真机验收、音效为合成、`wild4Legality` 未暴露、无许可证。
