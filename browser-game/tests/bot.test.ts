import { describe, expect, it } from "vitest";
import { Bot } from "../src/bot.ts";
import { CONFIG } from "../src/config.ts";
import { creature } from "../src/creatures.ts";
import { newGame, step, type Game, type PowerKind } from "../src/sim.ts";

const DT = 1 / 120;
/** Bot (slot 1) vs a player standing still at the far side, with one power up in between. */
function setup(botName: string, kind: PowerKind): { g: Game; bot: Bot; picked: () => boolean } {
  const g = newGame(creature("Starmane"), creature(botName), mulberry(3));
  g.phase = "fight"; g.spawnIn = 1e9; g.cycleIn = 1e9; g.night = false; g.nightness = 0;
  const [p, b] = g.fighters;
  p.x = -380; p.y = 0; b.x = 380; b.y = 0;
  g.pickups.push({ id: 1, kind, x: 0, y: 0, age: 0 });
  const bot = new Bot(mulberry(5));
  let got = false;
  return {
    g, bot,
    picked: () => {
      for (let t = 0; t < 6; t += DT) {
        g.pickups.forEach((pk) => (pk.age = 0));
        bot.think(b, p, DT, g);
        step(g, DT);
        if (g.events.some((e) => e.type === "power" && e.slot === 1)) got = true;
      }
      return got;
    },
  };
}

describe("computer opponent and genes", () => {
  it("an Ember bot walks around coffee; a Blaze bot goes for it", () => {
    expect(setup("Shadepounce", "coffee").picked()).toBe(false); // Ember: jitters
    expect(setup("Moonwhisker", "coffee").picked()).toBe(true); // Blaze: boost
  });

  it("a Keen bot walks around bitter greens; a hurt Bold bot goes for it", () => {
    expect(setup("Shadepounce", "greens").picked()).toBe(false); // Keen: bitter
    const s = setup("Morningdrift", "greens"); // Bold
    s.g.fighters[1].hp = 40;
    expect(s.picked()).toBe(true);
  });

  it("every bot goes for an energy orb", () => {
    expect(setup("Shadepounce", "orb").picked()).toBe(true);
    expect(setup("Morningdrift", "orb").picked()).toBe(true);
  });

  it("still reaches and fights the player around a harmful power up", () => {
    const s = setup("Shadepounce", "coffee");
    s.picked();
    const [p] = s.g.fighters;
    expect(p.hp).toBeLessThan(CONFIG.fighter.maxHp);
  });
});

function mulberry(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("Keen computer", () => {
  it("heads for a power up it senses before it appears", () => {
    const g = newGame(creature("Starmane"), creature("Shadepounce"), mulberry(2)); // the computer is Keen
    g.phase = "fight"; g.cycleIn = 1e9; g.night = false;
    const [p, b] = g.fighters;
    p.x = -380; b.x = 380; b.y = 0;
    g.spawnIn = CONFIG.keen.foresight;
    g.pending = { id: 50, kind: "orb", x: 380, y: -300, age: -1 };
    const bot = new Bot(mulberry(4));
    bot.think(b, p, DT, g);
    expect(bot.target?.id).toBe(50);
    expect(b.intent.y).toBeLessThan(-0.5);
  });
});
