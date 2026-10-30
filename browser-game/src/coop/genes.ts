// What each gene version does in Hatchling Expedition, and the words used to tell
// players which gene opened something ("Your Keen nose found a hidden door!").
import type { Creature } from "../creatures.ts";
import type { Muscle } from "../sim.ts";

/** One explorer's genes: the 4 creature axes plus the ACTN3 muscle type. */
export interface Profile {
  flame: Creature["flame"];
  time: Creature["time"];
  senses: Creature["senses"];
  spark: Creature["spark"];
  muscle: Muscle;
}

export type GeneOption = Profile[keyof Profile];

export const GENE_OF: Record<GeneOption, keyof Profile> = {
  Blaze: "flame", Ember: "flame", Dawn: "time", Dusk: "time", Keen: "senses", Bold: "senses",
  Crackling: "spark", Still: "spark", Sprinter: "muscle", Mixed: "muscle", Endurance: "muscle",
};

/** All 48 explorer profiles (16 creatures x 3 muscle types). */
export function allProfiles(): Profile[] {
  const out: Profile[] = [];
  for (const flame of ["Blaze", "Ember"] as const) for (const time of ["Dawn", "Dusk"] as const)
    for (const senses of ["Keen", "Bold"] as const) for (const spark of ["Crackling", "Still"] as const)
      for (const muscle of ["Sprinter", "Mixed", "Endurance"] as const) out.push({ flame, time, senses, spark, muscle });
  return out;
}

export const has = (p: Profile, option: GeneOption) => p[GENE_OF[option]] === option;

/** The ability each gene version gives, in a few words (team genome panel, hints). */
export const ABILITY: Record<GeneOption, string> = {
  Blaze: "dashes through closing gates",
  Ember: "glows in the dark and melts ice",
  Dawn: "walks on sun stones by day",
  Dusk: "walks on moon stones at night",
  Keen: "sniffs out hidden doors, traps and keys",
  Bold: "munches through bitter bramble",
  Crackling: "powers machines",
  Still: "calms wild critters and crosses fragile bridges",
  Sprinter: "wins short timed runs",
  Mixed: "can sprint and push",
  Endurance: "pushes heavy blocks",
};

/** "Keen nose", "Ember glow"...: the body part or power behind each gene in messages. */
export const POWER: Record<GeneOption, string> = {
  Blaze: "Blaze dash", Ember: "Ember glow", Dawn: "Dawn sight", Dusk: "Dusk sight", Keen: "Keen nose",
  Bold: "Bold jaws", Crackling: "Crackling spark", Still: "Still calm", Sprinter: "Sprinter legs",
  Mixed: "Mixed muscles", Endurance: "Endurance muscles",
};
