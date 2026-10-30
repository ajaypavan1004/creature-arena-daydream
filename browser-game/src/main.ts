// Creature Arena: two Genome Wrapped creatures fight in a stone ring, and their genes
// decide what each power up does to them. Screens are plain DOM over the canvas; the
// fight runs at a fixed simulation rate.
//
// Modes: against the computer, 2 players on one keyboard, and local network play (the
// host's browser runs the game; the guest's device sends controls and draws the state).
import { Bot } from "./bot.ts";
import { CONFIG } from "./config.ts";
import { decodeCreature } from "./code.ts";
import { Expedition } from "./coop/ui.ts";
import { artUrl, creature, creatureWithAxes, CREATURES, thumbUrl, type Creature } from "./creatures.ts";
import { ACTION_NAMES, ACTIONS, bindKey, Keyboard, keyName, loadKeys, P1_KEYS, P2_KEYS, resetKeys, type Action, type KeyMap } from "./input.ts";
import { applySnapshot, Connection, lanAddresses, snapshot, type Message } from "./net.ts";
import { drawQr } from "./qr.ts";
import { PowersPanel, type PowersEntry } from "./powers.ts";
import { Renderer } from "./render.ts";
import { MUSCLES, newGame, step, type Game, type GameEvent, type Muscle, type Vec } from "./sim.ts";
import { Sound } from "./sound.ts";
import { isTouchDevice, TouchControls } from "./touch.ts";
import { WALKS } from "./walks.ts";

const STEP = 1 / 120;
// Recording mode (#rec): exposes the game state, and "#rec&slow=0.4" runs the game
// slower so a screen recorder can catch every frame (the video is sped back up).
const HASH = new URLSearchParams(location.hash.slice(1));
const TIME_SCALE = HASH.has("rec") ? Number(HASH.get("slow") ?? 1) : 1;

const canvas = document.querySelector<HTMLCanvasElement>("#arena")!;
const ui = document.querySelector<HTMLDivElement>("#ui")!;
const renderer = new Renderer(canvas);
loadKeys();
const keys = new Keyboard();
const sound = new Sound();
const touch = new TouchControls();
const TOUCH = isTouchDevice();
const LAN = lanAddresses();
const powers = new PowersPanel();
const expedition = new Expedition({
  canvas, ui, keys, touch, sound, powers, touchDevice: TOUCH, lanAvailable: !!LAN, onExit: () => showTitle(),
  onJoin: () => showJoin(), onControls: () => showControls(() => expedition.reopenLobby()),
});

type Mode = "cpu" | "2p" | "lan";
type Screen = "title" | "select" | "fight" | "win" | "join" | "controls";

let mode: Mode = "cpu";
let screen: Screen = "title";
/** The two chosen creatures (slot 0 = Player 1; slot 1 = the computer or Player 2). */
const picks: [Creature | null, Creature | null] = [creature("Shadepounce"), creature("Moonwhisker")];
/** Each side's muscle stat (the ACTN3 sprinter/endurance trait), chosen in the picker. */
const muscles: [Muscle, Muscle] = ["Sprinter", "Endurance"];
let game: Game | null = null;
let bot = new Bot();

/** Local network: this device's role, the connection, and what the other side has done. */
let role: "host" | "guest" | null = null;
let conn: Connection | null = null;
let room: { code: string; addresses: string[] } | null = null;
let guestHere = false;
let guestInput = { x: 0, y: 0, attacks: 0, sprint: false };
let guestAttacksSeen = 0;
let netEvents: GameEvent[] = [];
let myAttacks = 0;
let joinCreatureCode = "";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) k === "class" ? (e.className = v) : e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

function button(label: string, onClick: () => void, props: Record<string, string> = {}): HTMLButtonElement {
  const b = el("button", props, label);
  b.addEventListener("click", onClick);
  return b;
}

/** Navigation (Back, Menu, Leave): a quiet link on its own line under the action buttons, never among them. */
function backLink(label: string, onClick: () => void, props: Record<string, string> = {}): HTMLButtonElement {
  return button(`‹ ${label}`, onClick, { ...props, class: `back-link ${props.class ?? ""}`.trim() });
}

function slotName(slot: 0 | 1): string {
  if (mode === "cpu") return slot === 0 ? "You" : "Computer";
  if (mode === "lan") return (slot === 0) === (role === "host") ? "You" : `Player ${slot + 1}`;
  return `Player ${slot + 1}`;
}

/** The slot this device controls in the picker (in local 2 player, whoever's turn it is). */
const mySlot = (): 0 | 1 => (mode === "lan" ? (role === "guest" ? 1 : 0) : turn);

/** Key hints that follow each player's chosen keys. */
const kbd = (code: string) => el("kbd", {}, keyName(code));
const moveKeys = (k: KeyMap) => el("kbd", {}, [k.up, k.left, k.down, k.right].map(keyName).join(" "));
function playerKeysHint(label: string, k: KeyMap, extra: Array<Node | string> = []): HTMLElement {
  return el("p", { class: "hint" }, `${label}: `, moveKeys(k), " move, ", kbd(k.attack), " attack, ", kbd(k.sprint), " sprint", ...extra);
}

const MUSCLE_TEXT: Record<Muscle, string> = {
  Sprinter: "Big burst, tires fast (ACTN3 CC)",
  Mixed: "Medium burst, medium stamina (ACTN3 CT)",
  Endurance: "Smaller boost, lasts much longer (ACTN3 TT)",
};

/** Creature code box (picker and LAN join): what was typed, and the last result. */
let codeText = "";
let codeNote: { ok: boolean; text: string } | null = null;

/** Load a creature code into a slot. Returns false (and says why) if it isn't valid. */
function applyCode(text: string, slot: 0 | 1): boolean {
  const r = decodeCreature(text);
  if (!r.ok) { codeNote = { ok: false, text: r.why }; return false; }
  const c = creatureWithAxes(r.axes);
  picks[slot] = c;
  void renderer.load(c.name);
  if (r.axes.muscle) muscles[slot] = r.axes.muscle;
  codeNote = {
    ok: true,
    text: r.axes.muscle ? `${c.name}, ${r.axes.muscle} muscles.`
      : `${c.name}. Your file didn't include the sprint gene, so choose your muscles below.`,
  };
  return true;
}

/** What the creature's genes mean in the arena, one line per gene. */
export function geneLines(c: Creature): Array<[string, string]> {
  return [
    [c.flame, c.flame === "Blaze" ? "Coffee gives a speed boost" : "Coffee gives it the jitters"],
    [c.time, c.time === "Dawn" ? "Hits harder by day" : "Hits harder at night"],
    [c.senses, c.senses === "Bold" ? "Bitter greens heal it" : "Senses power ups early; bitter greens make it reel"],
    [c.spark, c.spark === "Crackling" ? "Energy orb: lightning dash" : "Energy orb: calm shield"],
  ];
}

const muteButton = button(sound.muted ? "Sound off" : "Sound on", () => toggleMute(), { class: "mute", "aria-pressed": String(sound.muted), "data-testid": "mute" });
document.body.append(muteButton);
function toggleMute(): void {
  const m = sound.toggleMute();
  muteButton.textContent = m ? "Sound off" : "Sound on";
  muteButton.setAttribute("aria-pressed", String(m));
}

// --------------------------------------------------------------------- title

/** The first screen: fight, or play together. */
function showTitle(): void {
  leaveLan();
  screen = "title";
  game = null;
  touch.show(false);
  powers.hide();
  const fight = button("Fight", () => showFightMenu(), { class: "primary big", "data-testid": "mode-fight" });
  const coop = button("Co-op", () => { game = null; expedition.openHost(); }, { class: "primary big", "data-testid": "mode-coop" });
  ui.replaceChildren(el("div", { class: "panel title" },
    el("h1", {}, "Creature Arena"),
    el("p", { class: "lede" }, "Your creature's genes are its powers. Fight with them, or team up."),
    el("div", { class: "choices" },
      el("div", { class: "choice" }, fight, el("p", {}, "One on one in the arena: against the computer, a friend on the same keyboard, or over the local network.")),
      el("div", { class: "choice" }, coop, el("p", {}, "Hatchling Expedition: 2 to 4 players work together through puzzle rooms. Every gene opens its own way through."))),
    el("p", { class: "hint" }, "Got a creature code from Genome Wrapped? You can enter it when you choose your creature.")));
  if (!TOUCH) fight.focus();
}

/** Fight options: against the computer, 2 players, local network, controls. */
function showFightMenu(): void {
  leaveLan();
  screen = "title";
  game = null;
  touch.show(false);
  powers.hide();
  const cpu = button("Player vs Computer", () => showSelect("cpu"), { class: "primary", "data-testid": "mode-cpu" });
  const modes: HTMLElement[] = [cpu];
  // On phones there's no shared keyboard, so no same-screen 2 player mode.
  if (!TOUCH) modes.push(button("2 Players", () => showSelect("2p"), { "data-testid": "mode-2p" }));
  if (!TOUCH) modes.push(button("Controls", () => showControls(() => showFightMenu()), { "data-testid": "mode-controls" }));
  if (LAN) {
    if (!TOUCH) modes.push(button("Host on local network", () => void hostLan(), { "data-testid": "mode-host" }));
    modes.push(button("Join a game", () => showJoin(), { "data-testid": "mode-join" }));
  }
  const controls = TOUCH
    ? [el("p", { class: "hint" }, "Left thumb: move · Right: Attack and Sprint")]
    : [playerKeysHint("Player 1", P1_KEYS), playerKeysHint("Player 2", P2_KEYS, [" · ", el("kbd", {}, "M"), " mute"])];
  ui.replaceChildren(el("div", { class: "panel title" },
    el("h1", {}, "Fight"),
    el("p", { class: "lede" }, "Your creature's genes decide what every power up does to it."),
    el("div", { class: "actions" }, ...modes),
    backLink("Back", () => showTitle(), { "data-testid": "fight-back" }),
    el("ul", { class: "legend" },
      el("li", {}, el("strong", {}, "Coffee"), " Blaze gets a boost, Ember gets the jitters"),
      el("li", {}, el("strong", {}, "Bitter greens"), " Bold munches them and heals; Keen tastes the bitterness and reels"),
      el("li", {}, el("strong", {}, "Sharp senses"), " Keen creatures see where power ups will appear, and grab them from further away"),
      el("li", {}, el("strong", {}, "Energy orb"), " Crackling gets a lightning dash, Still gets a shield"),
      el("li", {}, el("strong", {}, "Day and night"), " Dawn creatures hit harder by day, Dusk at night"),
      el("li", {}, el("strong", {}, "Sprint"), " Sprinter muscles burst fast and tire fast; Endurance lasts; Mixed is in between"),
      el("li", {}, el("strong", {}, "Creature code"), " Got one from Genome Wrapped? Enter it on the next screen")),
    ...controls));
  if (!TOUCH) cpu.focus();
}

// -------------------------------------------------------------------- picker

/** Picker state: whose turn it is to choose, and each player's keyboard cursor. */
let turn: 0 | 1 = 0;
const cursor: [number, number] = [0, 0];

function showSelect(m: Mode): void {
  powers.hide();
  mode = m;
  screen = "select";
  game = null;
  touch.show(false);
  turn = mode === "lan" ? mySlot() : 0;
  if (mode === "lan" && role === "guest") picks[1] = null; // the guest chooses its own
  if (mode === "lan" && role === "host") picks[1] = null;
  cursor[0] = Math.max(0, CREATURES.findIndex((c) => c === picks[0]));
  cursor[1] = Math.max(0, CREATURES.findIndex((c) => c === picks[1]));
  renderSelect();
  shareLobby();
}

function choose(c: Creature): void {
  picks[turn] = c;
  void renderer.load(c.name);
  if (mode !== "lan" && turn === 0) turn = 1;
  renderSelect();
  shareLobby();
  sendPick();
}

function setMuscle(s: 0 | 1, m: Muscle): void {
  muscles[s] = m;
  renderSelect();
  shareLobby();
  sendPick();
}

/** Guest -> host: this player's creature and muscles. */
function sendPick(): void {
  if (role === "guest" && picks[1]) conn?.send({ t: "pick", name: picks[1].name, muscle: muscles[1] });
}

function renderSelect(): void {
  if (screen !== "select") return;
  const own = (s: 0 | 1) => mode !== "lan" || s === mySlot();
  const slot = (s: 0 | 1) => {
    const c = picks[s];
    const waiting = mode === "lan" && !own(s)
      ? (role === "host" && !guestHere ? "Waiting for a player to join…" : `${slotName(s)} is choosing…`) : "Choose…";
    const box = el("button", { class: `slot slot${s}${turn === s ? " active" : ""}`, "data-testid": `slot-${s}` },
      el("span", { class: "who" }, slotName(s)),
      c ? el("img", { src: thumbUrl(c.name), alt: "" }) : el("span", { class: "empty" }, "?"),
      el("strong", {}, c?.name ?? waiting),
      c ? el("ul", { class: "genes" }, ...geneLines(c).map(([g, t]) => el("li", {}, el("b", {}, g), " ", t))) : "");
    if (own(s)) box.addEventListener("click", () => { turn = s; renderSelect(); });
    else box.disabled = true;
    // Muscle stat: not one of the 4 creature genes, so it's chosen separately for now.
    const muscle = el("div", { class: "muscle", role: "radiogroup", "aria-label": `${slotName(s)}: muscle type (ACTN3)` },
      el("span", {}, "Muscles (ACTN3)"),
      ...MUSCLES.map((m) => {
        const b = button(m, () => setMuscle(s, m),
          { role: "radio", "aria-checked": String(muscles[s] === m), class: muscles[s] === m ? "on" : "", "data-testid": `muscle-${s}-${m}` });
        b.title = MUSCLE_TEXT[m];
        if (!own(s)) b.disabled = true;
        return b;
      }),
      el("small", {}, MUSCLE_TEXT[muscles[s]]));
    return el("div", { class: "slotwrap" }, box, muscle);
  };
  const grid = el("div", { class: "grid", role: "listbox", "aria-label": `Creature for ${slotName(turn)}` },
    ...CREATURES.map((c, i) => {
      const classes = ["pick"];
      if (picks[0] === c) classes.push("chosen0");
      if (picks[1] === c) classes.push("chosen1");
      if (!TOUCH) {
        if (mode === "2p") { if (cursor[0] === i) classes.push("cursor0"); if (cursor[1] === i) classes.push("cursor1"); }
        else if (cursor[0] === i) classes.push(`cursor${turn}`);
      }
      const b = el("button", { class: classes.join(" "), "data-testid": `pick-${c.name}`, role: "option", "aria-selected": String(picks[turn] === c) },
        el("img", { src: thumbUrl(c.name), alt: "", decoding: "async" }),
        el("strong", {}, c.name),
        el("span", {}, `${c.flame} · ${c.time} · ${c.senses} · ${c.spark}`),
        WALKS[c.name] ? el("em", {}, "animated") : "");
      b.addEventListener("click", () => choose(c));
      return b;
    }));

  const back = backLink(mode === "lan" ? "Leave" : "Back", () => showFightMenu(), { "data-testid": "select-back" });
  const actions: HTMLElement[] = [];
  if (mode !== "lan") {
    actions.push(button(mode === "cpu" ? "Random opponent" : `Random for ${slotName(turn)}`, () => {
      const others = CREATURES.filter((c) => c !== picks[turn === 1 ? 0 : 1]);
      choose(others[Math.floor(Math.random() * others.length)]);
    }));
  }
  if (role !== "guest") {
    const fight = button("Fight!", () => void startFight(), { class: "primary", "data-testid": "fight" });
    if (!picks[0] || !picks[1] || (mode === "lan" && !guestHere)) fight.disabled = true;
    actions.push(fight);
  } else {
    actions.push(el("span", { class: "waiting" }, picks[1] ? "Ready. The host starts the fight." : "Choose your creature"));
  }

  const heading = mode === "cpu" ? (turn === 0 ? "Choose your creature" : "Choose the computer's creature")
    : mode === "lan" ? "Choose your creature" : `${slotName(turn)}: choose your creature`;
  const keysHint = TOUCH ? "" : mode === "2p"
    ? el("p", { class: "hint" }, "Player 1: ", moveKeys(P1_KEYS), " to move, ", kbd(P1_KEYS.attack), " to choose · Player 2: ", moveKeys(P2_KEYS), " and ", kbd(P2_KEYS.attack))
    : el("p", { class: "hint" }, moveKeys(P1_KEYS), " or ", moveKeys(P2_KEYS), " to move, ", kbd(P1_KEYS.attack), " or ", kbd(P2_KEYS.attack), " to choose");
  // Creature code from Genome Wrapped: loads the creature and sprint type in one go.
  const codeInput = el("input", { class: "code-input small", maxlength: "9", autocapitalize: "characters", autocomplete: "off",
    spellcheck: "false", placeholder: "ABC-DEF", "aria-label": "Creature code", "data-testid": "creature-code", value: codeText });
  const load = () => {
    codeText = codeInput.value;
    const target = mySlot();
    if (applyCode(codeText, target)) {
      turn = target;
      if (mode !== "lan" && target === 0 && !picks[1]) turn = 1;
      shareLobby();
      sendPick();
    }
    renderSelect();
  };
  codeInput.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") load(); });
  codeInput.addEventListener("input", () => { codeText = codeInput.value; });
  const codeBox = el("div", { class: "codebox" },
    el("label", {}, mode === "cpu" && turn === 1 ? "Computer's creature code" : "Creature code"), codeInput,
    button("Load", load, { "data-testid": "creature-code-load" }),
    codeNote ? el("span", { class: codeNote.ok ? "note ok" : "note bad", "data-testid": "creature-code-note", role: "status" }, codeNote.text) : "");

  ui.replaceChildren(el("div", { class: "panel select", "data-testid": "select" },
    role === "host" && room ? lobbyBox() : "",
    el("h2", {}, heading),
    codeBox,
    el("div", { class: "slots" }, slot(0), el("div", { class: "vs" }, "vs"), slot(1)),
    grid,
    el("div", { class: "actions" }, ...actions),
    back,
    keysHint));
}

/** Keyboard picking: each player moves their own cursor and confirms with their attack key. */
function selectKeys(): void {
  const cols = getComputedStyle(document.querySelector(".grid") ?? document.body).gridTemplateColumns.split(" ").length || 4;
  const steer = (k: KeyMap, who: 0 | 1) => {
    let moved = false;
    if (keys.take(k.left)) { cursor[who] = (cursor[who] + CREATURES.length - 1) % CREATURES.length; moved = true; }
    if (keys.take(k.right)) { cursor[who] = (cursor[who] + 1) % CREATURES.length; moved = true; }
    if (keys.take(k.up)) { cursor[who] = (cursor[who] + CREATURES.length - cols) % CREATURES.length; moved = true; }
    if (keys.take(k.down)) { cursor[who] = (cursor[who] + cols) % CREATURES.length; moved = true; }
    return moved;
  };
  if (mode === "2p") {
    let changed = steer(P1_KEYS, 0);
    changed = steer(P2_KEYS, 1) || changed;
    if (keys.take(P1_KEYS.attack)) { turn = 0; choose(CREATURES[cursor[0]]); changed = false; }
    if (keys.take(P2_KEYS.attack)) { turn = 1; choose(CREATURES[cursor[1]]); changed = false; }
    if (changed) renderSelect();
  } else {
    // One player on this device: either set of keys works.
    const moved = steer(P1_KEYS, 0) || steer(P2_KEYS, 0);
    if (moved) renderSelect();
    if (keys.take(P1_KEYS.attack) || keys.take(P2_KEYS.attack)) choose(CREATURES[cursor[0]]);
  }
  if (keys.take("Escape")) showFightMenu();
}

// ------------------------------------------------------------ local network

function lobbyBox(): HTMLElement {
  const url = `http://${room!.addresses[0] ?? location.host}/#join=${room!.code}`;
  const qr = el("canvas", { class: "qr", "aria-label": `QR code for ${url}`, "data-testid": "qr" });
  drawQr(qr, url, 220);
  return el("div", { class: "lobby", "data-testid": "lobby" },
    qr,
    el("div", {},
      el("p", { class: "kicker" }, "Local network game"),
      el("p", {}, "Room code ", el("strong", { class: "code", "data-testid": "room-code" }, room!.code)),
      el("p", { class: "hint" }, "On the other phone or laptop (same WiFi or hotspot): scan the QR code, or open ",
        el("strong", {}, `http://${room!.addresses[0] ?? location.host}/`), ", choose Join a game and type the code."),
      el("p", { class: guestHere ? "status ok" : "status" }, guestHere ? "Player 2 has joined." : "Waiting for Player 2…")));
}

async function hostLan(): Promise<void> {
  leaveLan();
  role = "host";
  conn = new Connection();
  conn.onmessage = onHostMessage;
  conn.onclose = () => { if (role === "host") lanError("Lost the connection to the game server. Is it still running?"); };
  try { await conn.ready(); } catch { lanError("Couldn't reach the game server on this laptop. Start it with: npm run lan"); return; }
  conn.send({ t: "host" });
}

function onHostMessage(m: Message): void {
  if (m.t === "room") { room = { code: m.code, addresses: m.addresses }; showSelect("lan"); }
  else if (m.t === "guest-joined") { guestHere = true; renderSelect(); shareLobby(); }
  else if (m.t === "guest-left") {
    guestHere = false; picks[1] = null;
    if (screen !== "select") showSelect("lan"); else renderSelect();
  } else if (m.t === "pick") {
    const c = CREATURES.find((x) => x.name === m.name);
    if (c) { picks[1] = c; void renderer.load(c.name); }
    if (MUSCLES.includes(m.muscle)) muscles[1] = m.muscle;
    renderSelect();
    shareLobby();
  } else if (m.t === "input") {
    guestInput = { x: clamp(m.x), y: clamp(m.y), attacks: m.attacks | 0, sprint: !!m.sprint };
  }
}

const clamp = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

/** Host -> guest: both players' choices, so the guest's picker shows the host's creature. */
function shareLobby(): void {
  if (role !== "host" || !conn) return;
  const side = (s: 0 | 1) => (picks[s] ? { name: picks[s]!.name, muscle: muscles[s] } : null);
  conn.send({ t: "lobby", host: side(0), guest: side(1) });
  if (screen === "select") conn.send({ t: "screen", screen: "lobby" });
}

function showJoin(code = ""): void {
  powers.hide();
  leaveLan();
  screen = "join";
  touch.show(false);
  const input = el("input", { class: "code-input", maxlength: "4", autocapitalize: "characters", autocomplete: "off", spellcheck: "false",
    placeholder: "CODE", "aria-label": "Room code", "data-testid": "join-code", value: code });
  const creatureCode = el("input", { class: "code-input small", maxlength: "9", autocapitalize: "characters", autocomplete: "off",
    spellcheck: "false", placeholder: "ABC-DEF", "aria-label": "Your creature code (optional)", "data-testid": "join-creature-code", value: joinCreatureCode });
  const join = () => {
    joinCreatureCode = creatureCode.value.trim();
    if (joinCreatureCode) {
      const r = decodeCreature(joinCreatureCode);
      if (!r.ok) { joinError(`Creature code: ${r.why}`); return; }
    }
    void joinLan(input.value);
  };
  const go = button("Join", join, { class: "primary", "data-testid": "join-go" });
  for (const box of [input, creatureCode]) box.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") join(); });
  ui.replaceChildren(el("div", { class: "panel join", "data-testid": "join" },
    el("h2", {}, "Join a game"),
    el("p", {}, "Type the room code shown on the host's screen."),
    el("div", { class: "row" }, input, go),
    el("p", { class: "hint" }, "Your creature code from Genome Wrapped (optional): "),
    el("div", { class: "row" }, creatureCode),
    el("p", { class: "error", "data-testid": "join-error" }),
    backLink("Back", () => showTitle(), { "data-testid": "join-back" })));
  input.focus();
  if (code) void joinLan(code);
}

async function joinLan(code: string): Promise<void> {
  const clean = code.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (clean.length !== 4) { joinError("The code is 4 letters."); return; }
  leaveLan();
  role = "guest";
  mode = "lan";
  conn = new Connection();
  conn.onmessage = onGuestMessage;
  conn.onclose = () => { if (role === "guest") lanError("The connection to the host was lost."); };
  try { await conn.ready(); } catch { lanError("Couldn't reach the host. Check you're on the same WiFi or hotspot."); return; }
  conn.send({ t: "join", code: clean });
}

function joinError(why: string): void {
  const e = document.querySelector('[data-testid="join-error"]');
  if (e) e.textContent = why;
}

function onGuestMessage(m: Message): void {
  // Hatchling Expedition: the expedition screens handle everything after joining.
  if (m.t === "joined" && m.mode === "coop") { expedition.openGuest(conn!); return; }
  if (expedition.active) {
    if (m.t === "host-left") { expedition.close(); lanError("The host ended the expedition."); }
    else expedition.guestMessage(m);
    return;
  }
  if (m.t === "error") { const why = m.why; leaveLan(); showJoin(); joinError(why); }
  else if (m.t === "joined") {
    muscles[1] = "Sprinter";
    picks[1] = null;
    showSelect("lan");
    // A creature code typed on the join screen picks the creature straight away.
    if (joinCreatureCode && applyCode(joinCreatureCode, 1)) { sendPick(); renderSelect(); }
  }
  else if (m.t === "host-left") lanError("The host ended the game.");
  else if (m.t === "lobby") {
    const find = (n?: string) => CREATURES.find((c) => c.name === n) ?? null;
    picks[0] = find(m.host?.name);
    if (m.host) { muscles[0] = m.host.muscle; void renderer.load(m.host.name); }
    renderSelect();
  } else if (m.t === "screen") {
    if (m.screen === "lobby" && screen !== "select") showSelect("lan");
    if (m.screen === "fight") enterGuestFight();
    if (m.screen === "win" && game) showWin(game);
  } else if (m.t === "state") {
    if (screen !== "fight" && screen !== "win") enterGuestFight();
    game = applySnapshot(game, m.s);
    renderer.handle(m.ev, game);
    sound.handle(m.ev);
  }
}

function enterGuestFight(): void {
  if (screen === "fight") return;
  screen = "fight";
  game = null;
  renderer.resetMatch();
  renderer.labels = [`${slotName(0)} · ${picks[0]?.name ?? ""}`, `${slotName(1)} · ${picks[1]?.name ?? ""}`];
  renderer.viewers = [1];
  showFightPowers();
  ui.replaceChildren(TOUCH ? "" : el("p", { class: "fight-hint" }, el("kbd", {}, "Esc"), " leave · ", el("kbd", {}, "M"), " mute"));
  touch.show(TOUCH);
  myAttacks = 0;
  keys.clearPresses();
}

function lanError(why: string): void {
  leaveLan();
  screen = "title";
  game = null;
  touch.show(false);
  ui.replaceChildren(el("div", { class: "panel", "data-testid": "lan-error" },
    el("h2", {}, "Local network game"),
    el("p", {}, why),
    button("Back to menu", () => showTitle(), { class: "primary" })));
}

function leaveLan(): void {
  const c = conn;
  role = null; conn = null; room = null; guestHere = false;
  c?.close();
  if (mode === "lan") mode = "cpu";
}

// ------------------------------------------------------------------ controls

/** Which key is being changed (waiting for a key press), and the last message. */
let rebinding: { player: 0 | 1; action: Action } | null = null;
let controlsNote: { ok: boolean; text: string } | null = null;

let controlsBack: () => void = () => showTitle();

function showControls(back: () => void = () => showTitle()): void {
  controlsBack = back;
  screen = "controls";
  powers.hide();
  game = null;
  rebinding = null;
  controlsNote = null;
  renderControls();
}

function renderControls(): void {
  const maps = [P1_KEYS, P2_KEYS] as const;
  const cell = (p: 0 | 1, a: Action) => {
    const waiting = rebinding?.player === p && rebinding.action === a;
    const b = button(waiting ? "Press a key…" : keyName(maps[p][a]), () => { rebinding = { player: p, action: a }; controlsNote = null; renderControls(); },
      { class: `keycap${waiting ? " waiting" : ""}`, "data-testid": `key-${p}-${a}`, "aria-label": `Player ${p + 1} ${ACTION_NAMES[a]}: ${keyName(maps[p][a])}. Change` });
    return el("td", {}, b);
  };
  const table = el("table", { class: "keys" },
    el("thead", {}, el("tr", {}, el("th", {}, ""), el("th", { class: "p1" }, "Player 1"), el("th", { class: "p2" }, "Player 2"))),
    el("tbody", {}, ...ACTIONS.map((a) => el("tr", {}, el("th", { scope: "row" }, ACTION_NAMES[a]), cell(0, a), cell(1, a)))));
  ui.replaceChildren(el("div", { class: "panel controls", "data-testid": "controls" },
    el("h2", {}, "Controls"),
    el("p", { class: "hint" }, "Click a key, then press the new key. Esc cancels. Your choices are saved in this browser."),
    table,
    el("p", { class: controlsNote ? (controlsNote.ok ? "note ok" : "note bad") : "note", role: "status", "data-testid": "controls-note" }, controlsNote?.text ?? ""),
    el("div", { class: "actions" },
      button("Reset to defaults", () => { resetKeys(); rebinding = null; controlsNote = { ok: true, text: "Back to the default keys." }; renderControls(); }, { "data-testid": "keys-reset" }),
      button("Done", () => controlsBack(), { class: "primary", "data-testid": "keys-done" }))));
}

// While changing a key, grab the next key press before the game sees it.
addEventListener("keydown", (e) => {
  if (screen !== "controls" || !rebinding) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const { player, action } = rebinding;
  if (e.code === "Escape") { rebinding = null; controlsNote = null; renderControls(); return; }
  const why = bindKey(player, action, e.code);
  if (why) controlsNote = { ok: false, text: why };
  else { controlsNote = { ok: true, text: `Player ${player + 1} ${ACTION_NAMES[action]}: ${keyName(e.code)}` }; rebinding = null; }
  renderControls();
}, true);

// --------------------------------------------------------------------- fight

let lastCount = -1;

async function startFight(): Promise<void> {
  const [a, b] = picks;
  if (!a || !b) return;
  if (mode === "lan" && !guestHere) return;
  await Promise.all([renderer.load(a.name), renderer.load(b.name)]);
  screen = "fight";
  ui.replaceChildren(TOUCH ? "" : el("p", { class: "fight-hint" }, el("kbd", {}, "Esc"), " menu · ", el("kbd", {}, "M"), " mute"));
  touch.show(TOUCH && mode === "cpu");
  game = newGame(a, b, Math.random, [...muscles]);
  if (mode === "cpu") game.fighters[1].speed = CONFIG.bot.speed;
  bot = new Bot();
  lastCount = -1;
  guestInput = { x: 0, y: 0, attacks: 0, sprint: false };
  guestAttacksSeen = 0;
  netEvents = [];
  renderer.labels = [`${slotName(0)} · ${a.name}`, `${slotName(1)} · ${b.name}`];
  renderer.viewers = mode === "2p" ? [0, 1] : [0];
  showFightPowers();
  renderer.resetMatch();
  keys.clearPresses();
  if (role === "host") conn?.send({ t: "screen", screen: "fight" });
}

/** Sidebar: both fighters and what each gene does in a fight. */
function showFightPowers(): void {
  const entries: PowersEntry[] = ([0, 1] as const).flatMap((s) => {
    const c = picks[s];
    return c ? [{ label: `${slotName(s)} · ${c.name}`, color: s === 0 ? "#ffd166" : "#ff6b6b",
      lines: [...geneLines(c), [muscles[s], MUSCLE_TEXT[muscles[s]]] as [string, string]] }] : [];
  });
  powers.show("Powers in this fight", entries);
}

function showWin(g: Game): void {
  screen = "win";
  powers.hide();
  touch.show(false);
  sound.win();
  const slot = g.winner ?? 0, w = g.fighters[slot].creature;
  const headline = mode === "cpu" ? (slot === 0 ? "You win!" : "The computer wins")
    : mode === "lan" ? (slotName(slot) === "You" ? "You win!" : `${slotName(slot)} wins`) : `Player ${slot + 1} wins!`;
  const actions = role === "guest"
    ? [el("span", { class: "waiting" }, "Waiting for the host…")]
    : [button("Rematch", () => void startFight(), { class: "primary", "data-testid": "rematch" }),
      button("Change creatures", () => showSelect(mode))];
  const back = role === "guest" ? backLink("Leave", () => showTitle()) : backLink(mode === "lan" ? "End game" : "Menu", () => showFightMenu(), { "data-testid": "win-menu" });
  ui.replaceChildren(el("div", { class: "panel win", "data-testid": "win" },
    el("p", { class: "kicker" }, headline),
    el("img", { class: "winner", src: artUrl(w.name), alt: w.name }),
    el("h2", {}, `${w.name} wins`),
    el("div", { class: "actions" }, ...actions),
    back,
    TOUCH || role === "guest" ? "" : el("p", { class: "hint" }, kbd(P1_KEYS.attack), " rematch · ", el("kbd", {}, "Esc"), " menu")));
  keys.clearPresses();
  if (role === "host") conn?.send({ t: "screen", screen: "win" });
}

/** This device's own controls: keyboard (either set of keys) plus touch. */
function myControls(keyMaps: KeyMap[]): { dir: Vec; attack: boolean; sprint: boolean } {
  let x = 0, y = 0, attack = false, sprint = false;
  for (const k of keyMaps) {
    const d = keys.direction(k);
    x += d.x; y += d.y;
    if (keys.take(k.attack)) attack = true;
    if (keys.held(k.sprint)) sprint = true;
  }
  if (TOUCH) {
    const t = touch.direction();
    x += t.x; y += t.y;
    if (touch.takeAttack()) attack = true;
    if (touch.sprint()) sprint = true;
  }
  const l = Math.hypot(x, y);
  return { dir: l > 1 ? { x: x / l, y: y / l } : { x, y }, attack, sprint };
}

// ---------------------------------------------------------------------- loop

let last = performance.now(), acc = 0;
function frame(now: number): void {
  let dt = Math.min(0.1, (now - last) / 1000) * TIME_SCALE;
  last = now;
  if (expedition.active) {
    if (keys.take("KeyM")) toggleMute();
    expedition.frame(dt);
    requestAnimationFrame(frame);
    return;
  }
  if (screen !== "join" && keys.take("KeyM")) toggleMute();
  if (screen === "select") selectKeys();
  if (screen === "win" && role !== "guest" && (keys.take(P1_KEYS.attack) || keys.take("Space"))) void startFight();
  else if (screen === "win" && keys.take("Escape")) showFightMenu();
  if (screen === "fight" && keys.take("Escape")) showFightMenu();
  if (screen === "controls" && !rebinding && keys.take("Escape")) controlsBack();

  if (role === "guest" && (screen === "fight" || screen === "win")) {
    // Guest: send controls, draw the host's latest state.
    const c = myControls([P1_KEYS, P2_KEYS]);
    if (c.attack) myAttacks++;
    conn?.send({ t: "input", x: c.dir.x, y: c.dir.y, attacks: myAttacks, sprint: c.sprint });
    if (game) { renderer.hud = true; renderer.setReserve(powers.reserved()); renderer.draw(game, dt); }
    else renderer.draw(idle, dt);
  } else if (game) {
    if (game.phase === "ko") dt *= 0.45; // slow motion on the final blow
    acc += dt;
    const local1 = mode === "2p" ? myControlsSplit(P1_KEYS) : myControls(mode === "lan" ? [P1_KEYS, P2_KEYS] : [P1_KEYS]);
    const local2 = mode === "2p" ? myControlsSplit(P2_KEYS) : null;
    let attack1 = local1.attack, attack2 = local2?.attack ?? false;
    if (mode === "lan" && guestInput.attacks > guestAttacksSeen) { attack2 = true; guestAttacksSeen = guestInput.attacks; }
    while (acc >= STEP) {
      acc -= STEP;
      const [p1, p2] = game.fighters;
      p1.intent = local1.dir; p1.attackPressed = attack1; p1.sprintHeld = local1.sprint;
      attack1 = false;
      if (mode === "cpu") bot.think(p2, p1, STEP, game);
      else if (mode === "2p") { p2.intent = local2!.dir; p2.attackPressed = attack2; p2.sprintHeld = local2!.sprint; }
      else { p2.intent = { x: guestInput.x, y: guestInput.y }; p2.attackPressed = attack2; p2.sprintHeld = guestInput.sprint; }
      attack2 = false;
      step(game, STEP);
      renderer.handle(game.events, game);
      sound.handle(game.events);
      if (role === "host") netEvents.push(...game.events);
    }
    if (game.phase === "countdown") {
      const n = Math.ceil((CONFIG.match.countdown - game.phaseT) / (CONFIG.match.countdown / 3));
      if (n !== lastCount) { sound.countdown(false); lastCount = n; }
    } else if (game.phase === "fight" && lastCount !== 0) { sound.countdown(true); lastCount = 0; }
    if (role === "host") { conn?.send({ t: "state", s: snapshot(game), ev: netEvents }); netEvents = []; }
    renderer.hud = true;
    renderer.setReserve(powers.reserved());
    renderer.draw(game, dt);
    if (game.phase === "over" && screen === "fight") showWin(game);
  } else {
    acc = 0;
    step(idle, dt);
    renderer.hud = false;
    renderer.setReserve(0);
    renderer.draw(idle, dt);
  }
  requestAnimationFrame(frame);
}

/** Same-keyboard 2 players: each uses only their own keys (no touch). */
function myControlsSplit(k: KeyMap): { dir: Vec; attack: boolean; sprint: boolean } {
  return { dir: keys.direction(k), attack: keys.take(k.attack), sprint: keys.held(k.sprint) };
}

// Behind the menus: the two picked creatures standing in the ring.
function idleGame(): Game {
  const g = newGame(picks[0] ?? CREATURES[0], picks[1] ?? CREATURES[1]);
  g.phase = "fight";
  g.phaseT = 99;
  g.spawnIn = g.cycleIn = Infinity;
  return g;
}
let idle = idleGame();
const refreshIdle = () => { idle = idleGame(); };
addEventListener("click", () => { if (screen === "select") refreshIdle(); });
addEventListener("keyup", () => { if (screen === "select") refreshIdle(); });

// A link from Genome Wrapped: "#code=ABC-DEF&play=battle" or "&play=coop". Only the creature code
// travels, in the fragment, which browsers never send to a server; nothing else from the report.
const linkedCode = HASH.get("code");
const linkedPlay = HASH.get("play");
// No top-level await: the build is a classic script so the game also opens from a local file.
void Promise.all([renderer.load(picks[0]!.name), renderer.load(picks[1]!.name)]).then(() => {
  const joinCode = HASH.get("join");
  if (joinCode && LAN) showJoin(joinCode);
  else if (linkedCode && linkedPlay === "coop") { expedition.openHost(); expedition.presetCode(linkedCode); }
  else if (linkedCode && linkedPlay === "battle" && applyCode(linkedCode, 0)) { showSelect("cpu"); turn = 1; renderSelect(); }
  else showTitle();
  requestAnimationFrame(frame);
});

if (HASH.has("rec")) Object.assign(globalThis, { __arena: () => game, __coop: () => expedition.state });
