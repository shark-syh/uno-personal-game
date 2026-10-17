# 浏览器验收报告（自动生成；M3-3/M4 回归 + M5 规则边界）

> 时间：2026-10-17T18:17:22.896Z ｜ 入口：http://localhost:3000 ｜ 浏览器：Chrome/155.0.8059.82
> 结果：**64 / 64 通过**

## 检查项

| 结果 | 项目 | 细节 |
|------|------|------|
| ✅ | 默认入口为引擎模式（真实对局） | getMode()=engine |
| ✅ | 引擎模式标记 `data-engine="on"` |  |
| ✅ | 大厅选项齐全（人数 9 档 / 难度 4 档 / AI 模式 3 档 / +4 挑战默认开） | {"counts":9,"difficulties":4,"modes":3,"challenge":true} |
| ✅ | 开局：人类 7~9 张手牌（起手 +2 可能 9 张）+ 3 个 AI 座位 | {"hand":7,"opponents":3,"failed":0,"overflow":{"scroll":1440,"client":1440}} |
| ✅ | 开局卡面全部加载成功 | failed=0 |
| ✅ | 抽牌堆计数在 HUD 正确显示（文本与 data-count 一致） | {"text":"79","dataCount":"79"} |
| ✅ | 1440 宽无横向溢出 | {"scroll":1440,"client":1440} |
| ✅ | 手牌区不再显示「你的手牌 / N 张」 | {"heading":false,"count":false,"text":""} |
| ✅ | 操作栏不再有出牌按钮（出牌改为点击手牌） | [{"text":"摸牌","disabled":false}] |
| ✅ | 正常回合无冗余状态提示文字 | hint= |
| ✅ | 当前颜色明显放大（色点 ≥20px、文字 ≥17px、不溢出） | {"dotW":22,"dotH":22,"labelFont":18,"labelRect":{"top":24,"right":139},"viewportW":1440,"topBarOverflow":false,"pageOverflow":false} |
| ✅ | 第 1 局完整打完并进入结算（🏆 你 获胜） | ["你0 张 · 出完手牌","老王11 张","小美12 张","阿强3 张"] |
| ✅ | 第 1 局：再来一局 / 退出回大厅可用 |  |
| ✅ | 第 2 局完整打完并进入结算（🏆 阿强 获胜） | ["你7 张","老王6 张","小美8 张","阿强0 张 · 出完手牌"] |
| ✅ | 第 2 局：再来一局 / 退出回大厅可用 |  |
| ✅ | 第 3 局完整打完并进入结算（🏆 老王 获胜） | ["你17 张","老王0 张 · 出完手牌"] |
| ✅ | 第 3 局：再来一局 / 退出回大厅可用 |  |
| ✅ | 结算页已取消分数计算与展示（无「趣味分数 / 本局得分」文字） | [["你0 张 · 出完手牌","老王11 张","小美12 张","阿强3 张"],["你7 张","老王6 张","小美8 张","阿强0 张 · 出完手牌"],["你17 张","老王0 张 · 出完手牌"]] |
| ✅ | 结算页图表齐全（每位玩家操作 / 全体动作构成 / 剩余手牌构成 + 总览数字） | [{"charts":3,"ops":4,"hands":4,"summary":6},{"charts":3,"ops":4,"hands":4,"summary":6},{"charts":3,"ops":2,"hands":2,"summary":6}] |
| ✅ | 每位玩家操作统计与总览合计一致（出牌/摸牌/叠牌/喊UNO/挑战） | [{"summary":{"动作":197,"出牌":149,"摸牌":147,"叠牌":22,"喊 UNO":8,"挑战":3},"players":[{"seat":0,"metrics":{"plays":39,"draws":32,"stackPlays":8,"unoCalls":3,"challenges":1}},{"seat":1,"metrics":{"plays":38,"draws":42,"stackPlays":6,"unoCalls":0,"challenges":0}},{"seat":2,"metrics":{"plays":34,"draws":39,"stackPlays":2,"unoCalls":2,"challenges":2}},{"seat":3,"metrics":{"plays":38,"draws":34,"stackPlays":6,"unoCalls":3,"challenges":0}}]},{"summary":{"动作":34,"出牌":27,"摸牌":20,"叠牌":5,"喊 UNO":1,"挑战":0},"players":[{"seat":0,"metrics":{"plays":6,"draws":6,"stackPlays":1,"unoCalls":0,"challenges":0}},{"seat":1,"metrics":{"plays":7,"draws":6,"stackPlays":1,"unoCalls":0,"challenges":0}},{"seat":2,"metrics":{"plays":5,"draws":6,"stackPlays":0,"unoCalls":0,"challenges":0}},{"seat":3,"metrics":{"plays":9,"draws":2,"stackPlays":3,"unoCalls":1,"challenges":0}}]},{"summary":{"动作":205,"出牌":154,"摸牌":157,"叠牌":19,"喊 UNO":8,"挑战":2},"players":[{"seat":0,"metrics":{"plays":70,"draws":80,"stackPlays":7,"unoCalls":2,"challenges":1}},{"seat":1,"metrics":{"plays":84,"draws":77,"stackPlays":12,"unoCalls":6,"challenges":1}}]}] |
| ✅ | 全体操作构成环形图数据自洽（各部分之和 = 五项操作合计） | [{"plays":149,"draws":147,"stackPlays":22,"unoCalls":8,"challenges":3},{"plays":27,"draws":20,"stackPlays":5,"unoCalls":1,"challenges":0},{"plays":154,"draws":157,"stackPlays":19,"unoCalls":8,"challenges":2}] |
| ✅ | 剩余手牌构成图表与结算行剩余张数一致 | [{"rows":[{"seat":0,"cards":0,"shownCount":0,"isWinnerRow":true,"text":"你0 张 · 出完手牌"},{"seat":1,"cards":11,"shownCount":11,"isWinnerRow":false,"text":"老王11 张"},{"seat":2,"cards":12,"shownCount":12,"isWinnerRow":false,"text":"小美12 张"},{"seat":3,"cards":3,"shownCount":3,"isWinnerRow":false,"text":"阿强3 张"}],"hands":[{"seat":0,"colors":{"red":0,"yellow":0,"green":0,"blue":0,"wild":0}},{"seat":1,"colors":{"red":4,"yellow":0,"green":3,"blue":4,"wild":0}},{"seat":2,"colors":{"red":2,"yellow":7,"green":2,"blue":1,"wild":0}},{"seat":3,"colors":{"red":1,"yellow":1,"green":0,"blue":1,"wild":0}}]},{"rows":[{"seat":0,"cards":7,"shownCount":7,"isWinnerRow":false,"text":"你7 张"},{"seat":1,"cards":6,"shownCount":6,"isWinnerRow":false,"text":"老王6 张"},{"seat":2,"cards":8,"shownCount":8,"isWinnerRow":false,"text":"小美8 张"},{"seat":3,"cards":0,"shownCount":0,"isWinnerRow":true,"text":"阿强0 张 · 出完手牌"}],"hands":[{"seat":0,"colors":{"red":2,"yellow":0,"green":3,"blue":2,"wild":0}},{"seat":1,"colors":{"red":2,"yellow":0,"green":2,"blue":2,"wild":0}},{"seat":2,"colors":{"red":3,"yellow":0,"green":2,"blue":3,"wild":0}},{"seat":3,"colors":{"red":0,"yellow":0,"green":0,"blue":0,"wild":0}}]},{"rows":[{"seat":0,"cards":17,"shownCount":17,"isWinnerRow":false,"text":"你17 张"},{"seat":1,"cards":0,"shownCount":0,"isWinnerRow":true,"text":"老王0 张 · 出完手牌"}],"hands":[{"seat":0,"colors":{"red":3,"yellow":8,"green":5,"blue":1,"wild":0}},{"seat":1,"colors":{"red":0,"yellow":0,"green":0,"blue":0,"wild":0}}]}] |
| ✅ | 结算页赢家行标注「出完手牌 / 手牌最少获胜」 | [["你0 张 · 出完手牌","老王11 张","小美12 张","阿强3 张"],["你7 张","老王6 张","小美8 张","阿强0 张 · 出完手牌"],["你17 张","老王0 张 · 出完手牌"]] |
| ✅ | 出牌通过点击手牌完成（操作栏无出牌按钮） | cardClicks=115 |
| ✅ | 摸牌按钮文案为「摸牌」（BUG-01 新规则：摸到可出为止） | sawDrawLabel=true |
| ✅ | 引擎事件覆盖：出牌/摸牌/回合结束 | {"DEAL":20,"START_CARD":6,"PLAY":338,"REVERSE":31,"STACK_PUSH":48,"STACK_RESOLVE":24,"DRAW":95,"COLOR_SET":34,"CHALLENGE_SUCCESS":2,"UNO_CALLED":17,"SKIP":38,"PILE_RESHUFFLE":2,"CHALLENGE_FAIL":3,"PLAYER_OUT":3,"ROUND_END":3} |
| ✅ | 引擎事件包含叠牌/挑战/UNO 路径（随机对局统计） | {"DEAL":20,"START_CARD":6,"PLAY":338,"REVERSE":31,"STACK_PUSH":48,"STACK_RESOLVE":24,"DRAW":95,"COLOR_SET":34,"CHALLENGE_SUCCESS":2,"UNO_CALLED":17,"SKIP":38,"PILE_RESHUFFLE":2,"CHALLENGE_FAIL":3,"PLAYER_OUT":3,"ROUND_END":3} |
| ✅ | 引擎模式：事件播放期间出现 aria-busy 输入锁 | busy 记录 34 次 |
| ✅ | 引擎模式：动画期间操作按钮被禁用 | {"actionDisabled":0,"handDisabled":7,"busyAttr":"true"} |
| ✅ | 引擎模式：AI 回合显示「思考中」气泡 | thinking 出现动画名=dots |
| ✅ | 引擎模式：动画结束后 aria-busy 解除 |  |
| ✅ | M4 智谱在线成功：状态栏显示「智谱」 | indicator=智谱 |
| ✅ | M4 智谱台词：AI 气泡展示 LLM line | line=阿强：“看我的” |
| ✅ | AI 台词只短暂展示：TTL/换人后自动消失（不跨回合残留） | line=阿强：“看我的” clearAfter=1ms |
| ✅ | 回大厅后 AI 台词清空（不留对话/不跨局残留） | [] |
| ✅ | M4 智谱失败自动降级：状态栏显示「本地·降级」+ 提示 toast | degradeSeen=true toast=智谱免费模型繁忙，已自动降级本地 AI |
| ✅ | M4 降级后本地 AI 继续行动（对局不中断） | eventFeedChanged=true |
| ✅ | 回大厅后 AI 台词清空（不留对话/不跨局残留） | [] |
| ✅ | mock 牌桌：手牌区无「你的手牌 / N 张」 | {"heading":false,"count":false,"text":""} |
| ✅ | mock 牌桌：操作栏只剩功能按钮（无出牌按钮） | [{"text":"摸牌","disabled":false}] |
| ✅ | mock 牌桌：正常回合无冗余提示文字 | hint= |
| ✅ | 事件队列逐条播放（5 事件 ≈ 1000ms） | elapsed=1044ms |
| ✅ | 事件队列期间 aria-busy=true 且操作按钮禁用 | {"busy":true,"disabled":1} |
| ✅ | 事件队列结束后 aria-busy / aria-disabled 清理 | {"busy":null,"actionBarDisabled":null} |
| ✅ | reduced-motion 下跳过动画（<100ms 完成） | elapsed=0ms |
| ✅ | 设置关闭动画后跳过动画（<100ms） | elapsed=0ms |
| ✅ | 弹窗进场动画 dialog-in 生效 | animationName=dialog-in |
| ✅ | UNO 按钮显著放大（高度 ≥56px、字号 ≥20px） | {"w":123,"h":64,"font":22,"text":"UNO!"} |
| ✅ | UNO 单击一次即喊出（不再二次确认弹窗） | {"dialogOpen":false,"toast":"（演示）已提交：UNO!"} |
| ✅ | UNO 按钮脉冲动画 uno-pulse 生效 | animationName=uno-pulse |
| ✅ | AI「思考中」气泡 dots 动画生效 | ::after animationName=dots |
| ✅ | mock 结算页正常渲染（UI 回归） | 🏆 你 获胜 |
| ✅ | 牌堆边界：抽牌堆剩 0 张时计数正常显示 | {"text":"0","dataCount":"0","feed":"牌堆重新洗牌你 摸了 2 张"} |
| ✅ | 牌堆边界：洗回事件在事件流显示「牌堆重新洗牌」 | 牌堆重新洗牌你 摸了 2 张 |
| ✅ | 牌堆边界：抽牌堆剩 1 张时计数正常显示 | {"text":"1","dataCount":"1"} |
| ✅ | 1024 宽大厅无横向溢出 | {"scroll":1024,"client":1024} |
| ✅ | 1024 宽牌桌无横向溢出、放大的当前颜色不遮挡/不溢出 | {"dotW":22,"dotH":22,"labelFont":18,"labelRect":{"top":24,"right":139},"viewportW":1024,"topBarOverflow":false,"pageOverflow":false} |
| ✅ | 1024 牌桌操作栏无出牌按钮 | [{"text":"摸牌","disabled":false}] |
| ✅ | 没有控制台 JS 异常 |  |
| ✅ | 没有 console.error |  |
| ✅ | 没有失败的网络请求 |  |
| ✅ | 没有 4xx/5xx 响应 |  |
| ✅ | 所有请求同源（无外链） |  |
| ✅ | 引擎 bundle 被页面加载（js/vendor/uno-engine.js） |  |

## 引擎事件统计（3 局真实对局，快速模式）

| 事件 | 次数 |
|------|------|
| PLAY | 338 |
| DRAW | 95 |
| STACK_PUSH | 48 |
| SKIP | 38 |
| COLOR_SET | 34 |
| REVERSE | 31 |
| STACK_RESOLVE | 24 |
| DEAL | 20 |
| UNO_CALLED | 17 |
| START_CARD | 6 |
| CHALLENGE_FAIL | 3 |
| PLAYER_OUT | 3 |
| ROUND_END | 3 |
| CHALLENGE_SUCCESS | 2 |
| PILE_RESHUFFLE | 2 |

## 对局结算摘要

- 第 1 局：🏆 你 获胜
- 第 2 局：🏆 阿强 获胜
- 第 3 局：🏆 老王 获胜

## 截图

- review-assets/ui-m32-lobby-1440.png
- review-assets/ui-m32-game-start-1440.png
- review-assets/ui-m32-ai-busy-1440.png
- review-assets/ui-m32-ai-thinking-1440.png
- review-assets/ui-m32-result-1440.png
- review-assets/ui-m32-mock-challenge-1440.png
- review-assets/ui-m32-mock-uno-1440.png
- review-assets/ui-m5-deck-edge-1440.png
