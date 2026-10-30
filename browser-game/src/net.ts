// Local network play. The host's browser runs the game and sends the state to the guest
// about 60 times a second; the guest sends back its controls. Both talk only to the small
// server on the host laptop (server/lan.mjs), never to the internet.
import { creature } from "./creatures.ts";
import { newGame, type Fighter, type Game, type GameEvent, type Muscle, type Vec } from "./sim.ts";

/** Local network play is offered only when the page comes from the LAN server. */
export function lanAddresses(): string[] | null {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="arena-lan"]');
  return meta ? meta.content.split(" ").filter(Boolean) : null;
}

export type Message =
  | { t: "room"; code: string; addresses: string[] }
  | { t: "joined"; code: string; mode?: "versus" | "coop"; id?: number }
  | { t: "error"; why: string }
  | { t: "guest-joined"; id?: number } | { t: "guest-left"; id?: number } | { t: "host-left" }
  // guest -> host
  | { t: "pick"; name: string; muscle: Muscle }
  | { t: "input"; x: number; y: number; attacks: number; sprint: boolean }
  // host -> guest
  | { t: "lobby"; host: { name: string; muscle: Muscle } | null; guest: { name: string; muscle: Muscle } | null }
  | { t: "state"; s: Snapshot; ev: GameEvent[] }
  | { t: "screen"; screen: "lobby" | "fight" | "win" }
  // Hatchling Expedition (see coop/net.ts)
  | { t: "coop"; m: unknown };

/** Every message may carry the guest number it came from (added by the server) or is for. */
export type Tagged = Message & { from?: number; to?: number };

export class Connection {
  private ws: WebSocket;
  onmessage: (m: Tagged) => void = () => {};
  onclose: () => void = () => {};

  constructor() {
    this.ws = new WebSocket(`ws://${location.host}/ws`);
    this.ws.addEventListener("message", (e) => { try { this.onmessage(JSON.parse(String(e.data))); } catch { /* ignore */ } });
    this.ws.addEventListener("close", () => this.onclose());
  }

  ready(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((ok, fail) => {
      this.ws.addEventListener("open", () => ok(), { once: true });
      this.ws.addEventListener("error", () => fail(new Error("Could not reach the game server")), { once: true });
    });
  }

  send(m: Tagged | { t: "host"; max?: number; mode?: "versus" | "coop" } | { t: "join"; code: string }): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close(): void { this.ws.close(); }
}

// ------------------------------------------------------------------- snapshots

const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

type FighterSnap = Omit<Fighter, "creature" | "intent" | "attackPressed" | "sprintHeld" | "swingHit" | "restT" | "slot" | "speed"> & { name: string };

export interface Snapshot {
  f: [FighterSnap, FighterSnap];
  phase: Game["phase"]; phaseT: number; time: number; winner: Game["winner"];
  night: boolean; nightness: number;
  pickups: Game["pickups"];
  pending: Game["pending"];
}

function fighterSnap(f: Fighter): FighterSnap {
  const dir = (v: Vec) => ({ x: r3(v.x), y: r3(v.y) });
  return {
    name: f.creature.name, muscle: f.muscle,
    x: r1(f.x), y: r1(f.y), vx: r1(f.vx), vy: r1(f.vy), hp: f.hp, facing: f.facing,
    swingT: r3(f.swingT), swingDir: dir(f.swingDir), swingDash: f.swingDash,
    cooldown: r3(f.cooldown), stun: r3(f.stun), flash: r3(f.flash), bob: r3(f.bob),
    boost: r3(f.boost), jitter: r3(f.jitter), bitter: r3(f.bitter), charged: r3(f.charged), shield: r3(f.shield),
    stamina: r3(f.stamina), sprinting: f.sprinting, winded: f.winded,
  };
}

export function snapshot(g: Game): Snapshot {
  return {
    f: [fighterSnap(g.fighters[0]), fighterSnap(g.fighters[1])],
    phase: g.phase, phaseT: r3(g.phaseT), time: r3(g.time), winner: g.winner,
    night: g.night, nightness: r3(g.nightness),
    pickups: g.pickups.map((p) => ({ ...p, x: r1(p.x), y: r1(p.y), age: r3(p.age) })),
    pending: g.pending && { ...g.pending, x: r1(g.pending.x), y: r1(g.pending.y), age: r3(g.pending.age) },
  };
}

/** The guest's copy of the game, updated from each snapshot (it never runs the rules). */
export function applySnapshot(g: Game | null, s: Snapshot): Game {
  const fresh = !g || g.fighters[0].creature.name !== s.f[0].name || g.fighters[1].creature.name !== s.f[1].name;
  const game = fresh ? newGame(creature(s.f[0].name), creature(s.f[1].name), Math.random, [s.f[0].muscle, s.f[1].muscle]) : g!;
  s.f.forEach((fs, i) => {
    const { name: _name, ...rest } = fs;
    Object.assign(game.fighters[i], rest);
  });
  Object.assign(game, { phase: s.phase, phaseT: s.phaseT, time: s.time, winner: s.winner, night: s.night, nightness: s.nightness, pickups: s.pickups, pending: s.pending ?? null });
  return game;
}
