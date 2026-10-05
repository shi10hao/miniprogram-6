#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成微信小程序 tabBar 图标（PNG）。

背景：微信原生 tabBar 只接受图片文件（不接受 emoji / 字体图标 / svg），
建议尺寸 81x81 px。本脚本用 Pillow 按矢量几何绘制，并做 4 倍超采样
（324x324 绘制 -> LANCZOS 缩到 81x81），得到边缘平滑的图标。

用法：
    python tools/generate-tab-icons.py <输出目录>
默认输出到 miniprogram/assets/icons/。
"""

import os
import sys
from PIL import Image, ImageDraw

# ---- 参数 ----------------------------------------------------------------
SIZE = 81          # 最终尺寸
SS = 4             # 超采样倍数
W = SIZE * SS      # 绘制画布边长 324
STROKE = 26        # 线宽（在 324 画布上）

COLOR_NORMAL = (154, 164, 178, 255)   # #9aa4b2  未选中，与 app.json tabBar.color 一致
COLOR_ACTIVE = (98, 188, 196, 255)    # #62BCC4  选中，与 tabBar.selectedColor 一致


def canvas():
    """返回 (image, draw)，透明背景。"""
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def round_line(d, p1, p2, color, width):
    """画带圆角端点的线段（ImageDraw.line 本身不支持圆头）。"""
    r = width / 2.0
    d.line([p1, p2], fill=color, width=int(round(width)))
    for (x, y) in (p1, p2):
        d.ellipse([x - r, y - r, x + r, y + r], fill=color)


def round_arc(d, bbox, start, end, color, width):
    """画带圆角端点的圆弧。ImageDraw.arc 的 width 是向内生长的，
    所以按 width/2 外扩 bbox 让线居中，再在两端补圆头。"""
    import math
    pad = width / 2.0
    x0, y0, x1, y1 = bbox
    d.arc([x0 - pad, y0 - pad, x1 + pad, y1 + pad],
          start=start, end=end, fill=color, width=int(round(width)))
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    rx, ry = (x1 - x0) / 2.0, (y1 - y0) / 2.0
    for ang in (start, end):
        a = math.radians(ang)
        px, py = cx + rx * math.cos(a), cy + ry * math.sin(a)
        d.ellipse([px - pad, py - pad, px + pad, py + pad], fill=color)


# 线宽：在 324 画布上取 24，缩到 81 后约 6px，视觉上更接近商业图标集的轻盈感
W_STROKE = 24
STROKE = W_STROKE


def icon_home(color):
    """首页：一笔连续的房子轮廓 + 实心门。

    用一条闭合折线画出「屋顶 + 屋身」的整体外形（专业图标集的标准做法），
    避免屋顶和屋身分段绘制时边框相互重叠、接缝处比别处粗。
    """
    img, d = canvas()
    apex = (162, 44)
    left = (48, 150)
    right = (276, 150)
    bottom_left = (88, 278)
    bottom_right = (236, 278)

    path = [apex, right, bottom_right, bottom_left, left, apex]
    d.line(path, fill=color, width=W_STROKE, joint="curve")
    # line() 不画端点圆头；闭合路径的顶点补圆角
    for (x, y) in (apex, left, right, bottom_left, bottom_right):
        r = W_STROKE / 2.0
        d.ellipse([x - r, y - r, x + r, y + r], fill=color)

    # 门：实心，避免细线在小尺寸下糊成一团
    d.rounded_rectangle([138, 198, 186, 278], radius=9, fill=color)
    return img


def icon_app(color):
    """应用：日历（两个挂耳 + 表身 + 三个日期点）。"""
    img, d = canvas()
    # 表身
    d.rounded_rectangle([46, 72, 278, 276], radius=34,
                        outline=color, width=int(STROKE))
    # 两个挂耳
    round_line(d, (110, 40), (110, 84), color, STROKE)
    round_line(d, (214, 40), (214, 84), color, STROKE)
    # 日期点
    r = 15
    for cx in (112, 162, 212):
        d.ellipse([cx - r, 168 - r, cx + r, 168 + r], fill=color)
    for cx in (112, 162, 212):
        d.ellipse([cx - r, 222 - r, cx + r, 222 + r], fill=color)
    return img


def icon_message(color):
    """消息：对话气泡 + 三个点。"""
    img, d = canvas()
    d.rounded_rectangle([40, 66, 284, 252], radius=44,
                        outline=color, width=int(STROKE))
    r = 14
    for cx in (112, 162, 212):
        d.ellipse([cx - r, 159 - r, cx + r, 159 + r], fill=color)
    return img


def icon_profile(color):
    """我的：头 + 肩。"""
    img, d = canvas()
    # 头
    d.ellipse([108, 46, 216, 154], outline=color, width=int(STROKE))
    # 肩（半圆弧，两端圆头）
    round_arc(d, [66, 190, 258, 382], 180, 360, color, STROKE)
    return img


ICONS = {
    "home": icon_home,
    "app": icon_app,
    "message": icon_message,
    "profile": icon_profile,
}


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        "miniprogram", "assets", "icons")
    os.makedirs(out_dir, exist_ok=True)

    written = []
    for name, fn in ICONS.items():
        for suffix, color in (("", COLOR_NORMAL), ("-active", COLOR_ACTIVE)):
            img = fn(color)
            img = img.resize((SIZE, SIZE), Image.LANCZOS)
            path = os.path.join(out_dir, "%s%s.png" % (name, suffix))
            img.save(path, "PNG", optimize=True)
            written.append(path)

    for p in written:
        print("%-46s %6d bytes" % (p, os.path.getsize(p)))
    print("\n共生成 %d 个图标 -> %s" % (len(written), out_dir))


if __name__ == "__main__":
    main()
