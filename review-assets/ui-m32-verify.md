# M3-3 体验修正 + M3-2/M4 浏览器验收报告（自动生成）

> 时间：2026-10-17T16:04:39.563Z ｜ 入口：http://localhost:3000 ｜ 浏览器：Chrome/155.0.8059.82
> 结果：**58 / 58 通过**

## 检查项

| 结果 | 项目 | 细节 |
|------|------|------|
| ✅ | 默认入口为引擎模式（真实对局） | getMode()=engine |
| ✅ | 引擎模式标记 `data-engine="on"` |  |
| ✅ | 大厅选项齐全（人数 9 档 / 难度 4 档 / AI 模式 3 档 / +4 挑战默认开） | {"counts":9,"difficulties":4,"modes":3,"challenge":true} |
| ✅ | 开局：人类 7~9 张手牌（起手 +2 可能 9 张）+ 3 个 AI 座位 | {"hand":7,"opponents":3,"failed":0,"overflow":{"scroll":1440,"client":1440}} |
| ✅ | 开局卡面全部加载成功 | failed=0 |
| ✅ | 1440 宽无横向溢出 | {"scroll":1440,"client":1440} |
| ✅ | 手牌区不再显示「你的手牌 / N 张」 | {"heading":false,"count":false,"text":""} |
| ✅ | 操作栏不再有出牌按钮（出牌改为点击手牌） | [{"text":"摸牌","disabled":false}] |
| ✅ | 正常回合无冗余状态提示文字 | hint= |
| ✅ | 当前颜色明显放大（色点 ≥20px、文字 ≥17px、不溢出） | {"dotW":22,"dotH":22,"labelFont":18,"labelRect":{"top":24,"right":139},"viewportW":1440,"topBarOverflow":false,"pageOverflow":false} |
| ✅ | 第 1 局完整打完并进入结算（🏆 阿强 获胜） | ["你4 张 · 趣味分数 56","老王1 张 · 趣味分数 5","小美7 张 · 趣味分数 133","阿强0 张 · 出完手牌 · 本局得分 194"] |
| ✅ | 第 1 局：再来一局 / 退出回大厅可用 |  |
| ✅ | 第 2 局完整打完并进入结算（🏆 老王 获胜） | ["你5 张 · 趣味分数 36","老王0 张 · 出完手牌 · 本局得分 167","小美8 张 · 趣味分数 62","阿强11 张 · 趣味分数 69"] |
| ✅ | 第 2 局：再来一局 / 退出回大厅可用 |  |
| ✅ | 第 3 局完整打完并进入结算（🏆 你 获胜） | ["你0 张 · 出完手牌 · 本局得分 160","老王10 张 · 趣味分数 160"] |
| ✅ | 第 3 局：再来一局 / 退出回大厅可用 |  |
| ✅ | 结算趣味分数 = 剩余手牌分值（引擎 → 公开视图 → UI 全链路一致） | [{"cards":4,"expected":56,"shown":56,"hasScore":true,"winnerScoreShown":null,"isOut":false,"isWinnerRow":false,"text":"你4 张 · 趣味分数 56"},{"cards":1,"expected":5,"shown":5,"hasScore":true,"winnerScoreShown":null,"isOut":false,"isWinnerRow":false,"text":"老王1 张 · 趣味分数 5"},{"cards":7,"expected":133,"shown":133,"hasScore":true,"winnerScoreShown":null,"isOut":false,"isWinnerRow":false,"text":"小美7 张 · 趣味分数 133"},{"cards":5,"expected":36,"shown":36,"hasScore":true,"winnerScoreShown":null,"isOut":false,"isWinnerRow":false,"text":"你5 张 · 趣味分数 36"}] |
| ✅ | 结算页存在非赢家趣味分 > 0（未出现全员清零） | maxShown=160 |
| ✅ | 结算页赢家行显示「出完手牌 / 手牌最少获胜 + 本局得分」（不再显示趣味分数 0 造成误解） | [["你4 张 · 趣味分数 56","老王1 张 · 趣味分数 5","小美7 张 · 趣味分数 133","阿强0 张 · 出完手牌 · 本局得分 194"],["你5 张 · 趣味分数 36","老王0 张 · 出完手牌 · 本局得分 167","小美8 张 · 趣味分数 62","阿强11 张 · 趣味分数 69"],["你0 张 · 出完手牌 · 本局得分 160","老王10 张 · 趣味分数 160"]] |
| ✅ | 结算页赢家「本局得分」= 对手剩余手牌分值之和（官方 UNO 计分口径） | [{"shown":194,"expected":194,"text":"阿强0 张 · 出完手牌 · 本局得分 194"},{"shown":167,"expected":167,"text":"老王0 张 · 出完手牌 · 本局得分 167"},{"shown":160,"expected":160,"text":"你0 张 · 出完手牌 · 本局得分 160"}] |
| ✅ | 出牌通过点击手牌完成（操作栏无出牌按钮） | cardClicks=261 |
| ✅ | 摸牌按钮文案为「摸牌」（BUG-01 新规则：摸到可出为止） | sawDrawLabel=true |
| ✅ | 引擎事件覆盖：出牌/摸牌/回合结束 | {"DEAL":20,"START_CARD":6,"PLAY":752,"COLOR_SET":68,"SKIP":75,"REVERSE":67,"DRAW":232,"STACK_PUSH":96,"STACK_RESOLVE":47,"UNO_CALLED":16,"CHALLENGE_SUCCESS":4,"PILE_RESHUFFLE":8,"CHALLENGE_FAIL":13,"PLAYER_OUT":3,"ROUND_END":3,"UNO_CAUGHT":1} |
| ✅ | 引擎事件包含叠牌/挑战/UNO 路径（随机对局统计） | {"DEAL":20,"START_CARD":6,"PLAY":752,"COLOR_SET":68,"SKIP":75,"REVERSE":67,"DRAW":232,"STACK_PUSH":96,"STACK_RESOLVE":47,"UNO_CALLED":16,"CHALLENGE_SUCCESS":4,"PILE_RESHUFFLE":8,"CHALLENGE_FAIL":13,"PLAYER_OUT":3,"ROUND_END":3,"UNO_CAUGHT":1} |
| ✅ | 引擎模式：事件播放期间出现 aria-busy 输入锁 | busy 记录 43 次 |
| ✅ | 引擎模式：动画期间操作按钮被禁用 | {"actionDisabled":0,"handDisabled":7,"busyAttr":"true"} |
| ✅ | 引擎模式：AI 回合显示「思考中」气泡 | thinking 出现动画名=dots |
| ✅ | 引擎模式：动画结束后 aria-busy 解除 |  |
| ✅ | M4 智谱在线成功：状态栏显示「智谱」 | indicator=智谱 |
| ✅ | M4 智谱台词：AI 气泡展示 LLM line | line=老王：“看我的” |
| ✅ | AI 台词只短暂展示：TTL/换人后自动消失（不跨回合残留） | line=老王：“看我的” clearAfter=2346ms |
| ✅ | 回大厅后 AI 台词清空（不留对话/不跨局残留） | [] |
| ✅ | M4 智谱失败自动降级：状态栏显示「本地·降级」+ 提示 toast | degradeSeen=true toast=智谱免费模型繁忙，已自动降级本地 AI |
| ✅ | M4 降级后本地 AI 继续行动（对局不中断） | eventFeedChanged=true |
| ✅ | 回大厅后 AI 台词清空（不留对话/不跨局残留） | [] |
| ✅ | mock 牌桌：手牌区无「你的手牌 / N 张」 | {"heading":false,"count":false,"text":""} |
| ✅ | mock 牌桌：操作栏只剩功能按钮（无出牌按钮） | [{"text":"摸牌","disabled":false}] |
| ✅ | mock 牌桌：正常回合无冗余提示文字 | hint= |
| ✅ | 事件队列逐条播放（5 事件 ≈ 1000ms） | elapsed=1052ms |
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
| PLAY | 752 |
| DRAW | 232 |
| STACK_PUSH | 96 |
| SKIP | 75 |
| COLOR_SET | 68 |
| REVERSE | 67 |
| STACK_RESOLVE | 47 |
| DEAL | 20 |
| UNO_CALLED | 16 |
| CHALLENGE_FAIL | 13 |
| PILE_RESHUFFLE | 8 |
| START_CARD | 6 |
| CHALLENGE_SUCCESS | 4 |
| PLAYER_OUT | 3 |
| ROUND_END | 3 |
| UNO_CAUGHT | 1 |

## 对局结算摘要

- 第 1 局：🏆 阿强 获胜
- 第 2 局：🏆 老王 获胜
- 第 3 局：🏆 你 获胜

## 截图

- review-assets/ui-m32-lobby-1440.png
- review-assets/ui-m32-game-start-1440.png
- review-assets/ui-m32-ai-busy-1440.png
- review-assets/ui-m32-ai-thinking-1440.png
- review-assets/ui-m32-result-1440.png
- review-assets/ui-m32-mock-challenge-1440.png
- review-assets/ui-m32-mock-uno-1440.png
