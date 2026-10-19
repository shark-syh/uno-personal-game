# 浏览器验收报告（自动生成；M3-3/M4 回归 + M5 规则边界）

> 时间：2026-10-19T10:42:37.423Z ｜ 入口：http://localhost:3000 ｜ 浏览器：Chrome/155.0.8059.82
> 结果：**103 / 103 通过**

## 检查项

| 结果 | 项目 | 细节 |
|------|------|------|
| ✅ | 默认入口为引擎模式（真实对局） | getMode()=engine |
| ✅ | 引擎模式标记 `data-engine="on"` |  |
| ✅ | 大厅选项齐全（人数 9 档 / 难度 4 档 / AI 模式 3 档 / +4 挑战默认开 / 无用户名输入） | {"counts":9,"difficulties":4,"modes":3,"challenge":true,"playerName":false} |
| ✅ | 开局：人类 7~9 张手牌（起手 +2 可能 9 张）+ 3 个 AI 座位 | {"hand":7,"opponents":3,"failed":0,"overflow":{"scroll":1440,"client":1440}} |
| ✅ | 开局卡面全部加载成功 | failed=0 |
| ✅ | 抽牌堆计数在 HUD 正确显示（文本与 data-count 一致） | {"text":"79","dataCount":"79"} |
| ✅ | 1440 宽无横向溢出 | {"scroll":1440,"client":1440} |
| ✅ | 手牌区不再显示「你的手牌 / N 张」 | {"heading":false,"count":false,"text":""} |
| ✅ | 操作栏不再有出牌按钮（出牌改为点击手牌） | [{"text":"摸牌","disabled":false}] |
| ✅ | 正常回合无冗余状态提示文字 | hint= |
| ✅ | 当前颜色明显放大（色点 ≥20px、文字 ≥17px、不溢出） | {"dotW":22,"dotH":22,"labelFont":18,"labelRect":{"top":24,"right":139},"viewportW":1440,"topBarOverflow":false,"pageOverflow":false} |
| ✅ | 第 1 局完整打完并进入结算（🏆 阿强 获胜） | ["你6 张","老王7 张","小美UNO1 张","阿强0 张 · 出完手牌"] |
| ✅ | 第 1 局：再来一局 / 退出回大厅可用 |  |
| ✅ | 第 2 局完整打完并进入结算（🏆 老王 获胜） | ["你6 张","老王0 张 · 出完手牌","小美4 张","阿强13 张"] |
| ✅ | 第 2 局：再来一局 / 退出回大厅可用 |  |
| ✅ | 第 3 局完整打完并进入结算（🏆 老王 获胜） | ["你8 张","老王0 张 · 出完手牌"] |
| ✅ | 第 3 局：再来一局 / 退出回大厅可用 |  |
| ✅ | 本地战绩：打完 3 局后写入 uno:stats（对局 +3、获胜数合法） | {"before":{},"after":{"games":3,"wins":0}} |
| ✅ | 本地战绩弹窗：显示已记录的对局/获胜数 | ×本地战绩对局 3 · 获胜 0知道了 |
| ✅ | 6 人：真实对局 AI 座位数正确（5 个） | seats=5 |
| ✅ | 6 人：座位全部在视口内、互不遮挡 | {"inside":true,"overlaps":[]} |
| ✅ | 6 人：座位不压手牌区、页面无横向溢出/竖向滚动 | {"overlapHand":[],"overflow":{"scrollW":1440,"clientW":1440,"scrollH":900,"clientH":900}} |
| ✅ | 6 人：抽牌堆计数与 HUD 一致 | count=63 hud=63 |
| ✅ | 6 人：轮转正常（自动行动座位 ≥2 个） | {"steps":15,"seats":[2,5,3,0,1,4],"elapsed":865,"screen":"result"} |
| ✅ | 10 人：真实对局 AI 座位数正确（9 个） | seats=9 |
| ✅ | 10 人：座位全部在视口内、互不遮挡 | {"inside":true,"overlaps":[]} |
| ✅ | 10 人：座位不压手牌区、页面无横向溢出/竖向滚动 | {"overlapHand":[],"overflow":{"scrollW":1440,"clientW":1440,"scrollH":900,"clientH":900}} |
| ✅ | 10 人：抽牌堆计数与 HUD 一致 | count=37 hud=37 |
| ✅ | 10 人：轮转正常（自动行动座位 ≥2 个） | {"steps":31,"seats":[1,4,7,9,5,0,3,8,2],"elapsed":1970,"screen":"result"} |
| ✅ | 10 人 @1024：座位全部在视口内、互不遮挡、无横向溢出 | {"seats":9,"inside":true,"overlaps":[],"overflow":{"scrollW":1024,"clientW":1024,"scrollH":769,"clientH":768}} |
| ✅ | 结算页已取消分数计算与展示（无「趣味分数 / 本局得分」文字） | [["你6 张","老王7 张","小美UNO1 张","阿强0 张 · 出完手牌"],["你6 张","老王0 张 · 出完手牌","小美4 张","阿强13 张"],["你8 张","老王0 张 · 出完手牌"]] |
| ✅ | 结算页图表齐全（每位玩家操作 / 全体动作构成 / 剩余手牌构成 + 总览数字） | [{"charts":3,"ops":4,"hands":4,"summary":6},{"charts":3,"ops":4,"hands":4,"summary":6},{"charts":3,"ops":2,"hands":2,"summary":6}] |
| ✅ | 每位玩家操作统计与总览合计一致（出牌/摸牌/叠牌/喊UNO/挑战） | [{"summary":{"动作":144,"出牌":90,"摸牌":76,"叠牌":12,"喊 UNO":3,"挑战":4},"players":[{"seat":0,"metrics":{"plays":25,"draws":24,"stackPlays":4,"unoCalls":0,"challenges":1}},{"seat":1,"metrics":{"plays":22,"draws":22,"stackPlays":0,"unoCalls":0,"challenges":2}},{"seat":2,"metrics":{"plays":21,"draws":15,"stackPlays":3,"unoCalls":1,"challenges":1}},{"seat":3,"metrics":{"plays":22,"draws":15,"stackPlays":5,"unoCalls":2,"challenges":0}}]},{"summary":{"动作":39,"出牌":25,"摸牌":20,"叠牌":3,"喊 UNO":1,"挑战":0},"players":[{"seat":0,"metrics":{"plays":5,"draws":4,"stackPlays":0,"unoCalls":0,"challenges":0}},{"seat":1,"metrics":{"plays":7,"draws":0,"stackPlays":1,"unoCalls":1,"challenges":0}},{"seat":2,"metrics":{"plays":7,"draws":4,"stackPlays":1,"unoCalls":0,"challenges":0}},{"seat":3,"metrics":{"plays":6,"draws":12,"stackPlays":1,"unoCalls":0,"challenges":0}}]},{"summary":{"动作":239,"出牌":139,"摸牌":133,"叠牌":17,"喊 UNO":5,"挑战":4},"players":[{"seat":0,"metrics":{"plays":69,"draws":70,"stackPlays":8,"unoCalls":3,"challenges":2}},{"seat":1,"metrics":{"plays":70,"draws":63,"stackPlays":9,"unoCalls":2,"challenges":2}}]}] |
| ✅ | 全体操作构成环形图数据自洽（各部分之和 = 五项操作合计） | [{"plays":90,"draws":76,"stackPlays":12,"unoCalls":3,"challenges":4},{"plays":25,"draws":20,"stackPlays":3,"unoCalls":1,"challenges":0},{"plays":139,"draws":133,"stackPlays":17,"unoCalls":5,"challenges":4}] |
| ✅ | 剩余手牌构成图表与结算行剩余张数一致 | [{"rows":[{"seat":0,"cards":6,"shownCount":6,"isWinnerRow":false,"text":"你6 张"},{"seat":1,"cards":7,"shownCount":7,"isWinnerRow":false,"text":"老王7 张"},{"seat":2,"cards":1,"shownCount":1,"isWinnerRow":false,"text":"小美UNO1 张"},{"seat":3,"cards":0,"shownCount":0,"isWinnerRow":true,"text":"阿强0 张 · 出完手牌"}],"hands":[{"seat":0,"colors":{"red":1,"yellow":3,"green":2,"blue":0,"wild":0}},{"seat":1,"colors":{"red":1,"yellow":3,"green":2,"blue":1,"wild":0}},{"seat":2,"colors":{"red":0,"yellow":1,"green":0,"blue":0,"wild":0}},{"seat":3,"colors":{"red":0,"yellow":0,"green":0,"blue":0,"wild":0}}]},{"rows":[{"seat":0,"cards":6,"shownCount":6,"isWinnerRow":false,"text":"你6 张"},{"seat":1,"cards":0,"shownCount":0,"isWinnerRow":true,"text":"老王0 张 · 出完手牌"},{"seat":2,"cards":4,"shownCount":4,"isWinnerRow":false,"text":"小美4 张"},{"seat":3,"cards":13,"shownCount":13,"isWinnerRow":false,"text":"阿强13 张"}],"hands":[{"seat":0,"colors":{"red":1,"yellow":0,"green":2,"blue":3,"wild":0}},{"seat":1,"colors":{"red":0,"yellow":0,"green":0,"blue":0,"wild":0}},{"seat":2,"colors":{"red":2,"yellow":0,"green":2,"blue":0,"wild":0}},{"seat":3,"colors":{"red":3,"yellow":5,"green":5,"blue":0,"wild":0}}]},{"rows":[{"seat":0,"cards":8,"shownCount":8,"isWinnerRow":false,"text":"你8 张"},{"seat":1,"cards":0,"shownCount":0,"isWinnerRow":true,"text":"老王0 张 · 出完手牌"}],"hands":[{"seat":0,"colors":{"red":5,"yellow":0,"green":2,"blue":1,"wild":0}},{"seat":1,"colors":{"red":0,"yellow":0,"green":0,"blue":0,"wild":0}}]}] |
| ✅ | 结算页赢家行标注「出完手牌 / 手牌最少获胜」 | [["你6 张","老王7 张","小美UNO1 张","阿强0 张 · 出完手牌"],["你6 张","老王0 张 · 出完手牌","小美4 张","阿强13 张"],["你8 张","老王0 张 · 出完手牌"]] |
| ✅ | 出牌通过点击手牌完成（操作栏无出牌按钮） | cardClicks=99 |
| ✅ | 摸牌按钮文案为「摸牌」（BUG-01 新规则：摸到可出为止） | sawDrawLabel=true |
| ✅ | 引擎事件覆盖：出牌/摸牌/回合结束 | {"DEAL":46,"START_CARD":9,"PLAY":359,"COLOR_SET":44,"STACK_PUSH":59,"STACK_RESOLVE":27,"DRAW":207,"REVERSE":23,"CHALLENGE_FAIL":7,"SKIP":46,"CHALLENGE_SUCCESS":5,"UNO_CALLED":12,"PLAYER_OUT":5,"ROUND_END":5,"UNO_CAUGHT":1,"PILE_RESHUFFLE":2} |
| ✅ | 引擎事件包含叠牌/挑战/UNO 路径（随机对局统计） | {"DEAL":46,"START_CARD":9,"PLAY":359,"COLOR_SET":44,"STACK_PUSH":59,"STACK_RESOLVE":27,"DRAW":207,"REVERSE":23,"CHALLENGE_FAIL":7,"SKIP":46,"CHALLENGE_SUCCESS":5,"UNO_CALLED":12,"PLAYER_OUT":5,"ROUND_END":5,"UNO_CAUGHT":1,"PILE_RESHUFFLE":2} |
| ✅ | 引擎模式：事件播放期间出现 aria-busy 输入锁 | busy 记录 16 次 |
| ✅ | 引擎模式：动画期间操作按钮被禁用 | {"actionDisabled":0,"handDisabled":7,"busyAttr":"true"} |
| ✅ | 引擎模式：AI 回合显示「思考中」气泡 | thinking 出现动画名=dots |
| ✅ | 引擎模式：动画结束后 aria-busy 解除 |  |
| ✅ | M4 智谱在线成功：状态栏显示「智谱」 | indicator=智谱 |
| ✅ | M4 智谱台词：AI 气泡展示 LLM line | line=阿强：“看我的” |
| ✅ | AI 台词只短暂展示：TTL/换人后自动消失（不跨回合残留） | line=阿强：“看我的” clearAfter=2812ms |
| ✅ | 回大厅后 AI 台词清空（不留对话/不跨局残留） | [] |
| ✅ | M4 智谱失败自动降级：状态栏显示「本地·降级」+ 提示 toast | degradeSeen=true toast=智谱免费模型繁忙，已自动降级本地 AI |
| ✅ | M4 降级后本地 AI 继续行动（对局不中断） | eventFeedChanged=true |
| ✅ | 回大厅后 AI 台词清空（不留对话/不跨局残留） | [] |
| ✅ | mock 牌桌：手牌区无「你的手牌 / N 张」 | {"heading":false,"count":false,"text":""} |
| ✅ | mock 牌桌：操作栏只剩功能按钮（无出牌按钮） | [{"text":"摸牌","disabled":false}] |
| ✅ | mock 牌桌：正常回合无冗余提示文字 | hint= |
| ✅ | 事件队列逐条播放（5 事件 = 200ms/条基础 + 动效时长） | elapsed=1347ms |
| ✅ | 事件队列期间 aria-busy=true 且操作按钮禁用 | {"busy":true,"disabled":1} |
| ✅ | 事件队列结束后 aria-busy / aria-disabled 清理 | {"busy":null,"actionBarDisabled":null} |
| ✅ | 事件动效：飞牌/横幅等临时元素由动效层创建（至少 2 个同时动画） | {"maxCards":2,"maxLayer":2,"lastEffect":"PILE_RESHUFFLE","elapsed":2035,"layer":0,"busy":null} |
| ✅ | 事件动效：队列结束后动效层清理干净、输入锁解除 | {"layer":0,"busy":null} |
| ✅ | 事件动效：6 个事件总时长合理（约 0.6~3s） | elapsed=2035ms |
| ✅ | dev 工具条「重播动画」触发动效（mock 局面） | {"layer":1,"lastEffect":"PLAY"} |
| ✅ | 结算彩带：获胜后全屏彩带出现（≥10 个同屏）且从屏幕顶部开始飘落 | {"count":24,"max":24,"minTop":-24} |
| ✅ | 结算彩带：事件队列结束后彩带继续自然飘落（不被提前清空） | count=24 |
| ✅ | 结算彩带：完整飘到屏幕底部后自动清理 | count=0 |
| ✅ | reduced-motion 下跳过动画与事件动效（<100ms 完成） | elapsed=0ms |
| ✅ | 设置关闭动画后跳过动画与事件动效（<100ms） | elapsed=0ms |
| ✅ | 音效：音效开启时事件触发合成音效（3 个事件 ≥3 次） | {"before":0,"after":3,"audio":"running","soundVolume":0.7} |
| ✅ | 音效：首次用户交互后 AudioContext 可用（autoplay 解锁） | audio=running |
| ✅ | 音效：设置关闭后不再播放 | {"before":0,"after":0} |
| ✅ | 挑战手牌展示：人类挑战 AI 成功时展示对方完整手牌 | {"count":5,"title":"挑战成功：查看 老王 的手牌"} |
| ✅ | 挑战手牌展示：约 2~3 秒后自动消失 | {"elapsed":2603,"visible":false} |
| ✅ | 挑战手牌展示：展示期间输入锁定（aria-busy） | busy=true |
| ✅ | 挑战：AI 挑战人类只提示「查看了你的手牌」且不展示手牌 | {"toast":"老王 查看了你的手牌","overlayHidden":true} |
| ✅ | 设置页：规则 4 项 + 音效音量/动画速度可配置且默认值正确 | {"twoPlayerRules":true,"unoPenalty":"2","deckExhaustion":"reshuffle","startCardRule":"classic","soundVolume":"0.7","animationSpeed":"normal","hasRulesHeading":true} |
| ✅ | 设置页：规则项保存到本地设置（uno:settings） | {"autoCallUno":false,"aiSpeed":"fast","sound":false,"soundVolume":0.35,"animation":true,"animationSpeed":"fast","showHint":true,"aiChatter":true,"twoPlayerRules":false,"unoPenalty":3,"deckExhaustion":"end-by-fewest","startCardRule":"ignore-action"} |
| ✅ | 设置页：保存后提示「设置已保存」 | 老王 查看了你的手牌设置已保存 |
| ✅ | 设置页：规则项映射到本局引擎配置（2 人局真实开局） | {"playerCount":2,"twoPlayerRules":false,"unoPenalty":3,"deckExhaustion":"end-by-fewest","startCardRule":"ignore-action"} |
| ✅ | 设置页：规则项刷新后保持（持久化） | {"twoPlayerRules":false,"unoPenalty":"3","deckExhaustion":"end-by-fewest","startCardRule":"ignore-action","soundVolume":"0.35","animationSpeed":"fast"} |
| ✅ | 弹窗进场动画 dialog-in 生效 | animationName=dialog-in |
| ✅ | UNO 按钮显著放大（高度 ≥56px、字号 ≥20px） | {"w":123,"h":64,"font":22,"text":"UNO!"} |
| ✅ | UNO 窗口：按钮显示倒计时条（时长 = 窗口时长） | {"duration":"4s"} |
| ✅ | UNO 单击一次即喊出（不再二次确认弹窗） | {"dialogOpen":false,"toast":"（演示）已提交：UNO!"} |
| ✅ | UNO 按钮脉冲动画 uno-pulse 生效 | animationName=uno-pulse |
| ✅ | UNO 窗口边界：需要自己喊 UNO 时无「抓他！」按钮 | [{"text":"UNO!","disabled":false}] |
| ✅ | 抓 UNO：操作栏出现「抓他！」按钮 | [{"text":"抓他！","disabled":false}] |
| ✅ | 抓 UNO：弹窗要求确认（含「抓他！」按钮） | ["×","抓他！"] |
| ✅ | 抓 UNO：确认后提交动作并关闭弹窗 | {"dialogOpen":false,"toast":"（演示）已提交：UNO!（演示）已提交：抓他！"} |
| ✅ | AI「思考中」气泡 dots 动画生效 | ::after animationName=dots |
| ✅ | mock 结算页正常渲染（UI 回归） | 🏆 你 获胜 |
| ✅ | 牌堆边界：抽牌堆剩 0 张时计数正常显示 | {"text":"0","dataCount":"0","feed":"牌堆重新洗牌你 摸了 2 张"} |
| ✅ | 牌堆边界：洗回事件在事件流显示「牌堆重新洗牌」 | 牌堆重新洗牌你 摸了 2 张 |
| ✅ | 牌堆边界：抽牌堆剩 1 张时计数正常显示 | {"text":"1","dataCount":"1"} |
| ✅ | 1024 宽大厅无横向溢出 | {"scroll":1024,"client":1024} |
| ✅ | 1024 宽牌桌无横向溢出、放大的当前颜色不遮挡/不溢出 | {"dotW":22,"dotH":22,"labelFont":18,"labelRect":{"top":24,"right":139},"viewportW":1024,"topBarOverflow":false,"pageOverflow":false} |
| ✅ | 1024 牌桌操作栏无出牌按钮 | [{"text":"摸牌","disabled":false}] |
| ✅ | 760 宽大厅无横向溢出 | {"scroll":760,"client":760} |
| ✅ | 760 宽牌桌无横向溢出、手牌区可横向滚动兜底、操作栏可用 | {"overflow":{"scroll":760,"client":760},"hand":{"scroll":740,"client":740,"cards":5},"actionBar":1} |
| ✅ | 没有控制台 JS 异常 |  |
| ✅ | 没有 console.error |  |
| ✅ | 没有失败的网络请求 |  |
| ✅ | 没有 4xx/5xx 响应 |  |
| ✅ | 所有请求同源（无外链） |  |
| ✅ | 引擎 bundle 被页面加载（js/vendor/uno-engine.js） |  |

## 引擎事件统计（3 局真实对局，快速模式）

| 事件 | 次数 |
|------|------|
| PLAY | 359 |
| DRAW | 207 |
| STACK_PUSH | 59 |
| DEAL | 48 |
| SKIP | 46 |
| COLOR_SET | 44 |
| STACK_RESOLVE | 27 |
| REVERSE | 23 |
| UNO_CALLED | 12 |
| START_CARD | 10 |
| CHALLENGE_FAIL | 7 |
| CHALLENGE_SUCCESS | 5 |
| PLAYER_OUT | 5 |
| ROUND_END | 5 |
| PILE_RESHUFFLE | 2 |
| UNO_CAUGHT | 1 |

## 对局结算摘要

- 第 1 局：🏆 阿强 获胜
- 第 2 局：🏆 老王 获胜
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
- review-assets/ui-m5-catch-uno-1440.png
- review-assets/ui-m5-challenge-hand-1440.png
- review-assets/ui-m5-6p-1440.png
- review-assets/ui-m5-10p-1440.png
- review-assets/ui-m5-10p-1024.png
- review-assets/ui-m6-effects-1440.png
- review-assets/ui-m6-settings-1440.png
- review-assets/ui-m6-mobile-760.png
