// Button spacing on every screen of Creature Arena at 360, 390, 430 px and desktop: no two buttons
// closer than 12 px (horizontally or vertically) and none overlapping. Run after a build:
// node tests/layout.browser.mjs
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const ROOT = new URL("../dist", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".png": "image/png" };
const srv = createServer((req, res) => {
  let p = join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
  if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" }); res.end(readFileSync(p));
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const URL0 = `http://127.0.0.1:${srv.address().port}/#rec`;

/** Pairs of visible buttons closer than 12 px, or overlapping (inside an open modal, only its buttons). */
const closeButtons = (page) => page.evaluate(() => {
  const name = (e) => (e.getAttribute("data-testid") ?? e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 30);
  const modal = document.querySelector(".pause");
  const els = [...(modal ?? document).querySelectorAll("button")].filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && e.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  });
  const out = [];
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const ra = els[i].getBoundingClientRect(), rb = els[j].getBoundingClientRect();
    const dx = Math.max(ra.left, rb.left) - Math.min(ra.right, rb.right);
    const dy = Math.max(ra.top, rb.top) - Math.min(ra.bottom, rb.bottom);
    if (Math.max(dx, dy) < 11.5) out.push(`${dx < 0 && dy < 0 ? "overlap" : `${Math.max(dx, dy).toFixed(1)} px`}: "${name(els[i])}" / "${name(els[j])}"`);
  }
  return out;
});

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const problems = [];
try {
  for (const width of [360, 390, 430, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const look = async (screen) => { for (const p of await closeButtons(page)) problems.push(`${width} px ${screen}: ${p}`); };
    await page.goto(URL0);
    await page.getByTestId("mode-fight").waitFor();
    await look("title");
    await page.getByTestId("mode-fight").click();
    await look("fight menu");
    await page.getByTestId("mode-controls").click();
    await look("controls");
    await page.getByTestId("keys-done").click();
    await page.getByTestId("mode-cpu").click();
    await look("choose creature");
    await page.locator(".grid button").first().click();
    await page.locator(".grid button").nth(1).click();
    await look("choose creature (both picked)");
    await page.getByTestId("fight").click();
    await page.waitForFunction(() => globalThis.__arena()?.phase === "fight", null, { timeout: 10000 });
    await look("fight");
    await page.evaluate(() => { const g = globalThis.__arena(); g.fighters[1].hp = 0; g.winner = 0; g.phase = "ko"; g.phaseT = 0; });
    await page.getByTestId("win").waitFor({ timeout: 10000 });
    await look("win");
    await page.getByTestId("win-menu").click();
    await page.getByTestId("fight-back").click();
    await page.getByTestId("mode-coop").click();
    await page.getByTestId("expedition-lobby").waitFor();
    await look("co-op lobby");
    await page.getByTestId("add-local").click();
    await page.getByTestId("choose-0").click();
    await look("co-op chooser");
    for (const [i, name] of [[0, "Moonwhisker"], [1, "Goldenhush"]]) {
      if (i) await page.getByTestId(`choose-${i}`).click();
      await page.getByTestId(`coop-pick-${name}`).click();
      await page.getByTestId("chooser-done").click();
    }
    await look("co-op lobby (2 players)");
    await page.getByTestId("start-expedition").click();
    await page.getByTestId("badges").waitFor();
    await look("co-op badges");
    await page.getByTestId("start-room-1").click();
    await page.getByTestId("coop-hud").waitFor();
    await look("co-op room");
    await page.keyboard.press("Escape");
    await page.getByTestId("coop-pause").waitFor();
    await look("co-op pause");
    await page.keyboard.press("Escape");
    await page.getByTestId("coop-pause").waitFor({ state: "detached" });
    // Move everyone onto the exit (as tests/coop.browser.mjs does) until the room ends.
    for (let k = 0; k < 20 && !(await page.getByTestId("team-genome").count()); k++) {
      await page.evaluate(() => {
        const w = globalThis.__coop(), T = 64;
        w.explorers.forEach((e, i) => { const [x, y] = w.room.exits[i % w.room.exits.length]; e.x = (x + 0.5) * T; e.y = (y + 0.5) * T; e.vx = e.vy = 0; });
      });
      await page.waitForTimeout(400);
    }
    await page.getByTestId("team-genome").waitFor({ timeout: 8000 });
    await look("team genome panel");
    await page.close();
  }
} finally {
  await browser.close();
  srv.close();
}
for (const p of problems) console.log(`FAIL ${p}`);
console.log(problems.length ? `${problems.length} button spacing problems` : "button spacing OK on every screen");
process.exit(problems.length ? 1 : 0);
