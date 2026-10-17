# UNO 单机版 UI

这是第一阶段的纯渲染 UI，使用原生 HTML、CSS 和 ES2022 模块，没有构建工具、第三方依赖或网络请求。规则引擎、AI 和发牌逻辑不在本阶段实现；UI 只消费 `GameView`，并把 `UiAction` 原样交给动作处理器。

## 预览

在仓库根目录执行：

```bash
cd apps/web
python -m http.server 8080
```

浏览器打开 `http://localhost:8080/` 即可预览全部 UI（M3-2 引擎接入前**默认 mock 模式**，不再需要 `?mock=1`；`?mock=0` 或 `?mode=engine` 为等待引擎接入的引擎模式）。ES Module 需要静态服务器，不能直接用 `file://` 打开。

## Mock 局面

默认是**干净预览**：进入大厅、不显示开发工具条。`?mock=1` 或 `?dev=1` 进入**开发模式**（显示工具条、点击动作有「（演示）已提交：…」toast 与控制台日志）。工具条包含 `lobby`、`normal-play`、`ai-thinking`、`stack-response`、`wild-color-picker`、`challenge-decide`、`uno-window`、`catch-uno`、`result`、`ten-players` 和额外的 `two-players`。切换局面会直接构造对应 `GameView`。`?mock=0` 时为引擎模式：工具条隐藏，大厅按钮不生效，操作交给注册的动作处理器消费（M3-2 起启用）。

也可在控制台调用 `window.UnoApp.setMockMode(true, "normal-play")` 开启工具条；调用 `setMockMode(false)` 退出 mock。接入引擎时先调用 `setActionHandler(fn)`，再调用 `render(view)`；引擎提供的 `view.mock` 决定模式。`render` 不修改传入对象，`playEvents` 单独消费事件并回调，不自动推进回合。

## 文件说明

- `index.html`：三个屏幕和契约规定的 DOM 锚点。
- `styles/`：设计 token、牌桌布局、卡牌、组件和基础动画。
- `js/mock/mockView.js`：可重复使用的 mock `GameView` 数据。
- `js/ui/`：按区域幂等渲染，不从 DOM 反推状态。
- `js/animation/queue.js`：第一阶段事件队列，每条事件 200ms；尊重 reduced motion。
- `js/state/`：`uno:settings` 和 `uno:stats` 的 localStorage 读写。

## 实现假设

- 牌面图片优先加载 `cards/{faceCode}.png`；图片失败时由卡牌节点绘制色块和短标签，不展示破图。卡面已由 `scripts/process-cards.py` 统一处理：去除原始模板外圈黑边并把图案居中（240×360，四边白边一致）。
- 手牌排布：默认全部排开（间距 10px）；数量超出可用宽度时均匀折叠（每张至少露出 36px，仍放不下则手牌区横向滚动）；鼠标悬停/键盘聚焦时当前牌提到最上层并上浮。
- mock 的 `START_GAME`、`RESTART`、`BACK_TO_LOBBY` 仅切换 mock view；其它动作不改变规则状态。
- 大厅新增「规则选项 · +4 挑战」勾选框（默认开启）：`START_GAME.config` 会附带 `challengeWild4` 布尔值，供 M3-2 对接时传给引擎 `GameConfig.challengeWild4`；关闭后引擎侧 +4 直接结算摸 4，不进入挑战窗口。
- 设置弹窗保存音效、动画、AI 速度和自动喊 UNO 四项；其余契约设置字段保留默认值。
- 每个 AI 的台词与思考状态在 `speech-layer` 内按 `data-seat` 呈现；座位内展示头像、名字、手牌数、UNO 和最近出牌。
- 事件动画为短计时队列，不包含发牌、飞牌、粒子和彩带等第二阶段效果。
- 若引擎重绘移除了弹窗原触发控件，关闭弹窗后焦点回到当前屏幕首个可用控件。
- 音效开关仅保存偏好，第一阶段没有音频资源或音频播放；AI 速度与自动喊 UNO 设置交由后续引擎消费。
- 战绩弹窗只展示本地缓存，不在 mock 切换或结算渲染时写入战绩。

## 实际检查记录

- 14 个 JavaScript 文件通过 Node 语法检查；HTML 引用的 5 个 CSS 和 1 个入口模块存在；54 个 manifest 卡面文件存在。
- HTML/CSS/JS 外链扫描无结果；静态服务 `/`、`/cards/R7.png`、`/styles/tokens.css` 返回 200。
- 10 个必需 mock 和额外的双人 mock 均经工具条切换、DOM 及卡面加载检查；未捕获控制台错误或警告。
- 2/4/10 人在 1024、1280、1920 宽度经元素边界检查，无页面横向溢出、座位互相重叠或座位越界；390 宽十人布局的样式优先级冲突已修复并复测无横向溢出。
- mock 的人数、手牌数、动作关联卡牌和 CHOOSE_COLOR 字段通过数据检查。

以上属于静态检查和浏览器自动化检查，不是人类视觉或交互验收。卡牌悬停观感、颜色辨识、弹窗键盘操作体验、1024×768 密度以及触屏实机体验仍需人工确认。规则、AI、音效播放和第二阶段复杂动画不属于本次交付。
