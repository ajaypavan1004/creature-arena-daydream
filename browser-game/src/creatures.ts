// The 16 Genome Wrapped creatures and their 4 gene types. Names and axes match
// genome-mythology/app/src/engine/archetype.ts (ARCHETYPE_NAMES). The game never sees
// DNA: a creature is only its name and these 4 gene types.

export type Flame = "Blaze" | "Ember";
export type Time = "Dusk" | "Dawn";
export type Senses = "Keen" | "Bold";
export type Spark = "Crackling" | "Still";

export interface Creature {
  name: string;
  flame: Flame;
  time: Time;
  senses: Senses;
  spark: Spark;
  /** True when the artwork faces left (most face right). */
  facesLeft: boolean;
}

/** Row = Time + Flame; columns: Keen+Crackling, Keen+Still, Bold+Crackling, Bold+Still. */
const NAMES: Record<`${Time} ${Flame}`, [string, string, string, string]> = {
  "Dusk Blaze": ["Moonwhisker", "Nightflicker", "Duskfang", "Starmane"],
  "Dawn Blaze": ["Sunsniffer", "Dawnflare", "Blazeleap", "Morningdrift"],
  "Dusk Ember": ["Shadepounce", "Glowpaw", "Thunderjaw", "Mooncoil"],
  "Dawn Ember": ["Sparksnout", "Sunburrow", "Emberjaw", "Goldenhush"],
};

const FACES_LEFT = new Set(["Blazeleap"]);

export const CREATURES: Creature[] = [];
for (const time of ["Dusk", "Dawn"] as Time[]) {
  for (const flame of ["Blaze", "Ember"] as Flame[]) {
    const row = NAMES[`${time} ${flame}`];
    (["Keen", "Bold"] as Senses[]).forEach((senses, s) =>
      (["Crackling", "Still"] as Spark[]).forEach((spark, k) => {
        const name = row[s * 2 + k];
        CREATURES.push({ name, flame, time, senses, spark, facesLeft: FACES_LEFT.has(name) });
      }));
  }
}

export function creature(name: string): Creature {
  const c = CREATURES.find((c) => c.name === name);
  if (!c) throw new Error(`Unknown creature: ${name}`);
  return c;
}

/** The creature with these 4 gene types (from a creature code). */
export function creatureWithAxes(a: { flame: Flame; time: Time; senses: Senses; spark: Spark }): Creature {
  return CREATURES.find((c) => c.flame === a.flame && c.time === a.time && c.senses === a.senses && c.spark === a.spark)!;
}

export function artUrl(name: string): string {
  return `${import.meta.env.BASE_URL}creatures/${name}.webp`;
}

/** Small preview for menus (made by art/tools/thumbs.py). */
export function thumbUrl(name: string): string {
  return `${import.meta.env.BASE_URL}thumbs/${name}.webp`;
}
