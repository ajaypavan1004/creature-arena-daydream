// Icon pictures for the power ups and the sun and moon, from art/tools/items.py. Any icon
// without a picture (or still loading) is drawn by icons.ts instead.
import available from "./items.json";
import { drawGreens, drawCoffee, drawMoon, drawOrb, drawSun } from "./icons.ts";

export type Icon = "coffee" | "greens" | "orb" | "sun" | "moon";
type Draw = (g: CanvasRenderingContext2D, size: number, t: number) => void;

const DRAWN: Record<Icon, Draw> = {
  coffee: drawCoffee, greens: drawGreens, orb: drawOrb,
  sun: (g, size) => drawSun(g, size), moon: (g, size) => drawMoon(g, size),
};

const pictures = new Map<Icon, HTMLImageElement>();
for (const name of available as Icon[]) {
  const img = new Image();
  img.src = `${import.meta.env.BASE_URL}items/${name}.webp`;
  img.decode().then(() => pictures.set(name, img)).catch(() => {});
}

/** Draw an icon centred on (0, 0), about `size` tall. */
export function drawIcon(g: CanvasRenderingContext2D, name: Icon, size: number, t: number): void {
  const img = pictures.get(name);
  if (!img) { DRAWN[name](g, size, t); return; }
  const s = size * 1.25, ratio = img.naturalWidth / img.naturalHeight;
  const w = ratio >= 1 ? s : s * ratio, h = ratio >= 1 ? s / ratio : s;
  g.save();
  if (name === "greens") g.rotate(Math.sin(t * 2) * 0.08);
  g.drawImage(img, -w / 2, -h / 2, w, h);
  g.restore();
}
