// Creature code: a short code from Genome Wrapped that tells the game which creature you
// are and your sprint type. It holds ONLY the 4 creature axes (Flame, Time, Senses, Spark)
// and the ACTN3 sprinter/marathoner result, nothing else about anyone's DNA.
//
// The same file exists in genome-mythology (app/src/creature/code.ts); keep them identical.
// Both test suites check the same 64 test vectors (tests/code_vectors.json).
//
// Format (version 0): 6 characters from a 31-character alphabet with no 0/O, 1/I or L,
// shown as ABC-DEF. Characters 1 to 5 carry the value, scrambled so neighbouring values
// look nothing alike; character 6 is a check character. A wrong character anywhere, or two
// neighbouring characters swapped, is always caught.
//   value = archetype * 4 + muscle            (0 to 63)
//   archetype = Ember<<3 | Dusk<<2 | Keen<<1 | Crackling   (the other option is 0)
//   muscle: 0 = unknown, 1 = Sprinter (ACTN3 CC), 2 = Mixed (CT), 3 = Endurance (TT)

export const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const BASE = ALPHABET.length; // 31, a prime
const DATA = 5;
const SPACE = BASE ** DATA; // 28,629,151
const MUL = 9_765_625; // 5^10: coprime with 31, so the scramble can be undone
const ADD = 15_485_863;

export type CodeMuscle = "Sprinter" | "Mixed" | "Endurance" | null;
export interface CodeAxes {
  flame: "Blaze" | "Ember";
  time: "Dawn" | "Dusk";
  senses: "Bold" | "Keen";
  spark: "Crackling" | "Still";
  /** Sprint type from ACTN3, or null when it couldn't be read from the file. */
  muscle: CodeMuscle;
}

const MUSCLE_BITS: CodeMuscle[] = [null, "Sprinter", "Mixed", "Endurance"];

function inverse(a: number, m: number): number {
  let [r0, r1, s0, s1] = [a % m, m, 1, 0];
  while (r1) { const q = Math.floor(r0 / r1); [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
  return ((s0 % m) + m) % m;
}
const INV = inverse(MUL, SPACE);

/** (a * b) mod m without losing precision (a, b < m < 2^25). */
function mulMod(a: number, b: number, m: number): number {
  const hi = Math.floor(b / 4096), lo = b % 4096;
  return ((((a * hi) % m) * 4096) % m + a * lo) % m;
}

function checkChar(digits: number[]): number {
  // Weights 1..6 over all six positions; the check digit makes the total 0 mod 31.
  let sum = 0;
  digits.forEach((d, i) => { sum += (i + 1) * d; });
  // 6 * c ≡ -sum (mod 31); the inverse of 6 mod 31 is 26.
  return (((-sum % BASE) + BASE) * 26) % BASE;
}

export function encodeCreature(a: CodeAxes): string {
  const arch = (a.flame === "Ember" ? 8 : 0) | (a.time === "Dusk" ? 4 : 0) | (a.senses === "Keen" ? 2 : 0) | (a.spark === "Crackling" ? 1 : 0);
  const value = arch * 4 + MUSCLE_BITS.indexOf(a.muscle);
  let n = (mulMod(value, MUL, SPACE) + ADD) % SPACE;
  const digits: number[] = [];
  for (let i = 0; i < DATA; i++) { digits.unshift(n % BASE); n = Math.floor(n / BASE); }
  digits.push(checkChar(digits));
  const s = digits.map((d) => ALPHABET[d]).join("");
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

export type DecodeResult = { ok: true; axes: CodeAxes } | { ok: false; why: string };

export function decodeCreature(input: string): DecodeResult {
  const s = input.toUpperCase().replace(/[\s\-–—_.]/g, "");
  if (!s) return { ok: false, why: "Type your creature code." };
  if (/[01OIL]/.test(s)) return { ok: false, why: "Creature codes never use 0, 1, O, I or L. Check those characters." };
  if (s.length !== DATA + 1) return { ok: false, why: "A creature code has 6 characters, like ABC-DEF." };
  const digits = [...s].map((ch) => ALPHABET.indexOf(ch));
  if (digits.some((d) => d < 0)) return { ok: false, why: "That code has a character that isn't used in creature codes." };
  if (checkChar(digits.slice(0, DATA)) !== digits[DATA]) return { ok: false, why: "That code doesn't add up. Check for a typo." };
  const n = digits.slice(0, DATA).reduce((acc, d) => acc * BASE + d, 0);
  const value = mulMod((n - ADD + SPACE) % SPACE, INV, SPACE);
  if (value >= 64) return { ok: false, why: "That isn't a creature code from this version of Genome Wrapped." };
  const arch = value >> 2;
  return {
    ok: true,
    axes: {
      flame: arch & 8 ? "Ember" : "Blaze",
      time: arch & 4 ? "Dusk" : "Dawn",
      senses: arch & 2 ? "Keen" : "Bold",
      spark: arch & 1 ? "Crackling" : "Still",
      muscle: MUSCLE_BITS[value & 3],
    },
  };
}
