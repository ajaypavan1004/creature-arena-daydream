// Drawing: the angled stone arena (lit for day or night), the creatures (images with
// simple motion or walk cycles), power ups, gene effects, health bars and hit effects.
// World (x, y) on the floor maps to the screen by squashing y by the arena tilt, so the ring is seen from above at an angle.
import { CONFIG } from "./config.ts";
import { SpriteBank } from "./sprites.ts";
import { drawIcon } from "./items.ts";
import { hasTimeAdvantage, type Effect, type Fighter, type Game, type GameEvent, type Pickup, type Vec } from "./sim.ts";

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string }
interface Popup { x: number; y: number; text: string; color: string; t: number }
interface Slash { slot: 0 | 1; dir: Vec; t: number; dash: boolean }
interface Bolt { pts: Vec[]; t: number }
interface Banner { text: string; color: string; t: number }

/** The word that pops up for each gene effect, and its colour. */
const EFFECT_TEXT: Record<Effect, [string, string]> = {
  boost: ["BOOST", "#ffd166"],
  jitters: ["JITTERS", "#ff5d5d"],
  yum: ["YUM", "#5be37d"],
  bitter: ["BITTER!", "#b6d65a"],
  lightning: ["LIGHTNING", "#f4ff6b"],
  shield: ["SHIELD", "#8ff5ff"],
};

const SLOT_COLORS = ["#ffd166", "#ff6b6b"] as const;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0; private h = 0; private dpr = 1;
  /** World-to-screen scale (CSS pixels per world unit) and the arena centre on screen. */
  private s = 1; private cx = 0; private cy = 0;
  /** Width of the arena picture, and the camera's sideways pan (CSS pixels). */
  private arenaW = 0; private camX = 0;
  private arenaDay?: HTMLCanvasElement;
  private arenaNight?: HTMLCanvasElement;
  private bank = new SpriteBank(CONFIG.fighter.spriteHeight);
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private slashes: Slash[] = [];
  private bolts: Bolt[] = [];
  private banner: Banner | null = null;
  private shake = 0;
  private walkT: [number, number] = [0, 0];
  private frameDt = 0;
  private frameT = 0;
  private shownHp: [number, number] = [CONFIG.fighter.maxHp, CONFIG.fighter.maxHp];
  labels: [string, string] = ["", ""];
  /** Health bars and names (off behind the menus). */
  hud = true;
  /** Space kept free on the right for the powers sidebar (CSS px). */
  private reserve = 0;
  setReserve(px: number): void { if (Math.abs(px - this.reserve) > 1) { this.reserve = px; this.resize(); } }
  /** Slots played on this screen: a Keen one sees where the next power up will appear. */
  viewers: Array<0 | 1> = [];

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  /** Load a creature's art (resolves once it can be drawn). */
  load(name: string): Promise<void> {
    return this.bank.load(name);
  }

  resetMatch(): void {
    this.shownHp = [CONFIG.fighter.maxHp, CONFIG.fighter.maxHp];
    this.particles = []; this.popups = []; this.slashes = []; this.bolts = []; this.banner = null; this.shake = 0;
  }

  private resize(): void {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = innerWidth; this.h = innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    const A = CONFIG.arena, R = A.radius;
    const above = CONFIG.fighter.spriteHeight * 0.75; // room for creatures and bars near the far edge
    const ew = this.w - this.reserve; // width left of the sidebar
    this.s = Math.min(ew / (2 * R + 80), this.h / (2 * R * A.tilt + A.wallHeight + above + 40));
    // Tall phone screens: zoom in and let the camera follow the fight sideways.
    if (this.h > this.w * 1.1) this.s = Math.min(this.s * CONFIG.arena.portraitZoom, this.h / (2 * R * A.tilt + A.wallHeight + above + 40));
    this.cx = ew / 2;
    // The arena picture is as wide as the ring needs, which can be wider than the screen
    // (and wide enough to fill behind the sidebar too).
    this.arenaW = Math.max(this.w + this.reserve, Math.ceil((2 * R + 120) * this.s));
    const content = (above + 2 * R * A.tilt + A.wallHeight) * this.s;
    this.cy = Math.max(0, (this.h - content) / 2) + (above + R * A.tilt) * this.s;
    this.arenaDay = this.buildArena(false);
    this.arenaNight = this.buildArena(true);
    this.bank.rescale(this.s * this.dpr);
  }

  private project(x: number, y: number): Vec {
    return { x: this.cx - this.camX + x * this.s, y: this.cy + y * this.s * CONFIG.arena.tilt };
  }

  // ---------------------------------------------------------------- arena

  private buildArena(night: boolean): HTMLCanvasElement {
    const A = CONFIG.arena, R = A.radius, s = this.s, d = this.dpr;
    const c = document.createElement("canvas");
    const W = this.arenaW, cx = W / 2;
    c.width = Math.round(W * d); c.height = this.canvas.height;
    const g = c.getContext("2d")!;
    g.scale(d, d);
    const rand = mulberry32(7); // the stones: identical by day and by night

    const P = night ? NIGHT : DAY;
    if (night) {
      // Night sky with a few stars.
      const sky = g.createRadialGradient(cx, this.cy, 0, cx, this.cy, Math.max(W, this.h) * 0.8);
      sky.addColorStop(0, "#232a4d"); sky.addColorStop(0.55, "#121630"); sky.addColorStop(1, "#06070e");
      g.fillStyle = sky; g.fillRect(0, 0, W, this.h);
      const stars = mulberry32(11);
      for (let i = 0; i < 90; i++) {
        g.fillStyle = `rgba(200,215,255,${0.08 + stars() * 0.25})`;
        g.beginPath(); g.arc(stars() * W, stars() * this.h, 0.5 + stars() * 1.2, 0, Math.PI * 2); g.fill();
      }
    } else {
      // Day sky: blue above, warm haze at the horizon, a soft sun glow.
      const sky = g.createLinearGradient(0, 0, 0, this.h);
      sky.addColorStop(0, "#6fa8dc"); sky.addColorStop(0.55, "#b9d4e8"); sky.addColorStop(1, "#f3d9b1");
      g.fillStyle = sky; g.fillRect(0, 0, W, this.h);
      const sun = g.createRadialGradient(W * 0.82, this.h * 0.12, 0, W * 0.82, this.h * 0.12, this.h * 0.5);
      sun.addColorStop(0, "rgba(255,247,214,0.9)"); sun.addColorStop(0.15, "rgba(255,236,180,0.5)"); sun.addColorStop(1, "rgba(255,236,180,0)");
      g.fillStyle = sun; g.fillRect(0, 0, W, this.h);
    }

    const rx = R * s, ry = R * s * A.tilt, wall = A.wallHeight * s;
    // Side wall: lower ellipse + band, with block seams on the front half.
    const side = g.createLinearGradient(0, this.cy, 0, this.cy + ry + wall);
    side.addColorStop(0, P.wallTop); side.addColorStop(1, P.wallBottom);
    g.fillStyle = side;
    g.beginPath(); g.ellipse(cx, this.cy + wall, rx, ry, 0, 0, Math.PI); g.lineTo(cx - rx, this.cy);
    g.ellipse(cx, this.cy, rx, ry, 0, Math.PI, 0, true); g.closePath(); g.fill();
    g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = Math.max(1, 1.5 * s);
    for (let i = 1; i < 18; i++) {
      const t = (i / 18) * Math.PI, x = cx + Math.cos(t) * rx, y = this.cy + Math.sin(t) * ry;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + wall); g.stroke();
    }
    g.beginPath(); g.ellipse(cx, this.cy + wall * 0.5, rx, ry, 0, 0, Math.PI); g.stroke();

    // Floor, drawn in world units: rings of flagstones, each with its own shade.
    g.save();
    g.translate(cx, this.cy); g.scale(s, s * A.tilt);
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.clip();
    const floor = g.createRadialGradient(0, 0, 0, 0, 0, R);
    floor.addColorStop(0, P.floor[0]); floor.addColorStop(0.7, P.floor[1]); floor.addColorStop(1, P.floor[2]);
    g.fillStyle = floor; g.fillRect(-R, -R, 2 * R, 2 * R);
    const rings = [0, 95, 190, 290, 395, R + 5];
    for (let r = 1; r < rings.length; r++) {
      const n = r === 1 ? 1 : 6 + r * 5, off = rand() * Math.PI;
      for (let j = 0; j < n; j++) {
        const a0 = off + (j / n) * Math.PI * 2, a1 = off + ((j + 1) / n) * Math.PI * 2;
        g.beginPath();
        g.arc(0, 0, rings[r], a0, a1); g.arc(0, 0, rings[r - 1], a1, a0, true); g.closePath();
        const v = rand();
        g.fillStyle = v < 0.5 ? `rgba(0,0,0,${0.03 + v * 0.1})` : `rgba(255,255,255,${(v - 0.5) * 0.09})`;
        g.fill();
        g.strokeStyle = P.joints; g.lineWidth = 3.2; g.stroke();
      }
    }
    // Speckles for a stone texture.
    for (let i = 0; i < 2600; i++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * R;
      g.fillStyle = rand() < 0.5 ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.08)";
      g.fillRect(Math.cos(a) * r, Math.sin(a) * r, 2 + rand() * 3, 2 + rand() * 3);
    }
    // Faint rune circle in the middle.
    g.strokeStyle = "rgba(160,230,255,0.16)"; g.lineWidth = 4;
    g.beginPath(); g.arc(0, 0, 78, 0, Math.PI * 2); g.stroke();
    g.beginPath();
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI * 2, r = i % 2 ? 30 : 70;
      for (const k of [0, 1]) { const b = a + k * Math.PI / 8; g.lineTo(Math.cos(b) * (k ? 30 : r), Math.sin(b) * (k ? 30 : r)); }
    }
    g.stroke();
    // Darken towards the rim.
    const rim = g.createRadialGradient(0, 0, R * 0.6, 0, 0, R);
    rim.addColorStop(0, "rgba(0,0,0,0)"); rim.addColorStop(1, P.rim);
    g.fillStyle = rim; g.fillRect(-R, -R, 2 * R, 2 * R);
    g.restore();
    return c;
  }

  private drawEdge(time: number, nightness: number): void {
    const A = CONFIG.arena, g = this.ctx, s = this.s;
    const pulse = (0.65 + 0.35 * Math.sin(time * Math.PI * 2 * A.edgePulse)) * (0.75 + 0.25 * nightness);
    g.save();
    g.translate(this.cx - this.camX, this.cy); g.scale(s, s * A.tilt);
    g.shadowColor = A.edgeColor; g.shadowBlur = 22 * pulse * this.dpr;
    g.strokeStyle = A.edgeColor; g.globalAlpha = 0.55 + 0.35 * pulse;
    g.lineWidth = 9; g.beginPath(); g.arc(0, 0, A.radius, 0, Math.PI * 2); g.stroke();
    g.shadowBlur = 0; g.globalAlpha = 0.9; g.strokeStyle = "#e9fdff"; g.lineWidth = 2.5; g.stroke();
    g.restore();
  }

  // -------------------------------------------------------------- sprites

  private drawFighter(f: Fighter, game: Game): void {
    const sp = this.bank.get(f.creature.name);
    const g = this.ctx, s = this.s, M = CONFIG.motion, F = CONFIG.fighter;
    const p = this.project(f.x, f.y);

    // Contact shadow.
    g.fillStyle = "rgba(5,8,20,0.38)";
    g.beginPath(); g.ellipse(p.x, p.y, F.radius * 1.35 * s, F.radius * 0.42 * s, 0, 0, Math.PI * 2); g.fill();
    if (!sp?.scaled) return;

    const speed = Math.hypot(f.vx, f.vy) / F.maxSpeed;
    const animated = sp.sheet.frames > 1;
    // Walk cycles animate the legs themselves, so they only get a hint of the hop.
    const hop = Math.abs(Math.sin(f.bob * Math.PI)) * M.bobHeight * s * Math.min(1, speed * 1.5) * (animated ? 0.25 : 1);
    // Walk frame: the cycle plays faster the faster the creature runs; standing holds frame 0.
    if (animated) this.walkT[f.slot] = speed > 0.08 ? this.walkT[f.slot] + this.frameDt * (0.4 + 0.9 * Math.min(1, speed)) : 0;
    const frame = animated ? Math.floor(this.walkT[f.slot] * sp.sheet.fps) % sp.sheet.frames : 0;
    const fx = (frame % sp.sheet.cols) * sp.tw, fy = Math.floor(frame / sp.sheet.cols) * sp.th;
    let lean = Math.max(-1, Math.min(1, f.vx / F.maxSpeed)) * M.lean;
    if (f.swingT >= 0) lean = f.swingDir.x * M.lungeLean * Math.sin(Math.min(1, f.swingT / 0.2) * Math.PI);
    if (f.hp <= 0) lean = -f.facing * 0.35;
    const flip = (f.facing === 1) !== sp.sheet.facesLeft ? 1 : -1;
    const squash = 1 - 0.04 * Math.min(1, speed) * (1 - Math.abs(Math.sin(f.bob * Math.PI)));
    const w = sp.w * s, h = sp.h * s;
    // Jitters: a fast shake. Bitter: a wobbly spin while reeling.
    const jx = f.jitter > 0 ? (Math.random() - 0.5) * 9 * s : 0, jy = f.jitter > 0 ? (Math.random() - 0.5) * 5 * s : 0;
    if (f.bitter > 0) lean += Math.sin(game.time * 14) * 0.18;
    if (f.jitter > 0) lean += (Math.random() - 0.5) * 0.08;

    if (f.boost > 0) this.drawBoostTrail(f, p, w, h);
    if (f.sprinting && speed > 0.4 && Math.random() < 0.6) {
      // Dust kicked up behind a sprinting creature.
      const v = Math.hypot(f.vx, f.vy) || 1;
      this.particles.push({ x: p.x - (f.vx / v) * w * 0.3 + (Math.random() - 0.5) * w * 0.3, y: p.y + (Math.random() - 0.5) * 6 * s,
        vx: -(f.vx / v) * 40 * s, vy: -12 * s, life: 0, max: 0.5, size: (5 + Math.random() * 5) * s, color: "dust" });
    }

    g.save();
    g.translate(p.x + jx, p.y - hop + jy);
    g.rotate(lean);
    g.scale(flip / squash, squash);
    if (f.hp <= 0) g.globalAlpha = 0.75;
    g.drawImage(sp.scaled, fx, fy, sp.tw, sp.th, -w / 2, -h, w, h);
    if (game.nightness > 0 && sp.dark) {
      // Night: shade the creature cool blue to match the lighting.
      g.globalAlpha = 0.32 * game.nightness * (f.hp <= 0 ? 0.75 : 1);
      g.drawImage(sp.dark, fx, fy, sp.tw, sp.th, -w / 2, -h, w, h);
      g.globalAlpha = f.hp <= 0 ? 0.75 : 1;
    }
    if (f.flash > 0 && sp.white) {
      g.globalAlpha = Math.min(1, f.flash / M.hitFlash) * 0.85;
      g.drawImage(sp.white, fx, fy, sp.tw, sp.th, -w / 2, -h, w, h);
    }
    g.restore();

    const mid = { x: p.x + jx, y: p.y - hop - h * 0.45 };
    if (f.charged > 0) this.drawCharge(mid, w, h, game.time);
    if (f.shield > 0) this.drawShield(mid, w, h, game.time, f.shield);
    if (f.bitter > 0 && Math.random() < 0.5) this.bubble(mid.x + (Math.random() - 0.5) * w * 0.7, mid.y + h * 0.3 * Math.random());
    if (f.jitter > 0) this.drawJitter(mid, w, h, game.time);
  }

  // ------------------------------------------------------- gene effects

  private drawBoostTrail(f: Fighter, p: Vec, w: number, h: number): void {
    const g = this.ctx, v = Math.hypot(f.vx, f.vy);
    if (v < 40) return;
    const ux = -f.vx / v, uy = -f.vy * CONFIG.arena.tilt / v;
    g.save();
    g.strokeStyle = "rgba(255,209,102,0.55)"; g.lineCap = "round"; g.lineWidth = Math.max(2, 4 * this.s);
    for (let i = 0; i < 4; i++) {
      const y = p.y - h * (0.2 + i * 0.17), off = ((this.frameT * 900 + i * 37) % 60) * this.s;
      const x0 = p.x + ux * (w * 0.35 + off), y0 = y + uy * (w * 0.35 + off);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + ux * 50 * this.s, y0 + uy * 50 * this.s); g.stroke();
    }
    g.restore();
  }

  private drawCharge(mid: Vec, w: number, h: number, t: number): void {
    const g = this.ctx;
    g.save();
    g.strokeStyle = "#f4ff6b"; g.shadowColor = "#fff36b"; g.shadowBlur = 10 * this.dpr; g.lineWidth = Math.max(1.5, 2.5 * this.s);
    for (let i = 0; i < 3; i++) {
      const a = t * 4 + i * 2.1 + Math.random() * 0.4;
      const pts = zigzag({ x: mid.x + Math.cos(a) * w * 0.45, y: mid.y + Math.sin(a) * h * 0.45 },
        { x: mid.x + Math.cos(a + 0.9) * w * 0.38, y: mid.y + Math.sin(a + 0.9) * h * 0.4 }, 4, 9 * this.s);
      g.beginPath(); pts.forEach((q, j) => (j ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.stroke();
    }
    g.restore();
  }

  private drawShield(mid: Vec, w: number, h: number, t: number, left: number): void {
    const g = this.ctx, fade = Math.min(1, left / 2); // fades out over its last 2 s
    const rx = w * 0.6, ry = h * 0.62;
    g.save();
    g.globalAlpha = fade * (0.85 + 0.15 * Math.sin(t * 5));
    const fill = g.createRadialGradient(mid.x, mid.y, Math.min(rx, ry) * 0.5, mid.x, mid.y, Math.max(rx, ry));
    fill.addColorStop(0, "rgba(143,245,255,0.04)"); fill.addColorStop(1, "rgba(143,245,255,0.28)");
    g.fillStyle = fill; g.strokeStyle = "rgba(190,250,255,0.85)"; g.lineWidth = Math.max(1.5, 2.5 * this.s);
    g.beginPath(); g.ellipse(mid.x, mid.y, rx, ry, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.7)"; g.lineWidth = Math.max(2, 4 * this.s);
    g.beginPath(); g.ellipse(mid.x, mid.y, rx * 0.8, ry * 0.8, 0, Math.PI * 1.1, Math.PI * 1.4); g.stroke();
    g.restore();
  }

  private drawJitter(mid: Vec, w: number, h: number, t: number): void {
    const g = this.ctx;
    g.save();
    g.strokeStyle = "rgba(255,93,93,0.9)"; g.lineWidth = Math.max(1.5, 2.5 * this.s); g.lineCap = "round";
    for (const side of [-1, 1]) {
      const x = mid.x + side * w * 0.5, y = mid.y - h * 0.25 + Math.sin(t * 40) * 2;
      g.beginPath(); g.moveTo(x, y - 10 * this.s); g.lineTo(x + side * 6 * this.s, y - 4 * this.s); g.lineTo(x, y + 2 * this.s); g.lineTo(x + side * 6 * this.s, y + 8 * this.s); g.stroke();
    }
    g.restore();
  }

  private bubble(x: number, y: number): void {
    this.particles.push({ x, y, vx: (Math.random() - 0.5) * 30 * this.s, vy: -(40 + Math.random() * 50) * this.s, life: 0, max: 0.9,
      size: (4 + Math.random() * 6) * this.s, color: "bubble" });
  }

  /** Keen senses: a faint, growing marker where the next power up is about to appear. */
  private drawForesight(pk: Pickup, seer: 0 | 1, t: number): void {
    const g = this.ctx, s = this.s, P = CONFIG.powerUps;
    const k = Math.max(0, Math.min(1, 1 + pk.age / CONFIG.keen.foresight)); // 0 -> 1 as it arrives
    const p = this.project(pk.x, pk.y), r = P.radius * s * (0.6 + 0.6 * k);
    g.save();
    g.globalAlpha = 0.25 + 0.35 * k;
    g.strokeStyle = SLOT_COLORS[seer]; g.lineWidth = Math.max(1, 2 * s);
    g.setLineDash([6 * s, 6 * s]); g.lineDashOffset = -t * 30 * s;
    g.beginPath(); g.ellipse(p.x, p.y, r, r * CONFIG.arena.tilt, 0, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 0.18 + 0.22 * k;
    g.translate(p.x, p.y - 30 * s);
    drawIcon(g, pk.kind, 40 * s, t);
    g.restore();
  }

  private drawPickup(pk: Pickup, t: number): void {
    const g = this.ctx, P = CONFIG.powerUps, s = this.s;
    const p = this.project(pk.x, pk.y);
    const appear = Math.min(1, pk.age / 0.35), pop = appear < 1 ? 1 + Math.sin(appear * Math.PI) * 0.3 : 1;
    const left = P.lifetime - pk.age;
    if (left < 2 && Math.floor(left * 8) % 2 === 0) return; // blink before vanishing
    const color = pk.kind === "coffee" ? "255,190,120" : pk.kind === "greens" ? "120,230,130" : "190,150,255";
    // Glow on the floor.
    g.save();
    const glow = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, P.radius * 1.6 * s);
    glow.addColorStop(0, `rgba(${color},0.55)`); glow.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = glow;
    g.beginPath(); g.ellipse(p.x, p.y, P.radius * 1.6 * s, P.radius * 1.6 * s * CONFIG.arena.tilt, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = `rgba(${color},0.8)`; g.lineWidth = Math.max(1, 2 * s);
    g.beginPath(); g.ellipse(p.x, p.y, P.radius * s, P.radius * s * CONFIG.arena.tilt, 0, 0, Math.PI * 2); g.stroke();
    // The icon floats above its spot.
    const size = 60 * s * appear * pop, float = (26 + Math.sin(t * 3 + pk.id) * 6) * s;
    g.translate(p.x, p.y - float - size * 0.4);
    drawIcon(g, pk.kind, size, t + pk.id);
    g.restore();
  }

  /** Where each health bar goes: above its creature, nudged up when the two would overlap. */
  private barSpots(fs: readonly Fighter[]): Array<{ x: number; y: number }> {
    const s = this.s, bh = Math.max(7, 12 * s), bw = Math.max(70, 130 * s), labelH = Math.max(11, 15 * s) + 6;
    const spots = fs.map((f) => {
      const p = this.project(f.x, f.y), h = this.bank.get(f.creature.name)?.h ?? CONFIG.fighter.spriteHeight;
      return { x: p.x, y: Math.max(labelH + 2, p.y - h * s - 14 * s - bh) };
    });
    const [a, b] = spots, gap = bh + labelH + 4 + Math.max(4, 6 * s) + 3;
    if (Math.abs(a.x - b.x) < bw + 12 && Math.abs(a.y - b.y) < gap) {
      const upper = fs[0].y < fs[1].y ? a : b, lower = upper === a ? b : a;
      upper.y = Math.min(upper.y, lower.y - gap);
    }
    return spots;
  }

  private drawBar(f: Fighter, label: string, spot: { x: number; y: number }, game: Game): void {
    const g = this.ctx, s = this.s;
    const bw = Math.max(70, 130 * s), bh = Math.max(7, 12 * s), x = spot.x - bw / 2, y = spot.y;
    const hp = f.hp / CONFIG.fighter.maxHp, shown = this.shownHp[f.slot] / CONFIG.fighter.maxHp;

    g.fillStyle = "rgba(8,10,20,0.75)"; roundRect(g, x - 2, y - 2, bw + 4, bh + 4, bh / 2 + 2); g.fill();
    g.fillStyle = "rgba(255,255,255,0.75)"; roundRect(g, x, y, bw * shown, bh, bh / 2); g.fill();
    g.fillStyle = hp > 0.5 ? "#5be37d" : hp > 0.25 ? "#ffd04d" : "#ff5d5d";
    if (hp > 0) { roundRect(g, x, y, Math.max(bh, bw * hp), bh, bh / 2); g.fill(); }
    g.strokeStyle = SLOT_COLORS[f.slot]; g.lineWidth = 1.5; roundRect(g, x - 2, y - 2, bw + 4, bh + 4, bh / 2 + 2); g.stroke();

    // Stamina, just under the health bar. It flashes red while winded.
    const sh = Math.max(4, 6 * s), sy = y + bh + 4, sw = bw * 0.8, sx = spot.x - sw / 2;
    g.fillStyle = "rgba(8,10,20,0.7)"; roundRect(g, sx - 1, sy - 1, sw + 2, sh + 2, sh / 2 + 1); g.fill();
    const winded = f.winded && Math.floor(this.frameT * 6) % 2 === 0;
    g.fillStyle = winded ? "#ff7a7a" : f.sprinting ? "#9ff0ff" : "#4fc3f7";
    if (f.stamina > 0) { roundRect(g, sx, sy, Math.max(sh, sw * f.stamina), sh, sh / 2); g.fill(); }

    const fs = Math.max(11, 15 * s);
    g.font = `700 ${fs}px ui-rounded, system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "bottom";
    g.lineWidth = 3; g.strokeStyle = "rgba(5,6,14,0.8)"; g.strokeText(label, spot.x, y - 4);
    g.fillStyle = SLOT_COLORS[f.slot]; g.fillText(label, spot.x, y - 4);

    // Sun or moon by the creature whose Time gene has the edge right now.
    if (game.phase === "fight" && hasTimeAdvantage(game, f)) {
      const size = Math.max(16, 26 * s);
      g.save(); g.translate(x - size * 0.75, y + bh / 2);
      drawIcon(g, game.night ? "moon" : "sun", size, game.time);
      g.restore();
    }
  }

  // ------------------------------------------------------------------ fx

  /** Turn the simulation's events into effects. */
  handle(events: GameEvent[], game: Game): void {
    for (const e of events) {
      if (e.type === "swing") {
        this.slashes.push({ slot: e.slot, dir: e.dir, t: 0, dash: e.dash });
        if (e.dash) {
          const f = game.fighters[e.slot], mid = (this.bank.get(f.creature.name)?.h ?? 150) * 0.45 * this.s;
          const a = this.project(f.x, f.y), b = this.project(f.x + e.dir.x * 220, f.y + e.dir.y * 220);
          this.bolts.push({ pts: zigzag({ x: a.x, y: a.y - mid }, { x: b.x, y: b.y - mid }, 7, 16 * this.s), t: 0 });
        }
      }
      if (e.type === "power") {
        const f = game.fighters[e.slot], h = (this.bank.get(f.creature.name)?.h ?? 150) * this.s;
        const p = this.project(f.x, f.y), [text, color] = EFFECT_TEXT[e.effect];
        this.popups.push({ x: p.x, y: p.y - h * 0.95, text, color, t: 0 });
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 140;
          this.particles.push({ x: p.x, y: p.y - h * 0.4, vx: Math.cos(a) * v * this.s, vy: Math.sin(a) * v * this.s - 80 * this.s,
            life: 0, max: 0.5, size: 3 * this.s + Math.random() * 3 * this.s, color });
        }
        if (e.effect === "bitter") for (let i = 0; i < 10; i++) this.bubble(p.x + (Math.random() - 0.5) * 80 * this.s, p.y - h * Math.random() * 0.6);
      }
      if (e.type === "block") {
        const f = game.fighters[e.slot], h = (this.bank.get(f.creature.name)?.h ?? 150) * this.s, p = this.project(e.x, e.y);
        this.popups.push({ x: p.x, y: p.y - h * 0.95, text: "BLOCKED", color: "#8ff5ff", t: 0 });
        for (let i = 0; i < 16; i++) {
          const a = Math.random() * Math.PI * 2, v = 160 + Math.random() * 200;
          this.particles.push({ x: p.x + Math.cos(a) * h * 0.4, y: p.y - h * 0.45 + Math.sin(a) * h * 0.4, vx: Math.cos(a) * v * this.s, vy: Math.sin(a) * v * this.s,
            life: 0, max: 0.45, size: 4 * this.s, color: "#bffaff" });
        }
      }
      if (e.type === "daynight") this.banner = e.night ? { text: "Night falls", color: "#b9c8ff", t: 0 } : { text: "Day breaks", color: "#ffd98a", t: 0 };
      if (e.type === "hit") {
        const f = game.fighters[e.slot], mid = (this.bank.get(f.creature.name)?.h ?? 150) * 0.45;
        const p = this.project(e.x, e.y);
        for (let i = 0; i < 14; i++) {
          const a = Math.atan2(e.dir.y, e.dir.x) + (Math.random() - 0.5) * 2.2, v = 120 + Math.random() * 260;
          this.particles.push({ x: p.x, y: p.y - mid * this.s, vx: Math.cos(a) * v * this.s, vy: (Math.sin(a) * v * 0.6 - 120) * this.s,
            life: 0, max: 0.35 + Math.random() * 0.25, size: (3 + Math.random() * 4) * this.s, color: Math.random() < 0.5 ? "#fff6d5" : "#ffb347" });
        }
        this.popups.push({ x: p.x, y: p.y - mid * this.s * 1.8, text: `-${e.damage}`, color: e.dash ? "#f4ff6b" : e.boosted ? "#ffb347" : "#ffffff", t: 0 });
        this.shake = Math.max(this.shake, CONFIG.fx.shake);
      }
      if (e.type === "ko") this.shake = CONFIG.fx.shake * 2.2;
    }
  }

  private drawSlash(sl: Slash, game: Game): void {
    const f = game.fighters[sl.slot], g = this.ctx, s = this.s;
    const life = 0.2, k = sl.t / life;
    if (k >= 1) return;
    const p = this.project(f.x + sl.dir.x * 70, f.y + sl.dir.y * 70);
    const ang = Math.atan2(sl.dir.y * CONFIG.arena.tilt, sl.dir.x);
    g.save();
    g.translate(p.x, p.y - CONFIG.fighter.spriteHeight * 0.38 * s);
    g.rotate(ang);
    g.globalAlpha = (1 - k) * 0.9;
    g.strokeStyle = sl.dash ? "#f4ff6b" : "#fff8e1"; g.shadowColor = sl.dash ? "#fff36b" : SLOT_COLORS[sl.slot]; g.shadowBlur = 14 * this.dpr;
    g.lineCap = "round";
    const r = (46 + 26 * k) * s;
    g.lineWidth = Math.max(2, 9 * s * (1 - k));
    g.beginPath(); g.arc(-r * 0.6, 0, r, -1.0, 1.0); g.stroke();
    g.restore();
  }

  // ---------------------------------------------------------------- frame

  draw(game: Game, dt: number): void {
    const g = this.ctx;
    this.frameDt = dt;
    this.frameT += dt;
    for (const f of game.fighters) {
      // Health bars drain with a short white trail.
      this.shownHp[f.slot] = Math.max(f.hp, this.shownHp[f.slot] - dt * 40);
    }
    this.shake *= Math.exp(-dt * 10);
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;

    g.setTransform(this.dpr, 0, 0, this.dpr, sx * this.dpr, sy * this.dpr);
    // Day and night: the night arena fades in over the day one.
    // Camera: follow the middle of the fight when the ring is wider than the screen.
    const maxPan = this.reserve ? 0 : Math.max(0, (this.arenaW - this.w) / 2 - 20 * this.s);
    const mid = (game.fighters[0].x + game.fighters[1].x) / 2 * this.s;
    const target = Math.max(-maxPan, Math.min(maxPan, mid));
    this.camX += (target - this.camX) * Math.min(1, dt * 4);
    const ax = this.cx - this.camX - this.arenaW / 2;
    if (this.arenaDay && game.nightness < 1) g.drawImage(this.arenaDay, ax, 0, this.arenaW, this.h);
    if (this.arenaNight && game.nightness > 0) {
      g.globalAlpha = game.nightness; g.drawImage(this.arenaNight, ax, 0, this.arenaW, this.h); g.globalAlpha = 1;
    }
    this.drawEdge(game.time, game.nightness);

    // Back-to-front by floor depth: creatures and power ups.
    const order: Array<{ y: number; draw: () => void }> = [
      ...game.fighters.map((f) => ({ y: f.y, draw: () => this.drawFighter(f, game) })),
      ...game.pickups.map((pk) => ({ y: pk.y, draw: () => this.drawPickup(pk, game.time) })),
    ].sort((a, b) => a.y - b.y);
    const seer = this.viewers.find((v) => game.fighters[v].creature.senses === "Keen");
    if (game.pending && seer !== undefined && game.phase === "fight") this.drawForesight(game.pending, seer, game.time);
    for (const o of order) o.draw();
    for (const b of this.bolts) { b.t += dt; this.drawBolt(b); }
    this.bolts = this.bolts.filter((b) => b.t < 0.25);
    for (const sl of this.slashes) { sl.t += dt; this.drawSlash(sl, game); }
    this.slashes = this.slashes.filter((sl) => sl.t < 0.2);
    const spots = this.barSpots(game.fighters);
    if (this.hud && game.phase !== "over") for (const f of game.fighters) this.drawBar(f, this.labels[f.slot], spots[f.slot], game);

    for (const p of this.particles) {
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      g.globalAlpha = Math.max(0, 1 - p.life / p.max);
      if (p.color === "dust") {
        g.fillStyle = "rgba(200,190,170,0.5)";
        g.beginPath(); g.arc(p.x, p.y, p.size * (1 + p.life / p.max), 0, Math.PI * 2); g.fill();
        continue;
      }
      if (p.color === "bubble") {
        // Bitter bubbles float up instead of falling.
        g.strokeStyle = "rgba(220,245,255,0.9)"; g.fillStyle = "rgba(160,220,255,0.18)"; g.lineWidth = Math.max(1, 1.5 * this.s);
        g.beginPath(); g.arc(p.x, p.y, p.size, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = "rgba(255,255,255,0.8)"; g.beginPath(); g.arc(p.x - p.size * 0.35, p.y - p.size * 0.35, p.size * 0.22, 0, Math.PI * 2); g.fill();
        continue;
      }
      p.vy += 900 * this.s * dt;
      g.fillStyle = p.color;
      g.beginPath(); g.arc(p.x, p.y, p.size * (1 - p.life / p.max * 0.5), 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life < p.max);

    for (const pu of this.popups) {
      pu.t += dt;
      const k = pu.t / CONFIG.fx.popupTime;
      g.globalAlpha = Math.max(0, 1 - k * k);
      this.text(pu.text, pu.x, pu.y - k * 40 * this.s, Math.max(14, 26 * this.s), pu.color);
    }
    g.globalAlpha = 1;
    this.popups = this.popups.filter((pu) => pu.t < CONFIG.fx.popupTime);

    this.drawBanner(game);
  }

  private drawBolt(b: Bolt): void {
    const g = this.ctx, k = b.t / 0.25;
    g.save();
    g.globalAlpha = 1 - k;
    g.strokeStyle = "#fbffd0"; g.shadowColor = "#f4ff6b"; g.shadowBlur = 18 * this.dpr; g.lineWidth = Math.max(2, 5 * this.s * (1 - k * 0.6));
    g.lineJoin = "round";
    g.beginPath(); b.pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.stroke();
    g.restore();
  }

  private drawBanner(game: Game): void {
    if (this.banner) {
      const b = this.banner;
      b.t += this.frameDt;
      const k = b.t / 1.8;
      if (k >= 1) this.banner = null;
      else {
        this.ctx.globalAlpha = k < 0.15 ? k / 0.15 : k > 0.7 ? (1 - k) / 0.3 : 1;
        this.text(b.text, this.w / 2, Math.max(40, this.h * 0.1), Math.min(this.w * 0.08, 44), b.color);
        this.ctx.globalAlpha = 1;
      }
    }
    let msg = "", k = 0;
    if (game.phase === "countdown") {
      const left = CONFIG.match.countdown - game.phaseT, step = CONFIG.match.countdown / 3;
      msg = String(Math.ceil(left / step)); k = 1 - ((left / step) % 1);
    } else if (game.phase === "fight" && game.phaseT < 0.7) {
      msg = "FIGHT!"; k = game.phaseT / 0.7;
    } else if (game.phase === "ko") {
      msg = "K.O.!"; k = Math.min(0.4, game.phaseT / CONFIG.match.koPause);
    }
    if (!msg) return;
    const g = this.ctx, size = Math.min(this.w * 0.2, 120) * (1.25 - 0.25 * Math.min(1, k * 3));
    g.globalAlpha = k > 0.7 ? Math.max(0, (1 - k) / 0.3) : 1;
    this.text(msg, this.w / 2, this.h * 0.42, size, "#ffe08a");
    g.globalAlpha = 1;
  }

  private text(t: string, x: number, y: number, size: number, color: string): void {
    const g = this.ctx;
    g.font = `800 ${size}px ui-rounded, system-ui, sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = Math.max(3, size / 9); g.strokeStyle = "rgba(10,8,20,0.85)"; g.lineJoin = "round";
    g.strokeText(t, x, y); g.fillStyle = color; g.fillText(t, x, y);
  }
}

interface Palette { wallTop: string; wallBottom: string; floor: [string, string, string]; joints: string; rim: string }
const NIGHT: Palette = { wallTop: "#4a4e5c", wallBottom: "#1d1f28", floor: ["#8f94a3", "#6c7180", "#4b4f5c"], joints: "rgba(20,22,30,0.55)", rim: "rgba(5,10,25,0.45)" };
const DAY: Palette = { wallTop: "#8a8274", wallBottom: "#4a443a", floor: ["#d3cbb9", "#b5ad9b", "#8e8676"], joints: "rgba(70,60,45,0.45)", rim: "rgba(60,45,25,0.25)" };

/** A jagged line from a to b (lightning). */
function zigzag(a: Vec, b: Vec, n: number, jitter: number): Vec[] {
  const pts: Vec[] = [a];
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
  for (let i = 1; i < n; i++) {
    const t = i / n, o = (Math.random() - 0.5) * 2 * jitter;
    pts.push({ x: a.x + dx * t + nx * o, y: a.y + dy * t + ny * o });
  }
  pts.push(b);
  return pts;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath(); g.roundRect(x, y, Math.max(0, w), h, Math.min(r, h / 2, Math.max(0, w) / 2));
}

/** Small seeded random generator, so the arena's stones look the same every time. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
