import { beforeEach, describe, expect, it } from "vitest";
import { bindKey, DEFAULT_KEYS, keyClash, keyName, loadKeys, P1_KEYS, P2_KEYS, resetKeys } from "../src/input.ts";

// A small in-memory stand-in for the browser's localStorage.
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
});

describe("custom keys", () => {
  beforeEach(() => { store.clear(); resetKeys(); });

  it("starts with the default keys", () => {
    expect(P1_KEYS).toEqual(DEFAULT_KEYS[0]);
    expect(P2_KEYS).toEqual(DEFAULT_KEYS[1]);
    expect(keyName("KeyW")).toBe("W");
    expect(keyName("ShiftRight")).toBe("Right Shift");
    expect(keyName("ArrowUp")).toBe("↑");
  });

  it("changes a key and saves it", () => {
    expect(bindKey(0, "attack", "Space")).toBe(null);
    expect(P1_KEYS.attack).toBe("Space");
    expect(JSON.parse(store.get("arena-keys")!)[0].attack).toBe("Space");
  });

  it("blocks keys used by either player, and the reserved keys", () => {
    expect(bindKey(0, "attack", "Enter")).toMatch(/Player 2's Attack/);
    expect(bindKey(1, "up", "KeyW")).toMatch(/Player 1's Up/);
    expect(bindKey(0, "up", "KeyS")).toMatch(/Player 1's Down/);
    expect(bindKey(0, "sprint", "Escape")).toMatch(/menu/);
    expect(bindKey(1, "attack", "KeyM")).toMatch(/mute/);
    expect(P1_KEYS).toEqual(DEFAULT_KEYS[0]);
    expect(P2_KEYS).toEqual(DEFAULT_KEYS[1]);
    expect(keyClash("KeyF", 0, "attack")).toBe(null); // its own key is fine
  });

  it("reloads saved keys, and ignores saved keys that clash", () => {
    bindKey(1, "attack", "Slash");
    Object.assign(P2_KEYS, DEFAULT_KEYS[1]);
    loadKeys();
    expect(P2_KEYS.attack).toBe("Slash");
    store.set("arena-keys", JSON.stringify([{ ...DEFAULT_KEYS[0], attack: "Enter" }, DEFAULT_KEYS[1]]));
    resetKeys();
    store.set("arena-keys", JSON.stringify([{ ...DEFAULT_KEYS[0], attack: "Enter" }, DEFAULT_KEYS[1]]));
    loadKeys();
    expect(P1_KEYS.attack).toBe("KeyF");
  });

  it("Reset to defaults puts every key back and forgets the saved ones", () => {
    bindKey(0, "left", "KeyJ");
    resetKeys();
    expect(P1_KEYS).toEqual(DEFAULT_KEYS[0]);
    expect(store.has("arena-keys")).toBe(false);
  });
});
