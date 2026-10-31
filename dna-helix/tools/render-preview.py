#!/usr/bin/env python3
"""render-preview.py -- draws what dna-helix/tools/preview.folk dumped, as
the GPU would, in layer order: hx-sprite (the painting, from
art/atlas-0.png), games-beam (the rungs), hx-strand (the backbones, the
shader's maths in numpy), games-dot (the rings), then the labels.

    python3 dna-helix/tools/render-preview.py DUMP_DIR OUT_DIR [ART_DIR]

Uses the arena's tools/render-preview.py for the sprite, light and label
drawing. Needs numpy and Pillow.
"""
import importlib.util
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

here = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("arena_preview", here.parent.parent / "tools" / "render-preview.py")
ap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ap)
W, H = ap.W, ap.H


def premult(img, x0, y0, rgb, a):
    """ONE, ONE_MINUS_SRC_ALPHA, rgb already multiplied by a."""
    h, w = a.shape
    dst = img[y0:y0 + h, x0:x0 + w]
    dst[...] = rgb + dst * (1 - a[..., None])


def sprite(img, texs, inst):
    """hx-sprite: ca-sprite's maths, premultiplied."""
    _, _, tex, aspect, place, uv, fx = inst
    cx, cy, ux, uy = place
    vx, vy = -uy * aspect, ux * aspect
    b = ap.box([(cx + sx * ux + sy * vx, cy + sx * uy + sy * vy) for sx in (-1, 1) for sy in (-1, 1)], 1)
    if b is None or int(tex) not in texs: return
    x0, y0, gx, gy = b
    dx, dy = gx - cx, gy - cy
    lx = (dx * ux + dy * uy) / (ux * ux + uy * uy)
    ly = (dx * vx + dy * vy) / (vx * vx + vy * vy)
    inside = (np.abs(lx) <= 1) & (np.abs(ly) <= 1)
    tu = uv[0] + (uv[2] - uv[0]) * (lx * 0.5 + 0.5)
    tv = uv[1] + (uv[3] - uv[1]) * (ly * 0.5 + 0.5)
    t = texs[int(tex)]
    c = ap.sample(t, tu, tv * 0.5)
    c[..., 3] = ap.sample(t, tu, 0.5 + tv * 0.5)[..., 0]
    rgb = c[..., :3] * (1 - fx[0]) + fx[0]
    a = np.where(inside & (c[..., 3] >= 0.004), c[..., 3] * fx[2], 0)
    premult(img, x0, y0, rgb * a[..., None], a)


def strand(img, inst):
    """hx-strand: the two backbones as smooth curves (the fragment shader)."""
    _, _, place, aspect, shape, unzip, color = inst
    cx, cy, ux, uy = place
    vx, vy = -uy * aspect, ux * aspect
    b = ap.box([(cx + sx * ux + sy * vx, cy + sx * uy + sy * vy) for sx in (-1, 1) for sy in (-1, 1)], 1)
    if b is None: return
    x0, y0, gx, gy = b
    dx, dy = gx - cx, gy - cy
    lx = (dx * ux + dy * uy) / (ux * ux + uy * uy)
    ly = (dx * vx + dy * vy) / (vx * vx + vy * vy)
    inside = (np.abs(lx) <= 1) & (np.abs(ly) <= 1)
    lu, lv = math.hypot(ux, uy), math.hypot(vx, vy)
    px = 1 / lv
    w = unzip[1] * np.exp(-((lx - unzip[0]) / unzip[2]) ** 2)
    a = shape[1] + math.pi * shape[0] * (lx + 1)
    k = math.pi * shape[0] * shape[2] * (1 - w) * lv / lu
    best = np.zeros_like(lx); bright = np.zeros_like(lx)
    for i in range(2):
        ai = a + i * 2.26
        off = shape[2] * (1 - w) * np.sin(ai) + (-1 if i == 0 else 1) * unzip[3] * w
        dist = np.abs(ly - off) / np.sqrt(1 + (k * np.cos(ai)) ** 2)
        depth = w + (1 - w) * (0.5 + 0.5 * np.cos(ai))
        th = shape[3] * (0.75 + 0.35 * depth)
        t = np.clip((dist - (th - px)) / (2 * px), 0, 1)
        core = 1 - t * t * (3 - 2 * t)
        glow = np.exp(-(dist / (th * 2.5)) ** 2) * 0.18
        cov = np.maximum(core, glow)
        take = cov * (0.5 + depth) > best * (0.5 + bright)
        best = np.where(take, cov, best); bright = np.where(take, depth, bright)
    e = np.clip((1 - np.abs(lx)) / 0.04, 0, 1)
    best = best * e * e * (3 - 2 * e)
    best = np.where(inside & (best >= 0.003), best, 0)
    rgb = np.array(color[:3]) * (0.3 + 0.7 * bright)[..., None] + 0.25 * (bright * bright)[..., None]
    alpha = best * color[3]
    premult(img, x0, y0, np.minimum(rgb, 1) * alpha[..., None], alpha)


def lines(moment, name):
    p = moment / f"{name}.txt"
    return [ap.num(ap.tcl_list(l)) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []


def render(moment, out, texs):
    img = np.zeros((H, W, 3), dtype=np.float32)
    for i in lines(moment, "hx-sprite"): sprite(img, texs, i)
    for i in lines(moment, "games-beam"): ap.beam(img, i)
    for i in lines(moment, "hx-strand"): strand(img, i)
    for i in lines(moment, "games-dot"): ap.dot(img, i)
    pic = Image.fromarray((ap.linear_to_srgb(img) * 255).astype(np.uint8))
    for line in (moment / "labels.txt").read_text().splitlines():
        if not line.strip(): continue
        parts = ap.tcl_list(line)
        (x, y), radians, scale, text, color = parts[0], float(parts[1]), float(parts[2]), parts[3], parts[4]
        text = " ".join(t if isinstance(t, str) else " ".join(t) for t in text) if isinstance(text, list) else text
        font = ImageFont.load_default(size=max(8, int(float(scale))))
        layer = Image.new("RGBA", (900, 200), (0, 0, 0, 0))
        ImageDraw.Draw(layer).multiline_text((450, 100), text.replace("\\n", "\n"), font=font, anchor="mm", align="center",
                                             fill=tuple(int(float(c) * 255) for c in color))
        layer = layer.rotate(math.degrees(radians), expand=True)
        pic.paste(layer, (int(float(x) - layer.width / 2), int(float(y) - layer.height / 2)), layer)
    pic.save(out / f"{moment.name}.png")
    print(f"render-preview: {out / moment.name}.png")


def main():
    dump, out = Path(sys.argv[1]), Path(sys.argv[2])
    art = Path(sys.argv[3]) if len(sys.argv) > 3 else here.parent.parent / "art"
    out.mkdir(parents=True, exist_ok=True)
    texs = {1: ap.load_tex(art / "atlas-0.png")}
    for moment in sorted(p for p in dump.iterdir() if p.is_dir()):
        render(moment, out, texs)


if __name__ == "__main__":
    main()
