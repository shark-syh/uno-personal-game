# 素材来源与许可说明

## `cards/`：54 张原始卡面

- 内容：标准 UNO 牌面 54 张唯一卡面（用于 `scripts/process-cards.py` 生成 `apps/web/cards/*.png`）。
- 来源：**CC0** —— [github.com/celsiusnarhwal/uno](https://github.com/celsiusnarhwal/uno)，其素材由 [Wikimedia Commons 的 UNO_cards_deck.svg](https://commons.wikimedia.org/wiki/File:UNO_cards_deck.svg) 切分而来。
- 用途：个人学习演示项目；卡面图案的知识产权归 Mattel（UNO® 是 Mattel 的注册商标），本项目与 Mattel 无关联。

## 官方规则参考

开发期间参考过 UNO 官方规则文档（Mattel 发布）。为控制仓库体积并避免不必要地再分发第三方文档，**官方规则 PDF 不放入本仓库**；可参考：

- [UNO 官方规则（Mattel）](https://www.mattelgames.com/en-us/card-games/uno)
- [UnoRules 规则整理](https://www.unorules.com/)

规则实现细节以 [`docs/开发计划.md`](../docs/开发计划.md) 第 4 章为准；与官方原版的差异（宽松叠牌、摸到可出为止、2 人规则等）见根目录 README 与开发计划 §4.12。

## 处理流水线

```bash
python scripts/process-cards.py   # research/cards/*.png → apps/web/cards/*.png + manifest.json
```

处理后的卡面已提交到 `apps/web/cards/`（240×360 PNG + `manifest.json`），日常运行无需重新处理。
