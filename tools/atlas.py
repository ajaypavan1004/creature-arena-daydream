#!/usr/bin/env python3
"""atlas.py -- packs the browser game's pictures into the textures the
table draws from, and writes where each one is.

    python3 tools/atlas.py BROWSER_GAME_DIR BAKED_DIR [OUT_DIR]

BROWSER_GAME_DIR is the browser game (its public/ and src/walks.json:
the browser-game branch's browser-game/). BAKED_DIR is tools/bake.mjs's
output. Writes to OUT_DIR (default art/):

  atlas.png  the 16 creatures' paintings, the walk cycles (every second
             frame: 12 a second), the power ups, the sun and the moon,
             and a soft shadow. One texture, so a frame's sprites are
             one draw.
  floor.png  the arena's stone floor by day (left) and by night (right).
  atlas.h    the cells: where each picture is (uv 0..1) and its size in
             sprite heights (the browser game's spriteHeight), as the
             browser game fits them (sprites.ts prepare).

Needs Pillow. A creature is SPRITE_PX tall in the atlas: about its size
on the table, so the GPU (no mipmaps) neither shrinks nor blows it up much.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SPRITE_PX = 320          # a sprite height in atlas pixels
ICON_PX = 192
PAD = 3
ATLAS_W = 4096
WALK_STEP = 2            # every second frame of the 24 fps clips

# The table's order: flame*8 + time*4 + senses*2 + spark (creaturearena.folk CREATURES).
CREATURES = ["Moonwhisker", "Nightflicker", "Duskfang", "Starmane", "Sunsniffer", "Dawnflare",
             "Blazeleap", "Morningdrift", "Shadepounce", "Glowpaw", "Thunderjaw", "Mooncoil",
             "Sparksnout", "Sunburrow", "Emberjaw", "Goldenhush"]
FACES_LEFT = {"Blazeleap"}  # src/creatures.ts


def fit(iw, ih):
    """sprites.ts prepare: the frame's size in sprite heights."""
    k = min(1 / ih, 1.3 / iw)
    return iw * k, ih * k


def shrink(im, w, h):
    """Stepwise halving, then the final size (as sprites.ts does)."""
    while im.width / 2 > w * 1.01 and im.height / 2 > h * 1.01:
        im = im.resize((max(1, im.width // 2), max(1, im.height // 2)), Image.LANCZOS)
    return im.resize((w, h), Image.LANCZOS)


def premultiplied_edges(im):
    """Bleeds colour into transparent pixels next to opaque ones, so the
    GPU's filtering at an edge doesn't pull in black."""
    im = im.convert("RGBA")
    rgb = im.convert("RGB").filter(ImageFilter.MaxFilter(3))
    alpha = im.getchannel("A")
    out = Image.composite(im.convert("RGB"), rgb, alpha.point(lambda a: 255 if a > 0 else 0))
    out.putalpha(alpha)
    return out


def shadow():
    w, h = 128, 48
    im = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(im)
    d.ellipse((10, 6, w - 10, h - 6), fill=255)
    im = im.filter(ImageFilter.GaussianBlur(5))
    out = Image.new("RGBA", (w, h), (5, 8, 20, 0))
    out.putalpha(im)
    return out


def main():
    game = Path(sys.argv[1])
    baked = Path(sys.argv[2])
    out = Path(sys.argv[3] if len(sys.argv) > 3 else "art")
    out.mkdir(parents=True, exist_ok=True)
    walks = json.loads((game / "src" / "walks.json").read_text())

    cells = []      # (name, image, w, h in sprite heights)
    still, walk = {}, {}
    for name in CREATURES:
        im = Image.open(game / "public" / "creatures" / f"{name}.webp").convert("RGBA")
        w, h = fit(*im.size)
        still[name] = len(cells)
        cells.append((f"{name}", shrink(im, round(w * SPRITE_PX), round(h * SPRITE_PX)), w, h))
    for name in CREATURES:
        if name not in walks:
            continue
        sh = walks[name]
        sheet = Image.open(game / "public" / "walk" / f"{name}.webp").convert("RGBA")
        w, h = fit(sh["fw"], sh["fh"])
        first = len(cells)
        for i in range(0, sh["frames"], WALK_STEP):
            x, y = (i % sh["cols"]) * sh["fw"], (i // sh["cols"]) * sh["fh"]
            frame = sheet.crop((x, y, x + sh["fw"], y + sh["fh"]))
            cells.append((f"{name} walk {i}", shrink(frame, round(w * SPRITE_PX), round(h * SPRITE_PX)), w, h))
        walk[name] = (first, len(cells) - first, sh["fps"] / WALK_STEP)

    items = {}
    for name, src in [("coffee", game / "public/items/coffee.webp"), ("moon", game / "public/items/moon.webp"),
                      ("greens", baked / "greens.png"), ("orb", baked / "orb.png"), ("sun", baked / "sun.png")]:
        im = Image.open(src).convert("RGBA")
        items[name] = len(cells)
        cells.append((name, shrink(im, ICON_PX, ICON_PX), 1.0, 1.0))
    items["shadow"] = len(cells)
    cells.append(("shadow", shadow(), 1.0, 0.375))

    # Shelves, tallest first.
    order = sorted(range(len(cells)), key=lambda i: -cells[i][1].height)
    place, x, y, shelf = {}, PAD, PAD, 0
    for i in order:
        im = cells[i][1]
        if x + im.width + PAD > ATLAS_W:
            x, y, shelf = PAD, y + shelf + PAD, 0
        place[i] = (x, y)
        x += im.width + PAD
        shelf = max(shelf, im.height)
    height = y + shelf + PAD
    height = ((height + 255) // 256) * 256
    if height > 4096:
        sys.exit(f"atlas.py: the atlas would be {ATLAS_W}x{height}; lower SPRITE_PX")
    atlas = Image.new("RGBA", (ATLAS_W, height), (0, 0, 0, 0))
    for i, (x, y) in place.items():
        atlas.paste(premultiplied_edges(cells[i][1]), (x, y))
    atlas.save(out / "atlas.png", optimize=True)

    day = Image.open(baked / "floor-day.png").convert("RGBA")
    night = Image.open(baked / "floor-night.png").convert("RGBA")
    floor = Image.new("RGBA", (day.width * 2, day.height), (0, 0, 0, 0))
    floor.paste(day, (0, 0))
    floor.paste(night, (day.width, 0))
    floor.save(out / "floor.png", optimize=True)

    def uv(i):
        x, y = place[i]
        im = cells[i][1]
        return (x / ATLAS_W, y / height, (x + im.width) / ATLAS_W, (y + im.height) / height)

    lines = [
        "/* atlas.h -- made by tools/atlas.py: where each picture is in",
        " * art/atlas.png (uv 0..1) and its size in sprite heights. */",
        f"#define CA_ATLAS_W {ATLAS_W}",
        f"#define CA_ATLAS_H {height}",
        "typedef struct { float u0, v0, u1, v1, w, h; } CaCell;",
        "static const CaCell CA_CELLS[] = {",
    ]
    for i, (name, im, w, h) in enumerate(cells):
        u0, v0, u1, v1 = uv(i)
        lines.append(f"    {{{u0:.6f}f, {v0:.6f}f, {u1:.6f}f, {v1:.6f}f, {w:.4f}f, {h:.4f}f}},  /* {i}: {name} */")
    lines.append("};")
    lines.append("/* Each creature's painting, in CREATURES order, and whether it faces left. */")
    lines.append("static const int CA_STILL[16] = {" + ", ".join(str(still[n]) for n in CREATURES) + "};")
    lines.append("static const int CA_FACES_LEFT[16] = {" + ", ".join("1" if n in FACES_LEFT else "0" for n in CREATURES) + "};")
    lines.append("/* Walk cycles: first cell, frames (0: none), frames a second. */")
    lines.append("static const int CA_WALK_FIRST[16] = {" + ", ".join(str(walk.get(n, (0, 0, 0))[0]) for n in CREATURES) + "};")
    lines.append("static const int CA_WALK_FRAMES[16] = {" + ", ".join(str(walk.get(n, (0, 0, 0))[1]) for n in CREATURES) + "};")
    lines.append("static const float CA_WALK_FPS[16] = {" + ", ".join(f"{walk.get(n, (0, 0, 0))[2]:.1f}f" for n in CREATURES) + "};")
    lines.append("enum { " + ", ".join(f"CA_CELL_{k.upper()} = {v}" for k, v in items.items()) + " };")
    (out / "atlas.h").write_text("\n".join(lines) + "\n")
    kb = (out / "atlas.png").stat().st_size // 1024
    print(f"atlas.py: {len(cells)} cells in {ATLAS_W}x{height} ({kb} KB), floor {floor.width}x{floor.height}")


if __name__ == "__main__":
    main()
