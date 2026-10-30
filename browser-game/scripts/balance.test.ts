// Balance check, run by hand:
//   BALANCE=1 npx vitest run --silent=false              (prints the tables)
//   BALANCE=1 BALANCE_OUT=docs/balance_after.md npx vitest run   (also saves them)
// Computer vs computer, every creature with every sprint type against every other,
// each pairing played BALANCE_REPEATS times from both sides, with power ups, day and
// night and sprint all on. Reports win rates by creature, by sprint type and by gene.
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { Bot } from "../src/bot.ts";
import { CONFIG } from "../src/config.ts";
import { CREATURES, type Creature } from "../src/creatures.ts";
import { MUSCLES, newGame, step, type Muscle } from "../src/sim.ts";

const REPEATS = Number(process.env.BALANCE_REPEATS ?? 2);
const DT = 1 / 120, MAX_T = 180;

interface Entry { c: Creature; m: Muscle }
const tally = new Map<string, { w: number; n: number }>();
const add = (key: string, won: boolean) => {
  const t = tally.get(key) ?? { w: 0, n: 0 };
  t.n++; if (won) t.w++;
  tally.set(key, t);
};
const rate = (key: string) => { const t = tally.get(key); return t && t.n ? t.w / t.n : NaN; };
const pct = (v: number) => (Number.isNaN(v) ? "-" : `${(v * 100).toFixed(1)}%`);

// Try settings without editing config.ts: BALANCE_SET="greens.heal=0;coffee.jitterTime=1"
for (const pair of (process.env.BALANCE_SET ?? "").split(";").filter(Boolean)) {
  const [path, value] = pair.split("=");
  const keys = path.split(".");
  let obj = CONFIG as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) obj = obj[k] as Record<string, unknown>;
  obj[keys.at(-1)!] = Number(value);
}

it("balance", () => {
  const entries: Entry[] = CREATURES.flatMap((c) => MUSCLES.map((m) => ({ c, m })));
  let matches = 0, T = 0, timeouts = 0;
  for (const a of entries) for (const b of entries) {
    if (a === b) continue;
    for (let r = 0; r < REPEATS; r++) {
      const g = newGame(a.c, b.c, Math.random, [a.m, b.m]);
      g.phase = "fight";
      const bots = [new Bot(), new Bot()];
      let t = 0;
      for (; t < MAX_T && g.phase === "fight"; t += DT) {
        const [p, q] = g.fighters;
        bots[0].think(p, q, DT, g); bots[1].think(q, p, DT, g);
        step(g, DT);
      }
      if (g.winner === null) { timeouts++; continue; }
      matches++; T += t;
      const sides = [a, b];
      sides.forEach((e, i) => {
        const won = g.winner === i, o = sides[1 - i];
        add(`creature:${e.c.name}`, won);
        add(`muscle:${e.m}`, won);
        // Gene options count only when the two fighters differ on that gene.
        if (e.c.flame !== o.c.flame) add(`gene:${e.c.flame}`, won);
        if (e.c.time !== o.c.time) add(`gene:${e.c.time}`, won);
        if (e.c.senses !== o.c.senses) add(`gene:${e.c.senses}`, won);
        if (e.c.spark !== o.c.spark) add(`gene:${e.c.spark}`, won);
        if (e.m !== o.m) add(`gene:${e.m}`, won);
      });
    }
  }
  const lines: string[] = [];
  lines.push(`${matches} matches (${REPEATS} per pairing per side), average ${(T / matches).toFixed(1)} s, ${timeouts} timeouts.`, "");
  lines.push("| Creature | Genes | Win rate |", "|---|---|---|");
  const rows = CREATURES.map((c) => ({ c, r: rate(`creature:${c.name}`) })).sort((x, y) => y.r - x.r);
  for (const { c, r } of rows) lines.push(`| ${c.name} | ${c.flame} · ${c.time} · ${c.senses} · ${c.spark} | ${pct(r)} |`);
  const spread = rows.map((x) => x.r);
  lines.push("", `Creature range: ${pct(Math.min(...spread))} to ${pct(Math.max(...spread))}.`, "");
  lines.push("| Gene | Option | Win rate vs the other option |", "|---|---|---|");
  const genes: Array<[string, string[]]> = [
    ["Flame", ["Blaze", "Ember"]], ["Time", ["Dawn", "Dusk"]], ["Senses", ["Bold", "Keen"]],
    ["Spark", ["Crackling", "Still"]], ["Muscles (ACTN3)", [...MUSCLES]],
  ];
  for (const [gene, opts] of genes) for (const o of opts) lines.push(`| ${gene} | ${o} | ${pct(rate(`gene:${o}`))} |`);
  lines.push("", "| Sprint type | Overall win rate |", "|---|---|");
  for (const m of MUSCLES) lines.push(`| ${m} | ${pct(rate(`muscle:${m}`))} |`);
  const out = lines.join("\n");
  console.log(out);
  if (process.env.BALANCE_OUT) writeFileSync(process.env.BALANCE_OUT, out + "\n");
}, 3_600_000);
