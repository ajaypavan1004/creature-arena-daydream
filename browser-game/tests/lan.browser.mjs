// End-to-end check of local network play: starts the LAN server, opens a host page and a
// phone-sized guest page, joins with the room code, picks creatures, fights, and checks
// that the guest's controls move its creature in the host's game.
// Run after a build: node tests/lan.browser.mjs [screenshot dir]
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import vectors from "./code_vectors.json" with { type: "json" };

const PORT = 8799, SHOTS = process.argv[2];
const server = spawn(process.execPath, ["server/lan.mjs", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((r) => server.stdout.on("data", (d) => String(d).includes("running") && r()));
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
let ok = true;
const check = (cond, what) => { console.log(`${cond ? "ok  " : "FAIL"} ${what}`); ok &&= !!cond; };
try {
  const host = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  host.on("pageerror", (e) => errs.push(`host: ${e}`));
  await host.goto(`http://127.0.0.1:${PORT}/#rec`);
  await host.getByTestId("mode-fight").click();
  await host.getByTestId("mode-host").click();
  const code = (await host.getByTestId("room-code").textContent()).trim();
  check(/^[A-Z]{4}$/.test(code), `room code ${code}`);
  const qrText = await host.evaluate(async () => {
    if (!("BarcodeDetector" in window)) return "(no reader)";
    const found = await new BarcodeDetector({ formats: ["qr_code"] }).detect(document.querySelector("canvas.qr"));
    return found[0]?.rawValue ?? null;
  });
  check(qrText?.endsWith(`/#join=${code}`), `QR code reads ${qrText}`);

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const guest = await phone.newPage();
  guest.on("pageerror", (e) => errs.push(`guest: ${e}`));
  await guest.goto(`http://127.0.0.1:${PORT}/#join=${code}`);
  await guest.getByTestId("select").waitFor();
  check(await host.getByText("Player 2 has joined.").isVisible(), "host sees the player join");
  // The guest loads its creature with a creature code (Goldenhush, Endurance muscles).
  const goldenhush = vectors.find((v) => v.axes.flame === "Ember" && v.axes.time === "Dawn" && v.axes.senses === "Bold"
    && v.axes.spark === "Still" && v.axes.muscle === "Endurance").code;
  await guest.getByTestId("creature-code").fill(goldenhush);
  await guest.getByTestId("creature-code-load").tap();
  check((await guest.getByTestId("creature-code-note").textContent()).includes("Goldenhush, Endurance"), "guest's creature code loads Goldenhush, Endurance");
  await host.getByTestId("pick-Moonwhisker").click();
  await host.waitForTimeout(300);
  check((await host.getByTestId("slot-1").textContent()).includes("Goldenhush"), "host sees the guest's creature");
  check((await guest.getByTestId("slot-0").textContent()).includes("Moonwhisker"), "guest sees the host's creature");
  if (SHOTS) { await host.screenshot({ path: `${SHOTS}/lan_host_lobby.png` }); await guest.screenshot({ path: `${SHOTS}/lan_guest_pick.png` }); }
  await host.getByTestId("fight").click();
  await guest.getByTestId("touch-attack").waitFor({ state: "visible" });
  const sidebar = await host.getByTestId("powers").innerText().catch(() => "");
  check(sidebar.includes("You · Moonwhisker") && sidebar.includes("Player 2 · Goldenhush") && sidebar.includes("Coffee gives a speed boost"), "host sidebar lists both fighters' powers");
  await host.waitForTimeout(2800); // countdown

  const before = await host.evaluate(() => { const f = globalThis.__arena().fighters[1]; return { x: f.x, y: f.y, muscle: f.muscle }; });
  check(before.muscle === "Endurance", "guest's muscle choice reached the host");
  // Drag the joystick left on the guest's phone for a moment.
  await guest.evaluate(() => {
    const zone = document.querySelector(".stick-zone");
    const ev = (type, x, y) => zone.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, bubbles: true }));
    ev("pointerdown", 100, 600); ev("pointermove", 40, 600);
    setTimeout(() => ev("pointerup", 40, 600), 700);
  });
  await host.waitForTimeout(800);
  const after = await host.evaluate(() => { const f = globalThis.__arena().fighters[1]; return { x: f.x, y: f.y }; });
  check(after.x < before.x - 60, `guest's joystick moved its creature (x ${before.x.toFixed(0)} -> ${after.x.toFixed(0)})`);
  const cdBefore = await host.evaluate(() => globalThis.__arena().fighters[1].cooldown);
  await guest.getByTestId("touch-attack").tap();
  await host.waitForTimeout(150);
  const cdAfter = await host.evaluate(() => globalThis.__arena().fighters[1].cooldown);
  check(cdAfter > cdBefore, "guest's Attack button made its creature swing");
  if (SHOTS) { await host.screenshot({ path: `${SHOTS}/lan_host_fight.png` }); await guest.screenshot({ path: `${SHOTS}/lan_guest_fight.png` }); }
  // End the fight quickly and check both show the win screen.
  await host.evaluate(() => { const g = globalThis.__arena(); g.spawnIn = 1e9; g.pickups = []; g.fighters[1].shield = 0; g.fighters[1].hp = 1; g.fighters[0].x = g.fighters[1].x - 100; g.fighters[0].y = g.fighters[1].y; g.fighters[0].cooldown = 0; g.fighters[0].attackPressed = true; });
  await host.keyboard.press("KeyF");
  await host.getByTestId("win").waitFor({ timeout: 8000 });
  await guest.getByTestId("win").waitFor({ timeout: 8000 });
  check(true, "both devices show the win screen");
  check((await guest.getByTestId("win").textContent()).includes("Player 1 wins"), "guest sees who won");
  // Host leaves: the guest is told.
  await host.close();
  await guest.getByTestId("lan-error").waitFor({ timeout: 5000 });
  check(true, "guest is told when the host leaves");
  check(errs.length === 0, `no page errors ${errs.join("; ")}`);
} catch (e) {
  console.log("FAIL", e.message.split("\n")[0]);
  ok = false;
} finally {
  await browser.close();
  server.kill();
}
console.log(ok ? "LAN OK" : "LAN FAILED");
process.exit(ok ? 0 : 1);
