// Hatchling Expedition rules played for real (scripted inputs): the gene abilities do
// what the room design (and the solver) assume, with the real speeds in config.ts.
import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config.ts";
import { creatureWithAxes } from "../src/creatures.ts";
import type { Profile } from "../src/coop/genes.ts";
import { ROOMS } from "../src/coop/rooms.ts";
import { newWorld, stepWorld, type Explorer, type World } from "../src/coop/world.ts";
import type { Muscle } from "../src/sim.ts";

const DT = 1 / 120, T = CONFIG.coop.tile;
const roomIndex = (id: string) => ROOMS.findIndex((r) => r.id === id);
function explorer(genes: Partial<Profile>) {
  const p = { flame: "Ember", time: "Dawn", senses: "Bold", spark: "Still", muscle: "Mixed", ...genes } as Profile;
  return { creature: creatureWithAxes(p), muscle: p.muscle as Muscle };
}
/** A world with the given explorers; the first one is put at tile (cx, cy). */
function at(id: string, cx: number, cy: number, ...genes: Array<Partial<Profile>>): { w: World; e: Explorer } {
  const w = newWorld(roomIndex(id), genes.map(explorer));
  w.cycleIn = 1e9; // keep it daytime unless a test changes it
  const e = w.explorers[0];
  e.x = (cx + 0.5) * T; e.y = (cy + 0.5) * T;
  return { w, e };
}
function run(w: World, seconds: number, each?: (t: number) => void): void {
  for (let t = 0; t < seconds; t += DT) { each?.(t); stepWorld(w, DT); }
}
const tileX = (e: Explorer) => Math.floor(e.x / T), tileY = (e: Explorer) => Math.floor(e.y / T);

describe("timed gate (Flame): only a Blaze dash beats it", () => {
  // Hatching Grounds: switch g at (7,8), gate G at (12,8).
  const attempt = (genes: Partial<Profile>) => {
    const { w, e } = at("hatching", 6, 8, genes);
    run(w, 2.5, (t) => {
      e.intent = { x: 1, y: 0 };
      e.sprintHeld = true;
      if (tileX(e) >= 8 && t < 1) e.actionPressed = true; // dash right after the switch
    });
    return tileX(e) > 12;
  };
  it("Blaze gets through (even with Endurance muscles)", () => {
    expect(attempt({ flame: "Blaze", muscle: "Sprinter" })).toBe(true);
    expect(attempt({ flame: "Blaze", muscle: "Endurance" })).toBe(true);
  });
  it("Ember can't, even sprinting", () => {
    for (const muscle of ["Sprinter", "Mixed", "Endurance"] as const) expect(attempt({ flame: "Ember", muscle })).toBe(false);
  });
});

describe("timed run door (Muscles): Sprinter and Mixed beat it, Endurance can't", () => {
  // Sun and Moon Crossing: switch r at (17,2), door R at (27,2).
  const attempt = (muscle: Muscle) => {
    const { w, e } = at("crossing", 17, 3, { muscle, flame: "Ember" });
    run(w, 4, (t) => { e.intent = t < 0.3 ? { x: 0, y: -1 } : { x: 1, y: 0 }; e.sprintHeld = t >= 0.3; });
    return tileX(e) > 27;
  };
  it("Sprinter yes", () => expect(attempt("Sprinter")).toBe(true));
  it("Mixed yes", () => expect(attempt("Mixed")).toBe(true));
  it("Endurance no", () => expect(attempt("Endurance")).toBe(false));
});

describe("heavy block (Muscles): Endurance and Mixed push it home, a Sprinter tires out", () => {
  // Sun and Moon Crossing: block K at (27,6) pushed up from (27,7).
  const attempt = (muscle: Muscle) => {
    const { w, e } = at("crossing", 27, 7, { muscle });
    run(w, 8, () => { e.intent = { x: 0, y: -1 }; });
    return w.things.get("K")!.open;
  };
  it("Endurance yes", () => expect(attempt("Endurance")).toBe(true));
  it("Mixed yes", () => expect(attempt("Mixed")).toBe(true));
  it("Sprinter no (the block slides back)", () => expect(attempt("Sprinter")).toBe(false));
});

describe("gene walls and helpers", () => {
  it("Keen nose finds the hidden door; Bold jaws munch the bramble; credit goes to the right player", () => {
    const { w } = at("hatching", 3, 2, { senses: "Keen" }, { senses: "Bold" });
    const [keen, bold] = w.explorers;
    bold.x = 4.5 * T; bold.y = 8.5 * T;
    const opened: string[] = [];
    run(w, 2, () => {
      keen.intent = { x: 1, y: 0 }; bold.intent = { x: 1, y: 0 };
      for (const ev of w.events) if (ev.type === "opened") opened.push(`${ev.slot}:${ev.gene}:${ev.text}`);
    });
    expect(opened).toContain("0:Keen:found a hidden door");
    expect(opened).toContain("1:Bold:munched through the bramble");
    expect(w.things.get("H")!.open && w.things.get("B")!.open).toBe(true);
  });

  it("a wild critter shoves non-Still creatures back, and a Still one calms it", () => {
    const { w, e } = at("hatching", 18, 8, { spark: "Crackling" });
    run(w, 2, () => { e.intent = { x: 1, y: 0 }; });
    expect(tileX(e)).toBeLessThan(20);
    expect(w.things.get("C")!.open).toBe(false);
    const still = at("hatching", 18, 8, { spark: "Still" });
    run(still.w, 2, () => { still.e.intent = { x: 1, y: 0 }; });
    expect(still.w.things.get("C")!.open).toBe(true);
  });

  it("sun stones hold a Dawn creature by day and drop everyone else", () => {
    const dawn = at("crossing", 5, 2, { time: "Dawn" });
    run(dawn.w, 2.5, () => { dawn.e.intent = { x: 1, y: 0 }; });
    expect(tileX(dawn.e)).toBeGreaterThan(12);
    const dusk = at("crossing", 5, 2, { time: "Dusk" });
    const fell: string[] = [];
    run(dusk.w, 1.5, () => { dusk.e.intent = { x: 1, y: 0 }; for (const ev of dusk.w.events) if (ev.type === "fell") fell.push(ev.why); });
    expect(fell).toContain("chasm");
  });

  it("a plate holds its door open only while someone stands on it", () => {
    const { w, e } = at("crossing", 30, 4, {}, {});
    stepWorld(w, DT);
    expect(w.things.get("D")!.held).toBe(true);
    e.x = 31.5 * T; e.y = 2.5 * T;
    stepWorld(w, DT);
    expect(w.things.get("D")!.held).toBe(false);
  });

  it("the final door needs every explorer on a plate at once", () => {
    const { w } = at("heart", 15, 3, {}, {}, {});
    const plates = [...w.things.get("P")!.cells];
    w.explorers.slice(0, 2).forEach((e, i) => { e.x = (plates[i][0] + 0.5) * T; e.y = (plates[i][1] + 0.5) * T; });
    w.explorers[2].x = 14.5 * T; w.explorers[2].y = 9.5 * T;
    stepWorld(w, DT);
    expect(w.things.get("X")!.open).toBe(false); // 2 of 3
    w.explorers[2].x = (plates[2][0] + 0.5) * T; w.explorers[2].y = (plates[2][1] + 0.5) * T;
    stepWorld(w, DT);
    expect(w.things.get("X")!.open).toBe(true);
  });

  it("the room is done when everyone stands on the exit", () => {
    const { w } = at("hatching", 23, 4, {}, {});
    const [a, b] = w.explorers;
    b.x = 24.5 * T; b.y = 5.5 * T;
    stepWorld(w, DT);
    expect(w.done).toBe(true);
    void a;
  });
});

describe("every timed gate and run door in every room", () => {
  // Walk from next to the switch, onto it, then along the switch's row and up/down to the door.
  const tryDoor = (roomId: string, doorId: string, genes: Partial<Profile>): boolean => {
    const ri = roomIndex(roomId), w = newWorld(ri, [explorer(genes)]);
    w.cycleIn = 1e9;
    const door = w.things.get(doorId)!, sw = w.room.things.get(door.def.via!)!.cells[0], [dx, dy] = door.cells[0];
    const e = w.explorers[0];
    const side = dx > sw[0] ? -1 : 1;
    e.x = (sw[0] + side + 0.5) * T; e.y = (sw[1] + 0.5) * T;
    const waypoints: Array<[number, number]> = [[sw[0], sw[1]], [dx, sw[1]], [dx, dy], [dx + (dx > sw[0] ? 2 : -2), dy]];
    let wp = 0, dashed = false;
    run(w, 4, () => {
      const [tx, ty] = waypoints[Math.min(wp, waypoints.length - 1)];
      const gx = (tx + 0.5) * T - e.x, gy = (ty + 0.5) * T - e.y, d = Math.hypot(gx, gy);
      if (d < 12 && wp < waypoints.length - 1) wp++;
      e.intent = d > 1 ? { x: gx / d, y: gy / d } : { x: 0, y: 0 };
      e.sprintHeld = wp >= 1;
      if (wp >= 1 && !dashed && door.def.kind === "gate") { e.actionPressed = true; dashed = true; }
    });
    return door.passers.length > 0 || Math.abs(Math.floor(e.x / T) - sw[0]) > Math.abs(dx - sw[0]);
  };
  for (const room of ROOMS) {
    for (const [id, def] of Object.entries(room.legend)) {
      if (def.kind === "gate") {
        it(`${room.id} gate ${id}: Blaze yes, Ember no`, () => {
          for (const muscle of ["Sprinter", "Mixed", "Endurance"] as const) {
            expect(tryDoor(room.id, id, { flame: "Blaze", muscle }), `Blaze ${muscle}`).toBe(true);
            expect(tryDoor(room.id, id, { flame: "Ember", muscle }), `Ember ${muscle}`).toBe(false);
          }
        });
      }
      if (def.kind === "run") {
        it(`${room.id} run door ${id}: Sprinter and Mixed yes, Endurance no`, () => {
          expect(tryDoor(room.id, id, { flame: "Ember", muscle: "Sprinter" }), "Sprinter").toBe(true);
          expect(tryDoor(room.id, id, { flame: "Ember", muscle: "Mixed" }), "Mixed").toBe(true);
          expect(tryDoor(room.id, id, { flame: "Ember", muscle: "Endurance" }), "Endurance").toBe(false);
        });
      }
    }
  }
});

describe("more abilities", () => {
  it("Ember melts the ice wall by standing next to it", () => {
    const { w, e } = at("hatching", 11, 2, { flame: "Ember" });
    run(w, CONFIG.coop.meltTime + 0.3, () => { e.intent = { x: 1, y: 0 }; });
    expect(w.things.get("I")!.open).toBe(true);
    const blaze = at("hatching", 11, 2, { flame: "Blaze" });
    run(blaze.w, 4, () => { blaze.e.intent = { x: 1, y: 0 }; });
    expect(blaze.w.things.get("I")!.open).toBe(false);
  });

  it("Crackling powers the machine at its node; Still can't", () => {
    const { w, e } = at("hatching", 18, 2, { spark: "Crackling" });
    run(w, 0.6, () => { e.intent = { x: 1, y: 0 }; });
    expect(w.things.get("Z")!.open).toBe(true);
    const still = at("hatching", 18, 2, { spark: "Still" });
    run(still.w, 0.6, () => { still.e.intent = { x: 1, y: 0 }; });
    expect(still.w.things.get("Z")!.open).toBe(false);
  });

  it("Keen sniffs out a trap field; stepping on a trap sends you back", () => {
    const { w, e } = at("burrows", 22, 3, { senses: "Keen" });
    run(w, 0.1);
    expect(w.things.get("t")!.revealed).toBe(true);
    const bold = at("burrows", 23, 3, { senses: "Bold" });
    const fell: string[] = [];
    run(bold.w, 1.5, () => { bold.e.intent = { x: 0.7, y: -0.7 }; for (const ev of bold.w.events) if (ev.type === "fell") fell.push(ev.why); });
    expect(bold.w.things.get("t")!.revealed).toBe(false);
    expect(fell).toContain("trap");
  });

  it("Still crosses the fragile bridge; anyone else cracks it and falls", () => {
    const still = at("storm", 6, 10, { spark: "Still" });
    run(still.w, 2.5, () => { still.e.intent = { x: 1, y: 0 }; });
    expect(tileX(still.e)).toBeGreaterThanOrEqual(11);
    const crack = at("storm", 6, 10, { spark: "Crackling" });
    const fell: string[] = [];
    run(crack.w, 1.5, () => { crack.e.intent = { x: 1, y: 0 }; for (const ev of crack.w.events) if (ev.type === "fell") fell.push(ev.why); });
    expect(fell).toContain("crack");
  });

  it("moon stones hold a Dusk creature at night", () => {
    const { w, e } = at("crossing", 5, 10, { time: "Dusk" });
    w.night = true; w.nightness = 1;
    run(w, 2.5, () => { e.intent = { x: 1, y: 0 }; });
    expect(tileX(e)).toBeGreaterThan(12);
  });

  it("a lever on the far side raises the bridge for everyone", () => {
    const { w, e } = at("crossing", 14, 2, {}, {});
    run(w, 0.5, () => { e.intent = { x: 0, y: -1 }; });
    expect(w.things.get("W")!.open).toBe(true);
    const other = w.explorers[1];
    other.x = 5.5 * T; other.y = 6.5 * T;
    run(w, 3, () => { other.intent = { x: 1, y: 0 }; });
    expect(tileX(other)).toBeGreaterThan(12);
  });

  it("an Ember lights the dark burrow for the whole team", () => {
    const { w, e } = at("burrows", 5, 3, { flame: "Ember" });
    run(w, 0.4, () => { e.intent = { x: 1, y: 0 }; });
    expect(w.lit.has(0)).toBe(true);
  });
});

describe("team combos in real time", () => {
  it("twilight bridge: Dawn on the sun pedestal + Dusk on the moon pedestal raises it; walk across to the gem", () => {
    const { w } = at("storm", 11, 6, { time: "Dawn" }, { time: "Dusk" });
    const [dawn, dusk] = w.explorers;
    dusk.x = 12.5 * T; dusk.y = 8.5 * T;
    stepWorld(w, DT);
    expect(w.things.get("T")!.open).toBe(true);
    expect(w.log.map((l) => l.gene)).toEqual(expect.arrayContaining(["Dawn", "Dusk"]));
    dawn.x = 12.5 * T; dawn.y = 9.5 * T;
    run(w, 1.6, () => { dawn.intent = { x: 1, y: 0 }; });
    expect(w.gems).toBe(1);
    const same = at("storm", 11, 6, { time: "Dawn" }, { time: "Dawn" });
    same.w.explorers[1].x = 12.5 * T; same.w.explorers[1].y = 8.5 * T;
    stepWorld(same.w, DT);
    expect(same.w.things.get("T")!.open).toBe(false);
  });

  it("slingshot: Endurance on the spring, Blaze on the launcher presses Attack and lands on the island", () => {
    const { w } = at("thorns", 7, 11, { flame: "Blaze", muscle: "Sprinter" }, { flame: "Ember", muscle: "Endurance" });
    const [blaze, holder] = w.explorers;
    holder.x = 7.5 * T; holder.y = 12.5 * T;
    blaze.actionPressed = true;
    run(w, CONFIG.coop.slingshot.flight + 0.1);
    expect([tileX(blaze), tileY(blaze)]).toEqual([10, 11]);
    expect(blaze.falling).toBe(0);
    run(w, 0.3, () => { blaze.intent = { x: 1, y: 0 }; }); // one tile right: the gem (one more is the pit)
    expect(w.gems).toBe(1);
    expect(blaze.falling).toBe(0);
    run(w, 0.5, () => { blaze.intent = { x: 0, y: -1 }; });
    expect(w.things.get("Q")!.open).toBe(true); // the island lever raises the bridge back
  });

  it("slingshot needs the spring held: alone, the Blaze just dashes", () => {
    const { w } = at("thorns", 7, 11, { flame: "Blaze", muscle: "Sprinter" }, { flame: "Ember", muscle: "Endurance" });
    w.explorers[0].actionPressed = true;
    run(w, 0.1);
    expect(w.explorers[0].flight).toBe(null);
  });
});

describe("Did you know? facts", () => {
  it("use worldwide figures only and cover both versions of a gene", async () => {
    const { fact, factsForRoom, WORLDWIDE } = await import("../src/coop/facts.ts");
    expect(WORLDWIDE.Blaze + WORLDWIDE.Ember).toBe(100);
    expect(WORLDWIDE.Sprinter + WORLDWIDE.Mixed + WORLDWIDE.Endurance).toBe(100);
    expect(fact("Keen")).toMatch(/^About 73 in 100 people worldwide/);
    expect(WORLDWIDE.Dawn + WORLDWIDE.Dusk).toBe(100);
    expect(WORLDWIDE.Keen + WORLDWIDE.Bold).toBe(100);
    const facts = factsForRoom(0, ["Keen", "Bold"], []);
    expect(facts).toHaveLength(2);
    for (const f of facts) expect(f).not.toMatch(/AFR|EUR|EAS|SAS|AMR|Africa|Europe|Asia/);
  });
});
