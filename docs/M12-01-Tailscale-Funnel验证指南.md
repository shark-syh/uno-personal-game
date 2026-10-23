# M12-01 Tailscale Funnel 跨网验证指南（暂缓）

> 状态：**已暂缓，不执行**（2026-10-21 起）。仅作恢复 M12 时的参考，不是当前任务。
> 原范围：验证「Tailscale Funnel → 房主本地 UNO 服务 → 客人浏览器」链路；不含桌面集成、固定端口、房间密码与限流。
> 原适用版本：UNO v1.3.0；Tailscale v1.38.3+。恢复前需重新确认版本与安全边界。

## 1. 目的

1. Funnel 能否把房主 UNO 稳定暴露为公网 HTTPS。
2. 客人不装 Tailscale/UNO、不登录，能否只用浏览器打开页面。
3. HTTPS 页面能否自动建立 `wss://`，完成加入、对局、刷新重连。
4. 房主关闭 UNO 后，客人能否收到 `server-closing` 回大厅；Funnel 关闭后网址是否失效。

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 房主 | Windows 10/11 x64；UNO v1.3.0 或 `npm run dev`；Tailscale 已登录 |
| Tailnet | 开启 Funnel、MagicDNS、HTTPS；首次需 Owner/Admin/Network admin |
| 客人 | 现代浏览器；**不安装 Tailscale**；与房主不同网络（建议手机热点） |
| 安全 | 测试期不配智谱 Key，AI 选「本地」；不用真实姓名；结束后立即关闭 Funnel |
| 时长 | 首次 DNS 可能等待数分钟，建议预留 20~30 分钟 |

## 3. 安全须知

- Funnel 是公网入口，任何拿到 URL 的人都能打开；当前版本**没有公网安全加固**。
- 不要公开 URL；不要用生产智谱 Key（`/api/ai/decide` 无公网鉴权）。
- `/api/health` 会返回 `lanUrls`，不要截图或转发。
- 只指向 UNO 端口，不指向文件目录、管理后台或其他服务。
- 测试结束执行 `tailscale funnel reset`，确认 `funnel status` 已无 UNO 路由；`reset` 会清除本机全部 Funnel 配置，有其它服务时改用精确 `off`。

## 4. 方案 A：网页版主机

1. 房主 `npm run dev`，打开 `http://localhost:3000`，进入「局域网联机」创建房间，记下 6 位码；加 1 个 AI 补位；AI 模式选本地。
2. 另开 PowerShell：`tailscale funnel 3000`（首次需浏览器批准）；复制 `https://<设备>.<tailnet>.ts.net`。
   需要后台保持时用 `tailscale funnel --bg 3000`。
3. 客机（另一网络、未装 Tailscale）打开该 HTTPS 地址，输入房间码加入。
4. 房主开始游戏，完成一局。

## 5. 方案 B：桌面版主机

1. 安装并启动 `UNO-Setup-1.3.0.exe`；设置页清除 Key，AI 选本地；创建房间并记码。
2. 取桌面版随机端口：
   ```powershell
   $pids = (Get-Process UNO -ErrorAction SilentlyContinue).Id
   Get-NetTCPConnection -State Listen |
     Where-Object { $pids -contains $_.OwningProcess } |
     Select-Object LocalAddress, LocalPort, OwningProcess
   ```
   排除 UDP 41234 后，`0.0.0.0` 上的随机 TCP 端口即服务端口；也可在 DevTools 执行 `await window.unoDesktop.getServerInfo()`。
3. `tailscale funnel <端口>`，确认代理目标是 `http://127.0.0.1:<端口>`，复制公网 URL。
4. 客人操作同方案 A；房主端邀请文案仍显示局域网地址，需手动发 Funnel URL + 房间码。
5. 关闭 UNO 后执行 `tailscale funnel reset`；重新打开会得到新随机端口，需重新配置。

## 6. 必验项目

| # | 项目 | 通过标准 |
| --- | --- | --- |
| 1 | 页面加载 | HTTPS 页面完整，静态资源无 404 |
| 2 | WSS 握手 | DevTools 中 `wss://.../ws` 返回 101 |
| 3 | 加入房间 | 客人输入房间码进入房间面板 |
| 4 | 完整对局 | 出牌、摸牌、UNO、+4、表情、结算、再来一局至少一局 |
| 5 | 刷新重连 | 客人刷新后恢复座位，或能重新加入 |
| 6 | 主机关窗 | 桌面版关窗后客人收到 `server-closing` 并回大厅，不无限重连 |
| 7 | 关闭 Funnel | 关闭后公网 URL 不可访问，重开可恢复 |
| 8 | 控制台 | 双方 0 error/exception；无异常 4xx/5xx |

- 方案 A 通过后再做方案 B；第 6 项必须用桌面版验证。
- 任何一项失败记录现象与截图，不进入 M12-02。

## 7. 预期边界（不是缺陷）

- 桌面客机不能只靠房间码从公网加入：客户端先走 UDP 发现，手动地址只拼 `ws://`；客人必须用浏览器。
- 房主邀请文案仍显示局域网地址；桌面端口随机；没有房间密码/限流/Origin 校验/`/api/health` 脱敏。
- Funnel 为 Beta，有带宽限制、仅 443/8443/10000、仅 TLS；首次 DNS 可能延迟约 10 分钟。

## 8. 结果记录

```text
M12-01 真机验证
日期：
房主：Windows / UNO / Tailscale 版本
主机方式：网页版 3000 / 桌面版随机端口
Funnel URL（设备名可脱敏）：
客人：网络 / 浏览器 / 是否安装 Tailscale（应为否）
结果：页面加载 / WSS 101 / 加入 / 完整对局 / 刷新重连 / 主机关窗 / 关闭 Funnel / 控制台错误
失败点与截图：
是否通过：
```

## 9. 通过后

- 通过：进入 M12-02（Funnel 启停与 `publicUrl` 注入），不做安全加固。
- 未通过：按失败点归类到 M12-02/03/04，不直接改游戏核心。
- 无论结果如何，结束都要 `tailscale funnel reset` 并确认状态为空。
