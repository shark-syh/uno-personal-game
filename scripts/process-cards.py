"""把 research/cards 中的 CC0 原始卡面处理成 apps/web/cards/*.png + manifest.json。

用法（项目根目录）：
    python scripts/process-cards.py

处理内容：
- 统一尺寸 240x360（原始素材 Y4 为 240x361，多出的 1px 裁掉）
- 统一输出 PNG（原始文件大多是 GIF 数据但扩展名是 .png，浏览器按内容解析通常可用，
  这里显式转码，避免 MIME/缓存问题）
- 去掉原始模板自带的 1~2px 外圈黑色描边（见 strip_outer_outline），保证 UI 上的
  白色边框四边均匀、卡面居中
- 生成 manifest.json（唯一卡面 54 种、合计 108 张牌的映射，供 UI/引擎使用）
"""
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "research", "cards")
OUT = os.path.join(ROOT, "apps", "web", "cards")

COLORS = {"B": "blue", "G": "green", "R": "red", "Y": "yellow"}
SPECIAL = {
    "WC": ("wild", None, None, 4),
    "W4": ("wild4", None, None, 4),
}

# 卡面图案距离图片边缘至少 19px，因此只在最外 12px 的边框区域里处理深色/灰色描边像素
OUTLINE_RING = 12
OUTLINE_THRESHOLD = 255


def strip_outer_outline(image: Image.Image) -> Image.Image:
    """把卡面外圈模板描边涂成白色（含圆角处的抗锯齿像素）。

    原始 CC0 卡牌素材是"白卡 + 最外缘一圈深色轮廓"的模板；UI 在图片外还有 4px 白边，
    这条黑线会露出来且让四边白边看起来不均匀。这里只改最外 12px 边框内的深色/灰色
    抗锯齿像素（阈值 240，避免留下虚线状残影），卡面图案（距边缘 ≥19px）不受影响；
    不缩放、不裁切，保持卡牌几何与对称性。
    """
    pixels = image.load()
    width, height = image.size
    for y in range(height):
        for x in range(width):
            if OUTLINE_RING <= x < width - OUTLINE_RING and OUTLINE_RING <= y < height - OUTLINE_RING:
                continue
            r, g, b, a = pixels[x, y]
            if a > 0 and r < OUTLINE_THRESHOLD and g < OUTLINE_THRESHOLD and b < OUTLINE_THRESHOLD:
                pixels[x, y] = (255, 255, 255, 255)
    return image


def center_visual_frame(image: Image.Image) -> Image.Image:
    """按"视觉边框"把卡面图案居中：四边白边一致。

    原始模板里图案位置有 1~2px 偏移（例如 R7 顶部白边 21px、底部 19px），
    不居中会让人感觉"牌偏了/白边不均匀"。这里沿中心行/列测量四边白边宽度，
    再整体平移图片让四边白边相等（整数像素取整，误差 ≤ 0.5px 源图）。
    """
    pixels = image.load()
    width, height = image.size

    def is_white(c):
        return c[0] >= 245 and c[1] >= 245 and c[2] >= 245

    def leading_white(seq):
        index = 0
        while index < len(seq) and (seq[index][3] == 0 or is_white(seq[index][:3])):
            index += 1
        return index

    cx, cy = width // 2, height // 2
    top = leading_white([pixels[cx, y] for y in range(height)])
    bottom = leading_white([pixels[cx, height - 1 - y] for y in range(height)])
    left = leading_white([pixels[x, cy] for x in range(width)])
    right = leading_white([pixels[width - 1 - x, cy] for x in range(width)])

    dx = round((right - left) / 2)
    dy = round((bottom - top) / 2)
    if dx == 0 and dy == 0:
        return image
    centered = Image.new("RGBA", (width, height), (255, 255, 255, 255))
    centered.paste(image, (dx, dy))
    return centered


def build_code_table():
    """返回 [(code, kind, color, value, copies)]，copies 为在 108 张牌中的数量。"""
    table = []
    for color_code in "BGRY":
        for value in range(10):
            table.append(
                (f"{color_code}{value}", "number", COLORS[color_code], value, 1 if value == 0 else 2)
            )
        for suffix, kind in (("A2", "draw2"), ("R", "reverse"), ("S", "skip")):
            table.append((f"{color_code}{suffix}", kind, COLORS[color_code], None, 2))
    for code, (kind, color, value, copies) in SPECIAL.items():
        table.append((code, kind, color, value, copies))
    return table


def main():
    os.makedirs(OUT, exist_ok=True)
    entries = []
    total = 0
    for code, kind, color, value, copies in build_code_table():
        src = os.path.join(SRC, f"{code}.png")
        if not os.path.exists(src):
            raise SystemExit(f"缺少原始卡面: {src}")
        image = Image.open(src).convert("RGBA")
        # 统一为 240x360：以左上角为锚点裁切/补齐（原始素材偏差最多 1px）
        canvas = Image.new("RGBA", (240, 360), (0, 0, 0, 0))
        canvas.paste(image.crop((0, 0, min(image.width, 240), min(image.height, 360))), (0, 0))
        strip_outer_outline(canvas)
        canvas = center_visual_frame(canvas)
        canvas.save(os.path.join(OUT, f"{code}.png"), optimize=True)
        entries.append(
            {
                "code": code,
                "file": f"cards/{code}.png",
                "kind": kind,
                "color": color,
                "value": value,
                "copies": copies,
            }
        )
        total += copies

    assert total == 108, f"牌数错误: {total}（应为 108）"
    manifest = {
        "version": 1,
        "source": "CC0 - github.com/celsiusnarhwal/uno (sliced from Wikimedia Commons UNO_cards_deck.svg)",
        "cardSize": [240, 360],
        "totalCards": total,
        "uniqueFaces": len(entries),
        "cards": entries,
    }
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)

    print(f"OK: {len(entries)} 种卡面 / {total} 张牌 -> {OUT}")
    print("已生成 manifest.json")


if __name__ == "__main__":
    main()
