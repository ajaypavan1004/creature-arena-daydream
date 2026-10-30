# Creature code

The creature code is a short code that Genome Wrapped shows on the creature reveal and
on the story card, with a **Copy code** button. Entering it in the Creature Arena game
loads your creature and your sprint type.

## What it contains

Only these, and nothing else about the person's DNA:

| Part | Source | Values |
|---|---|---|
| Flame | CYP1A2 rs762551 (the archetype axis) | Blaze / Ember |
| Time | HCRTR2 rs2653349 (A carrier = Dawn) | Dawn / Dusk |
| Senses | TAS2R38 rs713598 (G carrier, tastes bitterness = Keen) | Bold / Keen |
| Spark | ADORA2A rs5751876 | Crackling / Still |
| Sprint type | ACTN3 rs1815739 (`sprinter_vs_marathoner`) | Sprinter (CC) / Mixed (CT) / Endurance (TT) / unknown |

The four axes are the creature shown at the reveal. If an axis SNP couldn't be read,
that axis uses the default the reveal already uses. If ACTN3 can't be called, the code
records "unknown", and the game asks the player to choose a sprint type.

That gives 16 creatures × 4 sprint states = 64 possible codes. Everyone with the same
creature and sprint type gets the same code. The code is computed on the device
(`app/src/engine/creature_code.ts`); nothing is sent anywhere.

## Format

- 6 characters, shown as `ABC-DEF`, from a 31-character alphabet:
  `23456789ABCDEFGHJKMNPQRSTUVWXYZ`. There's no 0, O, 1, I or L.
- value = archetype × 4 + sprint, where:
  - archetype = Ember·8 + Dusk·4 + Keen·2 + Crackling·1, with the other option of each
    axis counting 0;
  - sprint: 0 = unknown, 1 = Sprinter, 2 = Mixed, 3 = Endurance.
- Characters 1–5 hold (value × 9,765,625 + 15,485,863) mod 31⁵, in base 31. The scramble
  makes neighbouring values look unrelated.
- Character 6 is a check character. With weights 1 to 6 across all six positions, the
  weighted sum is 0 mod 31.

Because 31 is prime and the weights are all different, any single wrong character and
any swap of two neighbouring characters is always rejected. Both projects test this
exhaustively. Decoding ignores case, spaces and dashes, and explains what's wrong
(for example, "never uses 0, 1, O, I or L").

Value 64 and above is reserved for later versions. The decoder rejects those, so a
future version can add more without old codes being misread.

## Two copies, kept identical

- Genome Wrapped: `app/src/engine/creature_code.ts` (also has `creatureCodeFor`).
- Creature Arena: `creature-arena/src/code.ts`.

Both test suites check the same 64 test vectors (`creature_code_vectors.json` /
`code_vectors.json`). If the two copies ever drift, a test fails.
