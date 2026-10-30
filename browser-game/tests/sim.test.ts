import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config.ts";
import { CREATURES, creature } from "../src/creatures.ts";
import { newGame, step, type Game } from "../src/sim.ts";

const DT = 1 / 120;
function fight(): Game {
  const g = newGame(creature("Shadepounce"), creature("Morningdrift"));
  g.phase = "fight"; g.night = false; g.nightness = 0;
  return g;
}
function run(g: Game, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) step(g, DT);
}

describe("creatures", () => {
  it("has all 16, each with art, and every gene combination exactly once", () => {
    expect(CREATURES).toHaveLength(16);
    const combos = new Set(CREATURES.map((c) => `${c.flame}${c.time}${c.senses}${c.spark}`));
    expect(combos.size).toBe(16);
    const art = Object.keys(import.meta.glob("../public/creatures/*.webp")).map((p) => p.split("/").pop()).sort();
    expect(art).toEqual(CREATURES.map((c) => `${c.name}.webp`).sort());
    expect(creature("Shadepounce")).toMatchObject({ flame: "Ember", time: "Dusk", senses: "Keen", spark: "Crackling" });
    expect(creature("Morningdrift")).toMatchObject({ flame: "Blaze", time: "Dawn", senses: "Bold", spark: "Still" });
  });
});

describe("combat", () => {
  it("a swing in range hits once, with knockback", () => {
    const g = fight(), [a, b] = g.fighters;
    a.x = 0; b.x = CONFIG.attack.range - 20; a.y = b.y = 0;
    a.attackPressed = true;
    run(g, 0.3);
    expect(b.hp).toBe(CONFIG.fighter.maxHp - CONFIG.attack.damage);
    expect(b.x).toBeGreaterThan(CONFIG.attack.range - 20);
  });

  it("a swing out of range misses, and cooldown limits attacks", () => {
    const g = fight(), [a, b] = g.fighters;
    a.x = -200; b.x = 200;
    a.attackPressed = true; step(g, DT);
    a.attackPressed = true; step(g, DT);
    run(g, 0.3);
    expect(b.hp).toBe(CONFIG.fighter.maxHp);
    expect(a.cooldown).toBeGreaterThan(0);
  });

  it("no hits during the countdown", () => {
    const g = newGame(creature("Shadepounce"), creature("Morningdrift")), [a, b] = g.fighters;
    a.x = 0; b.x = 80;
    a.attackPressed = true;
    run(g, 0.3);
    expect(b.hp).toBe(CONFIG.fighter.maxHp);
  });

  it("reaching zero health ends the match with a winner", () => {
    const g = fight(), [a, b] = g.fighters;
    b.hp = CONFIG.attack.damage;
    a.x = 0; b.x = 90;
    a.attackPressed = true;
    run(g, 0.3);
    expect(g.phase).toBe("ko");
    expect(g.winner).toBe(0);
    run(g, CONFIG.match.koPause + 0.1);
    expect(g.phase).toBe("over");
  });

  it("creatures stay inside the ring and never overlap", () => {
    const g = fight(), [a, b] = g.fighters;
    a.intent = { x: 1, y: 0 };
    for (let t = 0; t < 4; t += DT) { a.intent = { x: 1, y: 0 }; b.intent = { x: -1, y: 0 }; step(g, DT); }
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(CONFIG.fighter.radius * 2 - 0.01);
    for (let t = 0; t < 4; t += DT) { a.intent = { x: 1, y: -1 }; step(g, DT); }
    expect(Math.hypot(a.x, a.y)).toBeLessThanOrEqual(CONFIG.arena.radius - CONFIG.fighter.radius + 0.01);
  });
});
