// Creature pictures ready to draw: the still image (a 1-frame sheet) or a walk cycle
// (a multi-frame sheet from art/tools/walk.py), downscaled once per screen size, with a
// white copy (hit flash) and a dark blue copy (night shading). Used by the arena and by
// Hatchling Expedition, each at its own size.
import { artUrl, creature } from "./creatures.ts";
import { WALKS, walkUrl } from "./walks.ts";

export interface Sprite {
  img: HTMLImageElement;
  sheet: { frames: number; cols: number; fw: number; fh: number; fps: number; facesLeft: boolean };
  scaled?: HTMLCanvasElement; white?: HTMLCanvasElement; dark?: HTMLCanvasElement;
  /** Frame size in world units, and in pixels inside scaled/white/dark. */
  w: number; h: number; tw: number; th: number;
}

export class SpriteBank {
  private sprites = new Map<string, Sprite>();
  private spriteHeight: number;
  /** Device pixels per world unit. */
  private px = 1;

  /** spriteHeight: how tall a creature is drawn, in world units. */
  constructor(spriteHeight: number) { this.spriteHeight = spriteHeight; }

  get(name: string): Sprite | undefined { return this.sprites.get(name); }

  /** Load a creature's art (resolves once it can be drawn). */
  load(name: string): Promise<void> {
    const have = this.sprites.get(name);
    if (have) return have.img.decode().catch(() => {});
    const img = new Image();
    const walk = WALKS[name];
    img.src = walk ? walkUrl(name) : artUrl(name);
    const sprite: Sprite = {
      img, w: 0, h: 0, tw: 0, th: 0,
      sheet: walk ? { ...walk, facesLeft: false } : { frames: 1, cols: 1, fw: 0, fh: 0, fps: 0, facesLeft: creature(name).facesLeft },
    };
    this.sprites.set(name, sprite);
    return img.decode().then(() => this.prepare(sprite)).catch(() => {});
  }

  /** New screen size: device pixels per world unit. Re-downscales everything loaded. */
  rescale(px: number): void {
    if (Math.abs(px - this.px) < 1e-6 && [...this.sprites.values()].every((s) => s.scaled)) return;
    this.px = px;
    for (const sp of this.sprites.values()) if (sp.img.complete && sp.img.naturalWidth) this.prepare(sp);
  }

  /** Downscale the art once per screen size (stepwise halving keeps it crisp). */
  private prepare(sp: Sprite): void {
    const sh0 = sp.sheet, H = this.spriteHeight;
    if (!sh0.fw) { sh0.fw = sp.img.naturalWidth; sh0.fh = sp.img.naturalHeight; }
    const iw = sh0.fw, ih = sh0.fh, rows = Math.ceil(sh0.frames / sh0.cols);
    const fit = Math.min(H / ih, (H * 1.3) / iw);
    sp.w = iw * fit; sp.h = ih * fit;
    const tw = Math.max(1, Math.round(sp.w * this.px)), th = Math.max(1, Math.round(sp.h * this.px));
    sp.tw = tw; sp.th = th;
    let src: CanvasImageSource = sp.img, sw = sp.img.naturalWidth, sh = sp.img.naturalHeight;
    while (sw / 2 > tw * sh0.cols) {
      const c = document.createElement("canvas");
      c.width = Math.round(sw / 2); c.height = Math.round(sh / 2);
      const g = c.getContext("2d")!; g.imageSmoothingQuality = "high";
      g.drawImage(src, 0, 0, c.width, c.height);
      src = c; sw = c.width; sh = c.height;
    }
    // Final size, frame by frame, so neighbouring frames never bleed into each other.
    const out = document.createElement("canvas");
    out.width = tw * sh0.cols; out.height = th * rows;
    const g = out.getContext("2d")!; g.imageSmoothingQuality = "high";
    const r = sw / sp.img.naturalWidth;
    for (let i = 0; i < sh0.frames; i++) {
      const c = i % sh0.cols, row = Math.floor(i / sh0.cols);
      g.drawImage(src, c * iw * r, row * ih * r, iw * r, ih * r, c * tw, row * th, tw, th);
    }
    const tint = (color: string) => {
      const c = document.createElement("canvas");
      c.width = out.width; c.height = out.height;
      const cg = c.getContext("2d")!;
      cg.drawImage(out, 0, 0); cg.globalCompositeOperation = "source-in"; cg.fillStyle = color; cg.fillRect(0, 0, out.width, out.height);
      return c;
    };
    sp.scaled = out; sp.white = tint("#fff"); sp.dark = tint("#0b1440");
  }
}
