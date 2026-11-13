# 素材来源与许可说明

## `cards/`：54 张原始卡面

- 内容：标准 UNO 牌面 54 张唯一卡面（用于 `scripts/process-cards.py` 生成 `apps/web/cards/*.png`）。
- 来源：**CC0** —— [github.com/celsiusnarhwal/uno](https://github.com/celsiusnarhwal/uno)，其素材由 [Wikimedia Commons 的 UNO_cards_deck.svg](https://commons.wikimedia.org/wiki/File:UNO_cards_deck.svg) 切分而来。
- 用途：个人学习演示项目；卡面图案的知识产权归 Mattel（UNO® 是 Mattel 的注册商标），本项目与 Mattel 无关联。

## 官方规则参考

开发期间参考过 UNO 官方规则文档（Mattel 发布）。为控制仓库体积并避免不必要地再分发第三方文档，**官方规则 PDF 不放入本仓库**；可参考：

- [UNO 官方规则（Mattel）](https://www.mattelgames.com/en-us/card-games/uno)
- [UnoRules 规则整理](https://www.unorules.com/)

规则实现细节以 [`docs/开发计划.md`](../docs/开发计划.md) 第 2 章为准；与官方原版的差异（宽松叠牌、摸到可出为止、2 人规则等）见根目录 README 与开发计划 §2.8。

## 处理流水线

```bash
python scripts/process-cards.py   # research/cards/*.png → apps/web/cards/*.png + manifest.json
```

处理后的卡面已提交到 `apps/web/cards/`（240×360 PNG + `manifest.json`），日常运行无需重新处理。

## `open-mercy/`：B 版参考卡面（2026-11-13 新增）

- 来源：[github.com/alii13/open-mercy](https://github.com/alii13/open-mercy)（MIT，Copyright (c) 2026 alii13），经国内镜像 `ghfast.top` 下载；完整原始包见 `open-mercy-main.zip`，裁剪结果见 `open-mercy/`。
- 内容：友尽版（No Mercy）卡面 68 个唯一面（`cards-webp/` 四色渲染、`cards-svgs/` 矢量描摹、`cards/` 实物照片）+ 规则参考与规则引擎，用于「进阶 / 友尽」两个新模式。
- **采用口径（用户 2026-11-13 决定）**：仅作者本人个人学习、研究与非商业演示使用，不用于任何商业活动；卡面美术与 UNO® 商标归 Mattel，MIT 只覆盖上游软件与文档，矢量描摹属复制性演绎、不主张原创权利、不标注为开源卡面；不随 exe / GitHub Release 等公开渠道外传。
- 完整来源、可用性逐项说明与**权限申明**见 [`open-mercy/README-来源与裁剪.md`](./open-mercy/README-来源与裁剪.md) §6，卡面预览见 `open-mercy/card-gallery.html` 页脚。
- 注意：`apps/web/cards/` 的 54 张 CC0 基础卡面仍受「牌面素材不可修改」红线保护，本目录资料不参与构建、不属于运行时资源。
