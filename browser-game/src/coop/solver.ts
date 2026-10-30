// Can this team finish this room? A logical model of the room rules, used by the tests
// to check every room against every possible team (and to show which genes opened what).
// It is deliberately cautious: anything that needs a gene is only counted as passable
// when a team member with that gene can actually get there.
//
// The timing-based rules (a Blaze dash beating a closing gate, a Sprinter beating a timed
// run, an Endurance creature pushing a block all the way) are checked separately against
// the real speeds and stamina in config.ts (tests/coop_world.test.ts).
import { has, type GeneOption, type Profile } from "./genes.ts";
import type { RoomDef, ThingDef, ThingKind } from "./rooms.ts";

export interface Thing { id: string; def: ThingDef; cells: Array<[number, number]> }

export interface ParsedRoom {
  w: number; h: number;
  /** Terrain under everything: "#", ".", "~", "S" or "E". */
  terrain: string[][];
  /** Which thing (letter) is on each tile, if any. */
  at: Array<Array<string | null>>;
  things: Map<string, Thing>;
  starts: Array<[number, number]>;
  exits: Array<[number, number]>;
  dark: Array<[number, number, number, number]>;
}

/** Things that block their tiles until opened. */
export const WALLS: ReadonlySet<ThingKind> = new Set(["bramble", "hidden", "ice", "electric", "critter", "gate", "run", "block", "door"]);
/** Things that sit over a chasm. */
const OVER_CHASM: ReadonlySet<ThingKind> = new Set(["sun", "moon", "fragile", "bridge"]);

export function parseRoom(room: RoomDef): ParsedRoom {
  const h = room.map.length, w = room.map[0].length;
  const terrain: string[][] = [], at: Array<Array<string | null>> = [];
  const things = new Map<string, Thing>();
  const starts: Array<[number, number]> = [], exits: Array<[number, number]> = [];
  room.map.forEach((row, y) => {
    if (row.length !== w) throw new Error(`${room.id}: row ${y} is ${row.length} wide, expected ${w}`);
    terrain.push([]); at.push([]);
    [...row].forEach((ch, x) => {
      const def = room.legend[ch];
      if (def) {
        const t = things.get(ch) ?? { id: ch, def, cells: [] };
        t.cells.push([x, y]);
        things.set(ch, t);
        terrain[y].push(OVER_CHASM.has(def.kind) ? "~" : ".");
        at[y].push(ch);
      } else {
        if (!"#.~SE".includes(ch)) throw new Error(`${room.id}: unknown tile "${ch}" at ${x},${y}`);
        terrain[y].push(ch);
        at[y].push(null);
        if (ch === "S") starts.push([x, y]);
        if (ch === "E") exits.push([x, y]);
      }
    });
  });
  for (const t of things.values()) {
    for (const ref of [t.def.opens, t.def.via]) if (ref && !things.has(ref)) throw new Error(`${room.id}: ${t.id} refers to missing "${ref}"`);
  }
  return { w, h, terrain, at, things, starts, exits, dark: room.dark ?? [] };
}

const key = (x: number, y: number) => y * 1000 + x;
const N4: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Cells a block slides into (its notch), and the cell its pusher stands on. */
export function blockGeometry(t: Thing): { from: [number, number]; to: [number, number]; push: [number, number] } {
  const [x, y] = t.cells[0], [dx, dy] = t.def.dir!;
  return { from: [x, y], to: [x + 2 * dx, y + 2 * dy], push: [x - dx, y - dy] };
}

export interface SolveResult {
  solved: boolean;
  /** Thing id -> the gene option that opened it (or "team" for levers, plates, keys). */
  opened: Map<string, GeneOption | "team">;
  gems: number;
  /** Which players can reach the exit. */
  atExit: boolean[];
}

export function solve(room: ParsedRoom, team: Profile[]): SolveResult {
  const opened = new Map<string, GeneOption | "team">();
  const darkLit = new Set<number>();
  let reach: Array<Set<number>> = team.map(() => new Set());
  const inDark = (x: number, y: number) => room.dark.findIndex(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);

  const trapFields = [...room.things.values()].filter((t) => t.def.kind === "traps").map((t) => ({
    id: t.id, x0: Math.min(...t.cells.map((c) => c[0])), x1: Math.max(...t.cells.map((c) => c[0])),
    y0: Math.min(...t.cells.map((c) => c[1])), y1: Math.max(...t.cells.map((c) => c[1])),
  }));
  const passable = (x: number, y: number, p: number): boolean => {
    if (x < 0 || y < 0 || x >= room.w || y >= room.h) return false;
    const me = team[p], id = room.at[y][x], terrain = room.terrain[y][x];
    if (terrain === "#") return false;
    // An unrevealed trap field: without a Keen nose nobody knows which tiles are safe.
    if (trapFields.some((f) => !opened.has(f.id) && x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1)) return false;
    const d = inDark(x, y);
    if (d >= 0 && !has(me, "Ember") && !darkLit.has(d)) return false; // can't see the way
    if (id) {
      const t = room.things.get(id)!, kind = t.def.kind;
      if (kind === "sun") return has(me, "Dawn");
      if (kind === "moon") return has(me, "Dusk");
      if (kind === "fragile") return has(me, "Still") || opened.has(id);
      if (kind === "bridge") return opened.has(id);
      if (kind === "traps") return false; // a spike trap: never a way through
      if (WALLS.has(kind)) {
        if (opened.has(id)) return !(kind === "block" && blockGeometry(t).to[0] === x && blockGeometry(t).to[1] === y);
        const sw = t.def.via ? room.things.get(t.def.via)!.cells[0] : null;
        if (kind === "gate") return has(me, "Blaze") && !!sw && reach[p].has(key(...sw));
        if (kind === "run") return (has(me, "Sprinter") || has(me, "Mixed")) && !!sw && reach[p].has(key(...sw));
        if (kind === "door") {
          // Held open by a plate while someone else stands on it.
          return [...room.things.values()].some((pl) => pl.def.kind === "plate" && pl.def.opens === id
            && team.some((_, q) => q !== p && reach[q].has(key(...pl.cells[0]))));
        }
        return false;
      }
    }
    return terrain !== "~";
  };

  const bfs = (p: number): Set<number> => {
    const seen = new Set<number>(), q: Array<[number, number]> = [];
    for (const s of room.starts) { seen.add(key(...s)); q.push(s); }
    for (let qi = 0; qi < q.length; qi++) {
      const [x, y] = q[qi];
      // Slingshot: a Blaze on the launcher flies to the landing spot while another
      // creature with Endurance holds the spring.
      const here = room.at[y][x] ? room.things.get(room.at[y][x]!)! : null;
      if (here?.def.kind === "launcher" && has(team[p], "Blaze")) {
        const spring = room.things.get(here.def.via!)!.cells[0];
        if (team.some((pr, j) => j !== p && has(pr, "Endurance") && reach[j].has(key(...spring)))) {
          for (const c of room.things.get(here.def.opens!)!.cells) if (!seen.has(key(...c))) { seen.add(key(...c)); q.push(c); }
        }
      }
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy, k = key(nx, ny);
        if (!seen.has(k) && passable(nx, ny, p)) { seen.add(k); q.push([nx, ny]); }
      }
    }
    return seen;
  };

  // Each thing's trigger cells (next to it, within 2, on it), worked out once.
  const zones = new Map<string, { adj: number[]; within2: number[]; on: number[] }>();
  for (const t of room.things.values()) {
    const adj = new Set<number>(), w2 = new Set<number>(), on = new Set<number>();
    for (const [x, y] of t.cells) {
      on.add(key(x, y));
      for (const [dx, dy] of N4) adj.add(key(x + dx, y + dy));
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (x + dx >= 0 && y + dy >= 0) w2.add(key(x + dx, y + dy));
    }
    zones.set(t.id, { adj: [...adj], within2: [...w2], on: [...on] });
  }
  const someone = (option: GeneOption | null, cells: number[]) =>
    team.findIndex((pr, i) => (!option || has(pr, option)) && cells.some((k) => reach[i].has(k)));

  for (let iter = 0; iter < 200; iter++) {
    reach = team.map((_, i) => bfs(i));
    const before = opened.size + darkLit.size;
    room.dark.forEach(([x0, y0, x1, y1], d) => {
      const cells: number[] = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push(key(x, y));
      if (someone("Ember", cells) >= 0) darkLit.add(d);
    });
    for (const t of room.things.values()) {
      if (opened.has(t.id)) continue;
      const { adj, within2, on } = zones.get(t.id)!;
      const open = (by: GeneOption | "team", target = t.id) => { if (!opened.has(target)) opened.set(target, by); opened.set(t.id, opened.get(t.id) ?? by); };
      switch (t.def.kind) {
        case "bramble": if (someone("Bold", adj) >= 0) open("Bold"); break;
        case "hidden": if (someone("Keen", within2) >= 0) open("Keen"); break;
        case "traps": if (someone("Keen", within2) >= 0) open("Keen"); break;
        case "ice": if (someone("Ember", adj) >= 0) open("Ember"); break;
        case "critter": if (someone("Still", within2) >= 0) open("Still"); break;
        case "electric": if (someone("Crackling", zones.get(t.def.via!)!.on) >= 0) open("Crackling"); break;
        case "block": {
          const { push } = blockGeometry(t);
          const pusher = team.find((pr, i) => (has(pr, "Endurance") || has(pr, "Mixed")) && reach[i].has(key(...push)));
          if (pusher) open(pusher.muscle);
          break;
        }
        case "lever": if (someone(null, on) >= 0) open("team", t.def.opens!); break;
        case "sunpad": {
          // Twilight bridge: a Dawn creature on the sun pedestal and a different, Dusk
          // creature on the moon pedestal, together.
          const moon = [...room.things.values()].find((m) => m.def.kind === "moonpad" && m.def.opens === t.def.opens)!;
          const moonCells = zones.get(moon.id)!.on;
          const pair = team.some((a, i) => has(a, "Dawn") && on.some((k) => reach[i].has(k))
            && team.some((b, j) => j !== i && has(b, "Dusk") && moonCells.some((k) => reach[j].has(k))));
          if (pair) open("team", t.def.opens!);
          break;
        }
        case "key": if (someone("Keen", within2) >= 0 && someone(null, on) >= 0) open("Keen", t.def.opens!); break;
        case "plates": {
          const need = Math.min(team.length, t.cells.length);
          const standing = team.filter((_, i) => t.cells.some((c) => reach[i].has(key(...c)))).length;
          if (standing >= need) open("team", t.def.opens!);
          break;
        }
        default: break;
      }
    }
    // Personal passes (gates, timed runs, plate doors, platforms) change with the others'
    // reach, so keep going until nothing new opens and nobody reaches anywhere new.
    if (opened.size + darkLit.size === before) {
      const sizes = reach.reduce((n, r) => n + r.size, 0);
      reach = team.map((_, i) => bfs(i));
      if (reach.reduce((n, r) => n + r.size, 0) === sizes) break;
    }
  }
  const gems = [...room.things.values()].filter((t) => t.def.kind === "gem" && team.some((_, i) => t.cells.some((c) => reach[i].has(key(...c))))).length;
  const atExit = team.map((_, i) => room.exits.some((e) => reach[i].has(key(...e))));
  return { solved: atExit.every(Boolean), opened, gems, atExit };
}
