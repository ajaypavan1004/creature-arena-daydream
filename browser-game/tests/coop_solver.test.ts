// Every Hatchling Expedition room must be finishable by ANY team of 2 to 4 explorers.
// A room only looks at some genes, so teams are grouped by the genes the room uses:
// checking one team per group covers every possible team exactly.
import { describe, expect, it } from "vitest";
import { allProfiles, type Profile } from "../src/coop/genes.ts";
import { ROOMS, type ThingKind } from "../src/coop/rooms.ts";
import { parseRoom, solve } from "../src/coop/solver.ts";

const USES: Partial<Record<ThingKind, keyof Profile>> = {
  bramble: "senses", hidden: "senses", traps: "senses", key: "senses",
  ice: "flame", gate: "flame",
  electric: "spark", critter: "spark", fragile: "spark",
  sun: "time", moon: "time",
  run: "muscle", block: "muscle",
};

function genesUsed(roomIndex: number): Array<keyof Profile> {
  const room = ROOMS[roomIndex], used = new Set<keyof Profile>();
  for (const def of Object.values(room.legend)) if (USES[def.kind]) used.add(USES[def.kind]!);
  if (room.dark?.length) used.add("flame");
  return [...used];
}

/** One profile per combination of the genes this room uses (the rest fixed). */
function profilesFor(genes: Array<keyof Profile>): Profile[] {
  const seen = new Map<string, Profile>();
  for (const p of allProfiles()) {
    const sig = genes.map((g) => p[g]).join("|");
    if (!seen.has(sig)) seen.set(sig, p);
  }
  return [...seen.values()];
}

function* multisets<T>(items: T[], n: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === n) { yield acc; return; }
  for (let i = start; i < items.length; i++) yield* multisets(items, n, i, [...acc, items[i]]);
}

describe("Hatchling Expedition: every room works for every team", () => {
  ROOMS.forEach((room, ri) => {
    it(`${room.name}: all teams of 2, 3 and 4 can finish`, () => {
      const parsed = parseRoom(room), kinds = profilesFor(genesUsed(ri));
      let teams = 0;
      for (const size of [2, 3, 4]) {
        for (const team of multisets(kinds, size)) {
          teams++;
          const r = solve(parsed, team);
          if (!r.solved) throw new Error(`${room.id}: team ${JSON.stringify(team)} can't finish (at exit: ${r.atExit})`);
        }
      }
      expect(teams).toBeGreaterThan(0);
    }, 120_000);

    it(`${room.name}: no way through without gene powers (no accidental shortcuts)`, () => {
      // A made-up explorer with none of the gene versions: only levers, plates and
      // doors opened by others can help it, so a team of these must get stuck.
      const nobody = { flame: "-", time: "-", senses: "-", spark: "-", muscle: "-" } as unknown as Profile;
      expect(solve(parseRoom(room), [nobody, nobody]).solved).toBe(false);
    });
  });

  it("each gene-wall can be opened by exactly the gene it belongs to", () => {
    const parsed = parseRoom(ROOMS[0]);
    const keenOnly = allProfiles().find((p) => p.senses === "Keen" && p.flame === "Blaze" && p.spark === "Crackling")!;
    const r = solve(parsed, [keenOnly, keenOnly]);
    expect(r.opened.get("H")).toBe("Keen");
    expect(r.opened.has("B")).toBe(false); // nobody Bold
    expect(r.opened.get("Z")).toBe("Crackling");
    expect(r.opened.has("C")).toBe(false); // nobody Still
  });

  it("rewards a mixed team: both versions of a gene find both bonus gems", () => {
    const ri = ROOMS.findIndex((r) => r.id === "thorns"), parsed = parseRoom(ROOMS[ri]);
    const keen = allProfiles().find((p) => p.senses === "Keen")!, bold = allProfiles().find((p) => p.senses === "Bold")!;
    expect(solve(parsed, [keen, keen]).gems).toBe(1);
    expect(solve(parsed, [bold, bold]).gems).toBe(1);
    expect(solve(parsed, [keen, bold]).gems).toBe(2);
  });
});

describe("team combos (bonus only)", () => {
  const P = (g: Partial<Profile>) => ({ ...allProfiles()[0], ...g }) as Profile;
  it("twilight bridge: needs a Dawn creature and a different Dusk creature together", () => {
    const parsed = parseRoom(ROOMS.find((r) => r.id === "storm")!);
    const dawnDusk = solve(parsed, [P({ time: "Dawn" }), P({ time: "Dusk" })]);
    expect(dawnDusk.opened.has("T")).toBe(true);
    expect(solve(parsed, [P({ time: "Dawn" }), P({ time: "Dawn" })]).opened.has("T")).toBe(false);
    expect(solve(parsed, [P({ time: "Dusk" }), P({ time: "Dusk" })]).opened.has("T")).toBe(false);
  });
  it("slingshot: a Blaze flies to the gem island only while another creature with Endurance holds the spring", () => {
    const parsed = parseRoom(ROOMS.find((r) => r.id === "thorns")!);
    const gems = (team: Profile[]) => solve(parsed, team).opened.has("Q");
    expect(gems([P({ flame: "Blaze", muscle: "Sprinter" }), P({ flame: "Ember", muscle: "Endurance" })])).toBe(true);
    expect(gems([P({ flame: "Blaze", muscle: "Endurance" }), P({ flame: "Ember", muscle: "Sprinter" })])).toBe(false); // can't hold your own spring
    expect(gems([P({ flame: "Ember", muscle: "Endurance" }), P({ flame: "Ember", muscle: "Endurance" })])).toBe(false);
  });
});
