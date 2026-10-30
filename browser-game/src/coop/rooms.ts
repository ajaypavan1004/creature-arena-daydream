// Hatchling Expedition rooms. Each room is a tile map (one character per tile) plus a
// legend for the letters: every letter is one "thing" (a bramble wall, a hidden door,
// a lever...), made of all the tiles that carry that letter.
//
// Terrain: # wall   . floor   ~ chasm (fall in and you're back at the start)
//          S start  E exit (everyone must stand on the exit to finish the room)
//
// Design rule: every obstacle on the way to the exit has two routes, one for each
// version of a gene, so any team can finish. Bonus gems may sit behind a single gene.
// tests/coop_solver.test.ts checks every room against every possible team.

export type ThingKind =
  | "bramble" | "hidden" | "ice" | "electric" | "critter" | "gate" | "run" | "block"
  | "sun" | "moon" | "fragile" | "bridge" | "traps" | "lever" | "plate" | "door" | "plates" | "key" | "gem" | "node" | "switch"
  // Team combos: two different genes on two different creatures, together.
  | "sunpad" | "moonpad" | "launcher" | "spring" | "landing";

export interface ThingDef {
  kind: ThingKind;
  /** lever/plate/plates/key/sunpad/moonpad: the letter of the thing it opens; launcher: where it lands. */
  opens?: string;
  /** electric: its power node; gate/run: its switch; launcher: its spring (a letter). */
  via?: string;
  /** block: push direction (the block slides this way into a notch). */
  dir?: [number, number];
  /** Shown the first time a player comes near (tutorial rooms). */
  hint?: string;
  /** Gems: a bonus, never needed to finish. */
  bonus?: boolean;
}

export interface RoomDef {
  id: string;
  name: string;
  intro: string;
  map: string[];
  legend: Record<string, ThingDef>;
  /** Dark areas (x0, y0, x1, y1 inclusive): only an Ember's glow lights them. */
  dark?: Array<[number, number, number, number]>;
  /** Show the hints for this room. */
  tutorial?: boolean;
}

export const ROOMS: RoomDef[] = [
  {
    id: "hatching",
    name: "1. Hatching Grounds",
    intro: "Each wall has two ways through. Your genes decide which one you can open.",
    tutorial: true,
    map: [
      "##########################",
      "#....#......#.......#....#",
      "#....H......I......nZ....#",
      "#....#......#.......#....#",
      "#.SS.#......#.......#..EE#",
      "#.SS.#......#.......#..EE#",
      "#....#......#.......#....#",
      "#....#......#.......#....#",
      "#....B.g....G.......C....#",
      "#....#......#l......#....#",
      "##########################",
    ],
    legend: {
      H: { kind: "hidden", hint: "Keen creatures sniff out hidden doors. Walk close to the cracked wall." },
      B: { kind: "bramble", hint: "Bold creatures can munch through bitter bramble. Push against it." },
      I: { kind: "ice", hint: "Ember creatures glow warm. Stand next to the ice to melt it." },
      G: { kind: "gate", via: "g", hint: "Blaze creatures: step on the switch, then dash (attack key) through before the gate shuts." },
      g: { kind: "switch" },
      l: { kind: "lever", opens: "G", hint: "Levers open the way for the whole team." },
      Z: { kind: "electric", via: "n", hint: "Crackling creatures can power the machine. Touch the glowing node." },
      n: { kind: "node" },
      C: { kind: "critter", hint: "A wild critter! Still creatures calm it down. Others get pushed back." },
    },
  },
  {
    id: "crossing",
    name: "2. Sun and Moon Crossing",
    intro: "Day and night take turns. Dawn creatures cross on sun stones by day, Dusk creatures on moon stones at night.",
    tutorial: true,
    map: [
      "##################################",
      "#.....~~~~~~~.a.#..........##v...#",
      "#.....uuuuuuu...#r.........R.....#",
      "#.SS..~~~~~~~...#..........##....#",
      "#.SS..~~~~~~~...#.........#.#.p..#",
      "#.....~~~~~~~...#.........#.#....#",
      "#.....WWWWWWW..............K.....#",
      "#.....~~~~~~~...#...........#....#",
      "#.....~~~~~~~...#..........####D##",
      "#.....~~~~~~~...#..........##....#",
      "#.....mmmmmmm...#..........##q...#",
      "#.....~~~~~~~.b.#..........##..EE#",
      "##################################",
    ],
    legend: {
      u: { kind: "sun", hint: "Sun stones: only Dawn creatures can stand on them, and only by day." },
      m: { kind: "moon", hint: "Moon stones: only Dusk creatures can stand on them, and only at night." },
      W: { kind: "bridge" },
      a: { kind: "lever", opens: "W", hint: "Pull a lever on the far side to raise the bridge for everyone." },
      b: { kind: "lever", opens: "W" },
      R: { kind: "run", via: "r", hint: "Sprinters and Mixed: step on the switch, then sprint (hold Sprint) to the door before it shuts." },
      r: { kind: "switch" },
      v: { kind: "lever", opens: "R" },
      K: { kind: "block", dir: [0, -1], hint: "Endurance and Mixed creatures can push the heavy block all the way up into its slot." },
      D: { kind: "door" },
      p: { kind: "plate", opens: "D", hint: "One creature holds the plate while the others go through." },
      q: { kind: "lever", opens: "D" },
    },
  },
  {
    id: "burrows",
    name: "3. Dark Burrows",
    intro: "The burrow is pitch black. Ember glow lights the way, or a Blaze can dash the long way round.",
    map: [
      "################################",
      "#....#..~.~...~.#......#t.t..#.#",
      "#....#..~.~...~.#....k.#t.tt.#.#",
      "#.........~.~..................#",
      "#....#..~...~.~.#......#.tt.t#.#",
      "#.SS.#..~...~.~.#......#.t..t#.#",
      "#.SS.############......#######E#",
      "#....############......#######E#",
      "#....############......#.....#.#",
      "#....#.....#.l.........B.......#",
      "#.....g....G...........#.....#.#",
      "#....#.....#....##I##V########.#",
      "#....#############x##y########.#",
      "################################",
    ],
    dark: [[6, 1, 15, 5]],
    legend: {
      G: { kind: "gate", via: "g" },
      g: { kind: "switch" },
      l: { kind: "lever", opens: "G" },
      t: { kind: "traps" },
      B: { kind: "bramble" },
      I: { kind: "ice" },
      x: { kind: "gem", bonus: true },
      k: { kind: "key", opens: "V" },
      V: { kind: "door" },
      y: { kind: "gem", bonus: true },
    },
  },
  {
    id: "storm",
    name: "4. Storm Works",
    intro: "A broken machine and a crumbling bridge. Then the great chasm, where day and night decide who crosses.",
    map: [
      "################################",
      "#.....#......~~~~~~~.a...#######",
      "#....nZ......~~~~~~~.....Cx#####",
      "#.....#......uuuuuuu.....#######",
      "#.....#####..~~~~~~~.....#######",
      "#.....#####..~~~~~~~...........#",
      "#.SS..#####o.~~~~~~~..........E#",
      "#.SS..#####..MMMMMMM..........E#",
      "#.....#####.q~~~~~~~..........E#",
      "#.....#~~~~..TTTzTTT...........#",
      "#......ffff..~~~~~~~.....#######",
      "#.....#WWWW.wmmmmmmm.....#######",
      "#.....#######~~~~~~~.b..NYy#####",
      "################################",
    ],
    legend: {
      Z: { kind: "electric", via: "n" },
      n: { kind: "node" },
      f: { kind: "fragile" },
      W: { kind: "bridge" },
      w: { kind: "lever", opens: "W" },
      u: { kind: "sun" },
      m: { kind: "moon" },
      M: { kind: "bridge" },
      a: { kind: "lever", opens: "M" },
      b: { kind: "lever", opens: "M" },
      C: { kind: "critter" },
      x: { kind: "gem", bonus: true },
      N: { kind: "node" },
      Y: { kind: "electric", via: "N" },
      y: { kind: "gem", bonus: true },
      o: { kind: "sunpad", opens: "T", hint: "Twilight bridge: a Dawn creature on the sun pedestal and a Dusk creature on the moon pedestal, both at once." },
      q: { kind: "moonpad", opens: "T" },
      T: { kind: "bridge" },
      z: { kind: "gem", bonus: true },
    },
  },
  {
    id: "thorns",
    name: "5. Thorn Sprint",
    intro: "Three walls in a row. Mix your muscles, noses and flames to get through, and look for secret alcoves.",
    map: [
      "####################################",
      "#..............##.....#.......#....#",
      "#....r.........R......#.......I....#",
      "#..............##.....H.......#....#",
      "#..............##.....#...#h..#....#",
      "#..............##.....#...#x#.#....#",
      "#.SS...........##.....#...###.#...E#",
      "#.SS..........#.#.....#...#j..#...E#",
      "#.............#.#.....#...#y#.#....#",
      "#.......~~~~~..K......#....#..#....#",
      "#.......~~.v~...#.....B..g....G....#",
      "#......LQQAz~..##.....#.......#....#",
      "#......P~~~~~..##.....#.......#....#",
      "####################################",
    ],
    legend: {
      R: { kind: "run", via: "r" },
      r: { kind: "switch" },
      K: { kind: "block", dir: [0, -1] },
      H: { kind: "hidden" },
      B: { kind: "bramble" },
      h: { kind: "hidden" },
      x: { kind: "gem", bonus: true },
      j: { kind: "bramble" },
      y: { kind: "gem", bonus: true },
      I: { kind: "ice" },
      G: { kind: "gate", via: "g" },
      g: { kind: "switch" },
      l: { kind: "lever", opens: "G" },
      L: { kind: "launcher", via: "P", opens: "A", hint: "Slingshot: an Endurance creature stands on the spring while a Blaze on the launcher presses Attack." },
      P: { kind: "spring" },
      A: { kind: "landing" },
      z: { kind: "gem", bonus: true },
      v: { kind: "lever", opens: "Q" },
      Q: { kind: "bridge" },
    },
  },
  {
    id: "heart",
    name: "6. Heart of the Nest",
    intro: "Four chambers, four plates. The nest opens only when every one of you stands on a plate at once.",
    map: [
      "###############################",
      "####################EEE########",
      "############.......#...########",
      "############...P...#...########",
      "############.......#...########",
      "#############H###B##X##########",
      "##########...........#.....####",
      "#####....#...........I.....####",
      "#####....Zn..SS......#.....####",
      "#####.P..#...SS......#....P####",
      "#####....C...........#.....####",
      "#####....#......g....G.l...####",
      "##########.r.........#.....####",
      "###############K###R###########",
      "##############.......##########",
      "##############...P...##########",
      "##############.......##########",
      "###############################",
      "###############################",
    ],
    legend: {
      H: { kind: "hidden" },
      B: { kind: "bramble" },
      Z: { kind: "electric", via: "n" },
      n: { kind: "node" },
      C: { kind: "critter" },
      I: { kind: "ice" },
      G: { kind: "gate", via: "g" },
      g: { kind: "switch" },
      l: { kind: "lever", opens: "G" },
      R: { kind: "run", via: "r" },
      r: { kind: "switch" },
      K: { kind: "block", dir: [0, 1] },
      P: { kind: "plates", opens: "X", hint: "Everyone onto a plate at the same time!" },
      X: { kind: "door" },
    },
  },
];
