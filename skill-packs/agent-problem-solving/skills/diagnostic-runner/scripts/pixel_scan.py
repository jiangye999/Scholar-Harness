#!/usr/bin/env python3
"""可复用像素诊断工具：扫描、边框定位、面板映射、裁剪、结构化报告。

用法：
  python pixel_scan.py hscan  --image a.png --y 45 --x0 20 --x1 550
  python pixel_scan.py vscan  --image a.png --x 541 --y0 40 --y1 280
  python pixel_scan.py border --image a.png --axis h --pos 45 --x0 20 --x1 550 --min-run 50
  python pixel_scan.py crop   --image a.png --box 100,200,700,900 --out out/diag.png
  python pixel_scan.py panel  --width 575 --height 303 --scale 3.83 --left 20 --top 40 --x 541 --y 45

每个子命令输出一行结论到 stdout，`--json 路径` 时把完整报告写 JSON 文件。
```
"""

import argparse
import json
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("缺少 Pillow，请先安装：pip install Pillow")


def _makedirs(path: str) -> None:
    parent = os.path.dirname(path) or "."
    os.makedirs(parent, exist_ok=True)


def _dark(px, x: int, y: int, thresh: int) -> bool:
    pixel = px[x, y]
    rgb = pixel[:3] if isinstance(pixel, tuple) else (pixel, pixel, pixel)
    return sum(rgb) < 3 * thresh


def _runs(indices):
    """把连续索引压缩成 (start, end) run 列表。"""
    runs = []
    if not indices:
        return runs
    s = p = indices[0]
    for v in indices[1:]:
        if v - p > 1:
            runs.append((s, p))
            s = v
        p = v
    runs.append((s, p))
    return runs


def hscan(px, y: int, x0: int, x1: int, thresh: int):
    dark = [x for x in range(x0, x1) if _dark(px, x, y, thresh)]
    return {"axis": "h", "pos": y, "range": [x0, x1], "dark_px": len(dark), "runs": _runs(dark)}


def vscan(px, x: int, y0: int, y1: int, thresh: int):
    dark = [y for y in range(y0, y1) if _dark(px, x, y, thresh)]
    return {"axis": "v", "pos": x, "range": [y0, y1], "dark_px": len(dark), "runs": _runs(dark)}


def find_border(px, axis: str, pos: int, lo: int, hi: int, thresh: int, min_run: int):
    """在指定行/列找最长连续暗段，报告覆盖范围与是否达到 min_run。"""
    scan = hscan(px, pos, lo, hi, thresh) if axis == "h" else vscan(px, pos, lo, hi, thresh)
    longest = max(scan["runs"], key=lambda r: r[1] - r[0], default=None)
    result = {
        **scan,
        "longest_run": longest,
        "longest_len": (longest[1] - longest[0] + 1) if longest else 0,
        "passes_min_run": bool(longest and longest[1] - longest[0] + 1 >= min_run),
    }
    return result


def crop(im, box, out: str):
    _makedirs(out)
    im.crop(box).save(out)
    return {"out": out, "size": [box[2] - box[0], box[3] - box[1]]}


def panel_rect(width: int, height: int, scale: float, left: int, top: int):
    """把面板的 clean 尺寸 + 缩放 + 左上角映射为最终图内像素矩形。"""
    return {
        "left": int(left),
        "top": int(top),
        "right": int(left + width * scale),
        "bottom": int(top + height * scale),
        "w_px": int(width * scale),
        "h_px": int(height * scale),
    }


def map_point(rect, x_orig, y_orig, w_orig: int, h_orig: int):
    """把 clean 面板内坐标 (x_orig, y_orig) 映射到最终图内。"""
    return {
        "x": rect["left"] + int(x_orig / w_orig * rect["w_px"]),
        "y": rect["top"] + int(y_orig / h_orig * rect["h_px"]),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    def add_common(p):
        p.add_argument("--image", required=True)
        p.add_argument("--thresh", type=int, default=120, help="单通道暗阈值，sum(rgb)<3*thresh")
        p.add_argument("--json", default=None, help="JSON 报告输出路径")

    for name, help_txt in (("hscan", "沿某行扫暗段"), ("vscan", "沿某列扫暗段"), ("border", "找最长连续边框")):
        p = sub.add_parser(name, help=help_txt)
        add_common(p)
        if name == "hscan":
            p.add_argument("--y", type=int, required=True)
            p.add_argument("--x0", type=int, required=True)
            p.add_argument("--x1", type=int, required=True)
        elif name == "vscan":
            p.add_argument("--x", type=int, required=True)
            p.add_argument("--y0", type=int, required=True)
            p.add_argument("--y1", type=int, required=True)
        else:
            p.add_argument("--axis", choices=["h", "v"], required=True)
            p.add_argument("--pos", type=int, required=True)
            p.add_argument("--lo", type=int, required=True)
            p.add_argument("--hi", type=int, required=True)
            p.add_argument("--min-run", type=int, default=50)

    p = sub.add_parser("crop", help="按 box 裁剪保存")
    p.add_argument("--image", required=True)
    p.add_argument("--box", required=True, help="L,T,R,B 逗号分隔")
    p.add_argument("--out", required=True)
    p.add_argument("--json", default=None)

    p = sub.add_parser("panel", help="面板坐标映射")
    p.add_argument("--width", type=int, required=True)
    p.add_argument("--height", type=int, required=True)
    p.add_argument("--scale", type=float, required=True)
    p.add_argument("--left", type=int, required=True)
    p.add_argument("--top", type=int, required=True)
    p.add_argument("--x", type=int, default=None, help="clean 内 x（可选）")
    p.add_argument("--y", type=int, default=None, help="clean 内 y（可选）")
    p.add_argument("--json", default=None)

    args = parser.parse_args()

    im = None
    px = None
    if args.cmd in ("hscan", "vscan", "border", "crop"):
        im = Image.open(args.image)
        px = im.load()

    if args.cmd in ("hscan", "vscan", "border"):
        if args.cmd == "hscan":
            result = hscan(px, args.y, args.x0, args.x1, args.thresh)
        elif args.cmd == "vscan":
            result = vscan(px, args.x, args.y0, args.y1, args.thresh)
        else:
            result = find_border(px, args.axis, args.pos, args.lo, args.hi, args.thresh, args.min_run)
    elif args.cmd == "crop":
        box = tuple(int(v) for v in args.box.split(","))
        if len(box) != 4:
            sys.exit("--box 需要 4 个值 L,T,R,B")
        result = crop(im, box, args.out)
        result["image"] = args.image
    else:
        rect = panel_rect(args.width, args.height, args.scale, args.left, args.top)
        result = {"rect": rect}
        if args.x is not None and args.y is not None:
            result["mapped"] = map_point(rect, args.x, args.y, args.width, args.height)

    result["status"] = "success"

    if args.json:
        _makedirs(args.json)
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        result["report"] = args.json

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
