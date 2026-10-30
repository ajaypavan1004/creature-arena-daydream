// Drawing Hatchling Expedition: a top-down tile room with raised walls, every gene
// obstacle in its own look, the explorers (the same creature art as the arena), darkness
// lit by Ember glow, day and night, and a message feed telling players what their genes did.
import { CONFIG } from "../config.ts";
import { drawIcon } from "../items.ts";
import { SpriteBank } from "../sprites.ts";
import { POWER } from "./genes.ts";
import { ROOMS } from "./rooms.ts";
import { OUTSIDE, Scenery, type Prop, type Style } from "./scenery.ts";
import { blockBox, type CoopEvent, type Explorer, type ThingState, type World } from "./world.ts";

export const PLAYER_COLORS = ["#ffd166", "#ff7b7b", "#7fe7ff", "#b9f27c"] as const;

interface Message { text: string; color: string; t: number }

export class CoopRenderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private bank = new SpriteBank(CONFIG.coop.spriteHeight);
  private w = 0; private h = 0; private dpr = 1;
  /** CSS pixels per world unit, and the camera's top-left in world units. */
  private s = 1; private camX = 0; private camY = 0;
  private roomLayer?: HTMLCanvasElement;
  private roomKey = "";
  private messages: Message[] = [];
  private hint: Message | null = null;
  private walkT = new Map<number, number>();
  private t = 0;
  /** Which slots are played on this screen (messages say "Your" for a single local player). */
  local: number[] = [];
  /** Space kept free on the right for the powers sidebar (CSS px). */
  reserve = 0;
  names: string[] = [];

  private scenery = new Scenery();
  private sceneryReady = false;
  private props: Prop[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    // Style previews: #style=storybook | watercolor | cartoon (default storybook).
    const style = new URLSearchParams(location.hash.slice(1)).get("style");
    if (style === "watercolor" || style === "cartoon" || style === "storybook") this.scenery.setStyle(style as Style);
    void this.scenery.ready.then(() => { this.sceneryReady = true; this.roomKey = ""; });
    addEventListener("resize", () => { this.roomKey = ""; });
  }

  load(name: string): Promise<void> { return this.bank.load(name); }

  reset(): void { this.messages = []; this.hint = null; this.roomKey = ""; }

  private whose(slot: number): string {
    if (this.local.length === 1 && this.local[0] === slot) return "Your";
    return `${this.names[slot] ?? `Player ${slot + 1}`}'s`;
  }
  private who(slot: number): string {
    if (this.local.length === 1 && this.local[0] === slot) return "You";
    return this.names[slot] ?? `Player ${slot + 1}`;
  }

  /** Turn this step's events into messages. */
  handle(events: CoopEvent[]): void {
    for (const e of events) {
      if (e.type === "opened") {
        const text = e.slot < 0 ? e.text : e.gene ? `${this.whose(e.slot)} ${POWER[e.gene]} ${e.text}!` : `${this.who(e.slot)} ${e.text}.`;
        this.messages.push({ text, color: e.slot >= 0 ? PLAYER_COLORS[e.slot] : "#ffffff", t: 0 });
      }
      if (e.type === "hint") this.hint = { text: e.text, color: "#ffffff", t: 0 };
      if (e.type === "gem") this.messages.push({ text: `${this.who(e.slot)} found a bonus gem!`, color: "#c9a7ff", t: 0 });
      if (e.type === "fell") this.messages.push({ text: `${this.who(e.slot)} ${e.why === "trap" ? "stepped on a hidden trap" : e.why === "crack" ? "cracked the fragile bridge" : "fell"}. Back to the start!`, color: "#ff9b9b", t: 0 });
      if (e.type === "growl") this.messages.push({ text: `The critter shoves ${this.who(e.slot) === "You" ? "you" : this.who(e.slot)} back. A Still creature could calm it.`, color: "#ffb36b", t: 0 });
      if (e.type === "daynight") this.messages.push({ text: e.night ? "Night falls: moon stones appear." : "Day breaks: sun stones appear.", color: e.night ? "#b9c8ff" : "#ffd98a", t: 0 });
    }
    if (this.messages.length > 5) this.messages.splice(0, this.messages.length - 5);
  }

  // ------------------------------------------------------------------ camera

  private layout(world: World, follow: Explorer[]): void {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    if (this.w !== innerWidth || this.h !== innerHeight) {
      this.w = innerWidth; this.h = innerHeight;
      this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
      this.roomKey = "";
    }
    const T = CONFIG.coop.tile, top = 56, bottom = 30;
    const roomW = world.room.w * T, roomH = world.room.h * T;
    const aw = this.w - this.reserve; // width left of the sidebar
    const fit = Math.min(aw / roomW, (this.h - top - bottom) / roomH);
    // Never smaller than about 30 px a tile: on phones the camera follows instead.
    const s = Math.max(fit, 30 / T);
    const key = `${world.roomIndex}|${s.toFixed(4)}|${this.w}x${this.h}|${this.dpr}|${this.reserve}`;
    if (key !== this.roomKey) {
      this.s = s;
      this.roomLayer = this.buildRoom(world);
      this.bank.rescale(this.s * this.dpr);
      this.roomKey = key;
    }
    const viewW = aw / this.s, viewH = (this.h - top - bottom) / this.s;
    const live = follow.filter((e) => e.falling <= 0);
    const cx = live.length ? live.reduce((a, e) => a + e.x, 0) / live.length : roomW / 2;
    const cy = live.length ? live.reduce((a, e) => a + e.y, 0) / live.length : roomH / 2;
    const tx = roomW <= viewW ? (roomW - viewW) / 2 : Math.max(0, Math.min(roomW - viewW, cx - viewW / 2));
    const ty = roomH <= viewH ? (roomH - viewH) / 2 - top / this.s : Math.max(0, Math.min(roomH - viewH, cy - viewH / 2)) - top / this.s;
    this.camX += (tx - this.camX) * 0.15; this.camY += (ty - this.camY) * 0.15;
    if (Math.abs(tx - this.camX) > viewW) { this.camX = tx; this.camY = ty; }
  }

  private sx(x: number): number { return (x - this.camX) * this.s; }
  private sy(y: number): number { return (y - this.camY) * this.s; }

  // ------------------------------------------------------------- static room

  private buildRoom(world: World): HTMLCanvasElement {
    const T = CONFIG.coop.tile, s = this.s, d = this.dpr, R = world.room;
    const c = document.createElement("canvas");
    c.width = Math.ceil(R.w * T * s * d); c.height = Math.ceil(R.h * T * s * d);
    const g = c.getContext("2d")!;
    g.scale(s * d, s * d);
    if (this.sceneryReady) {
      // Outdoor scenery: painted ground, water, overgrown walls (props are drawn live).
      const id = ROOMS[world.roomIndex].id;
      this.scenery.ground(g, R, id);
      this.props = this.scenery.props(R, id);
      return c;
    }
    this.props = [];
    const wallH = T * 0.35;
    for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) {
      const t = R.terrain[y][x], px = x * T, py = y * T;
      if (t === "~") {
        const grad = g.createLinearGradient(0, py, 0, py + T);
        grad.addColorStop(0, "#05060c"); grad.addColorStop(1, "#10142a");
        g.fillStyle = grad; g.fillRect(px, py, T, T);
        continue;
      }
      if (t === "#") continue;
      g.fillStyle = (x + y) % 2 ? "#8a8f9c" : "#83889a";
      g.fillRect(px, py, T, T);
      g.strokeStyle = "rgba(30,32,44,0.35)"; g.lineWidth = 2; g.strokeRect(px + 1, py + 1, T - 2, T - 2);
      if (t === "E") {
        g.fillStyle = "rgba(127,231,255,0.35)"; g.fillRect(px, py, T, T);
        g.strokeStyle = "rgba(200,250,255,0.8)"; g.lineWidth = 3; g.strokeRect(px + 6, py + 6, T - 12, T - 12);
      }
      if (t === "S") { g.fillStyle = "rgba(255,209,102,0.18)"; g.fillRect(px, py, T, T); }
    }
    // Walls: a front face and a raised top, for a bit of depth.
    for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) {
      if (R.terrain[y][x] !== "#") continue;
      const px = x * T, py = y * T;
      const below = y + 1 < R.h && R.terrain[y + 1][x] !== "#";
      if (below) { g.fillStyle = "#2b2e3b"; g.fillRect(px, py + T - wallH, T, wallH); }
      g.fillStyle = "#4a4f61"; g.fillRect(px, py - (below ? 0 : 0), T, T - (below ? wallH : 0));
      g.fillStyle = "rgba(255,255,255,0.06)"; g.fillRect(px, py, T, 4);
    }
    return c;
  }

  // ------------------------------------------------------------------- frame

  draw(world: World, dt: number, follow: Explorer[]): void {
    this.t += dt;
    this.layout(world, follow);
    const g = this.ctx, T = CONFIG.coop.tile;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = this.sceneryReady ? OUTSIDE[ROOMS[world.roomIndex].id] ?? "#07080f" : "#07080f"; g.fillRect(0, 0, this.w, this.h);
    if (this.roomLayer && this.sceneryReady) {
      // A soft shore around the area, so it sits in the landscape instead of ending in a box.
      const X = this.sx(0), Y = this.sy(0), W = world.room.w * T * this.s, H = world.room.h * T * this.s, m = T * 0.6 * this.s;
      g.save();
      g.shadowColor = "rgba(0,0,0,0.45)"; g.shadowBlur = 40 * this.dpr;
      g.fillStyle = "rgba(240,225,190,0.55)";
      g.beginPath(); g.roundRect(X - m, Y - m, W + 2 * m, H + 2 * m, m * 1.5); g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = `rgba(255,255,255,${0.25 + 0.1 * Math.sin(this.t * 1.5)})`; g.lineWidth = Math.max(1.5, 3 * this.s);
      g.beginPath(); g.roundRect(X - m * 1.15, Y - m * 1.15, W + 2.3 * m, H + 2.3 * m, m * 1.7); g.stroke();
      g.restore();
    }
    if (this.roomLayer) g.drawImage(this.roomLayer, this.sx(0), this.sy(0), world.room.w * T * this.s, world.room.h * T * this.s);
    this.drawWater(world);
    this.drawExits(world);

    for (const t of world.things.values()) this.drawThing(world, t);

    // Props and explorers together, back to front. A prop in front of an explorer
    // turns see-through so nobody gets lost behind a tree.
    const order = [...world.explorers].sort((a, b) => a.y - b.y);
    const items: Array<{ y: number; draw: () => void }> = order.map((e) => ({ y: e.y, draw: () => this.drawExplorer(world, e) }));
    for (const p of this.props) {
      const hides = world.explorers.some((e) => e.falling <= 0 && e.y < p.y && e.y > p.y - p.h * T * 1.05 && Math.abs(e.x - p.x) < T * (0.4 + p.h * 0.35));
      items.push({ y: p.y, draw: () => {
        g.save();
        g.translate(this.sx(0), this.sy(0)); g.scale(this.s, this.s);
        this.scenery.drawProp(g, p, this.t, hides ? 0.4 : 1);
        g.restore();
      } });
    }
    items.sort((a, b) => a.y - b.y).forEach((i) => i.draw());

    this.drawDark(world);
    // Light: warm sunshine by day, blue moonlight by night.
    g.fillStyle = `rgba(255,214,150,${0.07 * (1 - world.nightness)})`; g.fillRect(0, 0, this.w, this.h);
    if (world.nightness > 0) { g.fillStyle = `rgba(10,16,48,${0.4 * world.nightness})`; g.fillRect(0, 0, this.w, this.h); }
    this.drawTags(order);
    this.drawHud(world, dt);
  }

  /** Moving light on water: drifting ripples. */
  private drawWater(world: World): void {
    if (!this.sceneryReady) return;
    const g = this.ctx, T = CONFIG.coop.tile, R = world.room, id = ROOMS[world.roomIndex].id;
    const water = id !== "burrows" && id !== "heart" && id !== "storm";
    if (!water) return;
    g.save();
    g.strokeStyle = "rgba(220,240,255,0.35)"; g.lineWidth = Math.max(1, 2 * this.s); g.lineCap = "round";
    for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) {
      if (R.terrain[y][x] !== "~") continue;
      const [X, Y, S] = this.tileRect(x, y);
      if (X + S < 0 || Y + S < 0 || X > this.w || Y > this.h) continue;
      for (let i = 0; i < 2; i++) {
        const ph = this.t * 0.8 + x * 1.7 + y * 2.3 + i * 3.1;
        const cx = X + S * (0.25 + 0.5 * ((Math.sin(ph * 0.37) + 1) / 2)), cy = Y + S * (0.3 + i * 0.4);
        g.globalAlpha = 0.25 + 0.25 * Math.sin(ph);
        g.beginPath(); g.moveTo(cx - S * 0.18, cy); g.quadraticCurveTo(cx, cy - S * 0.06, cx + S * 0.18, cy); g.stroke();
      }
    }
    g.restore();
  }

  /** The exit: a ring of glowing stones with drifting sparkles. */
  private drawExits(world: World): void {
    const g = this.ctx, T = CONFIG.coop.tile, ex = world.room.exits;
    if (!ex.length) return;
    const cx = (ex.reduce((a, [x]) => a + x, 0) / ex.length + 0.5) * T, cy = (ex.reduce((a, [, y]) => a + y, 0) / ex.length + 0.5) * T;
    const r = Math.max(T * 0.8, Math.sqrt(ex.length) * T * 0.62);
    const X = this.sx(cx), Y = this.sy(cy), R = r * this.s, pulse = 0.6 + 0.4 * Math.sin(this.t * 2.2);
    g.save();
    const grd = g.createRadialGradient(X, Y, R * 0.1, X, Y, R * 1.2);
    grd.addColorStop(0, `rgba(170,250,255,${0.45 * pulse})`); grd.addColorStop(1, "rgba(170,250,255,0)");
    g.fillStyle = grd; g.beginPath(); g.arc(X, Y, R * 1.2, 0, 7); g.fill();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.fillStyle = "#cfd6d8"; g.strokeStyle = "#7a8486"; g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(X + Math.cos(a) * R, Y + Math.sin(a) * R * 0.8, R * 0.12, R * 0.09, 0, 0, 7); g.fill(); g.stroke();
      g.fillStyle = `rgba(160,250,255,${0.5 + 0.5 * Math.sin(this.t * 3 + i)})`;
      g.beginPath(); g.arc(X + Math.cos(a) * R, Y + Math.sin(a) * R * 0.8 - R * 0.04, R * 0.035, 0, 7); g.fill();
    }
    for (let i = 0; i < 6; i++) {
      const k = (this.t * 0.35 + i / 6) % 1, a = i * 2.1 + this.t * 0.3;
      g.globalAlpha = 1 - k; g.fillStyle = "#e9fdff";
      g.beginPath(); g.arc(X + Math.cos(a) * R * 0.6, Y + Math.sin(a) * R * 0.4 - k * R * 0.9, Math.max(1.5, R * 0.03), 0, 7); g.fill();
    }
    g.restore();
  }

  private tileRect(x: number, y: number): [number, number, number] {
    const T = CONFIG.coop.tile;
    return [this.sx(x * T), this.sy(y * T), T * this.s];
  }

  private drawThing(world: World, t: ThingState): void {
    const g = this.ctx, k = t.def.kind, tt = this.t, T = CONFIG.coop.tile;
    const onTile = (cx: number, cy: number, test: (e: Explorer) => boolean) =>
      world.explorers.some((e) => e.falling <= 0 && Math.floor(e.x / T) === cx && Math.floor(e.y / T) === cy && test(e));
    for (const [cx, cy] of t.cells) {
      const [x, y, S] = this.tileRect(cx, cy);
      if (x + S < 0 || y + S < 0 || x > this.w || y > this.h) continue;
      const mx = x + S / 2, my = y + S / 2;
      g.save();
      switch (k) {
        case "bramble": {
          if (t.open) { g.fillStyle = "rgba(60,40,20,0.35)"; g.beginPath(); g.ellipse(mx, my + S * 0.2, S * 0.4, S * 0.15, 0, 0, 7); g.fill(); break; }
          const eaten = Math.min(1, t.progress / CONFIG.coop.munchTime);
          g.globalAlpha = 1 - eaten * 0.6;
          g.fillStyle = "#2f4a22"; g.beginPath(); g.ellipse(mx, my + S * 0.1, S * 0.52, S * 0.42, 0, 0, 7); g.fill();
          g.strokeStyle = "#6b4a2a"; g.lineWidth = Math.max(1.5, S * 0.05); g.lineCap = "round";
          for (let i = 0; i < 5; i++) {
            const a = -2.6 + i * 0.55;
            g.beginPath(); g.moveTo(mx, my + S * 0.4); g.quadraticCurveTo(mx + Math.cos(a) * S * 0.6, my + Math.sin(a) * S * 0.5, mx + Math.cos(a + 0.6) * S * 0.45, my + Math.sin(a + 0.6) * S * 0.45); g.stroke();
          }
          g.fillStyle = "#e8d8b0";
          for (let i = 0; i < 9; i++) { const a = i * 0.7, r = S * (0.25 + (i % 3) * 0.08); g.beginPath(); g.moveTo(mx + Math.cos(a) * r, my + Math.sin(a) * r * 0.8); g.lineTo(mx + Math.cos(a) * (r + S * 0.09), my + Math.sin(a) * (r + S * 0.09) * 0.8); g.lineTo(mx + Math.cos(a + 0.2) * r, my + Math.sin(a + 0.2) * r * 0.8); g.fill(); }
          g.fillStyle = "#c0304a";
          for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(mx + Math.cos(i * 1.7) * S * 0.25, my + Math.sin(i * 1.7) * S * 0.2, S * 0.05, 0, 7); g.fill(); }
          break;
        }
        case "hidden":
          if (t.open) {
            // A stone archway, now open.
            g.fillStyle = "rgba(255,230,160,0.18)"; g.fillRect(x, y, S, S);
            g.strokeStyle = "#9a9486"; g.lineWidth = Math.max(3, S * 0.12);
            g.beginPath(); g.moveTo(x + S * 0.12, y + S); g.lineTo(x + S * 0.12, y + S * 0.35); g.quadraticCurveTo(mx, y - S * 0.05, x + S * 0.88, y + S * 0.35); g.lineTo(x + S * 0.88, y + S); g.stroke();
          } else {
            // Old stones behind a curtain of vines.
            g.fillStyle = "#6e6a60"; g.fillRect(x, y, S, S);
            g.strokeStyle = "rgba(40,36,30,0.5)"; g.lineWidth = 1.5;
            for (let r = 0; r < 3; r++) { g.beginPath(); g.moveTo(x, y + S * (r + 1) / 3); g.lineTo(x + S, y + S * (r + 1) / 3); g.stroke(); }
            g.strokeStyle = "#3f7a2e"; g.lineWidth = Math.max(1.5, S * 0.05);
            for (let i = 0; i < 5; i++) {
              const vx = x + S * (0.12 + i * 0.19), sway = Math.sin(tt * 1.3 + i) * S * 0.03;
              g.beginPath(); g.moveTo(vx, y); g.quadraticCurveTo(vx + sway, y + S * 0.5, vx - sway, y + S * (0.75 + (i % 2) * 0.2)); g.stroke();
              g.fillStyle = "#5aa040"; g.beginPath(); g.ellipse(vx + sway * 0.5, y + S * 0.45, S * 0.06, S * 0.035, 0.6, 0, 7); g.fill();
            }
          }
          break;
        case "ice": {
          if (t.open) { g.fillStyle = "rgba(160,220,255,0.3)"; g.beginPath(); g.ellipse(mx, my + S * 0.15, S * 0.42, S * 0.2, 0, 0, 7); g.fill(); break; }
          const melt = Math.min(1, t.progress / CONFIG.coop.meltTime);
          const top = y + S * melt * 0.5;
          const grd = g.createLinearGradient(x, top, x + S, y + S);
          grd.addColorStop(0, "rgba(230,248,255,0.95)"); grd.addColorStop(1, "rgba(120,190,240,0.9)");
          g.fillStyle = grd;
          g.beginPath(); g.moveTo(x + S * 0.08, y + S); g.lineTo(x + S * 0.02, top + S * 0.25); g.lineTo(x + S * 0.3, top); g.lineTo(x + S * 0.7, top + S * 0.08); g.lineTo(x + S * 0.98, top + S * 0.3); g.lineTo(x + S * 0.92, y + S); g.closePath(); g.fill();
          g.strokeStyle = "rgba(255,255,255,0.85)"; g.lineWidth = 2;
          g.beginPath(); g.moveTo(x + S * 0.25, top + S * 0.2); g.lineTo(x + S * 0.45, top + S * 0.5); g.stroke();
          if (melt > 0) { g.fillStyle = "rgba(140,200,255,0.5)"; g.beginPath(); g.ellipse(mx, y + S * 0.95, S * 0.4 * melt + S * 0.1, S * 0.08, 0, 0, 7); g.fill(); }
          break;
        }
        case "electric": {
          // An ancient crystal totem: dim until a Crackling creature charges its crystal.
          const on = t.open;
          if (on) { g.globalAlpha = 0.9; }
          g.fillStyle = on ? "rgba(120,110,100,0.5)" : "#7a7468";
          g.fillRect(x + S * 0.18, y + S * (on ? 0.55 : 0.12), S * 0.64, S * (on ? 0.4 : 0.85));
          g.strokeStyle = "rgba(40,36,30,0.5)"; g.lineWidth = 1.5; g.strokeRect(x + S * 0.18, y + S * (on ? 0.55 : 0.12), S * 0.64, S * (on ? 0.4 : 0.85));
          if (!on) {
            g.strokeStyle = "rgba(200,180,255,0.6)"; g.lineWidth = Math.max(1, S * 0.03);
            g.beginPath(); g.moveTo(mx - S * 0.12, my); g.lineTo(mx, my - S * 0.12); g.lineTo(mx + S * 0.12, my); g.lineTo(mx, my + S * 0.12); g.closePath(); g.stroke();
          }
          const cy2 = y + S * (on ? 0.42 : 0.1), glow = on ? 1 : 0.35 + 0.15 * Math.sin(tt * 3);
          g.shadowColor = "#c9a7ff"; g.shadowBlur = (on ? 18 : 6) * this.dpr;
          g.fillStyle = `rgba(190,150,255,${glow})`;
          g.beginPath(); g.moveTo(mx, cy2 - S * 0.18); g.lineTo(mx + S * 0.1, cy2); g.lineTo(mx, cy2 + S * 0.1); g.lineTo(mx - S * 0.1, cy2); g.closePath(); g.fill();
          break;
        }
        case "node": {
          const powered = [...world.things.values()].some((o) => o.def.kind === "electric" && o.def.via === t.id && o.open);
          g.shadowColor = "#c9a7ff"; g.shadowBlur = (powered ? 16 : 8) * this.dpr;
          for (let i = 0; i < 3; i++) {
            const ox = (i - 1) * S * 0.14, hgt = S * (0.28 + (i === 1 ? 0.12 : 0));
            g.fillStyle = powered ? "#e2d4ff" : `rgba(190,150,255,${0.6 + 0.25 * Math.sin(tt * 4 + i)})`;
            g.beginPath(); g.moveTo(mx + ox, my - hgt); g.lineTo(mx + ox + S * 0.07, my + S * 0.15); g.lineTo(mx + ox - S * 0.07, my + S * 0.15); g.closePath(); g.fill();
          }
          break;
        }
        case "critter": {
          const calm = t.open;
          if (calm) {
            g.fillStyle = "#8b6bb8"; g.beginPath(); g.ellipse(mx + S * 0.3, my + S * 0.3, S * 0.18, S * 0.12, 0, 0, 7); g.fill();
            g.fillStyle = "#fff"; g.font = `${S * 0.25}px system-ui`; g.fillText("z", mx + S * 0.35, my + S * 0.05 - Math.sin(tt * 2) * 4);
            break;
          }
          const wob = Math.sin(tt * 8) * S * 0.03;
          g.fillStyle = "#7a4fb0";
          g.beginPath();
          for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2, r = S * (i % 2 ? 0.32 : 0.44); g.lineTo(mx + Math.cos(a) * r + wob, my + Math.sin(a) * r); }
          g.closePath(); g.fill();
          g.fillStyle = "#fff"; g.beginPath(); g.arc(mx - S * 0.1, my - S * 0.05, S * 0.08, 0, 7); g.arc(mx + S * 0.1, my - S * 0.05, S * 0.08, 0, 7); g.fill();
          g.fillStyle = "#200"; g.beginPath(); g.arc(mx - S * 0.1, my - S * 0.04, S * 0.035, 0, 7); g.arc(mx + S * 0.1, my - S * 0.04, S * 0.035, 0, 7); g.fill();
          if (t.progress > 0) { g.strokeStyle = "#8ff5ff"; g.lineWidth = 3; g.beginPath(); g.arc(mx, my, S * 0.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, t.progress / CONFIG.coop.calmTime)); g.stroke(); }
          break;
        }
        case "gate":
        case "run": {
          if (t.open) break;
          // A gate of upright logs, lifted while its switch is running.
          const lift = t.timer > 0 ? Math.min(1, t.timer / 0.15) : 0;
          const band = k === "gate" ? "#e07a2e" : "#c94b5b";
          g.globalAlpha = 1 - lift * 0.75;
          for (let i = 0; i < 4; i++) {
            const lx = x + S * (0.06 + i * 0.235), ly = y - lift * S * 0.6;
            const grd = g.createLinearGradient(lx, 0, lx + S * 0.2, 0);
            grd.addColorStop(0, "#6b4a2a"); grd.addColorStop(0.5, "#9a7048"); grd.addColorStop(1, "#5a3c22");
            g.fillStyle = grd; g.fillRect(lx, ly, S * 0.2, S);
            g.fillStyle = "#4a3018"; g.beginPath(); g.ellipse(lx + S * 0.1, ly + S * 0.04, S * 0.1, S * 0.04, 0, 0, 7); g.fill();
          }
          g.fillStyle = band; g.fillRect(x, y + S * 0.3 - lift * S * 0.6, S, S * 0.07); g.fillRect(x, y + S * 0.7 - lift * S * 0.6, S, S * 0.07);
          g.globalAlpha = 1;
          if (t.timer > 0) {
            const full = k === "gate" ? CONFIG.coop.gateWindow : CONFIG.coop.runWindow;
            g.strokeStyle = "#fff"; g.lineWidth = 3; g.beginPath(); g.arc(mx, my, S * 0.35, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (t.timer / full)); g.stroke();
          }
          break;
        }
        case "switch": {
          const forRun = [...world.things.values()].some((o) => o.def.kind === "run" && o.def.via === t.id);
          g.fillStyle = "#8a857a"; g.beginPath(); g.ellipse(mx, my + S * 0.05, S * 0.36, S * 0.3, 0, 0, 7); g.fill();
          g.fillStyle = "#a7a194"; g.beginPath(); g.ellipse(mx, my, S * 0.3, S * 0.24, 0, 0, 7); g.fill();
          g.fillStyle = forRun ? "#c94b5b" : "#e07a2e"; g.font = `bold ${S * 0.3}px system-ui`; g.textAlign = "center"; g.textBaseline = "middle";
          g.fillText(forRun ? "⏱" : "»", mx, my);
          break;
        }
        case "block": {
          // A heavy mossy boulder.
          const [bx0, by0, bx1, by1] = blockBox(t);
          const X = this.sx(bx0), Y = this.sy(by0), W = (bx1 - bx0) * this.s, H = (by1 - by0) * this.s;
          g.fillStyle = "rgba(0,0,0,0.25)"; g.beginPath(); g.ellipse(X + W / 2, Y + H * 0.85, W * 0.45, H * 0.15, 0, 0, 7); g.fill();
          const grd = g.createRadialGradient(X + W * 0.35, Y + H * 0.3, W * 0.05, X + W / 2, Y + H / 2, W * 0.6);
          grd.addColorStop(0, "#a49a88"); grd.addColorStop(1, "#5e574a");
          g.fillStyle = grd; g.beginPath(); g.ellipse(X + W / 2, Y + H / 2, W * 0.46, H * 0.44, 0, 0, 7); g.fill();
          g.fillStyle = "rgba(90,150,60,0.75)"; g.beginPath(); g.ellipse(X + W * 0.45, Y + H * 0.2, W * 0.3, H * 0.12, -0.2, 0, 7); g.fill();
          break;
        }
        case "sun":
        case "moon": {
          // Lily pads: glowing and solid in their own time of day, sunk and faint otherwise.
          const mine = k === "sun" ? !world.night : world.night;
          const warn = mine && world.cycleIn < CONFIG.coop.warn && Math.floor(tt * 6) % 2 === 0;
          const bob = Math.sin(tt * 1.5 + cx) * S * 0.02;
          g.globalAlpha = mine ? (warn ? 0.5 : 1) : 0.22;
          g.translate(mx, my + bob);
          g.fillStyle = mine ? "#4f9a4a" : "#3a6a50";
          g.beginPath(); g.arc(0, 0, S * 0.44, 0.35, Math.PI * 2 - 0.05); g.lineTo(0, 0); g.closePath(); g.fill();
          g.strokeStyle = "rgba(30,60,30,0.6)"; g.lineWidth = 1.5; g.stroke();
          if (mine) { g.shadowColor = k === "sun" ? "#ffd166" : "#b9c8ff"; g.shadowBlur = 14 * this.dpr; }
          drawIcon(g, k === "sun" ? "sun" : "moon", S * 0.45, tt);
          break;
        }
        case "fragile":
          if (t.timer > 0) break;
          // A rope bridge: planks with ropes along both sides.
          g.fillStyle = "#9b7a50";
          for (let i = 0; i < 4; i++) g.fillRect(x + S * (0.04 + i * 0.245), y + S * 0.12, S * 0.18, S * 0.76);
          g.strokeStyle = "#d9c08a"; g.lineWidth = Math.max(1.5, S * 0.04);
          g.beginPath(); g.moveTo(x, y + S * 0.12); g.quadraticCurveTo(mx, y + S * 0.2, x + S, y + S * 0.12); g.stroke();
          g.beginPath(); g.moveTo(x, y + S * 0.88); g.quadraticCurveTo(mx, y + S * 0.96, x + S, y + S * 0.88); g.stroke();
          break;
        case "bridge":
          if (!t.open) { g.strokeStyle = "rgba(220,200,150,0.3)"; g.setLineDash([4, 6]); g.strokeRect(x + 4, y + 4, S - 8, S - 8); break; }
          g.fillStyle = "#8a6a45";
          for (let i = 0; i < 4; i++) g.fillRect(x + S * (0.02 + i * 0.25), y + S * 0.06, S * 0.22, S * 0.88);
          g.fillStyle = "rgba(0,0,0,0.2)"; g.fillRect(x, y + S * 0.88, S, S * 0.08);
          break;
        case "traps":
          if (!t.revealed) break;
          // Snapping thorn plants.
          g.fillStyle = "rgba(160,30,30,0.25)"; g.beginPath(); g.ellipse(mx, my, S * 0.45, S * 0.35, 0, 0, 7); g.fill();
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + Math.sin(tt * 3) * 0.1;
            g.fillStyle = i % 2 ? "#b8323a" : "#8a2028";
            g.beginPath(); g.moveTo(mx, my); g.lineTo(mx + Math.cos(a - 0.25) * S * 0.38, my + Math.sin(a - 0.25) * S * 0.3); g.lineTo(mx + Math.cos(a) * S * 0.46, my + Math.sin(a) * S * 0.36); g.closePath(); g.fill();
          }
          break;
        case "lever": {
          const pulled = t.open;
          g.fillStyle = "#8a857a"; g.beginPath(); g.ellipse(mx, y + S * 0.72, S * 0.26, S * 0.14, 0, 0, 7); g.fill();
          g.strokeStyle = "#7a5a3a"; g.lineWidth = Math.max(2, S * 0.08); g.lineCap = "round";
          const hx = x + S * (pulled ? 0.75 : 0.25);
          g.beginPath(); g.moveTo(mx, y + S * 0.7); g.lineTo(hx, y + S * 0.22); g.stroke();
          g.shadowColor = pulled ? "#8ff5a0" : "#ffd166"; g.shadowBlur = 10 * this.dpr;
          g.fillStyle = pulled ? "#8ff5a0" : "#ffd166"; g.beginPath(); g.arc(hx, y + S * 0.2, S * 0.09, 0, 7); g.fill();
          break;
        }
        case "plate":
        case "plates": {
          // Mossy carved stones; they glow while someone stands on them.
          const on = onTile(cx, cy, () => true);
          g.fillStyle = "#77736a"; g.beginPath(); g.ellipse(mx, my + S * 0.04, S * 0.4, S * 0.33, 0, 0, 7); g.fill();
          g.fillStyle = on ? "#9feaff" : "#8f8a80"; g.beginPath(); g.ellipse(mx, my, S * 0.34, S * 0.27, 0, 0, 7); g.fill();
          g.fillStyle = "rgba(90,150,60,0.7)"; g.beginPath(); g.ellipse(mx - S * 0.18, my + S * 0.14, S * 0.12, S * 0.06, 0.4, 0, 7); g.fill();
          g.strokeStyle = on ? "#ffffff" : "rgba(60,56,50,0.7)"; g.lineWidth = 2;
          g.beginPath(); g.arc(mx, my, S * 0.14, 0, 7); g.stroke();
          if (k === "plates") { g.beginPath(); g.moveTo(mx, my - S * 0.14); g.lineTo(mx, my + S * 0.14); g.moveTo(mx - S * 0.14, my); g.lineTo(mx + S * 0.14, my); g.stroke(); }
          break;
        }
        case "door":
          if (t.open || t.held) {
            g.fillStyle = "#6b4a2a"; g.fillRect(x, y, S * 0.12, S); g.fillRect(x + S * 0.88, y, S * 0.12, S);
            g.strokeStyle = "#3f7a2e"; g.lineWidth = 2; g.beginPath(); g.moveTo(x + S * 0.06, y); g.quadraticCurveTo(x - S * 0.05, my, x + S * 0.06, y + S); g.stroke();
            break;
          }
          // A vine gate between two posts.
          g.fillStyle = "#6b4a2a"; g.fillRect(x, y, S * 0.14, S); g.fillRect(x + S * 0.86, y, S * 0.14, S);
          g.strokeStyle = "#3f7a2e"; g.lineWidth = Math.max(2, S * 0.06);
          for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(x + S * 0.1, y + S * (0.15 + i * 0.22)); g.quadraticCurveTo(mx, y + S * (0.28 + i * 0.22), x + S * 0.9, y + S * (0.15 + i * 0.22)); g.stroke(); }
          g.fillStyle = "#6bb04a";
          for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(x + S * (0.2 + i * 0.12), y + S * (0.25 + (i % 3) * 0.22), S * 0.05, S * 0.03, i, 0, 7); g.fill(); }
          break;
        case "key":
          if (!t.revealed || t.open) break;
          g.translate(mx, my - Math.sin(tt * 3) * 3);
          g.shadowColor = "#ffd166"; g.shadowBlur = 12 * this.dpr;
          g.strokeStyle = "#ffd166"; g.lineWidth = Math.max(2, S * 0.07);
          g.beginPath(); g.arc(-S * 0.12, 0, S * 0.12, 0, 7); g.moveTo(0, 0); g.lineTo(S * 0.3, 0); g.lineTo(S * 0.3, S * 0.1); g.stroke();
          break;
        case "gem":
          if (t.open) break;
          g.translate(mx, my - Math.sin(tt * 3 + cx) * 3);
          g.shadowColor = "#c9a7ff"; g.shadowBlur = 14 * this.dpr;
          g.fillStyle = "#c9a7ff"; g.strokeStyle = "#fff"; g.lineWidth = 2;
          g.beginPath(); g.moveTo(0, -S * 0.25); g.lineTo(S * 0.2, 0); g.lineTo(0, S * 0.25); g.lineTo(-S * 0.2, 0); g.closePath(); g.fill(); g.stroke();
          break;
        case "sunpad":
        case "moonpad": {
          const sun = k === "sunpad";
          const here = onTile(cx, cy, (e) => (sun ? e.profile.time === "Dawn" : e.profile.time === "Dusk"));
          g.fillStyle = "#8a857a"; g.beginPath(); g.arc(mx, my, S * 0.46, 0, 7); g.fill();
          g.fillStyle = sun ? "#7a5a20" : "#2c3560"; g.beginPath(); g.arc(mx, my, S * 0.38, 0, 7); g.fill();
          g.strokeStyle = here ? "#ffffff" : sun ? "#e9b949" : "#8d9fd6"; g.lineWidth = here ? 4 : 2; g.stroke();
          if (here) { g.shadowColor = sun ? "#ffd166" : "#b9c8ff"; g.shadowBlur = 16 * this.dpr; g.stroke(); g.shadowBlur = 0; }
          g.translate(mx, my);
          drawIcon(g, sun ? "sun" : "moon", S * 0.55, tt);
          break;
        }
        case "spring": {
          // A bent sapling spring: it glows while an Endurance creature holds it.
          const held = onTile(cx, cy, (e) => e.profile.muscle === "Endurance");
          g.fillStyle = held ? "rgba(127,231,255,0.35)" : "rgba(0,0,0,0.15)"; g.beginPath(); g.ellipse(mx, my + S * 0.15, S * 0.42, S * 0.2, 0, 0, 7); g.fill();
          g.strokeStyle = "#6b4a2a"; g.lineWidth = Math.max(2, S * 0.07); g.lineCap = "round";
          g.beginPath(); g.moveTo(mx - S * 0.3, my + S * 0.3); g.quadraticCurveTo(mx - S * 0.35, my - S * 0.3, mx + S * (held ? 0.35 : 0.1), my - S * (held ? 0.1 : 0.35)); g.stroke();
          g.fillStyle = "#5aa040"; g.beginPath(); g.ellipse(mx + S * (held ? 0.35 : 0.1), my - S * (held ? 0.1 : 0.35), S * 0.1, S * 0.06, 0.5, 0, 7); g.fill();
          break;
        }
        case "launcher":
          g.fillStyle = "#6b4a2a"; g.beginPath(); g.ellipse(mx, my + S * 0.2, S * 0.4, S * 0.22, 0, 0, 7); g.fill();
          g.strokeStyle = "#d9c08a"; g.lineWidth = 3; g.beginPath(); g.moveTo(x + S * 0.15, y + S * 0.2); g.lineTo(mx, my + S * 0.1); g.lineTo(x + S * 0.85, y + S * 0.2); g.stroke();
          break;
        case "landing":
          g.strokeStyle = `rgba(255,209,102,${0.4 + 0.2 * Math.sin(tt * 4)})`; g.lineWidth = 2; g.setLineDash([5, 5]);
          g.beginPath(); g.arc(mx, my, S * 0.35, 0, 7); g.stroke();
          break;
        default: break;
      }
      g.restore();
    }
  }

  private drawExplorer(world: World, e: Explorer): void {
    const g = this.ctx, s = this.s, sp = this.bank.get(e.creature.name), R = CONFIG.coop.radius;
    const x = this.sx(e.x), y = this.sy(e.y);
    const fallK = e.falling > 0 ? 1 - e.falling / CONFIG.coop.respawn : 0;
    if (e.falling > 0 && fallK > 0.6) return;
    g.save();
    g.fillStyle = "rgba(5,8,20,0.35)";
    g.beginPath(); g.ellipse(x, y + R * 0.4 * s, R * 1.3 * s * (1 - fallK), R * 0.5 * s * (1 - fallK), 0, 0, 7); g.fill();
    if (!sp?.scaled) { g.fillStyle = PLAYER_COLORS[e.slot]; g.beginPath(); g.arc(x, y, R * s, 0, 7); g.fill(); g.restore(); return; }
    const speed = Math.hypot(e.vx, e.vy) / CONFIG.coop.walkSpeed;
    const animated = sp.sheet.frames > 1;
    const wt = speed > 0.08 ? (this.walkT.get(e.slot) ?? 0) + (1 / 60) * (0.4 + 0.9 * Math.min(1.5, speed)) : 0;
    this.walkT.set(e.slot, wt);
    const frame = animated ? Math.floor(wt * sp.sheet.fps) % sp.sheet.frames : 0;
    const fx = (frame % sp.sheet.cols) * sp.tw, fy = Math.floor(frame / sp.sheet.cols) * sp.th;
    // Slingshot flight: up in an arc.
    const hop = Math.abs(Math.sin(e.bob * Math.PI)) * 5 * s * Math.min(1, speed) * (animated ? 0.25 : 1)
      + Math.sin(e.flightK * Math.PI) * CONFIG.coop.slingshot.arc * s;
    const flip = (e.facing === 1) !== sp.sheet.facesLeft ? 1 : -1;
    const w = sp.w * s * (1 - fallK * 0.7), h = sp.h * s * (1 - fallK * 0.7);
    if (e.dashT > 0) { g.globalAlpha = 0.35; g.fillStyle = "#ffb347"; g.beginPath(); g.ellipse(x - e.vx * 0.05 * s, y - h * 0.3, w * 0.4, h * 0.2, 0, 0, 7); g.fill(); g.globalAlpha = 1; }
    g.translate(x, y + R * 0.4 * s - hop);
    g.rotate(Math.max(-1, Math.min(1, e.vx / CONFIG.coop.walkSpeed)) * 0.08 + fallK * 2);
    g.scale(flip, 1);
    g.drawImage(sp.scaled, fx, fy, sp.tw, sp.th, -w / 2, -h, w, h);
    if (world.nightness > 0 && sp.dark) { g.globalAlpha = 0.3 * world.nightness; g.drawImage(sp.dark, fx, fy, sp.tw, sp.th, -w / 2, -h, w, h); }
    g.restore();
  }

  /** Name tags above the explorers ("P1 · Shadepounce"), stacked so they never overlap. */
  private drawTags(explorers: Explorer[]): void {
    const g = this.ctx, s = this.s, size = Math.max(12, Math.min(16, 22 * s));
    g.font = `800 ${size}px ui-rounded, system-ui, sans-serif`;
    const placed: Array<[number, number, number, number]> = [];
    const tags = explorers.filter((e) => e.falling <= 0).map((e) => {
      // Who it is and which creature, so everyone remembers whose powers are whose.
      const label = `${this.local.length === 1 && this.local[0] === e.slot ? "You" : `P${e.slot + 1}`} · ${e.creature.name}`;
      const w = g.measureText(label).width + 10, h = size + 6;
      const x = Math.max(w / 2 + 4, Math.min(this.w - w / 2 - 4, this.sx(e.x)));
      return { e, label, w, h, x, y: this.sy(e.y) - CONFIG.coop.spriteHeight * 0.85 * s };
    }).sort((a, b) => b.y - a.y);
    for (const t of tags) {
      for (let guard = 0; guard < 8; guard++) {
        const hit = placed.find(([x0, y0, x1, y1]) => t.x - t.w / 2 < x1 && t.x + t.w / 2 > x0 && t.y - t.h < y1 && t.y > y0);
        if (!hit) break;
        t.y = hit[1] - 2;
      }
      placed.push([t.x - t.w / 2, t.y - t.h, t.x + t.w / 2, t.y]);
      g.fillStyle = "rgba(8,10,20,0.6)"; g.fillRect(t.x - t.w / 2, t.y - t.h, t.w, t.h);
      g.textAlign = "center"; g.textBaseline = "bottom";
      g.fillStyle = PLAYER_COLORS[t.e.slot]; g.fillText(t.label, t.x, t.y - 2);
      if (t.e.stamina < 0.999) {
        const bw = Math.min(t.w - 10, 60), bh = 4;
        g.fillStyle = "rgba(8,10,20,0.7)"; g.fillRect(t.x - bw / 2, t.y + 1, bw, bh);
        g.fillStyle = t.e.winded ? "#ff7a7a" : "#4fc3f7"; g.fillRect(t.x - bw / 2, t.y + 1, bw * t.e.stamina, bh);
      }
    }
  }

  /** Dark areas: black unless lit. An Ember glows wide; everyone else sees a little. */
  private drawDark(world: World): void {
    if (!world.room.dark.length) return;
    const g = this.ctx, T = CONFIG.coop.tile, s = this.s;
    world.room.dark.forEach(([x0, y0, x1, y1], i) => {
      if (world.lit.has(i)) return;
      const X = this.sx(x0 * T), Y = this.sy(y0 * T), W = (x1 - x0 + 1) * T * s, H = (y1 - y0 + 1) * T * s;
      const layer = document.createElement("canvas");
      layer.width = Math.max(1, Math.ceil(W)); layer.height = Math.max(1, Math.ceil(H));
      const lg = layer.getContext("2d")!;
      lg.fillStyle = "#020205"; lg.fillRect(0, 0, layer.width, layer.height);
      lg.globalCompositeOperation = "destination-out";
      for (const e of world.explorers) {
        if (e.falling > 0) continue;
        const r = (e.profile.flame === "Ember" ? CONFIG.coop.glowRadius : CONFIG.coop.darkSight) * T * s;
        const ex = this.sx(e.x) - X, ey = this.sy(e.y) - Y;
        const grad = lg.createRadialGradient(ex, ey, r * 0.3, ex, ey, r);
        grad.addColorStop(0, "rgba(0,0,0,1)"); grad.addColorStop(1, "rgba(0,0,0,0)");
        lg.fillStyle = grad; lg.beginPath(); lg.arc(ex, ey, r, 0, 7); lg.fill();
      }
      g.drawImage(layer, X, Y, W, H);
    });
  }

  private drawHud(world: World, dt: number): void {
    const g = this.ctx;
    // Messages, newest at the bottom.
    let y = this.h - 16;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      m.t += dt;
      if (m.t > 6) continue;
      g.globalAlpha = m.t > 5 ? 6 - m.t : 1;
      g.font = "700 15px ui-rounded, system-ui, sans-serif"; g.textAlign = "left"; g.textBaseline = "bottom";
      const wdt = g.measureText(m.text).width;
      g.fillStyle = "rgba(8,10,20,0.75)"; g.fillRect(12, y - 22, wdt + 16, 24);
      g.fillStyle = m.color; g.fillText(m.text, 20, y - 3);
      y -= 28;
    }
    this.messages = this.messages.filter((m) => m.t <= 6);
    g.globalAlpha = 1;
    // Tutorial hint, top centre.
    if (this.hint) {
      this.hint.t += dt;
      if (this.hint.t > 7) this.hint = null;
      else {
        g.font = "700 16px ui-rounded, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
        const wdt = Math.min(this.w - 24, g.measureText(this.hint.text).width + 28);
        g.fillStyle = "rgba(12,14,30,0.85)"; g.fillRect(this.w / 2 - wdt / 2, 66, wdt, 32);
        g.strokeStyle = "rgba(127,231,255,0.5)"; g.strokeRect(this.w / 2 - wdt / 2, 66, wdt, 32);
        g.fillStyle = "#fff"; g.fillText(this.hint.text, this.w / 2, 82, this.w - 40);
      }
    }
  }
}
