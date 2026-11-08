# 更新日志

> v1.0~v1.3 的逐条历史已压缩；完整原文见 git 历史与 [`docs/v1-开发归档.md`](docs/v1-开发归档.md)。当前开发阶段为 v2.0.0 UI 升级。

## 未发版 · N1~N4b 人工验收通过（2026-11-08）

- 用户确认「N4b 以前的所有均通过人工验证」：N1 设计契约、N2 全局基底与顶栏、N3 大厅两栏、N4a 牌桌结构、N4b 牌桌数据与手牌区全部收口为 ✅；代码此前已随 `u0-baseline` 分组提交，无待补 commit。
- U4（显示层白角 / squircle 全量推广）按用户指令整体回退，未提交改动丢弃，工作区回到 tag `u3`（U3 完成态）；用户反馈的「大厅设置区不要圆角」「卡片显示问题」尚未落地，等单独指令。
- 按 `docs/开发约定.md` §7，批准「开始 N5」前先对上一阶段成果打 tag `v2.2.0-alpha.2`，不 push。

## 未发版 · U3 手牌区融合与空格执行（2026-11-08）

### 下方手牌区融合（U3）

- 取消 N4a 的 `minmax(0,1fr) 164px` 双列：`#hand-zone.player-zone` 改**单列**，`#hand` 占满下方宽度，手牌横向不再被右侧独立动作列挤窄。
- 动作区**内嵌手牌坞**：`#action-bar.action-stack` 移入 `.hand-deck` 顶部新增的 `.hand-rail` 细轨，与 `YOUR HAND` 标题共用一行（44px），不再另起一列；≤760 折成标题 / 动作两行，仍走文档流。
- 主操作按钮**长条化**：动作条吃掉细轨剩余宽度，首个可用功能按钮（常规回合即「摸牌」，摸牌后即「结束回合」）标 `data-primary` + `aria-keyshortcuts="Space"`，荧光绿主色 + 右下角 `SPACE` 角标；UNO 按钮仍保持 ≥56px / ≥20px 的醒目规格。
- 极矮屏（≤640 高）从 `.hand-deck` / `#hand` 内边距里省回细轨高度，牌桌仍一屏；`#hand[data-playable]`、`overflow-x:auto`、`.hand-dock` 渐变底与安全区、`#action-bar[data-phase]`、≥44px 触控与全部 DOM 锚点只增不改。

### 空格 = 点击主操作按钮（U3）

- `js/ui/hand.js` 全局只挂一次 `keydown`（capture）：命中空格且在对局页时，直接 `primary.click()` 复用按钮自身的 click 监听——**同一 `UiAction`、同一事件队列、同一 `aria-busy` 输入锁**，与鼠标点击没有第二条规则。
- 焦点在输入框 / 房间码 / 弹窗内、或手牌坞以外的按钮（顶栏等）时不接管，保留原生输入与键盘可达性；同时阻止默认行为，避免空格滚动页面或代劳出牌。**出牌仍只点手牌**，Tab → Enter 出牌路径不变。
- 验收新增：`verify:ui` U3 结构 2 条（单列 / 内嵌 / 占满 / 长条 / Space 提示）+ 键盘 4 条（空格等价同一 actionId、与鼠标点击逐项一致、输入框不触发、弹窗不触发），`verify:online` 每客户端 1 条；实跑 `verify:ui` 192/192、`verify:online` 44/44、lint / typecheck 0。`npm test` 复跑时 vitest 5.0.5 在收集阶段全量失败（32/32 文件 0 用例，`Vitest failed to find the current suite`），`npm ci --ignore-scripts` 重装依赖后仍复现，属本机既有环境故障、与本次改动无关，详见 [`docs/开发进度.md`](docs/开发进度.md) §1。

## 未发版 · U2 右栏手牌数走势折线图（2026-11-07）

### 手牌数走势（U2）

- 右栏主视觉替换为「各玩家手牌数走势」**纯 SVG 折线图**（不引图表库，沿用结算页做法）：荧光绿 `#d9ff4b` 标「你」，其余座位按相对座位取扩展调色板区分，末点圆点 + 图例（座位名 / 颜色）。
- 数据：从事件历史按动作步重放各座位手牌数（`DEAL` / `PLAY` / `DRAW` / `STACK_RESOLVE` / `CHALLENGE_FAIL` / `UNO_CAUGHT` / `PLAYER_OUT`），末样本用权威 `handCount` 覆盖，保证末点与 `#hand` / 对手「N 张」一致；联机仅用公开数量，零牌面泄露。
- U1 的 CURRENT PRESSURE / RECENT EVENTS 六项字段与 TURN 回合标签**原位保留**、一个不丢；直角面板风格不变。
- **修复「曲线不能连续显示」**：引擎 `applyAction` 每次动作都会重置 `state.events`（单帧仅本批事件），故在 UI 层累积全量事件历史（单机 `rt.eventHistory`、联机模块级累积、新发牌自动重开），不改引擎 / `GameView` / 协议；SVG 改为绝对定位撑满画布；图例移出画布避免被绝对定位层遮挡。
- 自适应：右栏改纵向 flex 列，U1 面板不收缩、走势图末尾 `flex:1` 吸收剩余高度，窄屏自动压缩；1024×600 极矮屏再压一档仍守「面板间距 ≥8px 不贴死」红线。
- 质量：`verify:ui` 186/186（新增 6 条 U2 断言：折线数=座位数、末值一致、不横向溢出、不越出右栏）、`verify:online` 42/42（联机 `faceNodes=0`）、lint / typecheck 0。

## 未发版 · 启动动画 / 大厅巨型牌 / 新图标（2026-11-07）

### 启动动画与转场

- 新增启动动画：SVG 手写笔迹逐笔写出 `UNO`（铅笔底稿 → 荧光绿墨迹 + 笔尖光点 → 签名下划线），进度条与状态文案同步；配色沿用 radical 近黑 `#090d0b` + 荧光绿 `#d9ff4b` + 36px 网格。
- 转场：墨迹定格 → 沿签名线光带扫过 → 遮罩虚化溶解，大厅两栏错峰升起，一次连续运动进入应用；点击/按键可跳过。
- 降级：`?test=1` / `?mock=1` / `?dev=1` / `?boot=0` / 动画关闭 / `prefers-reduced-motion` 均跳过；每次浏览器会话只播一次，`?boot=1` 可强制预览；9 秒兜底防止遮罩卡死。
- 桌面壳仅把窗口底色对齐启动层（`#0b1f14` → `#090d0b`），避免首帧闪色；引擎、协议、`window.UnoApp` 契约零改动。

### 大厅巨型 UNO 牌（随机卡面 + 卡背）

- 左栏巨字右侧留白新增 `.lobby-deck`：两张 2:3 大牌交叠，一张随机卡面（54 张唯一牌面之一）、一张 `card-back.svg` 卡背；每次打开随机牌面、上下层与倾角，一次性发牌落桌动效、荧光绿椭圆细线与状态点呼应主题。
- 纯绝对定位装饰层（在 `.lobby-shell` 之下），不改巨字排版与文档流；≤1080 退为极淡水印并收掉位移/旋角（不撑宽 `scrollWidth`），≤520 隐藏。
- 卡面预解码后再挂载，`boot.js` 的 `waitForApp()` 一并等待，遮罩退场时牌面必已就位。

### 首次启动加载修复 + exe 外观

- **首帧闪烁修复**：`.boot-ink path` 在 CSS 里预设 `stroke-dasharray/dashoffset`，且 `boot.js` 从 ESM 改为 `</body>` 前同步执行的经典脚本（自读 `uno:settings`，不再依赖模块图）；首帧即「尚未书写」，消除冷启动时先闪完整字形再被清空的跳变。
- 干净首次启动实测：80ms 墨迹未显 / 1.5s 正在书写 / 4.7s 遮罩移除且 `inert` 解除，控制台 0 error。
- **图标重做**：`apps/desktop/build/icon.ico` / `icon.png` 改为近黑圆角底 + 荧光绿紧字距 `UNO` 字标 + 一笔倾斜签名线 + 右上状态点，7 档尺寸（16~256）；旧官方红椭圆绿底图标退役。已验证新图标 PNG 数据写入 `UNO.exe` 与安装包。
- 质量：`verify:ui` 172/172、`verify:online` 38/38、`typecheck` / `lint` 0、`npm test` 334/335（唯一失败为已知 esbuild 环境问题）；1440/1024/420 无横向溢出、随机牌面与上下层生效、无失败请求。
### 白角修复 · 连续曲率圆角 · 新需求入计划（同日第三轮）

- **图标白角根因**：Chrome `omitBackground` 未生效，`icon-*.png` 为 RGB（无 alpha），四角是纯白不透明像素 `(255,255,255,255)` → Windows 显示白角。改用 `Emulation.setDefaultBackgroundColorOverride({a:0})` 输出 RGBA，7 档尺寸四角 alpha 全 0。
- **连续曲率圆角**：图标背景与内框换成超椭圆 `n=5` 的 squircle（曲率连续，无直线↔圆弧突变），新增统一资源 `apps/web/assets/squircle.svg` 与全局 token `--ui-squircle`；ICO 小尺寸（16/24/32/48）改带 AND mask 的 32bpp DIB，大尺寸用带 alpha 的 PNG，彻底消除白角。
- **大厅牌白角**：卡面 PNG 个别角残留白色不透明像素（实测 `G2.png` 右上、`R7.png` 左下）；`.lobby-deck__card` 套 squircle 遮罩裁掉，投影上移到容器避免被遮罩裁掉；素材批量去背列为 U4 后续项。
- **硬性规定**：「一切 UI 圆角必须连续曲率、禁止普通 `border-radius` 圆弧」写入 [`docs/开发进度.md`](docs/开发进度.md) §4 红线第 11 条、[`docs/开发约定.md`](docs/开发约定.md) §6、`styles/tokens.css`。
- **新 UI 需求入计划（⬜ 未开发）**：[`docs/UI优化方案-待开发.md`](docs/UI优化方案-待开发.md) 记录 U1 右栏信息回归 + 保留回合数、U2 右栏改玩家手牌数折线图、U3 下方手牌区融合 + 长条按钮/空格执行、U4 素材去背根治 + squircle 全量推广，含 4 个待用户拍板的歧义点。
- 验证：`verify:ui` 172/172、新图标 DIB/PNG 资源写入三个 exe、1440 截图确认大厅牌无白角。
- **安装包再次重建**：`apps/desktop/release/UNO-Setup-2.0.0.exe` + 桌面两个副本（同名与 `UNO Setup.exe`），112,333,612 字节，SHA256 `9FCC704CBAC9F461F273A285F87A515C0D21DDCFFF4A7F5B9ECCBD9C2E0F7EB8`（`SHA256SUMS.txt` 已同步）。版本号仍为 2.0.0，未做 v2.2 发布口径变更；README 中的旧哈希对应已上传 GitHub Release 的历史包。

### 文档压缩与 U 系列定调（同日第四轮，纯文档）

- **压缩总档**：新增 [`docs/开发总档.md`](docs/开发总档.md)，把此前 21 份方案/契约/归档压成一份，含版本时间线、各阶段「做出什么效果」、按布局/启动/图标打包/验收环境/联机分类的 **Bug 与坑位档案**、红线、质量基线、命令速查、被压缩文档去向；`docs/README.md` 索引与 `docs/开发进度.md` 台账全面更新到当前 v2.2 + U 系列状态。
- **U 系列三点拍板并写入方案**：① U2 折线图可替换右栏位置，但原有信息必须保留显示、回合数保留；② U3 空格与鼠标点击相同，只是多一层选择；③ **「牌面素材不可修改」红线依旧存在**，白角只在显示层用遮罩处理，U4 取消批量重处理卡面。仅剩「U 系列排期」待定。
- **应用快捷方式图标诊断**：已安装 `UNO.exe` 与最新构建大小一致且都含新 DIB32/PNG256 图标；ICO 32×32 条目四角 `alpha=0` 且 AND mask=1（透明）。桌面 `UNO.lnk` 指向该 exe 且无自定义 IconLocation，显示白底属 Windows 图标缓存（按目标路径索引），非文件问题。已发 `SHChangeNotify`/`ie4uinit` 刷新信号；彻底清理方案见桌面 `refresh-uno-icon.cmd`（需用户确认后执行）。
- **清理（用户确认后执行）**：删除 `apps/desktop/release-boot` / `release-icon` / `release-next` 三个旧构建目录的绝大部分文件，磁盘占用 958 MB → 4.8 MB（仅剩被系统锁定的 `app.asar` / `default_app.asar`）；清掉 `boot-preview` 28 张中间帧与历史临时脚本 `.tmp-shot.mjs`，保留 4 张被文档/展示引用的图片；**docs 全部保留**（按用户选择的推荐清单）。`npx eslint .` 现在无需忽略参数即 0 错误。
- **图标缓存彻底刷新（用户确认后执行）**：停止 explorer → 删除 14 个 `iconcache_*.db` / `IconCache.db` → `ie4uinit -show` → 重启 explorer（已确认进程恢复）。桌面 `UNO.lnk` 应显示无白底的新图标。
- 本轮**未写任何实现代码**，U1~U4 仍为待开发；`npm run lint` / `typecheck` 0 错误。

### 第五轮 · 三段式汇报 / 自检 / 批准即提交规定（同日，纯文档）

- 新增硬性规定（用户指令）：① 每次开发完输出**只包含三段**「开发了什么 / 能实现什么样的效果 / 还剩什么」，不得有第四段；② 每次修改文件后**自行验证无 bug** 才汇报，验证结果不单独成段；③ 用户批准下一步开发后**先自动 `git commit` + 打 tag，再开工**，不做 push；首次批准先分组提交历史存量改动并打 `u0-baseline`。
- 落地：[`docs/开发约定.md`](docs/开发约定.md) §7（并标注 §2 四段式已被覆盖）、[`docs/开发进度.md`](docs/开发进度.md) §4 红线第 12 条、[`docs/开发总档.md`](docs/开发总档.md) §5 第 8 条、`docs/README.md` 索引。
- [`docs/UI优化方案-待开发.md`](docs/UI优化方案-待开发.md) 补 U1~U4 总览表 + 每个 U 的「开发步骤」与「开发完能实现的效果」，按已拍板三点细化（折线图可替换但信息保留、空格等价点击、牌面素材红线不变）。
- 本轮未写实现代码、**未 commit、未打 tag**（按新规定等用户批准下一步开发时执行）。

### 第六轮 · U1 右栏信息回归（同日，实现代码）

- **开工前提交**：按 §7 首次批准口径，把历史存量按逻辑分 4 组补 commit（`61a65a5` v2.2 N3/N4a/N4b、`d986303` 启动动画与大厅牌、`c736a57` 图标与 squircle、`b7fffd0` 总档与 U 计划），并打基线 tag `u0-baseline`；未 push、未提交 `.env` / 日志 / 验收产物。
- **右栏信息回归**：`CURRENT PRESSURE`（当前玩家手牌数 / 你的手牌 / 可出牌 / 牌堆剩余）与 `RECENT EVENTS`（上一手 / 上一位 / 状态）六项字段在对局中全部可读；≤1080 不再整栏 `display:none`，改为 168px 紧凑摘要列；≤800 高再压成两列、≤760 文档流横向摘要、≤520 单列，六档视口一屏不下沉。
- **回合数保留**：左栏 `TURN / 01` 与「阶段 x / 4」原地不删不挪；右栏新增 `TURN / xx · 阶段 x / 4` 紧凑胶囊，与左栏同一个 `turnCounter` / `doneCount` 同源。全部字段由 `renderTurnStatus()` 与 `#hand` / `#draw-count` / `#turn-stamp` 同源驱动，未新增引擎字段、未改 GameView / 协议。
- **数据卡片直角（同日用户追加拍板：「数据显示的卡片不用做圆角」）**：`.status-card` 与回合胶囊先套过 `--ui-squircle` 双层描边，随后按反馈移除双层遮罩伪元素，改为 `border-radius: 0` + 1px 实线边框；移除普通 `border-radius: 13px` 圆弧。§6 连续曲率只约束确需圆角的元素，U4 不得把右栏数据面板改回圆角；直角本身不露白角。
- **折叠不冲突（同日用户追加）**：右栏三块直角面板的间距在 ≤1080 与矮屏档由 6px / 5px 统一为 **8px**（1440 保持 10px），直角边框不再贴死成双线；`rightRailAudit()` 新增面板几何审计（两两 `minGap ≥ 8px`、不重叠、不越出父栏、卡内文字不溢出、不与牌桌/手牌/动作栏重叠），并挂进 5 条 U1 断言，各档实测 8~10px、零冲突。
- **验证**：`verify:ui` **180/180**（新增 8 条 U1 断言：字段完整 / 同源一致 / **数据卡片直角**静态断言（无 squircle mask、半径 0、1px 边框）/ 四档一屏）、`verify:online` **40/40**（新增 2 条联机右栏可见与不泄露牌面）、`npm run lint` / `typecheck` 0、`npm test` 334/335（唯一失败为已知 `web-engine-bundle` esbuild 权限问题）；1440 / 1366×657 / 1024×600 / 1024×768 / 420 无头截图核对右栏字段不裁切、直角无白角、无横向溢出。
- **按 §7 留待下次批准提交**：U1 代码与本轮文档不单独 commit / tag，下次「开始 Ux」时先提交上一阶段成果并打 `u1`。

## v2.0.0（2026-10-25，[GitHub Release](https://github.com/shark-syh/uno-personal-game/releases/tag/v2.0.0)）

v2.0.0 UI 重构整体发布：执行编号 M1~M8（视觉契约 → 大厅品牌 → 圆桌座位 → 悬浮手牌 → UNO 金环 → 结算转场 → 无障碍收口 → 发布），外加一次用户确认的 radical 风格重塑。规则引擎、`GameView`/`UiAction`、WebSocket 协议、服务端权威与脱敏边界零改动；`window.UnoApp` 五个 API 与 DOM 锚点只增不改。

### M7 响应式/无障碍/性能收口（2026-10-25）

- 荧光绿焦点环（`:focus-visible`）；CDP 真实键盘验证「Tab 聚焦合法牌 → Enter 出牌」完整键盘路径；对手卡背 `aria-hidden`、触控目标 ≥44px 断言。
- 420/760/1024/1440 四档布局断言在 radical 配色下复测；`npm run perf` FCP 280ms / FPS 60。
- 根治「6 人轮转」偶发断言（采样窗 5s→9s：智谱单次决策可达 3.8s，旧窗口只采到人类座位）。
- 验证：`verify:ui` 137/137（新增 4 项 M7 断言）、`verify:online` 32/32。

### 风格重塑 · radical 主题（2026-10-25，用户确认采用原型配色）

- 全套换肤为 radical 设计语言：近黑基底 `#090d0b` + 荧光绿点缀 `#d9ff4b` + 全屏网格纹理；令牌名不变、值替换（`--v2-gold` 即荧光绿）。
- 牌桌当前颜色指示改为「细色环 + 同色边缘光」；UNO 按钮/金环/合法牌/刚抽角标荧光绿；结算四色渐变标题、顶线式统计卡、radical 图表配色；弹窗/输入框暗色化。
- 契约 B03 同步改写（radical 主题为唯一视觉基线）；M2~M6 结构与交互零改动。

### M6 结算转场与对局总结（2026-10-25）

- 结算头部：`本局结算` kicker + 胜者名标题（去 emoji）+ `人数/手数/用时/行动` meta（不再显示恒为 1 的「局数」）。
- 获胜牌飞入：切屏前缓存弃牌堆顶 rect，结算后克隆飞行 520ms 入槽；转场期间锁定重复点击；源缺失/平局/牌堆耗尽/动画关闭/reduced-motion 静态降级。
- 标题四色胜利渐变 + 一次 520ms 亮度扫过；平局/牌堆耗尽负向断言。

### M5 UNO 条件与金色倒计时环（2026-10-25）

- UNO 按钮只在「1 张 + uno-window + canCallUno + CALL_UNO 合法」时渲染；窗口时长唯一映射（休闲 10s / 简单 8s / 真实 6s / 骨灰级 4s，`?test=1` 固定 120ms）。
- 金色倒计时环（conic-gradient + `@property --uno-progress` 插值）；`data-window-key` + 负 `animation-delay` 保证重复渲染不重置进度；到期只改 UI 不提交动作；动画关闭/reduced-motion 静态降级（金边框 + 文本秒数）。

### M4 悬浮手牌与动作区（2026-10-24）

- `#hand-zone.hand-dock` 悬浮手牌坞（背景与牌桌融合、触底 safe-area 留白）；`#hand[data-count]`、`.card[data-state]`（legal/illegal/drawn）、`#action-bar[data-phase]`。
- 手牌卡宽六档（120/108/96/88/80/76，保持 2:3）；`#hand` 独立横向滚动边界（`overscroll-behavior-x: contain`）；W3 以下动作栏两行网格；触控目标 ≥44px。

### 版本口径

- 代码版本 1.3.0 → **2.0.0**（根 package.json / 服务端 `/api/health` / 桌面壳 package.json 同步）；顶栏与大厅版本号随之显示 v2.0.0。
- 桌面安装包（NSIS）`UNO-Setup-2.0.0.exe` 已本地打包并上传 GitHub Release `v2.0.0`（约 107 MiB，SHA256 `15884337046AFB9805555BC30EB7A177A7C32325B90CAE849B35F794A3AC361A`），`SHA256SUMS.txt` 一并提供；源码由 tag 自动生成。

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
