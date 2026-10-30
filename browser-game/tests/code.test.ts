import { describe, expect, it } from "vitest";
import { ALPHABET, decodeCreature, encodeCreature, type CodeAxes } from "../src/code.ts";
import vectors from "./code_vectors.json";

const ALL: CodeAxes[] = [];
for (const flame of ["Blaze", "Ember"] as const) for (const time of ["Dawn", "Dusk"] as const)
  for (const senses of ["Bold", "Keen"] as const) for (const spark of ["Crackling", "Still"] as const)
    for (const muscle of [null, "Sprinter", "Mixed", "Endurance"] as const) ALL.push({ flame, time, senses, spark, muscle });

describe("creature code", () => {
  it("round-trips all 64 creature + sprint combinations, each with its own code", () => {
    const codes = new Set<string>();
    for (const a of ALL) {
      const code = encodeCreature(a);
      expect(code).toMatch(/^[2-9A-HJKMNP-Z]{3}-[2-9A-HJKMNP-Z]{3}$/);
      codes.add(code);
      expect(decodeCreature(code)).toEqual({ ok: true, axes: a });
    }
    expect(codes.size).toBe(64);
  });

  it("matches the shared test vectors (same as genome-mythology)", () => {
    expect(vectors).toHaveLength(64);
    for (const v of vectors as Array<{ code: string; axes: CodeAxes }>) {
      expect(encodeCreature(v.axes)).toBe(v.code);
      expect(decodeCreature(v.code)).toEqual({ ok: true, axes: v.axes });
    }
  });

  it("never uses confusable characters", () => {
    for (const ch of "01OIL") expect(ALPHABET).not.toContain(ch);
  });

  it("is forgiving about case, spaces and dashes", () => {
    const code = encodeCreature(ALL[13]);
    expect(decodeCreature(code.toLowerCase().replace("-", " "))).toEqual({ ok: true, axes: ALL[13] });
  });

  it("catches every single wrong character and every swap of neighbours", () => {
    for (const a of ALL) {
      const s = encodeCreature(a).replace("-", "");
      for (let i = 0; i < 6; i++) {
        for (const ch of ALPHABET) {
          if (ch === s[i]) continue;
          expect(decodeCreature(s.slice(0, i) + ch + s.slice(i + 1)).ok).toBe(false);
        }
        if (i < 5 && s[i] !== s[i + 1]) expect(decodeCreature(s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2)).ok).toBe(false);
      }
    }
  });

  it("explains what's wrong", () => {
    expect(decodeCreature("")).toMatchObject({ ok: false });
    expect(decodeCreature("AB0-DEF")).toMatchObject({ ok: false, why: expect.stringContaining("0, 1, O, I or L") });
    expect(decodeCreature("ABCD")).toMatchObject({ ok: false, why: expect.stringContaining("6 characters") });
  });
});
