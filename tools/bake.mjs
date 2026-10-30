// bake.mjs -- draws the browser game's canvas-only art into PNGs, with the
// browser game's own drawing code, in headless Chromium:
//
//   floor-day.png, floor-night.png   the arena's stone floor, seen from
//                                    straight above (render.ts buildArena
//                                    with no tilt and no side wall)
//   greens.png, orb.png, sun.png     the icons that have no picture
//                                    (icons.ts)
//
//     node tools/bake.mjs OUT_DIR [FLOOR_PX]
//
// The drawing below is render.ts's and icons.ts's, with the types taken
// out; keep it in step with them. tools/atlas.py packs the results.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
// (require: playwright installed globally, where ESM imports do not look.)
const { chromium } = createRequire(import.meta.url)("playwright");

const out = process.argv[2] ?? "art/baked";
const floorPx = Number(process.argv[3] ?? 1024);
mkdirSync(out, { recursive: true });

const page = `
<canvas id="c"></canvas>
<script>
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const NIGHT = { floor: ["#8f94a3", "#6c7180", "#4b4f5c"], joints: "rgba(20,22,30,0.55)", rim: "rgba(5,10,25,0.45)", wall: "#4a4e5c" };
const DAY = { floor: ["#d3cbb9", "#b5ad9b", "#8e8676"], joints: "rgba(70,60,45,0.45)", rim: "rgba(60,45,25,0.25)", wall: "#8a8274" };

// render.ts buildArena's floor, from above: the canvas is the ring's
// square, R world units to each side, plus a band of the wall's stone.
function floor(night, px) {
  const c = document.getElementById("c");
  c.width = px; c.height = px;
  const g = c.getContext("2d");
  g.clearRect(0, 0, px, px);
  const R = 520, band = 26, s = px / (2 * (R + band));
  const rand = mulberry32(7);
  const P = night ? NIGHT : DAY;
  g.save();
  g.translate(px / 2, px / 2); g.scale(s, s);
  // The wall's top: a band of stone round the ring.
  g.beginPath(); g.arc(0, 0, R + band, 0, Math.PI * 2); g.fillStyle = P.wall; g.fill();
  g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 2.5;
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    g.beginPath(); g.moveTo(Math.cos(a) * R, Math.sin(a) * R); g.lineTo(Math.cos(a) * (R + band), Math.sin(a) * (R + band)); g.stroke();
  }
  g.beginPath(); g.arc(0, 0, R + band - 1, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.clip();
  const fl = g.createRadialGradient(0, 0, 0, 0, 0, R);
  fl.addColorStop(0, P.floor[0]); fl.addColorStop(0.7, P.floor[1]); fl.addColorStop(1, P.floor[2]);
  g.fillStyle = fl; g.fillRect(-R, -R, 2 * R, 2 * R);
  const rings = [0, 95, 190, 290, 395, R + 5];
  for (let r = 1; r < rings.length; r++) {
    const n = r === 1 ? 1 : 6 + r * 5, off = rand() * Math.PI;
    for (let j = 0; j < n; j++) {
      const a0 = off + (j / n) * Math.PI * 2, a1 = off + ((j + 1) / n) * Math.PI * 2;
      g.beginPath();
      g.arc(0, 0, rings[r], a0, a1); g.arc(0, 0, rings[r - 1], a1, a0, true); g.closePath();
      const v = rand();
      g.fillStyle = v < 0.5 ? "rgba(0,0,0," + (0.03 + v * 0.1) + ")" : "rgba(255,255,255," + ((v - 0.5) * 0.09) + ")";
      g.fill();
      g.strokeStyle = P.joints; g.lineWidth = 3.2; g.stroke();
    }
  }
  for (let i = 0; i < 2600; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * R;
    g.fillStyle = rand() < 0.5 ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.08)";
    g.fillRect(Math.cos(a) * r, Math.sin(a) * r, 2 + rand() * 3, 2 + rand() * 3);
  }
  g.strokeStyle = "rgba(160,230,255,0.16)"; g.lineWidth = 4;
  g.beginPath(); g.arc(0, 0, 78, 0, Math.PI * 2); g.stroke();
  g.beginPath();
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2, r = i % 2 ? 30 : 70;
    for (const k of [0, 1]) { const b = a + k * Math.PI / 8; g.lineTo(Math.cos(b) * (k ? 30 : r), Math.sin(b) * (k ? 30 : r)); }
  }
  g.stroke();
  const rim = g.createRadialGradient(0, 0, R * 0.6, 0, 0, R);
  rim.addColorStop(0, "rgba(0,0,0,0)"); rim.addColorStop(1, P.rim);
  g.fillStyle = rim; g.fillRect(-R, -R, 2 * R, 2 * R);
  g.restore();
  return c.toDataURL("image/png");
}

// icons.ts, at t = 0 (the table moves them itself).
function drawGreens(g, size, t) {
  const u = size / 40;
  g.save();
  g.fillStyle = "#8cc46a"; g.strokeStyle = "#3d6b2a"; g.lineWidth = 1.5 * u;
  g.beginPath(); g.moveTo(-4 * u, 16 * u); g.lineTo(-3 * u, 2 * u); g.lineTo(3 * u, 2 * u); g.lineTo(4 * u, 16 * u); g.closePath();
  g.fill(); g.stroke();
  const bumps = [[-9, -1, 7], [9, -1, 7], [-4, -8, 8], [5, -8, 8], [0, -1, 8], [0, -13, 6]];
  for (const [x, y, r] of bumps) {
    g.fillStyle = "#3f8f3a"; g.strokeStyle = "#245a22";
    g.beginPath(); g.arc(x * u, y * u, r * u, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  g.fillStyle = "rgba(160,220,120,0.55)";
  for (const [x, y, r] of bumps) { g.beginPath(); g.arc((x - r * 0.3) * u, (y - r * 0.3) * u, r * 0.35 * u, 0, Math.PI * 2); g.fill(); }
  g.restore();
}
function drawOrb(g, size, t) {
  const u = size / 40, r = 12 * u;
  g.save();
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, r * 2);
  glow.addColorStop(0, "rgba(190,150,255,0.55)"); glow.addColorStop(1, "rgba(190,150,255,0)");
  g.fillStyle = glow; g.beginPath(); g.arc(0, 0, r * 2, 0, Math.PI * 2); g.fill();
  const body = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  body.addColorStop(0, "#ffffff"); body.addColorStop(0.35, "#c9b4ff"); body.addColorStop(1, "#6a3df0");
  g.fillStyle = body; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "rgba(255,255,255,0.85)"; g.lineWidth = 1.4 * u;
  for (let i = 0; i < 2; i++) {
    const a = t * 3 + i * Math.PI;
    g.beginPath();
    g.moveTo(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2);
    g.lineTo(Math.cos(a + 0.5) * r * 0.55, Math.sin(a + 0.5) * r * 0.55 - 2 * u);
    g.lineTo(Math.cos(a + 0.9) * r * 0.85, Math.sin(a + 0.9) * r * 0.85);
    g.stroke();
  }
  g.restore();
}
function drawSun(g, size) {
  const r = size * 0.28;
  g.save();
  g.fillStyle = "#ffd166"; g.strokeStyle = "#ffd166"; g.lineWidth = Math.max(1.2, size * 0.07); g.lineCap = "round";
  g.shadowColor = "#ffb703"; g.shadowBlur = size * 0.4;
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.beginPath(); g.moveTo(Math.cos(a) * r * 1.45, Math.sin(a) * r * 1.45); g.lineTo(Math.cos(a) * r * 1.85, Math.sin(a) * r * 1.85); g.stroke();
  }
  g.restore();
}
// An icon centred in a square canvas, at the size it is drawn at.
function icon(name, px) {
  const c = document.getElementById("c");
  c.width = px; c.height = px;
  const g = c.getContext("2d");
  g.clearRect(0, 0, px, px);
  g.save(); g.translate(px / 2, px / 2);
  const size = px * (name === "orb" ? 0.8 : name === "sun" ? 0.62 : 0.95);
  if (name === "greens") drawGreens(g, size, 0);
  if (name === "orb") drawOrb(g, size, 0);
  if (name === "sun") drawSun(g, size);
  g.restore();
  return c.toDataURL("image/png");
}
</script>`;

const browser = await chromium.launch();
const tab = await browser.newPage();
await tab.setContent(page);
const save = (name, url) => writeFileSync(`${out}/${name}.png`, Buffer.from(url.split(",")[1], "base64"));
save("floor-day", await tab.evaluate((px) => floor(false, px), floorPx));
save("floor-night", await tab.evaluate((px) => floor(true, px), floorPx));
for (const name of ["greens", "orb", "sun"]) save(name, await tab.evaluate((n) => icon(n, 256), name));
await browser.close();
console.log(`bake: wrote floor-day, floor-night, greens, orb, sun to ${out}`);
