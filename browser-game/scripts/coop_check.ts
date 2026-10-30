// Dev tool: check rooms against teams and print the first failures.
// node scripts/coop_check.ts [roomId] [teamSize]
import { allProfiles, type Profile } from "../src/coop/genes.ts";
import { ROOMS } from "../src/coop/rooms.ts";
import { parseRoom, solve } from "../src/coop/solver.ts";

const [onlyRoom, sizeArg] = process.argv.slice(2);
const size = Number(sizeArg ?? 2);
const P = allProfiles();
const short = (p: Profile) => `${p.flame[0]}${p.time.slice(0, 2)}${p.senses[0]}${p.spark[0]}${p.muscle[0]}`;
function* teams(n: number, start = 0, acc: Profile[] = []): Generator<Profile[]> {
  if (acc.length === n) { yield acc; return; }
  for (let i = start; i < P.length; i++) yield* teams(n, i, [...acc, P[i]]);
}
for (const room of ROOMS.filter((r) => !onlyRoom || r.id === onlyRoom)) {
  const parsed = parseRoom(room);
  let total = 0, fails = 0;
  const t0 = performance.now();
  const gems: number[] = [];
  for (const team of teams(size)) {
    total++;
    const r = solve(parsed, team);
    gems.push(r.gems);
    if (!r.solved) { fails++; if (fails <= 5) console.log(`  FAIL ${room.id}: ${team.map(short).join(" + ")} atExit=${r.atExit} opened=${[...r.opened.keys()].join("")}`); }
  }
  console.log(`${room.id}: ${total - fails}/${total} teams of ${size} finish, gems ${Math.min(...gems)}-${Math.max(...gems)}, ${(performance.now() - t0).toFixed(0)} ms`);
}
