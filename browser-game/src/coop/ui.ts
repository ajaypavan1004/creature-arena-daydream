// Hatchling Expedition screens and flow: the lobby (players on this keyboard and on other
// devices), choosing creatures (picker or creature code), playing the rooms, the "team
// genome" panel after each room, and the finale. The host runs the rooms; other devices
// send their controls and draw what the host sends.
import { decodeCreature } from "../code.ts";
import { CREATURES, creatureWithAxes, thumbUrl, type Creature } from "../creatures.ts";
import { Keyboard, keyName, P1_KEYS, P2_KEYS, type KeyMap } from "../input.ts";
import { Connection, type Tagged } from "../net.ts";
import { drawQr } from "../qr.ts";
import { MUSCLES, type Muscle } from "../sim.ts";
import type { Sound } from "../sound.ts";
import type { PowersPanel } from "../powers.ts";
import type { TouchControls } from "../touch.ts";
import { factsForRoom, SOURCE, WORLDWIDE } from "./facts.ts";
import { ABILITY, GENE_OF, has, type GeneOption, type Profile } from "./genes.ts";
import { CoopRenderer, PLAYER_COLORS } from "./render.ts";
import { ROOMS } from "./rooms.ts";
import { newWorld, platesStatus, profileOf, stepWorld, type CoopEvent, type World } from "./world.ts";

const STEP = 1 / 120;

type Seat = { where: "key1" | "key2" | "touch" | "remote"; id?: number; creature: Creature | null; muscle: Muscle };

/** Messages inside { t: "coop", m } between host and guests. */
type CoopMsg =
  | { k: "lobby"; seats: SeatInfo[]; you: number }
  | { k: "pick"; name: string; muscle: Muscle }
  | { k: "start"; room: number; seats: SeatInfo[]; you: number }
  | { k: "state"; s: Snap; ev: CoopEvent[] }
  | { k: "panel"; panel: PanelData }
  | { k: "finale"; gems: number; total: number }
  | { k: "badges"; seats: SeatInfo[]; you: number };
interface SeatInfo { name: string | null; muscle: Muscle; remote: boolean }
interface Snap {
  room: number; time: number; night: boolean; nightness: number; cycleIn: number; gems: number; done: boolean; lit: number[];
  ex: number[][]; th: Record<string, number[]>;
}
interface PanelData {
  room: string; rows: Array<{ gene: string; text: string; color: string }>; missing: string[]; gems: number; gemsTotal: number; last: boolean;
  facts: string[];
  /** For the team genome card: gems found so far in the expedition, and rooms done. */
  gemsSoFar: number; roomsDone: number;
}

export interface ExpeditionDeps {
  canvas: HTMLCanvasElement;
  ui: HTMLDivElement;
  keys: Keyboard;
  touch: TouchControls;
  sound: Sound;
  powers: PowersPanel;
  touchDevice: boolean;
  lanAvailable: boolean;
  onExit: () => void;
  /** Join someone else's game, and change keys (the main menu's screens). */
  onJoin: () => void;
  onControls: () => void;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export class Expedition {
  private d: ExpeditionDeps;
  private render: CoopRenderer;
  private seats: Seat[] = [];
  private role: "host" | "guest" = "host";
  private conn: Connection | null = null;
  private room: { code: string; addresses: string[] } | null = null;
  private mySeat = 0;
  private world: World | null = null;
  private screen: "lobby" | "play" | "panel" | "finale" | "off" = "off";
  private choosing: number | null = null;
  private codeNote = "";
  private inputs = new Map<number, { x: number; y: number; attacks: number; sprint: boolean; seen: number }>();
  private myAttacks = 0;
  private acc = 0;
  private gemsTotal = 0;
  private paused = false;
  private guestSeats: SeatInfo[] = [];

  constructor(d: ExpeditionDeps) {
    this.d = d;
    this.render = new CoopRenderer(d.canvas);
  }

  get active(): boolean { return this.screen !== "off"; }
  /** Back from the Controls screen to the lobby, as it was. */
  reopenLobby(): void { this.screen = "lobby"; this.renderLobby(); }

  /** For tests and recordings (#rec): the room being played. */
  get state(): World | null { return this.world; }

  // ------------------------------------------------------------- helpers

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) k === "class" ? (e.className = v) : e.setAttribute(k, v);
    e.append(...kids);
    return e;
  }
  private button(label: string, onClick: () => void, props: Record<string, string> = {}): HTMLButtonElement {
    const b = this.el("button", props, label);
    b.addEventListener("click", onClick);
    return b;
  }
  /** Navigation (Back, Menu, Quit): a quiet link on its own line under the action buttons. */
  private backLink(label: string, onClick: () => void, props: Record<string, string> = {}): HTMLButtonElement {
    return this.button(`‹ ${label}`, onClick, { ...props, class: `back-link ${props.class ?? ""}`.trim() });
  }
  private send(m: CoopMsg, to?: number): void { this.conn?.send({ t: "coop", m, ...(to !== undefined ? { to } : {}) } as Tagged); }

  private seatLabel(i: number): string {
    const s = this.seats[i];
    if (this.role === "guest") return i === this.mySeat ? "You" : `Player ${i + 1}`;
    return s.where === "remote" ? `Player ${i + 1} (other device)` : `Player ${i + 1}`;
  }

  // --------------------------------------------------------------- lobby

  /** Open the lobby on this device as the host, with Player 1 on this keyboard (or touch). */
  openHost(): void {
    this.role = "host";
    this.seats = [{ where: this.d.touchDevice ? "touch" : "key1", creature: null, muscle: "Mixed" }];
    this.gemsTotal = 0;
    this.screen = "lobby";
    this.renderLobby();
  }

  /** Player 1 starts with the creature from a creature code (a link from Genome Wrapped carries only the code). */
  presetCode(text: string): void {
    const r = decodeCreature(text);
    if (!r.ok || !this.seats[0]) return;
    const c = creatureWithAxes(r.axes);
    this.seats[0] = { ...this.seats[0], creature: c, muscle: r.axes.muscle ?? this.seats[0].muscle };
    this.codeNote = r.axes.muscle ? `${c.name}, ${r.axes.muscle} muscles.` : `${c.name}. Your file didn't include the sprint gene, so choose your muscles below.`;
    void this.render.load(c.name);
    this.renderLobby();
  }

  /** Joined someone else's expedition over the local network. */
  openGuest(conn: Connection): void {
    this.role = "guest";
    this.conn = conn;
    this.seats = [];
    this.screen = "lobby";
    this.renderLobby();
  }

  close(): void {
    const c = this.conn;
    this.conn = null; this.room = null;
    if (this.role === "host") c?.close();
    this.screen = "off";
    this.world = null;
    this.d.touch.show(false);
    this.d.powers.hide();
  }

  private async invite(): Promise<void> {
    if (this.conn) return;
    this.conn = new Connection();
    this.conn.onmessage = (m) => this.hostMessage(m);
    this.conn.onclose = () => { if (this.role === "host" && this.room) { this.room = null; this.conn = null; this.seats = this.seats.filter((s) => s.where !== "remote"); this.renderLobby(); } };
    try { await this.conn.ready(); } catch { this.conn = null; alert("Couldn't reach the game server on this laptop. Start it with: npm run lan"); return; }
    this.conn.send({ t: "host", max: 3, mode: "coop" });
  }

  private hostMessage(m: Tagged): void {
    if (m.t === "room") { this.room = { code: m.code, addresses: m.addresses }; this.renderLobby(); return; }
    if (m.t === "guest-joined" && m.id !== undefined) {
      if (this.seats.length >= 4 || this.screen !== "lobby") return; // full, or already playing
      this.seats.push({ where: "remote", id: m.id, creature: null, muscle: "Mixed" });
      this.inputs.set(m.id, { x: 0, y: 0, attacks: 0, sprint: false, seen: 0 });
      this.renderLobby();
      return;
    }
    if (m.t === "guest-left" && m.id !== undefined) {
      this.seats = this.seats.filter((s) => !(s.where === "remote" && s.id === m.id));
      this.inputs.delete(m.id);
      if (this.screen !== "lobby") { this.screen = "lobby"; this.world = null; this.d.touch.show(false); }
      this.renderLobby();
      return;
    }
    if (m.t === "input" && m.from !== undefined) {
      const inp = this.inputs.get(m.from);
      if (inp) Object.assign(inp, { x: clamp(m.x), y: clamp(m.y), attacks: m.attacks | 0, sprint: !!m.sprint });
      return;
    }
    if (m.t === "coop" && m.from !== undefined) {
      const cm = m.m as CoopMsg;
      if (cm.k === "pick") {
        const seat = this.seats.find((s) => s.where === "remote" && s.id === m.from);
        const c = CREATURES.find((x) => x.name === cm.name);
        if (seat && c) { seat.creature = c; void this.render.load(c.name); }
        if (seat && MUSCLES.includes(cm.muscle)) seat.muscle = cm.muscle;
        this.renderLobby();
      }
    }
  }

  /** Guest: everything from the host. */
  guestMessage(m: Tagged): void {
    if (m.t !== "coop") return;
    const cm = m.m as CoopMsg;
    if (cm.k === "lobby") {
      this.guestSeats = cm.seats; this.mySeat = cm.you;
      for (const s of cm.seats) if (s.name) void this.render.load(s.name);
      if (this.screen !== "lobby") { this.screen = "lobby"; this.world = null; this.d.touch.show(false); }
      this.renderLobby();
    } else if (cm.k === "start") {
      this.guestSeats = cm.seats; this.mySeat = cm.you;
      this.startRoom(cm.room);
    } else if (cm.k === "state") {
      if (!this.world || this.world.roomIndex !== cm.s.room) this.startRoom(cm.s.room);
      applySnap(this.world!, cm.s);
      this.handleEvents(cm.ev);
    } else if (cm.k === "panel") {
      this.showPanel(cm.panel);
    } else if (cm.k === "finale") {
      this.showFinale(cm.gems, cm.total);
    } else if (cm.k === "badges") {
      this.guestSeats = cm.seats; this.mySeat = cm.you;
      this.showBadges(cm.seats);
    }
  }

  private shareLobby(): void {
    if (this.role !== "host" || !this.conn) return;
    const seats = this.seats.map((s) => ({ name: s.creature?.name ?? null, muscle: s.muscle, remote: s.where === "remote" }));
    this.seats.forEach((s, i) => { if (s.where === "remote") this.send({ k: "lobby", seats, you: i }, s.id); });
  }

  private renderLobby(): void {
    if (this.screen !== "lobby") return;
    this.d.powers.hide();
    this.shareLobby();
    const { ui } = this.d;
    const seatCard = (i: number) => {
      const info = this.role === "guest" ? this.guestSeats[i] : null;
      const s = this.seats[i];
      const creature = info ? (info.name ? CREATURES.find((c) => c.name === info.name)! : null) : s.creature;
      const muscle = info ? info.muscle : s.muscle;
      const mine = this.role === "guest" ? i === this.mySeat : s.where !== "remote";
      const where = this.role === "guest" ? (i === this.mySeat ? "This device" : "Another player")
        : s.where === "key1" ? `This keyboard: ${keysText(P1_KEYS)}` : s.where === "key2" ? `This keyboard: ${keysText(P2_KEYS)}`
        : s.where === "touch" ? "This phone" : "On another device";
      const card = this.el("div", { class: "seat", "data-testid": `seat-${i}` },
        this.el("p", { class: "seat-who" }, this.role === "guest" && i === this.mySeat ? "You" : `Player ${i + 1}`),
        this.el("p", { class: "seat-where" }, where),
        creature ? this.el("img", { src: thumbUrl(creature.name), alt: "" }) : this.el("div", { class: "seat-empty" }, "?"),
        this.el("strong", {}, creature?.name ?? (mine ? "Choose a creature" : "Choosing…")),
        creature ? geneChips(profileOf(creature, muscle)) : "");
      card.style.setProperty("--seat", PLAYER_COLORS[i]); // set from script: the page's CSP allows no inline style attributes
      if (mine) card.append(this.button(creature ? "Change" : "Choose", () => { this.choosing = i; this.codeNote = ""; this.renderLobby(); }, { "data-testid": `choose-${i}` }));
      if (this.role === "host" && s.where === "key2") card.append(this.button("Remove", () => { this.seats.splice(i, 1); this.renderLobby(); }));
      return card;
    };
    const count = this.role === "guest" ? this.guestSeats.length : this.seats.length;
    const seats = this.el("div", { class: "seats" }, ...Array.from({ length: count }, (_, i) => seatCard(i)));
    const actions: HTMLElement[] = [];
    if (this.role === "host" && !this.conn && this.d.lanAvailable) actions.push(this.button("Join a game", () => { this.close(); this.d.onJoin(); }, { "data-testid": "coop-join" }));
    if (this.role === "host" && !this.d.touchDevice) actions.push(this.button("Controls", () => this.d.onControls(), { "data-testid": "coop-controls" }));
    if (this.role === "host") {
      if (!this.d.touchDevice && !this.seats.some((s) => s.where === "key2") && this.seats.length < 4) {
        actions.push(this.button("Add a player on this keyboard", () => { this.seats.push({ where: "key2", creature: null, muscle: "Mixed" }); this.renderLobby(); }, { "data-testid": "add-local" }));
      }
      if (this.d.lanAvailable && !this.d.touchDevice && !this.conn) actions.push(this.button("Invite players on the network", () => void this.invite(), { "data-testid": "invite" }));
      const ready = this.seats.length >= 2 && this.seats.every((s) => s.creature);
      const start = this.button("Start expedition", () => this.begin(), { class: "primary", "data-testid": "start-expedition" });
      if (!ready) start.disabled = true;
      actions.push(start);
    } else {
      actions.push(this.el("span", { class: "waiting" }, "The host starts the expedition."));
    }
    const note = this.role === "host" && this.seats.length < 2
      ? this.el("p", { class: "hint" }, this.d.touchDevice
        ? "2 to 4 players. On a phone, join a game hosted on a laptop: tap Join a game."
        : "2 to 4 players. Add a player on this keyboard, or invite players on other devices.") : "";
    ui.replaceChildren(this.el("div", { class: "panel expedition", "data-testid": "expedition-lobby" },
      this.el("h2", {}, "Hatchling Expedition"),
      this.el("p", { class: "lede" }, "Work together through 6 rooms. Every obstacle has two ways through, one for each version of a gene, so mix your creatures."),
      this.role === "host" && this.room ? this.lanBox() : "",
      seats, note,
      this.choosing !== null ? this.chooser(this.choosing) : "",
      this.el("div", { class: "actions" }, ...actions),
      this.backLink("Back", () => { this.close(); this.d.onExit(); }, { "data-testid": "coop-back" })));
  }

  private lanBox(): HTMLElement {
    const url = `http://${this.room!.addresses[0] ?? location.host}/#join=${this.room!.code}`;
    const qr = this.el("canvas", { class: "qr", "aria-label": `QR code for ${url}`, "data-testid": "qr" });
    drawQr(qr, url, 180);
    return this.el("div", { class: "lobby" }, qr, this.el("div", {},
      this.el("p", { class: "kicker" }, "Invite up to 3 players"),
      this.el("p", {}, "Room code ", this.el("strong", { class: "code", "data-testid": "room-code" }, this.room!.code)),
      this.el("p", { class: "hint" }, "On a phone or laptop on the same WiFi or hotspot: scan the code, or open ",
        this.el("strong", {}, `http://${this.room!.addresses[0] ?? location.host}/`), " and choose Join a game.")));
  }

  /** Pick a creature for a seat: the 16 creatures, a creature code box, and the muscle type. */
  private chooser(i: number): HTMLElement {
    const seat = this.role === "host" ? this.seats[i] : null;
    const current = seat ? seat.creature : (this.guestSeats[i]?.name ? CREATURES.find((c) => c.name === this.guestSeats[i].name)! : null);
    const muscle = seat ? seat.muscle : (this.guestSeats[i]?.muscle ?? "Mixed");
    const pick = (c: Creature | null, m: Muscle) => {
      if (seat) { if (c) seat.creature = c; seat.muscle = m; }
      else {
        if (c) this.guestSeats[i] = { ...this.guestSeats[i], name: c.name };
        this.guestSeats[i] = { ...this.guestSeats[i], muscle: m };
        const name = c?.name ?? this.guestSeats[i].name;
        if (name) this.send({ k: "pick", name, muscle: m });
      }
      if (c) void this.render.load(c.name);
      this.renderLobby();
    };
    const input = this.el("input", { class: "code-input small", maxlength: "9", autocapitalize: "characters", autocomplete: "off", spellcheck: "false", placeholder: "ABC-DEF", "aria-label": "Creature code", "data-testid": "coop-code" });
    const load = () => {
      const r = decodeCreature(input.value);
      if (!r.ok) { this.codeNote = r.why; this.renderLobby(); return; }
      const c = creatureWithAxes(r.axes);
      this.codeNote = r.axes.muscle ? `${c.name}, ${r.axes.muscle} muscles.` : `${c.name}. Your file didn't include the sprint gene, so choose your muscles below.`;
      pick(c, r.axes.muscle ?? muscle);
    };
    input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") load(); });
    const grid = this.el("div", { class: "grid" }, ...CREATURES.map((c) => {
      const b = this.el("button", { class: `pick${current === c ? " chosen0" : ""}`, "data-testid": `coop-pick-${c.name}` },
        this.el("img", { src: thumbUrl(c.name), alt: "", decoding: "async" }), this.el("strong", {}, c.name),
        this.el("span", {}, `${c.flame} · ${c.time} · ${c.senses} · ${c.spark}`));
      b.addEventListener("click", () => pick(c, muscle));
      return b;
    }));
    return this.el("div", { class: "chooser" },
      this.el("h3", {}, `${this.role === "guest" ? "Your" : `Player ${i + 1}'s`} creature`),
      this.el("div", { class: "codebox" }, this.el("label", {}, "Creature code"), input, this.button("Load", load, { "data-testid": "coop-code-load" }),
        this.codeNote ? this.el("span", { class: "note ok" }, this.codeNote) : ""),
      grid,
      this.el("div", { class: "muscle" }, this.el("span", {}, "Muscles (ACTN3)"),
        ...MUSCLES.map((m) => this.button(m, () => pick(null, m), { class: m === muscle ? "on" : "", "data-testid": `coop-muscle-${m}` }))),
      this.el("div", { class: "actions" }, this.button("Done", () => { this.choosing = null; this.renderLobby(); }, { class: "primary", "data-testid": "chooser-done" })));
  }

  // ---------------------------------------------------------------- rooms

  private begin(): void {
    if (this.role !== "host") return;
    this.choosing = null;
    this.gemsTotal = 0;
    void Promise.all(this.seats.map((s) => this.render.load(s.creature!.name))).then(() => this.showBadges(this.seatInfos()));
  }

  /** "Meet your team": each explorer's 5-gene badge, before the first room. */
  private showBadges(seats: SeatInfo[]): void {
    this.screen = "panel";
    this.d.powers.hide();
    if (this.role === "host") this.seats.forEach((s, i) => { if (s.where === "remote") this.send({ k: "badges", seats, you: i }, s.id); });
    const cards = seats.map((seat, i) => {
      const c = CREATURES.find((x) => x.name === seat.name)!, p = profileOf(c, seat.muscle);
      const you = this.role === "guest" ? i === this.mySeat : false;
      const card = this.el("div", { class: "badge", "data-testid": `badge-${i}` },
        this.el("p", { class: "seat-who" }, `${you ? "You" : `Player ${i + 1}`} · ${c.name}`),
        this.el("img", { src: thumbUrl(c.name), alt: "" }),
        this.el("ul", { class: "badge-genes" }, ...([p.flame, p.time, p.senses, p.spark, p.muscle] as GeneOption[]).map((o) =>
          this.el("li", {}, this.el("b", {}, o), this.el("span", {}, ABILITY[o]), this.el("small", {}, `${WORLDWIDE[o]}% of people worldwide`)))));
      card.style.setProperty("--seat", PLAYER_COLORS[i]); // set from script: no inline style attributes under the CSP
      return card;
    });
    this.d.ui.replaceChildren(this.el("div", { class: "panel genome", "data-testid": "badges" },
      this.el("p", { class: "kicker" }, "Hatchling Expedition"),
      this.el("h2", {}, "Meet your team"),
      this.el("p", { class: "lede" }, "Five genes each. Every gene version opens its own way through, so look out for what your team can do together."),
      this.el("div", { class: "badges" }, ...cards),
      this.el("p", { class: "hint" }, `Percentages: ${SOURCE}.`),
      this.el("div", { class: "row" }, this.role === "host"
        ? this.button("Start room 1", () => this.startRoom(0), { class: "primary", "data-testid": "start-room-1" })
        : this.el("span", { class: "waiting" }, "The host starts room 1."))));
  }

  private seatInfos(): SeatInfo[] {
    return this.seats.map((s) => ({ name: s.creature?.name ?? null, muscle: s.muscle, remote: s.where === "remote" }));
  }

  private startRoom(index: number): void {
    const infos = this.role === "host" ? this.seatInfos() : this.guestSeats;
    const players = infos.map((s) => ({ creature: CREATURES.find((c) => c.name === s.name)!, muscle: s.muscle }));
    this.world = newWorld(index, players);
    for (const p of players) void this.render.load(p.creature.name);
    this.render.reset();
    this.render.names = infos.map((s, i) => `P${i + 1} ${s.name}`);
    this.render.local = this.role === "guest" ? [this.mySeat] : this.seats.map((s, i) => (s.where === "remote" ? -1 : i)).filter((i) => i >= 0);
    this.screen = "play";
    this.paused = false;
    this.acc = 0;
    this.myAttacks = 0;
    this.d.keys.clearPresses();
    this.d.touch.show(this.d.touchDevice);
    const room = ROOMS[index];
    this.d.powers.show("Your team's powers", infos.map((s, i) => {
      const p = profileOf(CREATURES.find((c) => c.name === s.name)!, s.muscle);
      const you = this.render.local.length === 1 && this.render.local[0] === i;
      return {
        label: `${you ? "You" : `P${i + 1}`} · ${s.name}`, color: PLAYER_COLORS[i],
        lines: ([p.flame, p.time, p.senses, p.spark, p.muscle] as GeneOption[]).map((o) => [o, ABILITY[o]] as [string, string]),
      };
    }));
    this.d.ui.replaceChildren(this.el("div", { class: "coop-top", "data-testid": "coop-hud" },
      this.el("strong", {}, room.name), this.el("span", { class: "coop-status", "data-testid": "coop-status" }),
      this.el("span", { class: "coop-intro" }, room.intro)));
    if (this.role === "host") this.seats.forEach((s, i) => { if (s.where === "remote") this.send({ k: "start", room: index, seats: this.seatInfos(), you: i }, s.id); });
  }

  private handleEvents(ev: CoopEvent[]): void {
    this.render.handle(ev);
    for (const e of ev) {
      if (e.type === "opened") this.d.sound.power("shield");
      if (e.type === "gem") this.d.sound.power("yum");
      if (e.type === "fell") this.d.sound.hit(false);
      if (e.type === "growl") this.d.sound.power("jitters");
      if (e.type === "done") this.d.sound.win();
    }
  }

  /** The team genome panel: which genes the team had and what each one opened. */
  private panelData(w: World): PanelData {
    const team = w.explorers.map((e) => e.profile);
    const rows: PanelData["rows"] = [];
    const geneNames: Array<[keyof Profile, string]> = [["flame", "Flame"], ["time", "Time"], ["senses", "Senses"], ["spark", "Spark"], ["muscle", "Muscles"]];
    for (const [gene, label] of geneNames) {
      const options = [...new Set(team.map((p) => p[gene]))] as GeneOption[];
      for (const o of options) {
        const who = w.explorers.filter((e) => e.profile[gene] === o).map((e) => `P${e.slot + 1}`).join(", ");
        const did = [...new Set(w.log.filter((l) => l.gene === o).map((l) => l.text))];
        rows.push({ gene: `${label}: ${o} (${who})`, text: did.length ? did.join("; ") : ABILITY[o], color: did.length ? "#ffffff" : "#aab0c8" });
      }
    }
    // Gene versions nobody on the team had: what they would have opened here.
    const KIND_GENE: Partial<Record<string, GeneOption[]>> = {
      hidden: ["Keen"], traps: ["Keen"], key: ["Keen"], bramble: ["Bold"], ice: ["Ember"], gate: ["Blaze"], electric: ["Crackling"],
      critter: ["Still"], fragile: ["Still"], sun: ["Dawn"], moon: ["Dusk"], run: ["Sprinter", "Mixed"], block: ["Endurance", "Mixed"],
      sunpad: ["Dawn"], moonpad: ["Dusk"], launcher: ["Blaze"], spring: ["Endurance"],
    };
    const missing: string[] = [];
    const present = (o: GeneOption) => team.some((p) => has(p, o));
    for (const o of Object.keys(GENE_OF) as GeneOption[]) {
      if (present(o)) continue;
      const things = [...w.things.values()].filter((t) => KIND_GENE[t.def.kind]?.includes(o) && !KIND_GENE[t.def.kind]!.some(present));
      if (w.room.dark.length && o === "Ember") missing.push("No Ember on the team: the burrow stayed dark.");
      else if (things.length) missing.push(`No ${o} on the team: a ${o} creature ${ABILITY[o]}, and could have opened ${things.length} more ${things.length === 1 ? "thing" : "things"} here.`);
    }
    const gemsTotal = [...w.things.values()].filter((t) => t.def.kind === "gem").length;
    // "Did you know?": gene versions this room used (both versions of each gene it tests).
    const used = new Set<GeneOption>();
    for (const t of w.things.values()) for (const o of KIND_GENE[t.def.kind] ?? []) for (const other of Object.keys(GENE_OF) as GeneOption[]) if (GENE_OF[other] === GENE_OF[o]) used.add(other);
    if (w.room.dark.length) { used.add("Ember"); used.add("Blaze"); }
    const facts = factsForRoom(w.roomIndex, [...used], team);
    return { room: ROOMS[w.roomIndex].name, rows, missing, gems: w.gems, gemsTotal, last: w.roomIndex === ROOMS.length - 1,
      facts, gemsSoFar: this.gemsTotal, roomsDone: w.roomIndex + 1 };
  }

  private showPanel(p: PanelData): void {
    this.screen = "panel";
    this.d.touch.show(false);
    this.d.powers.hide();
    const next = this.role === "host"
      ? this.button(p.last ? "Finish the expedition" : "Next room", () => this.nextRoom(), { class: "primary", "data-testid": "next-room" })
      : this.el("span", { class: "waiting" }, "Waiting for the host…");
    this.d.ui.replaceChildren(this.el("div", { class: "panel genome", "data-testid": "team-genome" },
      this.el("p", { class: "kicker" }, `${p.room}: done!`),
      this.el("h2", {}, "Your team genome"),
      this.el("ul", { class: "genome-rows" }, ...p.rows.map((r) => {
        const li = this.el("li", {}, this.el("b", {}, r.gene), " ", r.text);
        li.style.color = r.color;
        return li;
      })),
      p.missing.length ? this.el("div", { class: "missing" }, this.el("p", { class: "kicker" }, "Genes you didn't have"), ...p.missing.map((m) => this.el("p", {}, m))) : this.el("p", { class: "hint" }, "Your team had every gene this room uses."),
      p.gemsTotal ? this.el("p", { class: "gems" }, `Bonus gems: ${p.gems} of ${p.gemsTotal}${p.gems < p.gemsTotal ? ". A team with a wider mix of genes finds more." : ". All found!"}`) : "",
      p.facts.length ? this.el("div", { class: "facts", "data-testid": "facts" }, this.el("p", { class: "kicker" }, "Did you know?"),
        ...p.facts.map((f) => this.el("p", {}, f)), this.el("p", { class: "hint" }, `Worldwide figures from the ${SOURCE}.`)) : "",
      this.el("div", { class: "actions" }, this.button("Save team genome card", () => void this.saveCard(p.gemsSoFar, p.roomsDone), { "data-testid": "save-card" }), next)));
  }

  private nextRoom(): void {
    const w = this.world!;
    if (w.roomIndex >= ROOMS.length - 1) {
      this.send({ k: "finale", gems: this.gemsTotal, total: totalGems() });
      this.showFinale(this.gemsTotal, totalGems());
      return;
    }
    this.startRoom(w.roomIndex + 1);
  }

  private showFinale(gems: number, total: number): void {
    this.screen = "finale";
    this.d.touch.show(false);
    this.d.powers.hide();
    this.d.sound.win();
    this.d.ui.replaceChildren(this.el("div", { class: "panel win", "data-testid": "expedition-done" },
      this.el("p", { class: "kicker" }, "Expedition complete!"),
      this.el("h2", {}, "The nest is open"),
      this.el("p", {}, `Your team found ${gems} of ${total} bonus gems.`),
      this.el("p", { class: "hint" }, "Every room had a way through for any team. The more different your genes, the more secrets you find."),
      this.el("div", { class: "actions" },
        this.button("Save team genome card", () => void this.saveCard(gems, ROOMS.length), { "data-testid": "save-card" }),
        this.role === "host" ? this.button("Play again", () => { this.screen = "lobby"; this.world = null; this.renderLobby(); }, { class: "primary" }) : ""),
      this.backLink("Menu", () => { this.close(); this.d.onExit(); }, { "data-testid": "finale-menu" })));
  }

  private retry(): void {
    if (this.role !== "host" || !this.world) return;
    this.startRoom(this.world.roomIndex);
  }

  private pause(on: boolean): void {
    this.paused = on;
    const box = this.d.ui.querySelector(".pause");
    if (!on) { box?.remove(); return; }
    if (box) return;
    this.d.ui.append(this.el("div", { class: "panel pause", "data-testid": "coop-pause" },
      this.el("h2", {}, "Paused"),
      this.el("div", { class: "actions" },
        this.button("Resume", () => this.pause(false), { class: "primary" }),
        this.role === "host" ? this.button("Retry room", () => this.retry(), { "data-testid": "retry-room" }) : ""),
      this.backLink("Quit to menu", () => { this.close(); this.d.onExit(); })));
  }

  /**
   * The team genome card: a picture to save, made on this device. It shows each
   * explorer's creature and its 4 creature genes, the gems found and the rooms done.
   * Nothing else: no codes, no DNA, and no sprint type (ACTN3 stays off shareable
   * pictures, as on the Genome Wrapped story image).
   */
  private async saveCard(gems: number, rooms: number): Promise<void> {
    const seats = this.role === "host" ? this.seatInfos() : this.guestSeats;
    const W = 1080, rowH = 200, H = 330 + seats.length * rowH + 150;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d")!;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#1b2140"); bg.addColorStop(1, "#0b0d1c");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(127,231,255,0.5)"; g.lineWidth = 4; g.strokeRect(30, 30, W - 60, H - 60);
    g.textAlign = "center"; g.fillStyle = "#ffd166"; g.font = "800 64px ui-rounded, system-ui, sans-serif";
    g.fillText("Team genome", W / 2, 140);
    g.fillStyle = "#aab0c8"; g.font = "600 32px ui-rounded, system-ui, sans-serif";
    g.fillText(`Hatchling Expedition · ${rooms} of ${ROOMS.length} rooms · ${gems} bonus gems`, W / 2, 200);
    const imgs = await Promise.all(seats.map((s) => new Promise<HTMLImageElement | null>((ok) => {
      const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = thumbUrl(s.name!);
    })));
    seats.forEach((s, i) => {
      const y = 260 + i * rowH, c2 = CREATURES.find((x) => x.name === s.name)!, p = profileOf(c2, s.muscle);
      const im = imgs[i];
      if (im) { const k = Math.min(190 / im.width, 190 / im.height); g.drawImage(im, 70 + (190 - im.width * k) / 2, y + (190 - im.height * k) / 2, im.width * k, im.height * k); }
      g.textAlign = "left"; g.fillStyle = PLAYER_COLORS[i]; g.font = "800 44px ui-rounded, system-ui, sans-serif";
      g.fillText(`P${i + 1} · ${s.name}`, 290, y + 60);
      g.fillStyle = "#f4f1ea"; g.font = "600 30px ui-rounded, system-ui, sans-serif";
      g.fillText([p.flame, p.time, p.senses, p.spark].join(" · "), 290, y + 115);
    });
    g.textAlign = "center"; g.fillStyle = "#aab0c8"; g.font = "500 26px ui-rounded, system-ui, sans-serif";
    g.fillText("Creature Arena · made on our own devices", W / 2, H - 70);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = this.el("a", { href: url, download: "team-genome.png" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ---------------------------------------------------------------- frame

  /** Called every animation frame while the expedition is open. */
  frame(dt: number): void {
    const { keys } = this.d;
    if (this.screen === "play" && keys.take("Escape")) this.pause(!this.paused);
    if (this.screen !== "play" || !this.world) return;
    const w = this.world;
    if (this.role === "guest") {
      const c = this.controls(this.d.touchDevice ? "touch" : "both");
      if (c.action) this.myAttacks++;
      this.conn?.send({ t: "input", x: c.dir.x, y: c.dir.y, attacks: this.myAttacks, sprint: c.sprint });
      this.render.reserve = this.d.powers.reserved();
      this.render.draw(w, dt, [w.explorers[this.mySeat]].filter(Boolean));
      this.status(w);
      return;
    }
    if (!this.paused) {
      // Local controls once per frame; remote ones from the latest message.
      const local = this.seats.map((s) => (s.where === "remote" ? null
        : this.controls(s.where === "touch" ? "touch" : s.where === "key2" ? "p2" : this.seats.some((o) => o.where === "key2") ? "p1" : "both")));
      this.acc += dt;
      let first = true;
      while (this.acc >= STEP) {
        this.acc -= STEP;
        w.explorers.forEach((e, i) => {
          const s = this.seats[i], c = local[i];
          if (c) { e.intent = c.dir; e.sprintHeld = c.sprint; e.actionPressed = first && c.action; }
          else if (s?.where === "remote") {
            const inp = this.inputs.get(s.id!)!;
            e.intent = { x: inp.x, y: inp.y }; e.sprintHeld = inp.sprint;
            if (inp.attacks > inp.seen) { e.actionPressed = true; inp.seen = inp.attacks; }
          }
        });
        first = false;
        stepWorld(w, STEP);
        this.handleEvents(w.events);
        if (this.conn) this.send({ k: "state", s: snap(w), ev: w.events });
        if (w.done) {
          this.gemsTotal += w.gems;
          const p = this.panelData(w);
          this.send({ k: "panel", panel: p });
          this.showPanel(p);
          break;
        }
      }
    }
    this.render.reserve = this.d.powers.reserved();
    const follow = w.explorers.filter((_, i) => this.seats[i]?.where !== "remote");
    this.render.draw(w, this.paused ? 0 : dt, follow.length ? follow : w.explorers);
    this.status(w);
  }

  private status(w: World): void {
    const el = this.d.ui.querySelector(".coop-status");
    if (!el) return;
    const plates = platesStatus(w);
    const time = w.night ? "Night" : "Day";
    el.textContent = `${time} · gems ${w.gems}${plates ? ` · plates ${plates.on} of ${plates.need}` : ""}${this.role === "host" && !this.d.touchDevice ? " · Esc pause" : ""}`;
  }

  private controls(which: "p1" | "p2" | "both" | "touch"): { dir: { x: number; y: number }; sprint: boolean; action: boolean } {
    const { keys, touch } = this.d;
    const maps: KeyMap[] = which === "p1" ? [P1_KEYS] : which === "p2" ? [P2_KEYS] : which === "both" ? [P1_KEYS, P2_KEYS] : [];
    let x = 0, y = 0, sprint = false, action = false;
    for (const k of maps) {
      const d = keys.direction(k);
      x += d.x; y += d.y;
      if (keys.held(k.sprint)) sprint = true;
      if (keys.take(k.attack)) action = true;
    }
    if (which === "touch" || this.d.touchDevice) {
      const t = touch.direction();
      x += t.x; y += t.y;
      if (touch.sprint()) sprint = true;
      if (touch.takeAttack()) action = true;
    }
    const l = Math.hypot(x, y);
    return { dir: l > 1 ? { x: x / l, y: y / l } : { x, y }, sprint, action };
  }
}

// ------------------------------------------------------------------ helpers

const clamp = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
const keysText = (k: KeyMap) => `${[k.up, k.left, k.down, k.right].map(keyName).join(" ")} + ${keyName(k.attack)}, ${keyName(k.sprint)} to sprint`;
const totalGems = () => ROOMS.reduce((n, r) => n + [...r.map.join("")].filter((ch) => r.legend[ch]?.kind === "gem").length, 0);

function geneChips(p: Profile): HTMLElement {
  const ul = document.createElement("ul");
  ul.className = "chips";
  for (const o of [p.flame, p.time, p.senses, p.spark, p.muscle] as GeneOption[]) {
    const li = document.createElement("li");
    li.textContent = o;
    li.title = `${o}: ${ABILITY[o]}`;
    ul.append(li);
  }
  return ul;
}

function snap(w: World): Snap {
  const th: Record<string, number[]> = {};
  for (const t of w.things.values()) th[t.id] = [t.open ? 1 : 0, r2(t.progress), r2(t.timer), t.revealed ? 1 : 0, r2(t.offset), t.held ? 1 : 0];
  return {
    room: w.roomIndex, time: r2(w.time), night: w.night, nightness: r2(w.nightness), cycleIn: r2(w.cycleIn), gems: w.gems, done: w.done, lit: [...w.lit],
    ex: w.explorers.map((e) => [Math.round(e.x), Math.round(e.y), Math.round(e.vx), Math.round(e.vy), e.facing, r2(e.stamina), e.sprinting ? 1 : 0, e.winded ? 1 : 0, r2(e.dashT), r2(e.falling), r2(e.bob), r2(e.flightK)]),
    th,
  };
}

function applySnap(w: World, s: Snap): void {
  Object.assign(w, { time: s.time, night: s.night, nightness: s.nightness, cycleIn: s.cycleIn, gems: s.gems, done: s.done, lit: new Set(s.lit) });
  s.ex.forEach((v, i) => {
    const e = w.explorers[i];
    if (!e) return;
    [e.x, e.y, e.vx, e.vy] = v;
    e.facing = v[4] as 1 | -1; e.stamina = v[5]; e.sprinting = !!v[6]; e.winded = !!v[7]; e.dashT = v[8]; e.falling = v[9]; e.bob = v[10]; e.flightK = v[11] ?? 0;
  });
  for (const [id, v] of Object.entries(s.th)) {
    const t = w.things.get(id);
    if (!t) continue;
    t.open = !!v[0]; t.progress = v[1]; t.timer = v[2]; t.revealed = !!v[3]; t.offset = v[4]; t.held = !!v[5];
  }
}

