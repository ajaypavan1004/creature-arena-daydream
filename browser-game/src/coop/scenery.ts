// Outdoor scenery for Hatchling Expedition: painted ground textures, water, and props
// (trees, rocks, ruins...) placed on the wall tiles so every room reads as a place in
// nature rather than a locked room. Purely visual: the room logic never looks at this.
//
// Art: Glitch (Tiny Speck, CC0), LuminousDragonGames textures (CC0), Kenney (CC0).
// See CREDITS.md. Assets are in public/scenery (made by art/tools/scenery.sh).
import { CONFIG } from "../config.ts";
import type { ParsedRoom } from "./solver.ts";

export type Style = "storybook" | "watercolor" | "cartoon";
type Tex = "sand" | "sand2" | "grass" | "grass2" | "dirt" | "dirt2" | "lava";
type Water = "water" | "pit" | "canyon";

export interface Theme {
  /** Main ground, a second ground in soft patches, and the ground under walls. */
  floor: Tex; patch: Tex; wall: Tex;
  /** What a chasm looks like. */
  chasm: Water;
  /** Props on walls next to open ground, props deeper in the walls, small things on the ground. */
  edge: string[]; deep: string[]; decor: string[];
  /** Flat colours for the cartoon style: floor, patch, wall, chasm. */
  flat: [string, string, string, string];
}

/** The land beyond the room's edges (drawn behind it). */
export const OUTSIDE: Record<string, string> = {
  hatching: "#2e6a8f", crossing: "#203f24", burrows: "#0c0a0e", storm: "#5a3420", thorns: "#1c2a26", heart: "#2a1410",
};

export const THEMES: Record<string, Theme> = {
  hatching: { floor: "sand", patch: "grass", wall: "grass2", chasm: "water",
    edge: ["bush", "bush2", "rosebush", "waterrock", "flatstones", "tree1", "pampas"], deep: ["tree1", "tree2", "tree3", "bush", "pine"], decor: ["tuft", "flowers", "flatstones"],
    flat: ["#f3d9a4", "#8fd16a", "#5aa65a", "#4aa3df"] },
  crossing: { floor: "grass", patch: "grass2", wall: "grass2", chasm: "water",
    edge: ["bush", "bush3", "tree1", "pine", "stump", "rosebush"], deep: ["pine", "tree1", "tree2", "tree3"], decor: ["tuft", "flowers", "wildshrooms"],
    flat: ["#8fd16a", "#7cc35c", "#4f9a4f", "#4aa3df"] },
  burrows: { floor: "dirt", patch: "dirt2", wall: "dirt2", chasm: "pit",
    edge: ["stalagmite", "stalagmite2", "glowshroom", "shelfshroom", "rockledge"], deep: ["stalagmite", "stalagmite2", "rockledge"], decor: ["wildshrooms", "flatstones"],
    flat: ["#8a6a4a", "#7a5c40", "#4a3a2c", "#141018"] },
  storm: { floor: "sand2", patch: "dirt", wall: "dirt", chasm: "canyon",
    edge: ["acacia", "rockledge", "flatstones", "pampas", "bush3"], deep: ["acacia", "rockledge", "baretree"], decor: ["flatstones", "tuft"],
    flat: ["#e8c48a", "#d4a46a", "#a8743e", "#5a3420"] },
  thorns: { floor: "grass2", patch: "dirt", wall: "grass2", chasm: "water",
    edge: ["standingstones", "stonehead", "gnarled", "rosebush", "stump"], deep: ["gnarled", "baretree", "standingstones", "tree2"], decor: ["flowers", "tuft", "wildshrooms"],
    flat: ["#7cc35c", "#a88a5a", "#4f7a4f", "#4aa3df"] },
  heart: { floor: "dirt", patch: "lava", wall: "dirt2", chasm: "pit",
    edge: ["stonehead", "standingstones", "rockledge", "baretree"], deep: ["rockledge", "baretree", "stalagmite"], decor: ["flatstones"],
    flat: ["#9a7a5a", "#d0502a", "#5a3a2a", "#141018"] },
};

/** Kenney stand-ins for the cartoon style (by role). */
const CARTOON: Record<string, string> = {
  tree1: "k_tree2", tree2: "k_tree2", tree3: "k_tree1", pine: "k_tree1", acacia: "k_tree2", gnarled: "k_tree1", baretree: "k_tree1",
  bush: "k_rock", bush2: "k_rock2", bush3: "k_rock", rosebush: "k_flower", stump: "k_rock2", pampas: "k_bush", tuft: "k_bush", flowers: "k_flower",
};

const ASSETS = [
  "tex_sand", "tex_sand2", "tex_grass", "tex_grass2", "tex_dirt", "tex_dirt2", "tex_lava",
  "prop_tree1", "prop_tree2", "prop_tree3", "prop_pine", "prop_acacia", "prop_rosebush", "prop_bush", "prop_bush2", "prop_bush3",
  "prop_tuft", "prop_pampas", "prop_shelfshroom", "prop_glowshroom", "prop_wildshrooms", "prop_stonehead", "prop_standingstones",
  "prop_stalagmite", "prop_stalagmite2", "prop_waterrock", "prop_flatstones", "prop_rockledge", "prop_stump", "prop_gnarled",
  "prop_baretree", "prop_flowers", "k_tree1", "k_tree2", "k_pine", "k_bush", "k_rock", "k_rock2", "k_flower",
];

/** How tall each prop stands, in tiles (trees tall, tufts small). */
const HEIGHT: Record<string, number> = {
  tree1: 2.6, tree2: 2.4, tree3: 2.6, pine: 2.8, acacia: 2.0, gnarled: 2.2, baretree: 2.2, rosebush: 1.5, bush: 1.1, bush2: 0.8,
  bush3: 0.9, tuft: 0.45, pampas: 1.2, shelfshroom: 0.9, glowshroom: 1.0, wildshrooms: 0.35, stonehead: 1.1, standingstones: 1.3,
  stalagmite: 1.9, stalagmite2: 0.8, waterrock: 0.9, flatstones: 0.45, rockledge: 0.6, stump: 1.2, flowers: 0.3,
};

export interface Prop { name: string; x: number; y: number; h: number; phase: number; flip: boolean }

export class Scenery {
  style: Style = "storybook";
  private images = new Map<string, HTMLImageElement>();
  /** Processed copies per style (watercolor: softened, pastel). */
  private styled = new Map<string, HTMLCanvasElement | HTMLImageElement>();
  ready: Promise<void>;

  constructor() {
    this.ready = Promise.all(ASSETS.map((n) => new Promise<void>((ok) => {
      const img = new Image();
      img.onload = () => { this.images.set(n, img); ok(); };
      img.onerror = () => ok();
      img.src = `${import.meta.env.BASE_URL}scenery/${n}.webp`;
    }))).then(() => {});
  }

  setStyle(s: Style): void { if (s !== this.style) { this.style = s; this.styled.clear(); } }

  /** An asset as drawn in the current style. */
  art(name: string): HTMLCanvasElement | HTMLImageElement | undefined {
    const key = this.style === "cartoon" && !name.startsWith("tex_") ? (CARTOON[name.replace(/^prop_/, "")] ?? name) : name;
    const have = this.styled.get(key);
    if (have) return have;
    const img = this.images.get(key);
    if (!img) return undefined;
    if (this.style !== "watercolor") { this.styled.set(key, img); return img; }
    // Watercolor: lighter, softer colours.
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const l = (p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11);
      for (let k = 0; k < 3; k++) p[i + k] = Math.min(255, (p[i + k] * 0.45 + l * 0.55) * 0.78 + 58);
    }
    g.putImageData(d, 0, 0);
    this.styled.set(key, c);
    return c;
  }

  /** Props for a room, placed the same way every time (seeded by the room). */
  props(room: ParsedRoom, roomId: string): Prop[] {
    const th = THEMES[roomId], rand = seeded(hash(roomId)), T = CONFIG.coop.tile, out: Prop[] = [];
    const wall = (x: number, y: number) => x < 0 || y < 0 || x >= room.w || y >= room.h || room.terrain[y][x] === "#";
    // Keep scenery clear of anything a gene interacts with (and of the tiles just below,
    // since tall props reach upwards), so obstacles are never hidden.
    const busy = new Set<number>();
    for (const t of room.things.values()) for (const [tx, ty] of t.cells) {
      for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 1; dx++) busy.add((ty + dy) * 1000 + tx + dx);
    }
    for (const [ex, ey] of room.exits) for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 1; dx++) busy.add((ey + dy) * 1000 + ex + dx);
    for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) {
      if (!wall(x, y) || busy.has(y * 1000 + x)) continue;
      const nearFloor = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !wall(x + dx, y + dy));
      const list = nearFloor ? th.edge : th.deep;
      if (rand() > (nearFloor ? 0.55 : 0.32)) continue;
      const name = list[Math.floor(rand() * list.length)];
      out.push({ name, x: (x + 0.3 + rand() * 0.4) * T, y: (y + 0.75 + rand() * 0.2) * T, h: HEIGHT[name] ?? 1, phase: rand() * 6.28, flip: rand() < 0.5 });
    }
    return out;
  }

  /** Small ground decorations on open floor (away from anything interactive). */
  decor(room: ParsedRoom, roomId: string): Prop[] {
    const th = THEMES[roomId], rand = seeded(hash(roomId) ^ 0x9e37), T = CONFIG.coop.tile, out: Prop[] = [];
    for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) {
      if (room.terrain[y][x] !== "." || room.at[y][x] || rand() > 0.07) continue;
      const name = th.decor[Math.floor(rand() * th.decor.length)];
      out.push({ name, x: (x + 0.2 + rand() * 0.6) * T, y: (y + 0.4 + rand() * 0.5) * T, h: HEIGHT[name] ?? 0.4, phase: rand() * 6.28, flip: rand() < 0.5 });
    }
    return out;
  }

  /**
   * The still part of a room, drawn once: ground, patches, walls as overgrown ground,
   * soft shadows where walls meet open ground, the chasm's base, and ground decorations.
   * g is scaled to world units.
   */
  ground(g: CanvasRenderingContext2D, room: ParsedRoom, roomId: string): void {
    const th = THEMES[roomId], T = CONFIG.coop.tile, W = room.w * T, H = room.h * T;
    const flat = this.style === "cartoon";
    const pattern = (tex: Tex, tint?: string) => {
      const img = this.art(`tex_${tex}`);
      if (flat || !img) return tint ?? "#888";
      const p = g.createPattern(img, "repeat")!;
      p.setTransform(new DOMMatrix().scale((T * 4) / img.width)); // one texture spans 4 tiles
      return p;
    };
    // 1. Ground everywhere, then patches of the second ground in soft blobs.
    g.fillStyle = pattern(th.floor, th.flat[0]); g.fillRect(0, 0, W, H);
    const rand = seeded(hash(roomId) ^ 0x51ed);
    const patch = document.createElement("canvas");
    patch.width = W; patch.height = H;
    const pg = patch.getContext("2d")!;
    pg.fillStyle = flat ? th.flat[1] : (() => { const img = this.art(`tex_${th.patch}`)!; const p = pg.createPattern(img, "repeat")!; p.setTransform(new DOMMatrix().scale((T * 4) / img.width)); return p; })();
    pg.fillRect(0, 0, W, H);
    pg.globalCompositeOperation = "destination-in";
    const blobs = Math.round((room.w * room.h) / 14);
    for (let i = 0; i < blobs; i++) {
      const x = rand() * W, y = rand() * H, r = T * (0.8 + rand() * 1.8);
      const grd = pg.createRadialGradient(x, y, r * 0.2, x, y, r);
      grd.addColorStop(0, "rgba(0,0,0,0.9)"); grd.addColorStop(1, "rgba(0,0,0,0)");
      pg.fillStyle = grd; pg.beginPath(); pg.arc(x, y, r, 0, 7); pg.fill();
    }
    g.drawImage(patch, 0, 0);

    // 2. Chasms: deep water, a dark pit, or a canyon drop, with soft edges.
    for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) {
      if (room.terrain[y][x] !== "~") continue;
      const px = x * T, py = y * T;
      if (th.chasm === "water") {
        const grd = g.createLinearGradient(px, py, px, py + T);
        grd.addColorStop(0, flat ? th.flat[3] : "#2f7fb0"); grd.addColorStop(1, flat ? th.flat[3] : "#245f8f");
        g.fillStyle = grd;
      } else if (th.chasm === "canyon") {
        const grd = g.createLinearGradient(px, py, px, py + T);
        grd.addColorStop(0, "#3a1d10"); grd.addColorStop(1, "#1a0c06");
        g.fillStyle = grd;
      } else g.fillStyle = "#0a0810";
      g.fillRect(px - 0.5, py - 0.5, T + 1, T + 1);
    }
    // Shore: a soft light rim where open ground meets water or a drop.
    edgeShade(g, room, (x, y) => room.terrain[y]?.[x] === "~", th.chasm === "water" ? "rgba(255,250,230,0.35)" : "rgba(0,0,0,0.45)", T * 0.22, true);

    // 3. Walls become overgrown ground (props stand on them later), with a shadow onto open ground.
    g.save();
    g.beginPath();
    for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) if (room.terrain[y][x] === "#") g.rect(x * T - 0.5, y * T - 0.5, T + 1, T + 1);
    g.clip();
    g.fillStyle = pattern(th.wall, th.flat[2]); g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(10,20,10,0.28)"; g.fillRect(0, 0, W, H);
    g.restore();
    // Soft, uneven edges: the wall ground spills a little onto open ground, never onto
    // anything interactive.
    g.save();
    const er = seeded(hash(roomId) ^ 0x2be1);
    g.beginPath();
    for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) {
      if (room.terrain[y][x] !== "#") continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= room.w || ny >= room.h || room.terrain[ny][nx] === "#" || room.at[ny][nx] || room.terrain[ny][nx] === "E") continue;
        for (let i = 0; i < 3; i++) {
          const along = (i + 0.2 + er() * 0.6) / 3;
          const bx = (x + 0.5 + dx * 0.5 + (dx ? 0 : along - 0.5)) * T, by = (y + 0.5 + dy * 0.5 + (dy ? 0 : along - 0.5)) * T;
          const r = T * (0.12 + er() * 0.16);
          g.moveTo(bx + r, by); g.arc(bx, by, r, 0, 7);
        }
      }
    }
    g.clip();
    g.fillStyle = pattern(th.wall, th.flat[2]); g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(10,20,10,0.2)"; g.fillRect(0, 0, W, H);
    g.restore();
    edgeShade(g, room, (x, y) => room.terrain[y]?.[x] === "#", "rgba(10,14,8,0.35)", T * 0.35, false);

    // 4. Watercolor: paper grain over everything.
    if (this.style === "watercolor") {
      // Paper: soft washes and blotches, then fine grain.
      const grain = seeded(7);
      for (let i = 0; i < (W * H) / 9000; i++) {
        const x = grain() * W, y = grain() * H, r = T * (0.6 + grain() * 1.6);
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, grain() < 0.5 ? "rgba(255,250,235,0.18)" : "rgba(120,100,80,0.08)"); grd.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      }
      g.fillStyle = "rgba(255,248,235,0.09)";
      for (let i = 0; i < (W * H) / 500; i++) g.fillRect(grain() * W, grain() * H, 1 + grain() * 4, 1 + grain() * 2);
      g.fillStyle = "rgba(255,250,240,0.16)"; g.fillRect(0, 0, W, H);
    }

    // 5. Ground decorations.
    for (const p of this.decor(room, roomId)) this.drawProp(g, p, 0, 1);
  }

  /** Draw one prop standing at its base point (world units), swaying a little. */
  drawProp(g: CanvasRenderingContext2D, p: Prop, t: number, alpha: number): void {
    const img = this.art(`prop_${p.name}`);
    if (!img) return;
    const T = CONFIG.coop.tile, h = p.h * T, w = (img.width / img.height) * h;
    const sway = p.h > 1.2 ? Math.sin(t * 0.9 + p.phase) * 0.025 : p.h > 0.6 ? Math.sin(t * 1.4 + p.phase) * 0.04 : 0;
    g.save();
    g.globalAlpha = alpha;
    // Soft contact shadow.
    g.fillStyle = "rgba(10,14,8,0.28)";
    g.beginPath(); g.ellipse(p.x, p.y, w * 0.38, Math.min(T * 0.22, h * 0.12), 0, 0, 7); g.fill();
    g.translate(p.x, p.y);
    g.rotate(sway);
    if (p.flip) g.scale(-1, 1);
    g.drawImage(img, -w / 2, -h, w, h);
    g.restore();
  }
}

/** Soft gradient strips on open tiles next to tiles where `is` holds (shadows, shores). */
function edgeShade(g: CanvasRenderingContext2D, room: ParsedRoom, is: (x: number, y: number) => boolean, color: string, size: number, onTarget: boolean): void {
  const T = CONFIG.coop.tile;
  for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) {
    if (is(x, y) || room.terrain[y][x] === "#" || (onTarget && room.terrain[y][x] === "~")) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (!is(x + dx, y + dy)) continue;
      const px = x * T, py = y * T;
      const x0 = dx === 1 ? px + T : dx === -1 ? px : px, y0 = dy === 1 ? py + T : dy === -1 ? py : py;
      const x1 = dx === 1 ? px + T - size : dx === -1 ? px + size : px, y1 = dy === 1 ? py + T - size : dy === -1 ? py + size : py;
      const grd = dx ? g.createLinearGradient(x0, 0, x1, 0) : g.createLinearGradient(0, y0, 0, y1);
      grd.addColorStop(0, color); grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd;
      if (dx) g.fillRect(Math.min(x0, x1), py, size, T); else g.fillRect(px, Math.min(y0, y1), T, size);
    }
  }
}

export function seeded(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s: string): number { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
