// Game rules, independent of drawing: movement, attacks, health, gene power ups, day and
// night, and the match flow. The renderer reads the state and the events each step produces.
import { CONFIG } from "./config.ts";
import type { Creature } from "./creatures.ts";

export interface Vec { x: number; y: number }

export type PowerKind = "coffee" | "greens" | "orb";

/** The muscle stat, from the ACTN3 sprinter/endurance trait. Not one of the 4 creature axes. */
export type Muscle = "Sprinter" | "Mixed" | "Endurance";
export const MUSCLES: readonly Muscle[] = ["Sprinter", "Mixed", "Endurance"];

export interface Pickup { id: number; kind: PowerKind; x: number; y: number; age: number }

export interface Fighter {
  slot: 0 | 1;
  creature: Creature;
  x: number; y: number;
  vx: number; vy: number;
  hp: number;
  /** 1 = facing right, -1 = facing left (on screen). */
  facing: 1 | -1;
  /** What the controller asks for this step: a direction (length <= 1) and an attack press. */
  intent: Vec;
  attackPressed: boolean;
  /** Sprint key held this step. */
  sprintHeld: boolean;
  muscle: Muscle;
  /** 1 = full, 0 = empty. */
  stamina: number;
  sprinting: boolean;
  /** True after running dry, until stamina is back to sprint.restartAt. */
  winded: boolean;
  /** Time since sprinting stopped (stamina refills after sprint.refillDelay). */
  restT: number;
  cooldown: number;
  /** Time since the current swing started, or -1 when not swinging. */
  swingT: number;
  swingDir: Vec;
  swingHit: boolean;
  /** True when the current swing is a lightning dash. */
  swingDash: boolean;
  stun: number;
  flash: number;
  /** Running clock for the hop while moving. */
  bob: number;
  /** Top speed multiplier (the computer runs a little slower). */
  speed: number;
  /** Gene effects: seconds left (0 = off). */
  boost: number;
  jitter: number;
  bitter: number;
  /** Held orb effects: seconds left before they fade unused (0 = none). */
  charged: number;
  shield: number;
}

export type GameEvent =
  | { type: "swing"; slot: 0 | 1; dir: Vec; dash: boolean }
  | { type: "hit"; slot: 0 | 1; x: number; y: number; damage: number; dir: Vec; dash: boolean; boosted: boolean }
  | { type: "block"; slot: 0 | 1; x: number; y: number }
  | { type: "power"; slot: 0 | 1; kind: PowerKind; effect: Effect; x: number; y: number }
  | { type: "spawn"; pickup: Pickup }
  | { type: "foresee"; pickup: Pickup }
  | { type: "daynight"; night: boolean }
  | { type: "ko"; slot: 0 | 1 };

/** What a power up did to the creature that picked it up. */
export type Effect = "boost" | "jitters" | "yum" | "bitter" | "lightning" | "shield";

export type Phase = "countdown" | "fight" | "ko" | "over";

export interface Game {
  fighters: [Fighter, Fighter];
  phase: Phase;
  /** Time spent in the current phase. */
  phaseT: number;
  time: number;
  winner: 0 | 1 | null;
  events: GameEvent[];
  pickups: Pickup[];
  /** The next power up, already placed but not there yet: Keen creatures sense it early. */
  pending: Pickup | null;
  nextPickupId: number;
  /** Fight time until the next spawn. */
  spawnIn: number;
  /** Day or night now (rules), and 0..1 how night-lit the arena looks (smooth, for drawing). */
  night: boolean;
  nightness: number;
  /** Fight time until the next day/night switch. */
  cycleIn: number;
  rand: () => number;
}

function fighter(slot: 0 | 1, creature: Creature, muscle: Muscle): Fighter {
  const side = slot === 0 ? -1 : 1;
  return {
    slot, creature,
    x: side * CONFIG.arena.radius * 0.5, y: 0, vx: 0, vy: 0,
    hp: CONFIG.fighter.maxHp,
    facing: slot === 0 ? 1 : -1,
    intent: { x: 0, y: 0 }, attackPressed: false,
    sprintHeld: false, muscle, stamina: 1, sprinting: false, winded: false, restT: 0,
    cooldown: 0, swingT: -1, swingDir: { x: -side, y: 0 }, swingHit: false, swingDash: false,
    stun: 0, flash: 0, bob: 0, speed: 1,
    boost: 0, jitter: 0, bitter: 0, charged: 0, shield: 0,
  };
}

const between = (r: () => number, [lo, hi]: readonly [number, number]) => lo + r() * (hi - lo);

export function newGame(a: Creature, b: Creature, rand: () => number = Math.random,
  muscles: [Muscle, Muscle] = ["Sprinter", "Sprinter"]): Game {
  const D = CONFIG.dayNight;
  const night = D.start === "random" ? rand() < 0.5 : D.start === "night";
  return {
    fighters: [fighter(0, a, muscles[0]), fighter(1, b, muscles[1])], phase: "countdown", phaseT: 0, time: 0, winner: null, events: [],
    pickups: [], pending: null, nextPickupId: 1, spawnIn: CONFIG.powerUps.firstSpawn,
    night, nightness: night ? 1 : 0, cycleIn: between(rand, D.first),
    rand,
  };
}

const len = (x: number, y: number) => Math.hypot(x, y);

export function step(g: Game, dt: number): void {
  g.events = [];
  g.time += dt;
  g.phaseT += dt;
  const [a, b] = g.fighters;
  const active = g.phase === "fight";

  if (g.phase === "countdown" && g.phaseT >= CONFIG.match.countdown) { g.phase = "fight"; g.phaseT = 0; }
  if (g.phase === "ko" && g.phaseT >= CONFIG.match.koPause) { g.phase = "over"; g.phaseT = 0; }

  if (active) { dayNight(g, dt); spawnPickups(g, dt); }
  const target = g.night ? 1 : 0;
  g.nightness += Math.sign(target - g.nightness) * Math.min(Math.abs(target - g.nightness), dt / CONFIG.dayNight.transition);

  for (const [me, foe] of [[a, b], [b, a]] as const) {
    if (!active) { me.intent = { x: 0, y: 0 }; me.attackPressed = false; me.sprintHeld = false; }
    move(me, foe, dt);
    attack(g, me, foe, dt);
  }
  separate(a, b);
  for (const f of g.fighters) keepInArena(f);
  if (active) collect(g);
}

// ------------------------------------------------------------ day and night

function dayNight(g: Game, dt: number): void {
  g.cycleIn -= dt;
  if (g.cycleIn > 0) return;
  g.night = !g.night;
  g.cycleIn = between(g.rand, CONFIG.dayNight.every);
  g.events.push({ type: "daynight", night: g.night });
}

/** True when the Time gene gives this creature the edge right now (Dawn by day, Dusk by night). */
export function hasTimeAdvantage(g: Game, f: Fighter): boolean {
  return g.night ? f.creature.time === "Dusk" : f.creature.time === "Dawn";
}

// ---------------------------------------------------------------- power ups

function spawnPickups(g: Game, dt: number): void {
  const P = CONFIG.powerUps;
  for (const p of g.pickups) p.age += dt;
  g.pickups = g.pickups.filter((p) => p.age < P.lifetime);
  g.spawnIn -= dt;
  // Choose the next power up and its spot a moment early, so Keen creatures can sense it.
  if (!g.pending && g.spawnIn <= CONFIG.keen.foresight && g.pickups.length < P.maxOnField) {
    const spot = findSpot(g);
    if (spot) {
      g.pending = { id: g.nextPickupId++, kind: pickKind(g), x: spot.x, y: spot.y, age: -Math.max(0, g.spawnIn) };
      g.events.push({ type: "foresee", pickup: g.pending });
    }
  }
  if (g.pending) g.pending.age = -Math.max(0, g.spawnIn);
  if (g.spawnIn > 0) return;
  g.spawnIn = between(g.rand, P.spawnEvery);
  const pickup = g.pending;
  g.pending = null;
  if (!pickup || g.pickups.length >= P.maxOnField) return;
  pickup.age = 0;
  g.pickups.push(pickup);
  g.events.push({ type: "spawn", pickup });
}

/** How close a creature must be to pick up a power up (Keen creatures reach further). */
export function grabReach(f: Fighter): number {
  return CONFIG.fighter.radius + CONFIG.powerUps.radius + (f.creature.senses === "Keen" ? CONFIG.keen.grabBonus : 0);
}

function pickKind(g: Game): PowerKind {
  const w = CONFIG.powerUps.weights, total = w.coffee + w.greens + w.orb;
  let r = g.rand() * total;
  if ((r -= w.coffee) < 0) return "coffee";
  if ((r -= w.greens) < 0) return "greens";
  return "orb";
}

function findSpot(g: Game): Vec | null {
  const P = CONFIG.powerUps, R = CONFIG.arena.radius * P.spawnArea;
  for (let tries = 0; tries < 20; tries++) {
    const a = g.rand() * Math.PI * 2, r = Math.sqrt(g.rand()) * R;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    const clear = g.fighters.every((f) => len(f.x - x, f.y - y) > P.spawnClearance)
      && g.pickups.every((p) => len(p.x - x, p.y - y) > P.radius * 4);
    if (clear) return { x, y };
  }
  return null;
}

function collect(g: Game): void {
  for (const f of g.fighters) {
    if (f.hp <= 0) continue;
    const reach = grabReach(f);
    const got = g.pickups.find((p) => len(p.x - f.x, p.y - f.y) < reach);
    if (!got) continue;
    g.pickups = g.pickups.filter((p) => p !== got);
    const effect = applyPower(f, got.kind, g.rand);
    g.events.push({ type: "power", slot: f.slot, kind: got.kind, effect, x: got.x, y: got.y });
  }
}

/** What each power up does to a creature, decided by its genes. */
export function effectOf(c: Creature, kind: PowerKind): Effect {
  if (kind === "coffee") return c.flame === "Blaze" ? "boost" : "jitters";
  if (kind === "greens") return c.senses === "Bold" ? "yum" : "bitter";
  return c.spark === "Crackling" ? "lightning" : "shield";
}

/** True when a power up helps this creature (the bot goes for these and avoids the rest). */
export function helps(c: Creature, kind: PowerKind): boolean {
  return ["boost", "yum", "lightning", "shield"].includes(effectOf(c, kind));
}

function applyPower(f: Fighter, kind: PowerKind, rand: () => number): Effect {
  const effect = effectOf(f.creature, kind);
  switch (effect) {
    case "boost": f.boost = CONFIG.coffee.boostTime; break;
    case "jitters": f.jitter = CONFIG.coffee.jitterTime; f.boost = 0; break;
    case "yum": f.hp = Math.min(CONFIG.fighter.maxHp, f.hp + CONFIG.greens.heal); break;
    case "bitter": {
      // Off it goes, in a random direction, and it can't steer or attack until it stops.
      const a = rand() * Math.PI * 2, v = CONFIG.greens.recoilSpeed;
      f.bitter = CONFIG.greens.recoilTime;
      f.vx = Math.cos(a) * v; f.vy = Math.sin(a) * v;
      break;
    }
    case "lightning": f.charged = CONFIG.orb.holdTime; break;
    case "shield": f.shield = CONFIG.orb.holdTime; break;
  }
  return effect;
}

// ----------------------------------------------------------------- movement

function move(f: Fighter, foe: Fighter, dt: number): void {
  const F = CONFIG.fighter;
  f.cooldown = Math.max(0, f.cooldown - dt);
  f.stun = Math.max(0, f.stun - dt);
  f.flash = Math.max(0, f.flash - dt);
  f.boost = Math.max(0, f.boost - dt);
  f.jitter = Math.max(0, f.jitter - dt);
  f.bitter = Math.max(0, f.bitter - dt);
  f.charged = Math.max(0, f.charged - dt);
  f.shield = Math.max(0, f.shield - dt);

  let ix = f.intent.x, iy = f.intent.y;
  const il = len(ix, iy);
  if (il > 1) { ix /= il; iy /= il; }
  const swinging = f.swingT >= 0;
  const frozen = f.stun > 0 || swinging || f.hp <= 0 || f.jitter > 0;

  sprint(f, il > 0.05 && !frozen && f.bitter <= 0, dt);

  if (f.bitter > 0) {
    // Reeling from the bitter taste: no steering, very little friction.
    const k = 1 - Math.exp(-CONFIG.greens.recoilFriction * dt);
    f.vx -= f.vx * k; f.vy -= f.vy * k;
  } else {
    if (frozen) { ix = 0; iy = 0; }
    const top = F.maxSpeed * f.speed * (f.boost > 0 ? CONFIG.coffee.boostSpeed : 1)
      * (f.sprinting ? CONFIG.sprint[f.muscle].speed : 1);
    const k = 1 - Math.exp(-(il > 0.05 && !frozen ? F.responsiveness : F.friction) * dt);
    f.vx += (ix * top - f.vx) * k;
    f.vy += (iy * top - f.vy) * k;
  }
  if (f.jitter > 0 && f.stun <= 0) { f.vx *= 0.5; f.vy *= 0.5; }
  f.x += f.vx * dt;
  f.y += f.vy * dt;

  const speed = len(f.vx, f.vy);
  f.bob = speed > 25 ? f.bob + dt * CONFIG.motion.bobRate * (0.5 + 0.5 * speed / F.maxSpeed) : 0;

  // Face the way you are running; when standing still, face the opponent.
  if (swinging) f.facing = f.swingDir.x >= 0 ? 1 : -1;
  else if (f.bitter > 0) { if (Math.abs(f.vx) > 20) f.facing = f.vx > 0 ? 1 : -1; }
  else if (Math.abs(ix) > 0.2) f.facing = ix > 0 ? 1 : -1;
  else if (il < 0.05 && Math.abs(foe.x - f.x) > 20) f.facing = foe.x > f.x ? 1 : -1;
}

/** Sprint: faster while the key is held and there's stamina; refills after a short rest. */
function sprint(f: Fighter, moving: boolean, dt: number): void {
  const S = CONFIG.sprint, m = S[f.muscle];
  if (f.winded && f.stamina >= S.restartAt) f.winded = false;
  f.sprinting = f.sprintHeld && moving && !f.winded && f.stamina > 0;
  if (f.sprinting) {
    f.stamina = Math.max(0, f.stamina - m.drain * dt);
    f.restT = 0;
    if (f.stamina === 0) { f.winded = true; f.sprinting = false; }
  } else {
    f.restT += dt;
    if (f.restT >= S.refillDelay) f.stamina = Math.min(1, f.stamina + m.refill * dt);
  }
}

// ------------------------------------------------------------------ attacks

function attack(g: Game, f: Fighter, foe: Fighter, dt: number): void {
  const A = CONFIG.attack;
  if (f.swingT >= 0) {
    f.swingT += dt;
    if (!f.swingHit && f.swingT >= A.windup) {
      f.swingHit = true;
      const dx = foe.x - f.x, dy = foe.y - f.y, d = len(dx, dy);
      const range = A.range + (f.swingDash ? CONFIG.orb.dashRange : 0);
      const facingOk = d < 1 || (dx * f.swingDir.x + dy * f.swingDir.y) / d >= Math.cos(A.arc);
      if (d <= range && facingOk && foe.hp > 0 && g.phase === "fight") hit(g, f, foe, d > 1 ? { x: dx / d, y: dy / d } : f.swingDir);
    }
    if (f.swingT >= A.windup + 0.14) f.swingT = -1;
  }
  const canSwing = f.cooldown <= 0 && f.stun <= 0 && f.swingT < 0 && f.hp > 0 && f.bitter <= 0;
  if (f.attackPressed && canSwing) {
    // Aim: at the opponent when they are close, otherwise where you are heading or facing.
    const dx = foe.x - f.x, dy = foe.y - f.y, d = len(dx, dy);
    const il = len(f.intent.x, f.intent.y);
    const dash = f.charged > 0;
    f.swingDir = d < (A.range + (dash ? CONFIG.orb.dashRange : 0)) * A.autoAim && d > 1 ? { x: dx / d, y: dy / d }
      : il > 0.2 ? { x: f.intent.x / il, y: f.intent.y / il } : { x: f.facing, y: 0 };
    f.swingT = 0;
    f.swingHit = false;
    f.swingDash = dash;
    f.charged = 0;
    f.cooldown = A.cooldown;
    const lunge = A.lunge * (dash ? CONFIG.orb.dashLunge : 1);
    f.vx += f.swingDir.x * lunge;
    f.vy += f.swingDir.y * lunge;
    g.events.push({ type: "swing", slot: f.slot, dir: f.swingDir, dash });
  }
  f.attackPressed = false;
}

function hit(g: Game, from: Fighter, to: Fighter, dir: Vec): void {
  const A = CONFIG.attack;
  if (to.shield > 0) {
    // The calm shield soaks up the whole hit, then it's gone.
    to.shield = 0;
    to.vx += dir.x * A.knockback * 0.4;
    to.vy += dir.y * A.knockback * 0.4;
    g.events.push({ type: "block", slot: to.slot, x: to.x, y: to.y });
    return;
  }
  const boosted = hasTimeAdvantage(g, from);
  const base = from.swingDash ? CONFIG.orb.dashDamage : A.damage;
  const damage = Math.round(base * (boosted ? CONFIG.dayNight.advantage : 1));
  to.hp = Math.max(0, to.hp - damage);
  to.vx += dir.x * A.knockback * (from.swingDash ? 1.6 : 1);
  to.vy += dir.y * A.knockback * (from.swingDash ? 1.6 : 1);
  to.stun = A.hitStun;
  to.flash = CONFIG.motion.hitFlash;
  g.events.push({ type: "hit", slot: to.slot, x: to.x, y: to.y, damage, dir, dash: from.swingDash, boosted });
  if (to.hp <= 0) {
    g.phase = "ko";
    g.phaseT = 0;
    g.winner = from.slot;
    g.events.push({ type: "ko", slot: to.slot });
  }
}

function separate(a: Fighter, b: Fighter): void {
  const dx = b.x - a.x, dy = b.y - a.y, d = len(dx, dy), min = CONFIG.fighter.radius * 2;
  if (d >= min) return;
  const nx = d > 0.01 ? dx / d : 1, ny = d > 0.01 ? dy / d : 0, push = (min - d) / 2;
  a.x -= nx * push; a.y -= ny * push;
  b.x += nx * push; b.y += ny * push;
}

function keepInArena(f: Fighter): void {
  const max = CONFIG.arena.radius - CONFIG.fighter.radius, d = len(f.x, f.y);
  if (d <= max) return;
  const nx = f.x / d, ny = f.y / d;
  f.x = nx * max; f.y = ny * max;
  const out = f.vx * nx + f.vy * ny;
  if (out > 0) {
    // A bitter reel bounces off the edge; otherwise just stop at it.
    const bounce = f.bitter > 0 ? 1.7 : 1;
    f.vx -= out * nx * bounce; f.vy -= out * ny * bounce;
  }
}
