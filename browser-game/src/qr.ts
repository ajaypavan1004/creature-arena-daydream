// A small QR code encoder (byte mode, error correction level M, versions 1 to 6: up to
// 106 bytes, plenty for a join link). Written here so the game needs no extra library.
// Checked against Chrome's built-in barcode reader (tests/lan.browser.mjs).

/** Version -> [EC codewords per block, number of blocks, data codewords per block]. */
const BLOCKS: Record<number, [number, number, number]> = {
  1: [10, 1, 16], 2: [16, 1, 28], 3: [26, 1, 44], 4: [18, 2, 32], 5: [24, 2, 43], 6: [16, 4, 27],
};
const ALIGN: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

// GF(256) arithmetic for Reed-Solomon (primitive polynomial 0x11d).
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function ecCodewords(data: number[], n: number): number[] {
  // Generator polynomial (x - a^0)(x - a^1)...(x - a^(n-1)).
  let gen = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(gen.length + 1).fill(0);
    gen.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= mul(c, EXP[i]); });
    gen = next;
  }
  const rem = new Array(n).fill(0);
  for (const d of data) {
    const f = d ^ rem.shift()!;
    rem.push(0);
    for (let i = 0; i < n; i++) rem[i] ^= mul(gen[i + 1], f);
  }
  return rem;
}

/** Encode text as a QR code: returns a square grid, true = dark module. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  let version = 1;
  while (version <= 6) {
    const [, nb, dc] = BLOCKS[version];
    if (4 + 8 + bytes.length * 8 <= nb * dc * 8) break;
    version++;
  }
  if (version > 6) throw new Error("Text too long for this QR encoder");
  const [ec, nb, dc] = BLOCKS[version];
  const capacity = nb * dc;

  // Bit stream: mode 0100 (byte), 8-bit length, data, terminator, pad bytes.
  const bits: number[] = [];
  const put = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  put(0b0100, 4); put(bytes.length, 8);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);

  // Split into blocks, add error correction, interleave.
  const blocks = Array.from({ length: nb }, (_, i) => data.slice(i * dc, (i + 1) * dc));
  const ecs = blocks.map((b) => ecCodewords(b, ec));
  const stream: number[] = [];
  for (let i = 0; i < dc; i++) for (const b of blocks) stream.push(b[i]);
  for (let i = 0; i < ec; i++) for (const e of ecs) stream.push(e[i]);

  const size = 17 + version * 4;
  const grid: Array<Array<boolean | null>> = Array.from({ length: size }, () => new Array(size).fill(null));
  const fixed = (r: number, c: number, v: boolean) => { grid[r][c] = v; };

  // Finder patterns with separators.
  for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0 + r, cc = c0 + c;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      fixed(rr, cc, r >= 0 && r <= 6 && c >= 0 && c <= 6 && ring !== 2);
    }
  }
  // Alignment patterns (not over the finders).
  const al = ALIGN[version];
  for (const r of al) for (const c of al) {
    if ((r < 9 && c < 9) || (r < 9 && c > size - 10) || (r > size - 10 && c < 9)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc2 = -2; dc2 <= 2; dc2++) fixed(r + dr, c + dc2, Math.max(Math.abs(dr), Math.abs(dc2)) !== 1);
  }
  // Timing patterns.
  for (let i = 8; i < size - 8; i++) { if (grid[6][i] === null) fixed(6, i, i % 2 === 0); if (grid[i][6] === null) fixed(i, 6, i % 2 === 0); }
  // Dark module, and reserve the format areas.
  fixed(size - 8, 8, true);
  const formatCells: Array<[number, number]> = [];
  for (let i = 0; i < 9; i++) { if (grid[8][i] === null) formatCells.push([8, i]); if (grid[i][8] === null && i !== 8) formatCells.push([i, 8]); }
  for (let i = 0; i < 8; i++) { formatCells.push([8, size - 1 - i]); formatCells.push([size - 1 - i, 8]); }
  for (const [r, c] of formatCells) if (grid[r][c] === null) grid[r][c] = false;
  const isFunction = grid.map((row) => row.map((v) => v !== null));

  // Data placement: two-column zigzag from the bottom right, skipping the timing column.
  const dataBits: number[] = [];
  for (const b of stream) for (let i = 7; i >= 0; i--) dataBits.push((b >> i) & 1);
  let k = 0;
  for (let right = size - 1, up = true; right > 0; right -= 2, up = !up) {
    if (right === 6) right = 5;
    for (let n = 0; n < size; n++) {
      const r = up ? size - 1 - n : n;
      for (const c of [right, right - 1]) {
        if (isFunction[r][c]) continue;
        grid[r][c] = (dataBits[k++] ?? 0) === 1;
      }
    }
  }

  // Try all 8 masks and keep the one with the lowest penalty.
  const MASKS: Array<(r: number, c: number) => boolean> = [
    (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (_r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];
  let best: boolean[][] | null = null, bestScore = Infinity;
  MASKS.forEach((mask, m) => {
    const g = grid.map((row, r) => row.map((v, c) => (isFunction[r][c] ? !!v : !!v !== mask(r, c))));
    placeFormat(g, m, size);
    const score = penalty(g);
    if (score < bestScore) { best = g; bestScore = score; }
  });
  return best!;
}

function placeFormat(g: boolean[][], mask: number, size: number): void {
  // EC level M = 00, then the mask; BCH(15,5) with generator 0x537, XOR 0x5412.
  const data = (0b00 << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bits >> i) & 1) === 1;
  // g[row][col]. Copy 1, around the top-left finder.
  for (let i = 0; i <= 5; i++) g[i][8] = bit(i);
  g[7][8] = bit(6); g[8][8] = bit(7); g[8][7] = bit(8);
  for (let i = 9; i <= 14; i++) g[8][14 - i] = bit(i);
  // Copy 2, split between the top-right and bottom-left finders.
  for (let i = 0; i <= 7; i++) g[8][size - 1 - i] = bit(i);
  for (let i = 8; i <= 14; i++) g[size - 15 + i][8] = bit(i);
  g[size - 8][8] = true; // the dark module
}

function penalty(g: boolean[][]): number {
  const n = g.length;
  let score = 0;
  const lines = [...g, ...g.map((_, c) => g.map((row) => row[c]))];
  for (const line of lines) {
    // Runs of 5+ same-coloured modules.
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && line[i] === line[i - 1]) run++;
      else { if (run >= 5) score += 3 + run - 5; run = 1; }
    }
    // Finder-like patterns.
    const s = line.map((v) => (v ? "1" : "0")).join("");
    score += 40 * ((s.match(/(?=10111010000)/g)?.length ?? 0) + (s.match(/(?=00001011101)/g)?.length ?? 0));
  }
  // 2x2 blocks.
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const v = g[r][c];
    if (g[r][c + 1] === v && g[r + 1][c] === v && g[r + 1][c + 1] === v) score += 3;
  }
  // Dark/light balance.
  const dark = g.flat().filter(Boolean).length;
  score += Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5) * 10;
  return score;
}

/** Draw a QR code into a canvas (with the 4-module quiet zone), dark on white. */
export function drawQr(canvas: HTMLCanvasElement, text: string, px: number): void {
  const m = qrMatrix(text), n = m.length, quiet = 4;
  const scale = Math.max(1, Math.floor(px / (n + quiet * 2)));
  canvas.width = canvas.height = (n + quiet * 2) * scale;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#000";
  m.forEach((row, r) => row.forEach((v, c) => { if (v) g.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale); }));
}
