import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config.ts";
import { CREATURES, creature } from "../src/creatures.ts";
import { effectOf, hasTimeAdvantage, helps, newGame, step, type Game, type PowerKind } from "../src/sim.ts";

const DT = 1 / 120;
function run(g: Game, seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds; t += DT) { each?.(); step(g, DT); }
}
/** A fight with no random spawns or day/night switches unless a test wants them. */
function fight(a = "Shadepounce", b = "Morningdrift"): Game {
  const g = newGame(creature(a), creature(b));
  g.phase = "fight"; g.spawnIn = 1e9; g.cycleIn = 1e9; g.night = false; g.nightness = 0;
  g.fighters[0].x = -300; g.fighters[1].x = 300;
  return g;
}
function give(g: Game, slot: 0 | 1, kind: PowerKind): void {
  const f = g.fighters[slot];
  g.pickups.push({ id: 99, kind, x: f.x, y: f.y, age: 0 });
  step(g, DT);
}

describe("gene power ups", () => {
  it("each power up's effect follows exactly one gene", () => {
    for (const c of CREATURES) {
      expect(effectOf(c, "coffee")).toBe(c.flame === "Blaze" ? "boost" : "jitters");
      expect(effectOf(c, "greens")).toBe(c.senses === "Bold" ? "yum" : "bitter");
      expect(effectOf(c, "orb")).toBe(c.spark === "Crackling" ? "lightning" : "shield");
      expect(helps(c, "orb")).toBe(true);
    }
    expect(helps(creature("Shadepounce"), "coffee")).toBe(false); // Ember
    expect(helps(creature("Shadepounce"), "greens")).toBe(false); // Keen
    expect(helps(creature("Morningdrift"), "coffee")).toBe(true); // Blaze
  });

  it("coffee: Blaze runs faster, Ember is frozen with the jitters", () => {
    const g = fight("Morningdrift", "Shadepounce");
    give(g, 0, "coffee");
    give(g, 1, "coffee");
    expect(g.pickups).toHaveLength(0);
    const [blaze, ember] = g.fighters;
    expect(blaze.boost).toBeGreaterThan(0);
    expect(ember.jitter).toBeGreaterThan(0);
    const x0 = ember.x;
    run(g, 0.5, () => { blaze.intent = { x: 0, y: 1 }; ember.intent = { x: 0, y: 1 }; });
    expect(Math.abs(ember.y)).toBeLessThan(5);
    expect(ember.x).toBeCloseTo(x0, 0);
    expect(Math.hypot(blaze.vx, blaze.vy)).toBeGreaterThan(CONFIG.fighter.maxSpeed * 1.2);
    run(g, CONFIG.coffee.jitterTime, () => { ember.intent = { x: 0, y: 1 }; });
    expect(ember.y).toBeGreaterThan(20); // free again
  });

  it("bitter greens: Bold heals, Keen reels out of control and can't attack", () => {
    const g = fight("Shadepounce", "Morningdrift");
    const [keen, bold] = g.fighters;
    bold.hp = 50;
    give(g, 1, "greens");
    expect(bold.hp).toBe(50 + CONFIG.greens.heal);
    give(g, 0, "greens");
    expect(keen.bitter).toBeGreaterThan(0);
    expect(Math.hypot(keen.vx, keen.vy)).toBeGreaterThan(CONFIG.greens.recoilSpeed * 0.9);
    keen.attackPressed = true; step(g, DT);
    expect(keen.swingT).toBe(-1);
    bold.hp = CONFIG.fighter.maxHp - Math.max(1, CONFIG.greens.heal - 1);
    give(g, 1, "greens");
    expect(bold.hp).toBe(CONFIG.fighter.maxHp); // never above full
  });

  it("orb: Crackling's next attack is a lightning dash, Still blocks the next hit", () => {
    const g = fight("Shadepounce", "Morningdrift");
    const [crack, still] = g.fighters;
    give(g, 0, "orb");
    give(g, 1, "orb");
    expect(crack.charged).toBeGreaterThan(0);
    expect(still.shield).toBeGreaterThan(0);
    crack.x = 0; still.x = 140;
    crack.attackPressed = true;
    run(g, 0.3);
    expect(still.hp).toBe(CONFIG.fighter.maxHp); // blocked
    expect(still.shield).toBe(0);
    expect(crack.charged).toBe(0); // the charge is used up even when blocked
    run(g, CONFIG.attack.cooldown);
    // Lightning dash reaches further and hits harder than a normal attack.
    give(g, 0, "orb");
    crack.x = 0; crack.y = 0; still.x = CONFIG.attack.range + 40; still.y = 0;
    crack.attackPressed = true;
    run(g, 0.3);
    expect(CONFIG.fighter.maxHp - still.hp).toBe(CONFIG.orb.dashDamage);
  });

  it("power ups spawn on their own, away from the creatures, and expire", () => {
    const g = fight();
    g.spawnIn = 0;
    step(g, DT);
    expect(g.pickups).toHaveLength(1);
    for (const f of g.fighters) expect(Math.hypot(f.x - g.pickups[0].x, f.y - g.pickups[0].y)).toBeGreaterThan(CONFIG.powerUps.spawnClearance);
    g.spawnIn = 1e9;
    run(g, CONFIG.powerUps.lifetime + 0.1);
    expect(g.pickups).toHaveLength(0);
  });
});

describe("day and night", () => {
  it("Dawn hits harder by day, Dusk by night", () => {
    const g = fight("Shadepounce", "Morningdrift"); // Dusk vs Dawn
    const [dusk, dawn] = g.fighters;
    expect(g.night).toBe(false);
    expect(hasTimeAdvantage(g, dawn)).toBe(true);
    expect(hasTimeAdvantage(g, dusk)).toBe(false);
    dawn.x = 0; dusk.x = 100;
    dawn.attackPressed = true;
    run(g, 0.3);
    expect(CONFIG.fighter.maxHp - dusk.hp).toBe(Math.round(CONFIG.attack.damage * CONFIG.dayNight.advantage));

    g.cycleIn = 0;
    step(g, DT);
    expect(g.night).toBe(true);
    expect(g.events.some((e) => e.type === "daynight")).toBe(true);
    run(g, CONFIG.dayNight.transition + 0.1);
    expect(g.nightness).toBe(1);
    const before = dawn.hp;
    dusk.x = 0; dusk.y = 0; dawn.x = 100; dawn.y = 0; dusk.cooldown = 0;
    dusk.attackPressed = true;
    run(g, 0.3);
    expect(before - dawn.hp).toBe(Math.round(CONFIG.attack.damage * CONFIG.dayNight.advantage));
  });

  it("switches every 20 to 30 seconds", () => {
    const g = fight();
    g.cycleIn = 25; // as newGame would pick
    const switches: number[] = [];
    run(g, 120, () => { if (g.events.some((e) => e.type === "daynight")) switches.push(g.time); });
    expect(switches.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < switches.length; i++) {
      const gap = switches[i] - switches[i - 1];
      expect(gap).toBeGreaterThanOrEqual(CONFIG.dayNight.every[0] - 0.05);
      expect(gap).toBeLessThanOrEqual(CONFIG.dayNight.every[1] + 0.05);
    }
  });
});

describe("sprint (ACTN3 muscle stat)", () => {
  function sprinting(muscle: "Sprinter" | "Endurance") {
    const g = newGame(creature("Shadepounce"), creature("Morningdrift"), Math.random, [muscle, muscle]);
    g.phase = "fight"; g.spawnIn = 1e9; g.cycleIn = 1e9; g.night = false;
    const f = g.fighters[0];
    f.x = -400; f.y = 0;
    return { g, f };
  }

  it("Sprinter: a bigger burst than Endurance, but it runs dry much sooner", () => {
    const s = sprinting("Sprinter"), e = sprinting("Endurance");
    run(s.g, 0.4, () => { s.f.intent = { x: 1, y: 0 }; s.f.sprintHeld = true; });
    run(e.g, 0.4, () => { e.f.intent = { x: 1, y: 0 }; e.f.sprintHeld = true; });
    expect(s.f.vx).toBeGreaterThan(e.f.vx);
    expect(e.f.vx).toBeGreaterThan(CONFIG.fighter.maxSpeed * 1.1);
    const dryAfter = (x: { g: Game; f: typeof s.f }) => {
      let t = 0;
      while (x.f.stamina > 0 && t < 30) { x.f.intent = { x: 0, y: t % 4 < 2 ? 1 : -1 }; x.f.sprintHeld = true; step(x.g, DT); t += DT; }
      return t;
    };
    const ts = dryAfter(sprinting("Sprinter")), te = dryAfter(sprinting("Endurance"));
    expect(te).toBeGreaterThan(ts * 3);
  });

  it("stamina refills after a rest, and a winded creature can't sprint until it recovers", () => {
    const { g, f } = sprinting("Sprinter");
    f.stamina = 0.01;
    run(g, 0.1, () => { f.intent = { x: 1, y: 0 }; f.sprintHeld = true; });
    expect(f.winded).toBe(true);
    expect(f.sprinting).toBe(false);
    run(g, CONFIG.sprint.refillDelay + 0.5, () => { f.intent = { x: 0, y: 0 }; f.sprintHeld = false; });
    expect(f.stamina).toBeGreaterThan(0.05);
    run(g, 0.05, () => { f.intent = { x: 1, y: 0 }; f.sprintHeld = true; });
    expect(f.sprinting).toBe(false); // still winded below restartAt
    run(g, 3, () => { f.intent = { x: 0, y: 0 }; f.sprintHeld = false; });
    run(g, 0.05, () => { f.intent = { x: 1, y: 0 }; f.sprintHeld = true; });
    expect(f.sprinting).toBe(true);
  });
});

describe("Keen senses", () => {
  it("the next power up is placed about a second before it appears", () => {
    const g = fight();
    g.spawnIn = CONFIG.keen.foresight + 0.5;
    run(g, 0.45);
    expect(g.pending).toBe(null);
    run(g, 0.1);
    const sensed = g.pending!;
    expect(sensed).not.toBe(null);
    expect(g.pickups).toHaveLength(0);
    run(g, CONFIG.keen.foresight);
    expect(g.pending).toBe(null);
    expect(g.pickups.map((p) => p.id)).toEqual([sensed.id]);
    expect(g.pickups[0]).toMatchObject({ x: sensed.x, y: sensed.y, kind: sensed.kind });
  });

  it("Keen creatures grab power ups from further away than Bold ones", () => {
    const reach = CONFIG.fighter.radius + CONFIG.powerUps.radius;
    const between = reach + CONFIG.keen.grabBonus / 2;
    const g = fight("Shadepounce", "Morningdrift"); // Keen vs Bold
    const [keen, bold] = g.fighters;
    g.pickups.push({ id: 7, kind: "orb", x: keen.x + between, y: 0, age: 0 }, { id: 8, kind: "orb", x: bold.x - between, y: 0, age: 0 });
    step(g, DT);
    expect(keen.charged).toBeGreaterThan(0);
    expect(bold.shield).toBe(0);
    expect(g.pickups.map((p) => p.id)).toEqual([8]);
  });
});
