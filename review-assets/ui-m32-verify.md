# M3-2 浏览器验收报告（自动生成）

> 时间：2026-10-17T14:24:07.494Z ｜ 入口：http://localhost:3000 ｜ 浏览器：Chrome/155.0.8059.82
> 结果：**34 / 34 通过**

## 检查项

| 结果 | 项目 | 细节 |
|------|------|------|
| ✅ | 默认入口为引擎模式（真实对局） | getMode()=engine |
| ✅ | 引擎模式标记 `data-engine="on"` |  |
| ✅ | 大厅选项齐全（人数 9 档 / 难度 4 档 / AI 模式 3 档 / +4 挑战默认开） | {"counts":9,"difficulties":4,"modes":3,"challenge":true} |
| ✅ | 开局：人类 7 张手牌 + 3 个 AI 座位 | {"hand":7,"opponents":3,"failed":0,"overflow":{"scroll":1440,"client":1440}} |
| ✅ | 开局卡面全部加载成功 | failed=0 |
| ✅ | 1440 宽无横向溢出 | {"scroll":1440,"client":1440} |
| ✅ | 第 1 局完整打完并进入结算（🏆 小美 获胜） | ["你8 张 · 趣味分数 53","老王2 张 · 趣味分数 8","小美0 张 · 趣味分数 0","阿强6 张 · 趣味分数 44"] |
| ✅ | 第 1 局：再来一局 / 退出回大厅可用 |  |
| ✅ | 第 2 局完整打完并进入结算（🏆 小美 获胜） | ["你10 张 · 趣味分数 98","老王4 张 · 趣味分数 30","小美0 张 · 趣味分数 0","阿强3 张 · 趣味分数 34"] |
| ✅ | 第 2 局：再来一局 / 退出回大厅可用 |  |
| ✅ | 第 3 局完整打完并进入结算（🏆 老王 获胜） | ["你6 张 · 趣味分数 60","老王0 张 · 趣味分数 0"] |
| ✅ | 第 3 局：再来一局 / 退出回大厅可用 |  |
| ✅ | 引擎事件覆盖：出牌/摸牌/回合结束 | {"DEAL":20,"START_CARD":6,"PLAY":92,"REVERSE":13,"STACK_PUSH":12,"COLOR_SET":13,"STACK_RESOLVE":6,"DRAW":36,"SKIP":12,"CHALLENGE_SUCCESS":3,"UNO_CALLED":7,"PLAYER_OUT":3,"ROUND_END":3} |
| ✅ | 引擎事件包含叠牌/挑战/UNO 路径（随机对局统计） | {"DEAL":20,"START_CARD":6,"PLAY":92,"REVERSE":13,"STACK_PUSH":12,"COLOR_SET":13,"STACK_RESOLVE":6,"DRAW":36,"SKIP":12,"CHALLENGE_SUCCESS":3,"UNO_CALLED":7,"PLAYER_OUT":3,"ROUND_END":3} |
| ✅ | 引擎模式：事件播放期间出现 aria-busy 输入锁 | busy 记录 15 次 |
| ✅ | 引擎模式：动画期间操作按钮被禁用 | {"actionDisabled":0,"handDisabled":7,"busyAttr":"true"} |
| ✅ | 引擎模式：AI 回合显示「思考中」气泡 | thinking 出现动画名=none |
| ✅ | 引擎模式：动画结束后 aria-busy 解除 |  |
| ✅ | 事件队列逐条播放（5 事件 ≈ 1000ms） | elapsed=1035ms |
| ✅ | 事件队列期间 aria-busy=true 且操作按钮禁用 | {"busy":true,"disabled":6} |
| ✅ | 事件队列结束后 aria-busy / aria-disabled 清理 | {"busy":null,"actionBarDisabled":null} |
| ✅ | reduced-motion 下跳过动画（<100ms 完成） | elapsed=0ms |
| ✅ | 设置关闭动画后跳过动画（<100ms） | elapsed=0ms |
| ✅ | 弹窗进场动画 dialog-in 生效 | animationName=dialog-in |
| ✅ | UNO 按钮脉冲动画 uno-pulse 生效 | animationName=uno-pulse |
| ✅ | AI「思考中」气泡 dots 动画生效 | ::after animationName=dots |
| ✅ | mock 结算页正常渲染（UI 回归） | 🏆 你 获胜 |
| ✅ | 1024 宽大厅无横向溢出 | {"scroll":1024,"client":1024} |
| ✅ | 没有控制台 JS 异常 |  |
| ✅ | 没有 console.error |  |
| ✅ | 没有失败的网络请求 |  |
| ✅ | 没有 4xx/5xx 响应 |  |
| ✅ | 所有请求同源（无外链） |  |
| ✅ | 引擎 bundle 被页面加载（js/vendor/uno-engine.js） |  |

## 引擎事件统计（3 局真实对局，快速模式）

| 事件 | 次数 |
|------|------|
| PLAY | 92 |
| DRAW | 36 |
| DEAL | 20 |
| REVERSE | 13 |
| COLOR_SET | 13 |
| STACK_PUSH | 12 |
| SKIP | 12 |
| UNO_CALLED | 7 |
| START_CARD | 6 |
| STACK_RESOLVE | 6 |
| CHALLENGE_SUCCESS | 3 |
| PLAYER_OUT | 3 |
| ROUND_END | 3 |

## 对局结算摘要

- 第 1 局：🏆 小美 获胜
- 第 2 局：🏆 小美 获胜
- 第 3 局：🏆 老王 获胜

## 截图

- review-assets/ui-m32-lobby-1440.png
- review-assets/ui-m32-game-start-1440.png
- review-assets/ui-m32-ai-busy-1440.png
- review-assets/ui-m32-ai-thinking-1440.png
- review-assets/ui-m32-result-1440.png
- review-assets/ui-m32-mock-challenge-1440.png
- review-assets/ui-m32-mock-uno-1440.png
