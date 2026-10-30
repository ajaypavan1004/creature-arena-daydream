// Hatchling Expedition flow in Chrome: lobby with 2 players on one keyboard, then every
// room (players are moved onto the exit to skip the puzzles), the team genome panel after
// each room, and the finale. Also checks for page errors and saves a picture of each room.
// Run after a build: node tests/coop.browser.mjs [screenshot dir]
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const SHOTS = process.argv[2];
const ROOT = new URL("../dist", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".png": "image/png" };
const srv = createServer((req, res) => {
  let p = join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
  if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" }); res.end(readFileSync(p));
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
let ok = true;
const check = (cond, what) => { console.log(`${cond ? "ok  " : "FAIL"} ${what}`); ok &&= !!cond; };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; page.on("pageerror", (e) => errs.push(String(e))); page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await page.goto(`http://127.0.0.1:${srv.address().port}/#rec`);
  await page.getByTestId("mode-coop").click();
  check(await page.getByTestId("start-expedition").isDisabled(), "can't start with one player");
  await page.getByTestId("add-local").click();
  for (const [i, name] of [[0, "Moonwhisker"], [1, "Goldenhush"]]) {
    await page.getByTestId(`choose-${i}`).click();
    await page.getByTestId(`coop-pick-${name}`).click();
    await page.getByTestId("chooser-done").click();
  }
  await page.getByTestId("start-expedition").click();
  await page.getByTestId("badges").waitFor();
  const badges = (await page.getByTestId("badges").innerText()).toLowerCase(); // names are shown in capitals
  check(badges.includes("player 1 · moonwhisker") && badges.includes("% of people worldwide"), "5-gene badges before room 1");
  await page.getByTestId("start-room-1").click();
  await page.getByTestId("coop-hud").waitFor();
  const side = await page.getByTestId("powers").innerText();
  check(side.includes("P1 · Moonwhisker") && side.includes("P2 · Goldenhush") && side.includes("munches through bitter bramble") && side.includes("sniffs out hidden doors"), "sidebar lists each explorer's powers");
  await page.getByTestId("powers-toggle").click();
  check(await page.getByTestId("powers").isHidden(), "sidebar folds away");
  await page.getByTestId("powers-toggle").click();
  for (let room = 0; room < 6; room++) {
    await page.getByTestId("coop-hud").waitFor();
    await page.waitForTimeout(500);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/room${room + 1}.png` });
    const info = await page.evaluate(() => {
      const w = globalThis.__coop();
      const exits = w.room.exits, T = 64;
      w.explorers.forEach((e, i) => { const [x, y] = exits[i % exits.length]; e.x = (x + 0.5) * T; e.y = (y + 0.5) * T; e.vx = e.vy = 0; });
      return { room: w.roomIndex, starts: w.room.starts.length };
    });
    check(info.room === room && info.starts >= 4, `room ${room + 1} started with ${info.starts} start tiles`);
    await page.getByTestId("team-genome").waitFor({ timeout: 5000 });
    const panel = await page.getByTestId("team-genome").innerText();
    check(panel.includes("Your team genome") && panel.includes("Senses: Keen (P1)") && panel.includes("Senses: Bold (P2)"), `room ${room + 1} team genome panel lists the team's genes`);
    if (room === 2) check(/Genes you didn't have|every gene/.test(panel), "panel says which genes were missing");
    check(/Did you know\?[\s\S]*in 100 people worldwide/.test(panel) && !/\b(AFR|EUR|EAS|SAS|AMR|African|European|Asian)\b/.test(panel), `room ${room + 1} has worldwide-only facts`);
    if (room === 0) {
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save-card").click()]);
      check(download.suggestedFilename() === "team-genome.png", "team genome card downloads as a picture");
    }
    await page.getByTestId("next-room").click();
  }
  await page.getByTestId("expedition-done").waitFor({ timeout: 5000 });
  check(true, "finale shown after room 6");
  check(errs.length === 0, `no page errors ${errs.slice(0, 2).join(" | ")}`);
} catch (e) {
  console.log("FAIL", e.message.split("\n")[0]); ok = false;
} finally { await browser.close(); srv.close(); }
console.log(ok ? "COOP OK" : "COOP FAILED");
process.exit(ok ? 0 : 1);
