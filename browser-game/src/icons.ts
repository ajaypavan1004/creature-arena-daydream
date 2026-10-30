// Small canvas-drawn icons (no image files): the three power ups, and the sun and moon
// for day/night. Each draws centred on (0, 0) at the given size (roughly its height).

type Ctx = CanvasRenderingContext2D;

export function drawCoffee(g: Ctx, size: number, t: number): void {
  const u = size / 40;
  g.save();
  // Steam.
  g.strokeStyle = "rgba(255,255,255,0.75)"; g.lineWidth = 2.2 * u; g.lineCap = "round";
  for (const k of [-1, 1]) {
    g.beginPath();
    for (let i = 0; i <= 8; i++) {
      const y = -10 * u - i * 1.4 * u, x = k * 4 * u + Math.sin(t * 5 + i * 0.8 + k) * 2.2 * u;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
  // Cup and handle.
  g.fillStyle = "#f4efe6"; g.strokeStyle = "#5b3a24"; g.lineWidth = 2 * u;
  g.beginPath(); g.moveTo(-11 * u, -8 * u); g.lineTo(11 * u, -8 * u); g.lineTo(8 * u, 12 * u); g.lineTo(-8 * u, 12 * u); g.closePath();
  g.fill(); g.stroke();
  g.beginPath(); g.arc(12 * u, 1 * u, 5 * u, -Math.PI / 2, Math.PI / 2); g.stroke();
  // Coffee surface.
  g.fillStyle = "#6b3f22";
  g.beginPath(); g.ellipse(0, -8 * u, 10.5 * u, 2.6 * u, 0, 0, Math.PI * 2); g.fill();
  g.restore();
}

/** Bitter greens: a broccoli floret (drawn, no picture). */
export function drawGreens(g: Ctx, size: number, t: number): void {
  const u = size / 40;
  g.save();
  g.rotate(Math.sin(t * 2) * 0.08);
  // Stalk.
  g.fillStyle = "#8cc46a"; g.strokeStyle = "#3d6b2a"; g.lineWidth = 1.5 * u;
  g.beginPath(); g.moveTo(-4 * u, 16 * u); g.lineTo(-3 * u, 2 * u); g.lineTo(3 * u, 2 * u); g.lineTo(4 * u, 16 * u); g.closePath();
  g.fill(); g.stroke();
  // Florets: overlapping dark-green bumps.
  const bumps: Array<[number, number, number]> = [[-9, -1, 7], [9, -1, 7], [-4, -8, 8], [5, -8, 8], [0, -1, 8], [0, -13, 6]];
  for (const [x, y, r] of bumps) {
    g.fillStyle = "#3f8f3a"; g.strokeStyle = "#245a22";
    g.beginPath(); g.arc(x * u, y * u, r * u, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  g.fillStyle = "rgba(160,220,120,0.55)";
  for (const [x, y, r] of bumps) { g.beginPath(); g.arc((x - r * 0.3) * u, (y - r * 0.3) * u, r * 0.35 * u, 0, Math.PI * 2); g.fill(); }
  g.restore();
}

export function drawOrb(g: Ctx, size: number, t: number): void {
  const u = size / 40, r = 12 * u;
  g.save();
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, r * 2);
  glow.addColorStop(0, "rgba(190,150,255,0.55)"); glow.addColorStop(1, "rgba(190,150,255,0)");
  g.fillStyle = glow; g.beginPath(); g.arc(0, 0, r * 2, 0, Math.PI * 2); g.fill();
  const body = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  body.addColorStop(0, "#ffffff"); body.addColorStop(0.35, "#c9b4ff"); body.addColorStop(1, "#6a3df0");
  g.fillStyle = body; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  // Little arcs of energy inside.
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

export function drawSun(g: Ctx, size: number): void {
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

export function drawMoon(g: Ctx, size: number): void {
  const r = size * 0.42;
  g.save();
  g.fillStyle = "#dfe8ff"; g.shadowColor = "#9fb8ff"; g.shadowBlur = size * 0.4;
  g.beginPath();
  g.arc(0, 0, r, Math.PI * 0.35, Math.PI * 1.65);
  g.arc(r * 0.45, -r * 0.05, r * 0.82, Math.PI * 1.45, Math.PI * 0.55, true);
  g.closePath(); g.fill();
  g.restore();
}
