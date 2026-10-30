// "Did you know?" facts for Hatchling Expedition: how common each gene version is
// WORLDWIDE (never broken down by population), from the 1000 Genomes Project frequencies
// that Genome Wrapped uses (2,504 people). Rounded to whole percent.
import type { GeneOption, Profile } from "./genes.ts";

export const WORLDWIDE: Record<GeneOption, number> = {
  Blaze: 41, Ember: 59,
  Dawn: 22, Dusk: 78,
  Keen: 73, Bold: 27,
  Crackling: 32, Still: 68,
  Sprinter: 38, Mixed: 44, Endurance: 18,
};

export const SOURCE = "1000 Genomes Project, 2,504 people worldwide";

/** What each gene version means, in plain words. */
const MEANS: Record<GeneOption, string> = {
  Blaze: "two A copies of a CYP1A2 variant linked to clearing caffeine faster",
  Ember: "at least one C copy of that CYP1A2 caffeine variant",
  Dawn: "at least one A copy of an HCRTR2 variant linked to being a morning person",
  Dusk: "no A copy of that HCRTR2 variant, the most common type",
  Keen: "at least one G copy of a TAS2R38 variant, the taster form that makes bitter greens taste bitter",
  Bold: "two C copies of that TAS2R38 variant, so bitter greens taste mild",
  Crackling: "two T copies of an ADORA2A variant linked to feeling jittery after strong coffee",
  Still: "at least one C copy of that ADORA2A variant",
  Sprinter: "two working copies of ACTN3 (CC), a protein in fast-twitch muscle",
  Mixed: "one working copy of ACTN3 (CT)",
  Endurance: "no working ACTN3 in fast-twitch muscle (TT), common among endurance athletes",
};

export function fact(o: GeneOption): string {
  return `About ${WORLDWIDE[o]} in 100 people worldwide have the ${o} version: ${MEANS[o]}.`;
}

/**
 * Two facts for the end of a room: about gene versions this room used, the team's own
 * first, and a different pair for each room.
 */
export function factsForRoom(roomIndex: number, used: GeneOption[], team: Profile[]): string[] {
  const mine = (o: GeneOption) => team.some((p) => Object.values(p).includes(o));
  const order = [...used.filter(mine), ...used.filter((o) => !mine(o))];
  if (!order.length) return [];
  const start = roomIndex % order.length;
  const picked = [order[start], order[(start + 1) % order.length]].filter((o, i, a) => a.indexOf(o) === i);
  return picked.map(fact);
}
