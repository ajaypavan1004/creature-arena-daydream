// Records a Day 1 match: title, start, a full fight (the player driven by a simple
// keyboard autopilot at a human pace), and the win screen. CDP screencast frames with
// timestamps -> ffconcat list for ffmpeg.
// Usage: node record_day1.mjs <frames dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "/Users/ajaypavan/creature-arena/node_modules/playwright-core/index.mjs";
import { serve } from "./serve.mjs";

const FRAMES = process.argv[2];
const SLOW = 0.4; // game runs at 0.4x while recording; ffmpeg speeds it back up
const W = (ms) => ms / SLOW;
mkdirSync(FRAMES, { recursive: true });
const srv = await serve("/Users/ajaypavan/creature-arena/dist");
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--force-device-scale-factor=1.5"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
await page.addInitScript(() => {
  addEventListener("pointerdown", (e) => {
    const d = document.createElement("div");
    d.style.cssText = `position:fixed;left:${e.clientX - 22}px;top:${e.clientY - 22}px;width:44px;height:44px;border-radius:50%;` +
      "background:rgba(255,255,255,.55);box-shadow:0 0 0 2px rgba(0,0,0,.25);pointer-events:none;z-index:99999;transition:transform .45s ease-out,opacity .45s ease-out";
    document.body.appendChild(d);
    requestAnimationFrame(() => { d.style.transform = "scale(1.6)"; d.style.opacity = "0"; });
    setTimeout(() => d.remove(), 600);
  }, true);
});
const cdp = await page.context().newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", async (f) => {
  const name = `f${String(frames.length).padStart(5, "0")}.jpg`;
  writeFileSync(`${FRAMES}/${name}`, Buffer.from(f.data, "base64"));
  frames.push({ name, t: f.metadata.timestamp });
  await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});

await page.goto(srv.url + `#rec&slow=${SLOW}`);
await page.getByTestId("start").waitFor();
await page.waitForTimeout(800);
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
const t0 = Date.now();
const mark = (w) => console.log(`${((Date.now() - t0) / 1000 * SLOW).toFixed(1)}s (video time) ${w}`);
mark("title");
await page.waitForTimeout(W(3500));
const box = await page.getByTestId("start").boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
await page.mouse.down(); await page.mouse.up();
mark("fight");

// Autopilot: approach, swing in range, sometimes step back after a swing.
const held = new Set();
async function hold(want) {
  for (const k of held) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
  for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
}
let swings = 0; const swingD = []; let prevHp = [100, 100], dmg = [0, 0];
let retreatUntil = 0, circle = 1, lastSwing = 0;
for (;;) {
  const s = await page.evaluate(() => { const g = globalThis.__arena(); return g && { phase: g.phase, f: g.fighters.map((f) => ({ x: f.x, y: f.y, hp: f.hp, cd: f.cooldown })) }; });
  if (!s || s.phase === "over") break;
  const [me, foe] = s.f, now = Date.now();
  s.f.forEach((f, i) => { if (f.hp < prevHp[i]) dmg[i]++; prevHp[i] = f.hp; });
  let dx = foe.x - me.x, dy = foe.y - me.y; const d = Math.hypot(dx, dy);
  if (now < retreatUntil) { const t = dx; dx = -dx * 0.7 - dy * circle; dy = -dy * 0.7 + t * circle; }
  else if (d < 120) { dx = 0; dy = 0; }
  // Keep away from the edge while backing off.
  const r = Math.hypot(me.x, me.y); if (r > 380) { dx -= me.x / r * 1.5 * Math.hypot(dx, dy || 1); dy -= me.y / r * 1.5 * Math.hypot(dx, dy || 1); }
  const want = new Set(), l = Math.hypot(dx, dy) || 1;
  if (dx / l > 0.38) want.add("KeyD"); if (dx / l < -0.38) want.add("KeyA");
  if (dy / l > 0.38) want.add("KeyS"); if (dy / l < -0.38) want.add("KeyW");
  if (s.phase !== "fight") want.clear();
  await hold(want);
  if (s.phase === "fight" && d < 158 && me.cd <= 0.02 && now - lastSwing > W(150) && now >= retreatUntil) {
    await page.keyboard.press("KeyF"); lastSwing = now; swings++; swingD.push(Math.round(d));
    if (Math.random() < 0.12) { retreatUntil = now + W(350 + Math.random() * 300); circle = Math.random() < 0.5 ? 1 : -1; }
  }
  await page.waitForTimeout(40);
}
await hold(new Set());
console.log("swings", swings, "hits taken [me, cpu]", dmg, "swing distances", swingD.join(","));
const result = await page.evaluate(() => globalThis.__arena().winner);
mark(`win screen (winner slot ${result})`);
await page.getByTestId("win").waitFor();
await page.waitForTimeout(W(4500));
mark("end");
const tEnd = Date.now() / 1000;
await cdp.send("Page.stopScreencast");
await browser.close(); srv.close();

const lines = ["ffconcat version 1.0"];
frames.forEach((f, i) => {
  const next = i + 1 < frames.length ? frames[i + 1].t : Math.max(f.t + 0.04, tEnd);
  lines.push(`file ${f.name}`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
});
lines.push(`file ${frames.at(-1).name}`);
writeFileSync(`${FRAMES}/list.ffconcat`, lines.join("\n") + "\n");
console.log(`frames: ${frames.length}, video span ${((frames.at(-1).t - frames[0].t) * SLOW).toFixed(1)}s, effective fps ${(frames.length / ((frames.at(-1).t - frames[0].t) * SLOW)).toFixed(0)}, winner slot ${result}`);
