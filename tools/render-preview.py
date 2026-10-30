#!/usr/bin/env python3
"""render-preview.py -- draws what tools/preview.folk dumped, as the GPU
would: ca-sprite instances from art/atlas.png and art/floor.png (the
pipeline's maths in numpy), then the games kit's light (games-dot and
games-beam, blended as games.folk's shaders do), then the labels.

    python3 tools/render-preview.py DUMP_DIR OUT_DIR [ART_DIR]

Writes OUT_DIR/NAME.png for each moment in DUMP_DIR (pick, fight-day,
fight-night). Needs numpy and Pillow.
"""
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = 1920, 1080


def tcl_list(s):
    """A Tcl list of numbers and braced lists (what the game prints)."""
    out, stack, word = [], [], ""
    cur = out
    for ch in s:
        if ch == "{":
            stack.append(cur); new = []; cur.append(new); cur = new
        elif ch == "}":
            if word: cur.append(word); word = ""
            cur = stack.pop()
        elif ch.isspace():
            if word: cur.append(word); word = ""
        else:
            word += ch
    if word: cur.append(word)
    return out


def num(x):
    return [num(v) for v in x] if isinstance(x, list) else float(x)


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def load_tex(path):
    im = np.asarray(Image.open(path).convert("RGBA"), dtype=np.float32) / 255
    im[..., :3] = srgb_to_linear(im[..., :3])   # an SRGB texture samples as linear
    return im


def sample(tex, u, v):
    """Bilinear, clamped (the GPU's sampler)."""
    h, w = tex.shape[:2]
    x = np.clip(u * w - 0.5, 0, w - 1); y = np.clip(v * h - 0.5, 0, h - 1)
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int)
    x1 = np.minimum(x0 + 1, w - 1); y1 = np.minimum(y0 + 1, h - 1)
    fx = (x - x0)[..., None]; fy = (y - y0)[..., None]
    return (tex[y0, x0] * (1 - fx) * (1 - fy) + tex[y0, x1] * fx * (1 - fy) +
            tex[y1, x0] * (1 - fx) * fy + tex[y1, x1] * fx * fy)


def blend(img, x0, y0, rgb, a):
    """ONE, ONE_MINUS_SRC_ALPHA with premultiplied rgb (gpu/pipelines.folk)."""
    h, w = a.shape
    dst = img[y0:y0 + h, x0:x0 + w]
    dst[...] = rgb * a[..., None] + dst * (1 - a[..., None])


def blend_light(img, x0, y0, rgb, I):
    """games.folk's light: colour * I, alpha I * 0.35."""
    h, w = I.shape
    dst = img[y0:y0 + h, x0:x0 + w]
    dst[...] = rgb[None, None, :] * I[..., None] + dst * (1 - 0.35 * I[..., None])


def box(points, pad):
    xs = [p[0] for p in points]; ys = [p[1] for p in points]
    x0 = max(0, int(min(xs) - pad)); y0 = max(0, int(min(ys) - pad))
    x1 = min(W, int(max(xs) + pad) + 1); y1 = min(H, int(max(ys) + pad) + 1)
    if x1 <= x0 or y1 <= y0: return None
    gx, gy = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
    return x0, y0, gx, gy


def sprite(img, texs, inst):
    _, _, tex, aspect, place, uv, fx = inst
    cx, cy, ux, uy = place
    vx, vy = -uy * aspect, ux * aspect
    corners = [(cx + sx * ux + sy * vx, cy + sx * uy + sy * vy) for sx in (-1, 1) for sy in (-1, 1)]
    b = box(corners, 1)
    if b is None or int(tex) not in texs: return
    x0, y0, gx, gy = b
    dx, dy = gx - cx, gy - cy
    lx = (dx * ux + dy * uy) / (ux * ux + uy * uy)
    ly = (dx * vx + dy * vy) / (vx * vx + vy * vy)
    inside = (np.abs(lx) <= 1) & (np.abs(ly) <= 1)
    tu = uv[0] + (uv[2] - uv[0]) * (lx * 0.5 + 0.5)
    tv = uv[1] + (uv[3] - uv[1]) * (ly * 0.5 + 0.5)
    c = sample(texs[int(tex)], tu, tv)
    rgb = c[..., :3] * (1 - fx[1]) + np.array([0.0033, 0.0070, 0.0513]) * fx[1]
    rgb = rgb * (1 - fx[0]) + fx[0]
    a = np.where(inside & (c[..., 3] >= 0.004), c[..., 3] * fx[2], 0)
    blend(img, x0, y0, rgb, a)


def dot(img, inst):
    _, _, (cx, cy), inner, outer, glow, color = inst
    r = outer + glow * 2.5 + 1
    b = box([(cx - r, cy - r), (cx + r, cy + r)], 0)
    if b is None: return
    x0, y0, gx, gy = b
    d = np.hypot(gx - cx, gy - cy)
    body = np.clip(outer - d + 0.5, 0, 1)
    if inner > 0: body *= np.clip(d - inner + 0.5, 0, 1)
    e = np.maximum(np.maximum(inner - d, d - outer), 0)
    halo = 0.55 * np.exp(-(e * e) / (glow * glow)) if glow > 0 else 0 * d
    blend_light(img, x0, y0, srgb_to_linear(np.array(color[:3])), np.maximum(body, halo) * color[3])


def beam(img, inst):
    _, _, a, b_, width, glow, fade, color = inst
    ext = width * 0.5 + glow * 2.5 + 1
    bb = box([a, b_], ext)
    if bb is None: return
    x0, y0, gx, gy = bb
    ax, ay = a; bx, by = b_
    l2 = max((bx - ax) ** 2 + (by - ay) ** 2, 1e-6)
    t = np.clip(((gx - ax) * (bx - ax) + (gy - ay) * (by - ay)) / l2, 0, 1)
    d = np.hypot(gx - (ax + t * (bx - ax)), gy - (ay + t * (by - ay)))
    body = np.clip(width * 0.5 - d + 0.5, 0, 1)
    e = np.maximum(d - width * 0.5, 0)
    halo = 0.55 * np.exp(-(e * e) / (glow * glow)) if glow > 0 else 0 * d
    I = np.maximum(body, halo) * (1 + (fade - 1) * t) * color[3]
    blend_light(img, x0, y0, srgb_to_linear(np.array(color[:3])), I)


def render(moment, out, texs):
    img = np.zeros((H, W, 3), dtype=np.float32)
    for line in (moment / "ca-sprite.txt").read_text().splitlines():
        if line.strip(): sprite(img, texs, num(tcl_list(line)))
    for line in (moment / "games-beam.txt").read_text().splitlines():
        if line.strip(): beam(img, num(tcl_list(line)))
    for line in (moment / "games-dot.txt").read_text().splitlines():
        if line.strip(): dot(img, num(tcl_list(line)))
    pic = Image.fromarray((linear_to_srgb(img) * 255).astype(np.uint8))
    draw = ImageDraw.Draw(pic)
    for line in (moment / "labels.txt").read_text().splitlines():
        if not line.strip(): continue
        parts = tcl_list(line)
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
    art = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(__file__).resolve().parent.parent / "art"
    out.mkdir(parents=True, exist_ok=True)
    texs = {1: load_tex(art / "atlas.png"), 2: load_tex(art / "floor.png")}
    for moment in sorted(p for p in dump.iterdir() if p.is_dir()):
        render(moment, out, texs)


if __name__ == "__main__":
    main()
