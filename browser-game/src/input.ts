// Keyboard controls. Defaults: Player 1 W A S D + F, Left Shift to sprint; Player 2 arrow
// keys + Enter, Right Shift to sprint. Each player can change their keys on the Controls
// screen; the choices are saved in this browser (localStorage) and checked for clashes.
import type { Vec } from "./sim.ts";

export interface KeyMap { up: string; down: string; left: string; right: string; attack: string; sprint: string }
export type Action = keyof KeyMap;
export const ACTIONS: Action[] = ["up", "down", "left", "right", "attack", "sprint"];
export const ACTION_NAMES: Record<Action, string> = { up: "Up", down: "Down", left: "Left", right: "Right", attack: "Attack", sprint: "Sprint" };

export const DEFAULT_KEYS: [KeyMap, KeyMap] = [
  { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", attack: "KeyF", sprint: "ShiftLeft" },
  { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", attack: "Enter", sprint: "ShiftRight" },
];

/** The live bindings: the rest of the game reads these objects, so they're updated in place. */
export const P1_KEYS: KeyMap = { ...DEFAULT_KEYS[0] };
export const P2_KEYS: KeyMap = { ...DEFAULT_KEYS[1] };
const PLAYERS = [P1_KEYS, P2_KEYS] as const;

/** Keys that always mean something else: menu/back, mute, and focus moving. */
export const RESERVED: Record<string, string> = { Escape: "Esc goes back to the menu", KeyM: "M is the mute key", Tab: "Tab moves between buttons" };
const STORE = "arena-keys";

/** A friendly name for a key code (KeyW -> W, ArrowUp -> ↑, ShiftLeft -> Left Shift). */
export function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  const named: Record<string, string> = {
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Space: "Space", Enter: "Enter", NumpadEnter: "Num Enter",
    ShiftLeft: "Left Shift", ShiftRight: "Right Shift", ControlLeft: "Left Ctrl", ControlRight: "Right Ctrl",
    AltLeft: "Left Alt", AltRight: "Right Alt", MetaLeft: "Left ⌘", MetaRight: "Right ⌘", Backspace: "Backspace",
    Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", BracketLeft: "[", BracketRight: "]",
    Minus: "-", Equal: "=", Backquote: "`", CapsLock: "Caps Lock",
  };
  return named[code] ?? code;
}

/** Who already uses this key, if anyone (other than the binding being changed). */
export function keyClash(code: string, player: 0 | 1, action: Action): string | null {
  if (RESERVED[code]) return RESERVED[code];
  for (const p of [0, 1] as const) for (const a of ACTIONS) {
    if (p === player && a === action) continue;
    if (PLAYERS[p][a] === code) return `${keyName(code)} is already Player ${p + 1}'s ${ACTION_NAMES[a]} key`;
  }
  return null;
}

/** Change one key. Returns why not, if it would clash. */
export function bindKey(player: 0 | 1, action: Action, code: string): string | null {
  const clash = keyClash(code, player, action);
  if (clash) return clash;
  PLAYERS[player][action] = code;
  saveKeys();
  return null;
}

export function resetKeys(): void {
  Object.assign(P1_KEYS, DEFAULT_KEYS[0]);
  Object.assign(P2_KEYS, DEFAULT_KEYS[1]);
  try { localStorage.removeItem(STORE); } catch { /* storage blocked */ }
}

function saveKeys(): void {
  try { localStorage.setItem(STORE, JSON.stringify([P1_KEYS, P2_KEYS])); } catch { /* storage blocked */ }
}

/** Load saved keys; anything missing, malformed or clashing falls back to the defaults. */
export function loadKeys(): void {
  let saved: unknown;
  try { saved = JSON.parse(localStorage.getItem(STORE) ?? "null"); } catch { saved = null; }
  if (!Array.isArray(saved) || saved.length !== 2) return;
  const maps = saved.map((m, i) => ACTIONS.reduce((acc, a) => {
    const v = (m as Record<string, unknown>)?.[a];
    acc[a] = typeof v === "string" && v.length < 40 ? v : DEFAULT_KEYS[i][a];
    return acc;
  }, {} as KeyMap));
  const all = maps.flatMap((m) => ACTIONS.map((a) => m[a]));
  if (new Set(all).size !== all.length || all.some((k) => RESERVED[k])) return; // clashing: keep defaults
  Object.assign(P1_KEYS, maps[0]);
  Object.assign(P2_KEYS, maps[1]);
}

const isGameKey = (code: string) => code === "Space" || PLAYERS.some((m) => ACTIONS.some((a) => m[a] === code));

export class Keyboard {
  private down = new Set<string>();
  private pressed = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener("keydown", (e) => {
      if (isGameKey(e.code) && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener("keyup", (e) => this.down.delete(e.code));
    target.addEventListener("blur", () => this.down.clear());
  }

  direction(k: KeyMap): Vec {
    const x = (this.down.has(k.right) ? 1 : 0) - (this.down.has(k.left) ? 1 : 0);
    const y = (this.down.has(k.down) ? 1 : 0) - (this.down.has(k.up) ? 1 : 0);
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  }

  held(code: string): boolean { return this.down.has(code); }

  /** True once per key press (holding the key does not repeat attacks). */
  take(code: string): boolean {
    const was = this.pressed.has(code);
    this.pressed.delete(code);
    return was;
  }

  clearPresses(): void { this.pressed.clear(); }
}
