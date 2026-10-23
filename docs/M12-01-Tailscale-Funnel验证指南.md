# M12-01 Tailscale Funnel 跨网验证指南（暂缓）

> 状态：**已暂缓，不执行**（2026-10-21 起）。跨网公网联机（M12）当前不开发；本指南仅作为以后恢复时的参考，不是当前任务。
> 原范围：验证「Tailscale Funnel → 房主本地 UNO 服务 → 客人浏览器」链路；不包含桌面版自动集成、固定端口、房间密码与限流。
> 原适用版本：UNO v1.3.0；Tailscale v1.38.3 及以上。恢复 M12 前需重新确认版本与安全边界。

## 1. 目的与范围

本指南回答四个问题：

1. Tailscale Funnel 能否把房主电脑上的 UNO 服务稳定地暴露为公网 HTTPS 地址。
2. 客人**不安装 Tailscale、不安装 UNO、不登录账号**，只用浏览器能否打开页面。
3. 浏览器在 HTTPS 页面下能否自动建立 `wss://` WebSocket，并完成加入房间、完整对局、刷新重连。
4. 房主关闭 UNO 后，客人能否收到 `server-closing` 并回到大厅；Funnel 关闭后网址是否失效。

本指南不做什么：

- 不修改任何代码。
- 不做桌面版自动开/关 Funnel。
- 不做固定端口、邀请链接改造、房间密码、限流、Origin 校验、`/api/health` 脱敏。
- 不验证桌面客机通过公网加入（当前桌面客机仍依赖 UDP 发现与 `ws://`，见 §8）。

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 房主系统 | Windows 10/11 x64 |
| UNO | v1.3.0 安装版，或仓库内 `npm run dev` 网页版 |
| Tailscale | v1.38.3+；Windows 客户端已安装并登录 |
| Tailnet 权限 | 首次启用 Funnel 需要 Owner / Admin / Network admin；普通成员需管理员提前放行 |
| Tailnet 配置 | MagicDNS 已开启；HTTPS 证书已开启；Funnel 已启用 |
| 房主网络 | 能正常访问 Tailscale 控制面；无需公网 IP、无需路由器端口映射 |
| 客人设备 | Chrome / Edge / Safari 等现代浏览器；**不安装 Tailscale**；首轮建议用笔记本，便于看 DevTools |
| 客人网络 | 与房主不同网络（推荐笔记本连接手机热点；不要与房主同一 WiFi） |
| 安全前提 | 测试期间**不要配置智谱 Key**，AI 模式选「本地」；不要使用真实姓名或敏感房间名 |
| 测试时长 | 首次 DNS 可能等待数分钟；建议预留 20~30 分钟 |

检查 Tailscale：

```powershell
tailscale version
tailscale status
```

如果提示找不到 `tailscale`，重启终端；仍找不到时使用完整路径：

```powershell
& "C:\Program Files\Tailscale\tailscale.exe" version
```

如果提示权限不足，改用「以管理员身份运行」的 PowerShell；Funnel 首次启用也可能要求管理员。

## 3. 安全须知（先读）

Funnel 是**公网入口**：任何拿到 URL 的人都能打开页面。当前版本还没有公网安全加固，因此：

- 只在测试期间开启；测试结束立即关闭 Funnel。
- 不要把 Funnel URL 发到公开群、论坛、截图或录屏中。
- 使用一次性测试房间；不要用真实姓名。
- **不要使用生产智谱 Key**。当前 `/api/ai/decide` 没有公网鉴权，拿到 URL 的人可能消耗房主额度。测试时清空桌面版 Key，或使用不含 Key 的环境。
- `/api/health` 目前会返回 `lanUrls`，可能包含房主内网地址；不要把该接口截图或转发。M12-04 会做公网脱敏。
- Funnel 只应指向 UNO 的本地端口，不要指向文件目录、管理后台或其他服务。
- 测试完成后执行 `tailscale funnel reset`，并确认 `tailscale funnel status` 已无 UNO 路由。

> `tailscale funnel reset` 会清除本机**所有** Funnel 配置。如果这台电脑还有别的 Funnel 服务，请改用原始命令加 `off`（见 §6.2）。

## 4. 方案 A：网页版主机（推荐先做）

先用固定端口 `3000` 验证 Funnel 与 WSS，排除桌面版随机端口带来的干扰。

### 4.1 启动房主 UNO

在仓库根目录执行：

```powershell
npm install
npm run dev
```

确认本机可访问：

```text
http://localhost:3000
```

在本机浏览器打开该地址，进入「局域网联机」：

1. 显示名可留空，默认「你」。
2. 点击「创建房间」。
3. 记下 6 位房间码。
4. 先添加 1 个 AI 补位，确保只有房主一人也能开局。
5. 确认 AI 模式为「本地」，不要选智谱。

此时先不要关闭房主浏览器标签页。

### 4.2 开启 Funnel

保持 UNO 服务运行，另开一个 PowerShell：

```powershell
tailscale funnel 3000
```

首次执行会打开浏览器，要求批准启用 Funnel；批准后 Tailscale 会自动处理 HTTPS 证书与 tailnet 策略。成功输出类似：

```text
Available on the internet:
https://<设备名>.<tailnet>.ts.net

|-- / proxy http://127.0.0.1:3000

Press Ctrl+C to exit.
```

复制 `https://...ts.net` 地址。这个地址不带端口。

如果希望关闭终端后仍保持：

```powershell
tailscale funnel --bg 3000
tailscale funnel status
```

`--bg` 模式在重启电脑或重启 Tailscale 后会自动恢复；测试结束后仍必须手动关闭。

### 4.3 客人浏览器加入

在客机（手机热点或其他网络）确认：

1. 没有安装、也没有登录 Tailscale。
2. 浏览器打开 Funnel 的 `https://...ts.net` 地址。
3. 页面正常显示 UNO 大厅。
4. 在「局域网联机」输入房间码，点击「加入房间」。

预期：

- 客人进入「联机房间」面板，座位列表出现自己。
- 房主端同时看到客人加入。
- 房主点击「开始游戏」，双方进入牌桌。

### 4.4 必验项目

按顺序完成，每项记录结果：

1. **页面加载**：客人能打开 HTTPS 页面，静态资源（卡面、字体、音效）无 404。
2. **WSS 握手**：客人 DevTools → Network → WS，看到 `wss://...ts.net/ws`，状态 `101 Switching Protocols`。
3. **加入房间**：房间码正确，客人进入房间面板，没有「未发现该房间」提示。
4. **完整对局**：出牌、摸牌、UNO、+4 挑战、表情、结算、再来一局至少走完一局。
5. **刷新重连**：客人刷新页面，应使用 `sessionStorage` 中的会话恢复座位；若未恢复，重新输入房间码应能加入。
6. **房主离开**：
   - 方案 B：关闭 UNO 窗口，客人应收到「主机已关闭游戏，联机已结束」并回大厅；不应无限重连。
   - 方案 A：关闭房主浏览器标签页，预期是房主迁移，不是 `server-closing`；关闭 `npm run dev` 则是连接断开。分别记录，不要混为一项。
7. **Funnel 关闭**：执行关闭命令后，客人刷新网址应无法访问；重新开启后可恢复。
8. **控制台**：双方 DevTools Console 无 error/exception；Network 无 4xx/5xx（静态资源缓存命中除外）。

## 5. 方案 B：桌面版主机（验证当前真实路径）

方案 A 通过后，再用 v1.3.0 安装版验证桌面版。当前桌面版端口是随机的，且界面不显示，需要手动取端口。

### 5.1 准备桌面版

1. 安装并启动 `UNO-Setup-1.3.0.exe`。
2. 打开设置，清除已保存的智谱 Key；AI 模式选「本地」。
3. 进入「局域网联机」，创建房间，记下房间码。
4. 可先加 1 个 AI 补位。

### 5.2 获取桌面版监听端口

方法一：PowerShell 查监听端口（推荐，不依赖 DevTools）

```powershell
$pids = (Get-Process UNO -ErrorAction SilentlyContinue).Id
Get-NetTCPConnection -State Listen |
  Where-Object { $pids -contains $_.OwningProcess } |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

排除 UDP 41234 后，`LocalAddress` 为 `0.0.0.0` 的随机 TCP 端口即 UNO 服务端口。可打开 `http://127.0.0.1:<端口>` 确认是 UNO 页面。

如果 `Get-Process UNO` 找不到进程，先确认真实进程名：

```powershell
Get-Process | Where-Object { $_.ProcessName -like '*UNO*' } | Select-Object Id, ProcessName
```

方法二：DevTools 控制台（如果快捷键可用）

桌面版移除了应用菜单，`Ctrl+Shift+I` 不一定能打开 DevTools。若能打开，在 Console 执行：

```js
await window.unoDesktop.getServerInfo()
```

返回对象中的 `port` 就是内嵌服务端口，例如 `51234`；`localUrl` 形如 `http://127.0.0.1:51234`。

### 5.3 开启 Funnel

把 `<端口>` 替换为上一步得到的端口：

```powershell
tailscale funnel <端口>
```

确认输出中的代理目标是 `http://127.0.0.1:<端口>`，复制公网 URL。

### 5.4 客人加入与验收

客人操作与 §4.3 相同。额外注意：

- 房主端「其他设备请打开 …」提示仍显示局域网地址，这是当前 M10 的预期行为；测试时**手动把 Funnel URL + 房间码发给客人**。
- 客人必须是浏览器；不要用另一台 UNO 桌面版只输入房间码，原因见 §8。
- 完成 §4.4 的 8 项验收。

### 5.5 关闭与恢复

1. 关闭 UNO 窗口。桌面版会先广播 `server-closing`，再释放端口。
2. 执行：

```powershell
tailscale funnel reset
tailscale funnel status
```

3. 重新打开 UNO 会得到**新的随机端口**；必须重新执行 `tailscale funnel <新端口>`。这正是 M12-03 要解决的问题。

## 6. 关闭 Funnel

### 6.1 清除全部 Funnel 配置

```powershell
tailscale funnel reset
tailscale funnel status
```

`status` 不再列出 UNO 路由即关闭成功。

### 6.2 只关闭 UNO 这一条

如果本机还有别的 Funnel 服务，不要用 `reset`。用原始命令加 `off`，并保留原始 flags。例如默认 443 端口：

```powershell
tailscale funnel --https=443 off
```

如果启动时用了自定义 flags，关闭时也要带上相同 flags。具体规则见官方 CLI 文档。

## 7. 验收清单

| # | 项目 | 通过标准 | 结果 |
| --- | --- | --- | --- |
| 1 | 房主 Funnel 启用 | `tailscale funnel status` 显示 UNO 端口与公网 URL | 待测 |
| 2 | 客人零安装 | 客机未安装/未登录 Tailscale，浏览器能打开页面 | 待测 |
| 3 | HTTPS 页面 | 页面完整加载，无证书错误、无混合内容拦截 | 待测 |
| 4 | WSS 握手 | DevTools 中 `wss://.../ws` 返回 101 | 待测 |
| 5 | 加入房间 | 客人输入房间码后进入房间面板 | 待测 |
| 6 | 完整对局 | 至少完成一局，含 UNO、+4、表情、结算、再来一局 | 待测 |
| 7 | 刷新重连 | 客人刷新后恢复座位，或能重新加入 | 待测 |
| 8 | 主机关窗 | 方案 B 关闭 UNO 窗口，客人收到 `server-closing` 并回大厅 | 待测 |
| 9 | 关闭 Funnel | 关闭后公网 URL 不可访问 | 待测 |
| 10 | 控制台 | 双方 0 error/exception；无异常 4xx/5xx | 待测 |
| 11 | 桌面版路径 | 方案 B 同样完成第 2~10 项 | 待测 |
| 12 | 安全前提 | 测试期间未配置智谱 Key，结束后已 reset | 待测 |

**M12-01 通过条件**：第 1~12 项全部通过；其中第 8、11 项必须用方案 B 完成。任何一项失败都要记录现象与截图，不进入 M12-02。

## 8. 当前预期边界（不是缺陷）

以下现象在 M12-01 阶段属于已知边界，不要误判为 Funnel 失败：

- **桌面客机不能只靠房间码从公网加入**：桌面客户端会先走 UDP 局域网发现；公网没有广播。手动填写主机地址时当前只拼 `ws://`，不能连 Funnel 的 `wss://`。M12-01 的客人必须用浏览器。
- **房主邀请文案仍显示局域网地址**：当前 `room-invite` 取 `/api/health` 的 `lanUrls`，M12-02/03 才改为公网 URL 优先。
- **桌面版端口随机**：每次启动都会变，M12-03 才加固定端口选项。
- **没有房间密码、加入限流、Origin 校验**：M12-04 才做。测试期间不要公开 URL。
- **`/api/health` 暴露内网地址**：M12-04 才做公网脱敏。
- **Funnel 是 Beta**：有非配置带宽限制；仅 443/8443/10000；仅 TLS；依赖房主 Tailscale 在线。
- **首次 DNS 可能延迟**：最多约 10 分钟；`nslookup <设备名>.<tailnet>.ts.net` 可辅助判断。

## 9. 常见问题

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| `tailscale: 无法识别` | CLI 不在 PATH | 重启终端，或用 `& "C:\Program Files\Tailscale\tailscale.exe" ...` |
| `Funnel is not enabled` / 无权限 | tailnet 未启用 Funnel，或当前角色不够 | 管理员在 Admin console → DNS 开启 Funnel；确认 Owner/Admin/Network admin |
| 命令成功但 URL 打不开 | DNS 未传播、Funnel 未批准、端口错误 | 等待几分钟；`tailscale funnel status`；`nslookup` |
| URL 返回 502/404 | Funnel 指向的本地端口没有服务 | 本机打开 `http://127.0.0.1:<端口>` 确认；重新检查端口 |
| 页面能开，但加入房间超时 | WebSocket 被网络拦截，或服务未监听 | DevTools 看 `wss://.../ws`；换手机热点；确认本机 `/api/health` 正常 |
| 控制台报 mixed content | 页面是 HTTPS，但代码尝试 `ws://` | 浏览器客人应自动走 `wss://`；若未走，记录为 M12-02/06 待修 |
| 客人刷新后回大厅 | 会话过期或房间已结束 | 重新输入房间码；记录是否可复现 |
| 房主关窗后客人一直重连 | 未收到 `server-closing` 或网络中断 | 记录时间线与控制台；这是 M12-01 的关键失败项 |
| `reset` 误删了其他 Funnel | `reset` 清除本机全部 Funnel | 用原始命令重新配置其他服务；后续改用精确 `off` |
| 443 被 Serve 占用 | 同一端口不能同时 Serve 和 Funnel | 改用 8443/10000，或先调整既有 Serve 配置 |

## 10. 结果记录模板

验证完成后，把下面内容补充到 `docs/开发进度.md` 或直接回报：

```text
M12-01 真机验证
日期：
房主：Windows 版本 / UNO 版本 / Tailscale 版本 / tailnet
主机方式：网页版 3000 / 桌面版随机端口
Funnel URL（可脱敏设备名）：
客人：网络（手机热点等）/ 浏览器版本 / 是否安装 Tailscale（应为否）
结果：
- 页面加载：
- WSS 101：
- 加入房间：
- 完整对局：
- 刷新重连：
- 主机关窗：
- 关闭 Funnel：
- 控制台错误：
- 延迟/卡顿：
失败点与截图：
是否通过：
```

## 11. 通过后

- 通过：进入 M12-02「桌面集成」，先做 Funnel 启停与 `publicUrl` 注入，不做安全加固。
- 未通过：按失败点归类到 M12-02（集成/端口）、M12-03（邀请/端口）或 M12-04（安全/Origin），不要直接改游戏核心。
- 无论结果如何，测试结束都要执行 `tailscale funnel reset` 并确认状态为空。

## 12. 参考

- Tailscale Funnel 功能与限制：<https://tailscale.com/docs/features/tailscale-funnel>
- `tailscale funnel` CLI：<https://tailscale.com/docs/reference/tailscale-cli/funnel>
- 分享本地开发服务器：<https://tailscale.com/docs/use-cases/application-testing/share-local-dev-server-with-internet>
