// Hatchling Expedition rules in real time: moving explorers around a tile room, gene
// abilities opening the way, timers, levers, plates and the exit. No drawing here; the
// renderer reads the state and the events each step produces.
import { CONFIG } from "../config.ts";
import type { Creature } from "../creatures.ts";
import type { Muscle, Vec } from "../sim.ts";
import { has, type GeneOption, type Profile } from "./genes.ts";
import { ROOMS, type ThingKind } from "./rooms.ts";
import { blockGeometry, parseRoom, WALLS, type ParsedRoom, type Thing } from "./solver.ts";

export interface Explorer {
  slot: number;
  creature: Creature;
  profile: Profile;
  x: number; y: number; vx: number; vy: number;
  facing: 1 | -1;
  /** Controls for this step. */
  intent: Vec; sprintHeld: boolean; actionPressed: boolean;
  stamina: number; sprinting: boolean; winded: boolean; restT: number;
  dashT: number; dashCd: number;
  /** Seconds until back at the start after a fall (0 = not falling). */
  falling: number;
  bob: number;
  /** The switch tile it stood on last step (switches trigger on stepping on). */
  onSwitch: string | null;
  /** Pushing a heavy block this step (uses stamina instead of sprinting). */
  pushing: boolean;
  /** Slingshot flight in progress, and how far along it is (0 = not flying). */
  flight: { x0: number; y0: number; x1: number; y1: number; t: number } | null;
  flightK: number;
}

export interface ThingState extends Thing {
  open: boolean;
  /** Munch, melt or calm progress (seconds). */
  progress: number;
  /** Gate or run door: seconds left open. Bridge-like crack: seconds until it reforms. */
  timer: number;
  /** Hidden doors, traps and keys: found by a Keen nose. */
  revealed: boolean;
  /** Heavy block: how far it has been pushed (world units). */
  offset: number;
  /** A held plate keeps its door open this step. */
  held: boolean;
  /** Gate or run door: explorers already in the doorway, who may finish going through. */
  passers: number[];
}

export type CoopEvent =
  | { type: "opened"; slot: number; gene: GeneOption | null; thing: string; kind: ThingKind; text: string }
  | { type: "hint"; text: string }
  | { type: "fell"; slot: number; why: "chasm" | "trap" | "crack" }
  | { type: "gem"; slot: number }
  | { type: "growl"; slot: number }
  | { type: "daynight"; night: boolean }
  | { type: "done" };

/** One entry per thing a gene opened, for the "team genome" panel. */
export interface Unlock { slot: number; gene: GeneOption | null; text: string }

export interface World {
  roomIndex: number;
  room: ParsedRoom;
  explorers: Explorer[];
  things: Map<string, ThingState>;
  time: number;
  night: boolean;
  nightness: number;
  cycleIn: number;
  events: CoopEvent[];
  gems: number;
  log: Unlock[];
  hinted: Set<string>;
  /** Dark areas an Ember has lit (by index). Lit areas stay lit. */
  lit: Set<number>;
  done: boolean;
  /** Firsts worth a message (a Dawn on the sun stones, an Ember in the dark...). */
  firsts: Set<string>;
}

export interface Joiner { creature: Creature; muscle: Muscle }

const T = () => CONFIG.coop.tile;
const C = () => CONFIG.coop;

export function profileOf(c: Creature, muscle: Muscle): Profile {
  return { flame: c.flame, time: c.time, senses: c.senses, spark: c.spark, muscle };
}

export function newWorld(roomIndex: number, players: Joiner[]): World {
  const room = parseRoom(ROOMS[roomIndex]);
  const things = new Map<string, ThingState>();
  for (const t of room.things.values()) things.set(t.id, { ...t, open: false, progress: 0, timer: 0, revealed: false, offset: 0, held: false, passers: [] });
  const w: World = {
    roomIndex, room, things, explorers: [], time: 0, night: false, nightness: 0, cycleIn: C().dayNight,
    events: [], gems: 0, log: [], hinted: new Set(), lit: new Set(), done: false, firsts: new Set(),
  };
  players.forEach((p, slot) => {
    const [sx, sy] = room.starts[slot % room.starts.length];
    w.explorers.push({
      slot, creature: p.creature, profile: profileOf(p.creature, p.muscle),
      x: (sx + 0.5) * T(), y: (sy + 0.5) * T(), vx: 0, vy: 0, facing: 1,
      intent: { x: 0, y: 0 }, sprintHeld: false, actionPressed: false,
      stamina: 1, sprinting: false, winded: false, restT: 0, dashT: 0, dashCd: 0, falling: 0, bob: 0, onSwitch: null, pushing: false, flight: null, flightK: 0,
    });
  });
  return w;
}

// ------------------------------------------------------------------ tile helpers

const cellOf = (v: number) => Math.floor(v / T());
const thingAt = (w: World, cx: number, cy: number) => {
  if (cx < 0 || cy < 0 || cx >= w.room.w || cy >= w.room.h) return null;
  const id = w.room.at[cy][cx];
  return id ? w.things.get(id)! : null;
};
const inDark = (w: World, cx: number, cy: number) => w.room.dark.findIndex(([x0, y0, x1, y1]) => cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1);
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
/** Distance from a point to the nearest of a thing's tiles (0 inside), in world units. */
function distToThing(t: Thing, x: number, y: number): number {
  let best = Infinity;
  for (const [cx, cy] of t.cells) {
    const dx = Math.max(cx * T() - x, 0, x - (cx + 1) * T()), dy = Math.max(cy * T() - y, 0, y - (cy + 1) * T());
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

/** Is this tile solid for this explorer right now? */
export function solid(w: World, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= w.room.w || cy >= w.room.h) return true;
  if (w.room.terrain[cy][cx] === "#") return true;
  const t = thingAt(w, cx, cy);
  if (!t || !WALLS.has(t.def.kind)) return false;
  if (t.def.kind === "block") return false; // the block itself is handled as a moving box
  if (t.open) return false;
  if ((t.def.kind === "gate" || t.def.kind === "run") && t.timer > 0) return false;
  if (t.def.kind === "door" && t.held) return false;
  return true;
}

/** Is there firm ground under this point for this explorer? */
function ground(w: World, e: Explorer, cx: number, cy: number): "ok" | "chasm" | "trap" | "crack" {
  if (w.room.terrain[cy]?.[cx] !== "~") {
    const t = thingAt(w, cx, cy);
    return t?.def.kind === "traps" ? "trap" : "ok";
  }
  const t = thingAt(w, cx, cy);
  if (!t) return "chasm";
  switch (t.def.kind) {
    case "bridge": return t.open ? "ok" : "chasm";
    case "sun": return has(e.profile, "Dawn") && !w.night ? "ok" : "chasm";
    case "moon": return has(e.profile, "Dusk") && w.night ? "ok" : "chasm";
    case "fragile": return t.open ? "ok" : has(e.profile, "Still") ? "ok" : t.timer > 0 ? "chasm" : "crack";
    default: return "chasm";
  }
}

// ------------------------------------------------------------------------ step

export function stepWorld(w: World, dt: number): void {
  w.events = [];
  if (w.done) return;
  w.time += dt;
  w.cycleIn -= dt;
  if (w.cycleIn <= 0) {
    w.night = !w.night;
    w.cycleIn = C().dayNight;
    w.events.push({ type: "daynight", night: w.night });
  }
  const target = w.night ? 1 : 0;
  w.nightness += Math.sign(target - w.nightness) * Math.min(Math.abs(target - w.nightness), dt / 1.2);

  for (const t of w.things.values()) {
    t.held = false;
    if ((t.def.kind === "gate" || t.def.kind === "run") && t.timer > 0) t.timer = Math.max(0, t.timer - dt);
    if (t.def.kind === "fragile" && t.timer > 0) t.timer = Math.max(0, t.timer - dt);
  }
  // Plates first, so a held door is open for this step's movement.
  for (const e of w.explorers) {
    if (e.falling > 0) continue;
    const t = thingAt(w, cellOf(e.x), cellOf(e.y));
    if (t?.def.kind === "plate") w.things.get(t.def.opens!)!.held = true;
  }
  // Anyone in a timed doorway while it's open may finish going through after it shuts.
  for (const t of w.things.values()) {
    if (t.def.kind !== "gate" && t.def.kind !== "run") continue;
    t.passers = w.explorers.filter((e) => e.falling <= 0 && distToThing(t, e.x, e.y) < C().radius
      && (t.timer > 0 || t.open || t.passers.includes(e.slot))).map((e) => e.slot);
  }
  for (const e of w.explorers) moveExplorer(w, e, dt);
  for (const e of w.explorers) abilities(w, e, dt);
  blocks(w, dt);
  teamThings(w);
  hints(w);
  // Everyone on the exit: room done.
  if (w.explorers.every((e) => e.falling <= 0 && w.room.terrain[cellOf(e.y)]?.[cellOf(e.x)] === "E")) {
    w.done = true;
    w.events.push({ type: "done" });
  }
}

function moveExplorer(w: World, e: Explorer, dt: number): void {
  const K = C();
  if (e.falling > 0) {
    e.falling -= dt;
    if (e.falling <= 0) {
      const [sx, sy] = w.room.starts[e.slot % w.room.starts.length];
      Object.assign(e, { x: (sx + 0.5) * T(), y: (sy + 0.5) * T(), vx: 0, vy: 0, falling: 0, stamina: 1, winded: false, dashT: 0 });
    }
    return;
  }
  e.dashCd = Math.max(0, e.dashCd - dt);
  if (e.flight) {
    // Flying on the slingshot: no steering, no ground until it lands.
    const f = e.flight, dur = K.slingshot.flight;
    f.t += dt;
    const k = Math.min(1, f.t / dur);
    e.x = f.x0 + (f.x1 - f.x0) * k; e.y = f.y0 + (f.y1 - f.y0) * k;
    e.flightK = k < 1 ? k : 0;
    if (k >= 1) e.flight = null;
    e.actionPressed = false;
    return;
  }
  let ix = e.intent.x, iy = e.intent.y;
  const il = Math.hypot(ix, iy);
  if (il > 1) { ix /= il; iy /= il; }

  // Sprint, with the same stamina rules as the arena (CONFIG.sprint).
  const S = CONFIG.sprint, m = S[e.profile.muscle];
  if (e.winded && e.stamina >= S.restartAt) e.winded = false;
  const pushing = e.pushing;
  e.sprinting = e.sprintHeld && il > 0.05 && !e.winded && e.stamina > 0 && !pushing;
  if (e.sprinting) { e.stamina = Math.max(0, e.stamina - m.drain * dt); e.restT = 0; if (e.stamina === 0) { e.winded = true; e.sprinting = false; } }
  else if (!pushing) { e.restT += dt; if (e.restT >= S.refillDelay) e.stamina = Math.min(1, e.stamina + m.refill * dt); }

  // Slingshot: a Blaze on the launcher, with an Endurance teammate on the spring, flies.
  const pad = thingAt(w, cellOf(e.x), cellOf(e.y));
  if (e.actionPressed && pad?.def.kind === "launcher" && has(e.profile, "Blaze")) {
    const [sx, sy] = w.room.things.get(pad.def.via!)!.cells[0];
    const holder = w.explorers.find((o) => o !== e && o.falling <= 0 && has(o.profile, "Endurance") && cellOf(o.x) === sx && cellOf(o.y) === sy);
    if (holder) {
      const [lx, ly] = w.room.things.get(pad.def.opens!)!.cells[0];
      e.flight = { x0: e.x, y0: e.y, x1: (lx + 0.5) * T(), y1: (ly + 0.5) * T(), t: 0 };
      e.vx = e.vy = 0; e.actionPressed = false; e.dashT = 0;
      combo(w, [[e, "Blaze", "flew on the slingshot"], [holder, "Endurance", "held the slingshot spring"]], `sling-${e.slot}`);
      return;
    }
  }
  // Blaze dash on the action key.
  if (e.actionPressed && has(e.profile, "Blaze") && e.dashCd <= 0) {
    const d = il > 0.1 ? { x: ix / Math.hypot(ix, iy), y: iy / Math.hypot(ix, iy) } : { x: e.facing, y: 0 };
    e.dashT = K.dash.time; e.dashCd = K.dash.cooldown;
    e.vx = d.x * K.dash.speed; e.vy = d.y * K.dash.speed;
  }
  e.actionPressed = false;
  if (e.dashT > 0) {
    e.dashT -= dt;
  } else {
    const top = K.walkSpeed * (e.sprinting ? m.speed : 1);
    const k = 1 - Math.exp(-(il > 0.05 ? K.responsiveness : K.friction) * dt);
    e.vx += (ix * top - e.vx) * k;
    e.vy += (iy * top - e.vy) * k;
  }
  if (Math.abs(e.vx) > 20) e.facing = e.vx > 0 ? 1 : -1;
  const speed = Math.hypot(e.vx, e.vy);
  e.bob = speed > 25 ? e.bob + dt * 4.5 : 0;

  // Move in small steps so a dash can't skip through a wall.
  const steps = Math.max(1, Math.ceil((speed * dt) / (K.radius * 0.5)));
  for (let i = 0; i < steps; i++) {
    e.x += (e.vx * dt) / steps;
    e.y += (e.vy * dt) / steps;
    collide(w, e);
  }

  // Ground check at the explorer's centre.
  const g = ground(w, e, cellOf(e.x), cellOf(e.y));
  if (g === "crack") {
    for (const f of w.things.values()) if (f.def.kind === "fragile") f.timer = 2.5; // the bridge crumbles for a moment
    fall(w, e, "crack");
  } else if (g !== "ok") fall(w, e, g === "trap" ? "trap" : "chasm");
}

function fall(w: World, e: Explorer, why: "chasm" | "trap" | "crack"): void {
  e.falling = C().respawn;
  e.vx = e.vy = 0;
  w.events.push({ type: "fell", slot: e.slot, why });
}

/** Push the explorer's circle out of solid tiles and the heavy blocks. */
function collide(w: World, e: Explorer): void {
  const r = C().radius;
  const boxes: Array<[number, number, number, number]> = [];
  for (let cy = cellOf(e.y - r); cy <= cellOf(e.y + r); cy++) {
    for (let cx = cellOf(e.x - r); cx <= cellOf(e.x + r); cx++) {
      if (!solid(w, cx, cy)) continue;
      if (thingAt(w, cx, cy)?.passers.includes(e.slot)) continue;
      boxes.push([cx * T(), cy * T(), (cx + 1) * T(), (cy + 1) * T()]);
    }
  }
  for (const t of w.things.values()) if (t.def.kind === "block") boxes.push(blockBox(t));
  for (const [x0, y0, x1, y1] of boxes) {
    const nx = Math.max(x0, Math.min(e.x, x1)), ny = Math.max(y0, Math.min(e.y, y1));
    const dx = e.x - nx, dy = e.y - ny, d = Math.hypot(dx, dy);
    if (d >= r) continue;
    if (d > 0.0001) { e.x = nx + (dx / d) * r; e.y = ny + (dy / d) * r; }
    else {
      // Centre inside the box: push out the shortest way.
      const opts = [[x0 - r - e.x, 0], [x1 + r - e.x, 0], [0, y0 - r - e.y], [0, y1 + r - e.y]];
      const [ox, oy] = opts.reduce((a, b) => (Math.hypot(a[0], a[1]) < Math.hypot(b[0], b[1]) ? a : b));
      e.x += ox; e.y += oy;
    }
  }
}

export function blockBox(t: ThingState): [number, number, number, number] {
  const { from } = blockGeometry(t), [dx, dy] = t.def.dir!;
  const x = from[0] * T() + dx * t.offset, y = from[1] * T() + dy * t.offset;
  return [x, y, x + T(), y + T()];
}

// ---------------------------------------------------------------- abilities

function opened(w: World, t: ThingState, e: Explorer | null, gene: GeneOption | null, text: string): void {
  if (t.open) return;
  t.open = true;
  w.events.push({ type: "opened", slot: e?.slot ?? -1, gene, thing: t.id, kind: t.def.kind, text });
  if (e) w.log.push({ slot: e.slot, gene, text });
}

function first(w: World, e: Explorer, tag: string, gene: GeneOption, text: string): void {
  if (w.firsts.has(tag)) return;
  w.firsts.add(tag);
  w.events.push({ type: "opened", slot: e.slot, gene, thing: tag, kind: "sun", text });
  w.log.push({ slot: e.slot, gene, text });
}

function abilities(w: World, e: Explorer, dt: number): void {
  if (e.falling > 0) return;
  const K = C(), cx = cellOf(e.x), cy = cellOf(e.y), here = thingAt(w, cx, cy);
  const touch = (t: Thing) => distToThing(t, e.x, e.y) <= K.radius + 6;

  // Switches trigger when stepped onto.
  const sw = here?.def.kind === "switch" ? here.id : null;
  if (sw && e.onSwitch !== sw) {
    for (const t of w.things.values()) {
      if ((t.def.kind === "gate" || t.def.kind === "run") && t.def.via === sw && !t.open) t.timer = t.def.kind === "gate" ? K.gateWindow : K.runWindow;
    }
  }
  e.onSwitch = sw;

  // Passing through a timed door while it's open: the gene that made it gets the credit.
  if ((here?.def.kind === "gate" || here?.def.kind === "run") && !here.open && here.timer > 0) {
    if (here.def.kind === "gate" && has(e.profile, "Blaze")) first(w, e, `pass-${here.id}-${e.slot}`, "Blaze", "dashed through the closing gate");
    if (here.def.kind === "run") first(w, e, `pass-${here.id}-${e.slot}`, e.profile.muscle, "beat the timed door");
  }
  if (here?.def.kind === "lever") {
    const target = w.things.get(here.def.opens!)!;
    if (!target.open) opened(w, target, e, null, "pulled the lever");
    here.open = true;
  }
  if (here?.def.kind === "gem" && !here.open) {
    here.open = true;
    w.gems++;
    w.events.push({ type: "gem", slot: e.slot });
  }
  if (here?.def.kind === "key" && here.revealed && !here.open) {
    here.open = true;
    opened(w, w.things.get(here.def.opens!)!, e, "Keen", "unlocked the vault with the buried key");
  }
  if (here && (here.def.kind === "sun" || here.def.kind === "moon")) {
    const gene = here.def.kind === "sun" ? "Dawn" : "Dusk";
    first(w, e, `${gene}-${e.slot}`, gene, here.def.kind === "sun" ? "walked the sun stones" : "walked the moon stones");
  }
  if (here?.def.kind === "fragile" && has(e.profile, "Still")) first(w, e, `fragile-${e.slot}`, "Still", "crossed the fragile bridge without a crack");
  const d = inDark(w, cx, cy);
  if (d >= 0 && has(e.profile, "Ember") && !w.lit.has(d)) {
    w.lit.add(d);
    first(w, e, `dark-${d}`, "Ember", "lit up the dark burrow");
  }

  for (const t of w.things.values()) {
    if (t.open && t.def.kind !== "hidden") continue;
    switch (t.def.kind) {
      case "bramble":
        if (has(e.profile, "Bold") && touch(t)) {
          t.progress += dt;
          if (t.progress >= K.munchTime) opened(w, t, e, "Bold", "munched through the bramble");
        }
        break;
      case "ice":
        if (has(e.profile, "Ember") && distToThing(t, e.x, e.y) <= K.tile * 0.9) {
          t.progress += dt;
          if (t.progress >= K.meltTime) opened(w, t, e, "Ember", "melted the ice wall");
        }
        break;
      case "hidden":
      case "traps":
      case "key":
        if (!t.revealed && has(e.profile, "Keen") && distToThing(t, e.x, e.y) <= K.sniffRadius * K.tile) {
          t.revealed = true;
          const text = t.def.kind === "hidden" ? "found a hidden door" : t.def.kind === "traps" ? "sniffed out hidden traps" : "dug up a buried key";
          if (t.def.kind === "hidden") opened(w, t, e, "Keen", text);
          else { w.events.push({ type: "opened", slot: e.slot, gene: "Keen", thing: t.id, kind: t.def.kind, text }); w.log.push({ slot: e.slot, gene: "Keen", text }); }
        }
        break;
      case "electric": {
        const node = w.room.things.get(t.def.via!)!;
        if (has(e.profile, "Crackling") && touch(node)) opened(w, t, e, "Crackling", "powered the machine");
        break;
      }
      case "critter":
        if (has(e.profile, "Still") && distToThing(t, e.x, e.y) <= K.calmRadius * K.tile) {
          t.progress += dt;
          if (t.progress >= K.calmTime) opened(w, t, e, "Still", "calmed the wild critter");
        } else if (!has(e.profile, "Still") && distToThing(t, e.x, e.y) <= K.radius + 10) {
          // It shoves anyone else back.
          const [tx, ty] = t.cells[0], cxw = (tx + 0.5) * K.tile, cyw = (ty + 0.5) * K.tile;
          const dd = dist(e.x, e.y, cxw, cyw) || 1;
          e.vx = ((e.x - cxw) / dd) * K.critterShove; e.vy = ((e.y - cyw) / dd) * K.critterShove;
          if (!w.firsts.has(`growl-${t.id}-${e.slot}`)) { w.firsts.add(`growl-${t.id}-${e.slot}`); w.events.push({ type: "growl", slot: e.slot }); }
        }
        break;
      default: break;
    }
  }
}

/** Heavy blocks: pushed by Endurance or Mixed muscles, they slide back if the push stops. */
function blocks(w: World, dt: number): void {
  const K = C();
  for (const e of w.explorers) e.pushing = false;
  for (const t of w.things.values()) {
    if (t.def.kind !== "block" || t.open) continue;
    const [dx, dy] = t.def.dir!, [x0, y0, x1, y1] = blockBox(t);
    let pushed = false;
    for (const e of w.explorers) {
      if (e.falling > 0) continue;
      // Behind the block, touching it, and pushing in its direction.
      const along = e.intent.x * dx + e.intent.y * dy;
      const nx = Math.max(x0, Math.min(e.x, x1)), ny = Math.max(y0, Math.min(e.y, y1));
      const touching = Math.hypot(e.x - nx, e.y - ny) <= K.radius + 3;
      const behind = dx ? (e.x - (x0 + x1) / 2) * dx < 0 : (e.y - (y0 + y1) / 2) * dy < 0;
      if (along > 0.6 && touching && behind && !e.winded && e.stamina > 0) {
        pushed = true;
        e.pushing = true;
        e.stamina = Math.max(0, e.stamina - K.push.drain[e.profile.muscle] * dt);
        if (e.stamina === 0) e.winded = true;
        if (t.offset + K.push.speed * dt >= 2 * K.tile) {
          t.offset = 2 * K.tile;
          opened(w, t, e, e.profile.muscle, "pushed the heavy block into its slot");
        }
      }
    }
    if (pushed && !t.open) t.offset = Math.min(2 * K.tile, t.offset + K.push.speed * dt);
    else if (!t.open) t.offset = Math.max(0, t.offset - K.push.slideBack * dt);
  }
}

/** A team combo: credit every creature and gene involved (once per combo). */
function combo(w: World, parts: Array<[Explorer, GeneOption, string]>, tag: string): void {
  if (w.firsts.has(tag)) return;
  w.firsts.add(tag);
  for (const [e, gene, text] of parts) {
    w.events.push({ type: "opened", slot: e.slot, gene, thing: tag, kind: "sunpad", text });
    w.log.push({ slot: e.slot, gene, text });
  }
}

/** Things the whole team does together: all-plates doors and the twilight bridge. */
function teamThings(w: World): void {
  for (const t of w.things.values()) {
    if (t.def.kind !== "sunpad") continue;
    const bridge = w.things.get(t.def.opens!)!;
    if (bridge.open) continue;
    const moon = [...w.things.values()].find((m) => m.def.kind === "moonpad" && m.def.opens === t.def.opens)!;
    const on = (e: Explorer, th: ThingState) => e.falling <= 0 && th.cells.some(([x, y]) => x === cellOf(e.x) && y === cellOf(e.y));
    const dawn = w.explorers.find((e) => has(e.profile, "Dawn") && on(e, t));
    const dusk = w.explorers.find((e) => e !== dawn && has(e.profile, "Dusk") && on(e, moon));
    if (dawn && dusk) {
      bridge.open = true;
      combo(w, [[dawn, "Dawn", "raised the twilight bridge with a Dusk friend"], [dusk, "Dusk", "raised the twilight bridge with a Dawn friend"]], `twilight-${t.id}`);
    }
  }
  for (const t of w.things.values()) {
    if (t.def.kind !== "plates") continue;
    const door = w.things.get(t.def.opens!)!;
    if (door.open) continue;
    const need = Math.min(w.explorers.length, t.cells.length);
    const standing = new Set<string>();
    for (const e of w.explorers) {
      if (e.falling > 0) continue;
      const cx = cellOf(e.x), cy = cellOf(e.y);
      if (t.cells.some(([px, py]) => px === cx && py === cy)) standing.add(`${cx},${cy}`);
    }
    if (standing.size >= need) opened(w, door, null, null, "Everyone on a plate: the nest opens!");
  }
}

function hints(w: World): void {
  const tutorial = ROOMS[w.roomIndex].tutorial;
  for (const t of w.things.values()) {
    if (!t.def.hint || w.hinted.has(t.id)) continue;
    // Team combos explain themselves in every room; other hints only in the tutorials.
    if (!tutorial && t.def.kind !== "sunpad" && t.def.kind !== "launcher") continue;
    if (w.explorers.some((e) => e.falling <= 0 && distToThing(t, e.x, e.y) <= C().hintRadius * C().tile)) {
      w.hinted.add(t.id);
      w.events.push({ type: "hint", text: t.def.hint });
    }
  }
}

/** Plates standing count for the HUD ("2 of 3 on plates"). */
export function platesStatus(w: World): { on: number; need: number } | null {
  for (const t of w.things.values()) {
    if (t.def.kind !== "plates" || w.things.get(t.def.opens!)!.open) continue;
    const on = w.explorers.filter((e) => e.falling <= 0 && t.cells.some(([px, py]) => px === cellOf(e.x) && py === cellOf(e.y))).length;
    return { on, need: Math.min(w.explorers.length, t.cells.length) };
  }
  return null;
}
