// Hatchling Expedition over the local network: the host (2 players on its keyboard) plus
// a laptop guest and a phone guest = 4 explorers. Checks joining, choosing creatures
// (one guest by creature code), starting, guest controls, the team genome panel on
// every device, and a guest leaving. Run after a build: node tests/coop_lan.browser.mjs
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import vectors from "./code_vectors.json" with { type: "json" };

const PORT = 8798;
const server = spawn(process.execPath, ["server/lan.mjs", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((r) => server.stdout.on("data", (d) => String(d).includes("running") && r()));
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
let ok = true;
const check = (cond, what) => { console.log(`${cond ? "ok  " : "FAIL"} ${what}`); ok &&= !!cond; };
try {
  const errs = [];
  const host = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  host.on("pageerror", (e) => errs.push(`host: ${e}`));
  await host.goto(`http://127.0.0.1:${PORT}/#rec`);
  await host.getByTestId("mode-coop").click();
  await host.getByTestId("add-local").click();
  await host.getByTestId("invite").click();
  const code = (await host.getByTestId("room-code").textContent()).trim();
  check(/^[A-Z]{4}$/.test(code), `room code ${code}`);
  for (const [i, name] of [[0, "Shadepounce"], [1, "Morningdrift"]]) {
    await host.getByTestId(`choose-${i}`).click(); await host.getByTestId(`coop-pick-${name}`).click(); await host.getByTestId("chooser-done").click();
  }

  const laptop = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  laptop.on("pageerror", (e) => errs.push(`laptop: ${e}`));
  await laptop.goto(`http://127.0.0.1:${PORT}/#join=${code}`);
  await laptop.getByTestId("expedition-lobby").waitFor();
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const phone = await phoneCtx.newPage();
  phone.on("pageerror", (e) => errs.push(`phone: ${e}`));
  await phone.goto(`http://127.0.0.1:${PORT}/#join=${code}`);
  await phone.getByTestId("expedition-lobby").waitFor();
  await host.waitForTimeout(300);
  check(await host.getByTestId("seat-3").count() === 1, "host lobby shows 4 seats");

  // Laptop guest picks from the grid; phone guest uses a creature code (Glowpaw, Endurance).
  await laptop.locator("[data-testid^=choose-]").click();
  await laptop.getByTestId("coop-pick-Sparksnout").click();
  await laptop.getByTestId("coop-muscle-Sprinter").click();
  await laptop.getByTestId("chooser-done").click();
  const glowpaw = vectors.find((v) => v.axes.flame === "Ember" && v.axes.time === "Dusk" && v.axes.senses === "Keen" && v.axes.spark === "Still" && v.axes.muscle === "Endurance").code;
  await phone.locator("[data-testid^=choose-]").tap();
  await phone.getByTestId("coop-code").fill(glowpaw);
  await phone.getByTestId("coop-code-load").tap();
  await phone.getByTestId("chooser-done").tap();
  await host.waitForTimeout(400);
  const seats = await host.locator(".seat strong").allTextContents();
  check(JSON.stringify(seats) === JSON.stringify(["Shadepounce", "Morningdrift", "Sparksnout", "Glowpaw"]), `host sees all four creatures: ${seats.join(", ")}`);
  check(!(await host.getByTestId("start-expedition").isDisabled()), "host can start");
  await host.getByTestId("start-expedition").click();
  await phone.getByTestId("badges").waitFor({ timeout: 5000 });
  check((await phone.getByTestId("badges").innerText()).toLowerCase().includes("you · glowpaw"), "phone guest sees the team badges, with its own marked");
  await host.getByTestId("start-room-1").click();
  await laptop.getByTestId("coop-hud").waitFor({ timeout: 5000 });
  await phone.getByTestId("coop-hud").waitFor({ timeout: 5000 });
  check(true, "guests are in room 1");
  const muscles = await host.evaluate(() => globalThis.__coop().explorers.map((e) => `${e.creature.name}/${e.profile.muscle}`));
  check(muscles[3] === "Glowpaw/Endurance" && muscles[2] === "Sparksnout/Sprinter", `host world: ${muscles.join(", ")}`);

  // The phone guest walks down with its joystick: its explorer moves on the host.
  const before = await host.evaluate(() => globalThis.__coop().explorers[3].y);
  await phone.evaluate(() => {
    const zone = document.querySelector(".stick-zone");
    const ev = (type, x, y) => zone.dispatchEvent(new PointerEvent(type, { pointerId: 5, clientX: x, clientY: y, bubbles: true }));
    ev("pointerdown", 100, 600); ev("pointermove", 100, 680);
    setTimeout(() => ev("pointerup", 100, 680), 600);
  });
  await host.waitForTimeout(700);
  const after = await host.evaluate(() => globalThis.__coop().explorers[3].y);
  check(after > before + 40, `phone guest's joystick moved its explorer (y ${Math.round(before)} -> ${Math.round(after)})`);

  // Finish the room on the host: every device shows the team genome.
  await host.evaluate(() => { const w = globalThis.__coop(); w.explorers.forEach((e, i) => { const [x, y] = w.room.exits[i % w.room.exits.length]; e.x = (x + 0.5) * 64; e.y = (y + 0.5) * 64; }); });
  for (const [p, n] of [[host, "host"], [laptop, "laptop"], [phone, "phone"]]) {
    await p.getByTestId("team-genome").waitFor({ timeout: 5000 });
    check((await p.getByTestId("team-genome").innerText()).includes("Your team genome"), `${n} shows the team genome panel`);
  }
  await host.getByTestId("next-room").click();
  await laptop.locator("text=2. Sun and Moon Crossing").waitFor({ timeout: 5000 });
  check(true, "guests follow the host into room 2");

  // A guest leaves: the host goes back to the lobby with 3 seats.
  await laptop.close();
  await host.getByTestId("expedition-lobby").waitFor({ timeout: 5000 });
  check(await host.locator(".seat").count() === 3, "a guest leaving takes the host back to the lobby");
  check(errs.length === 0, `no page errors ${errs.slice(0, 2).join(" | ")}`);
} catch (e) {
  console.log("FAIL", e.message.split("\n")[0]); ok = false;
} finally { await browser.close(); server.kill(); }
console.log(ok ? "COOP LAN OK" : "COOP LAN FAILED");
process.exit(ok ? 0 : 1);
