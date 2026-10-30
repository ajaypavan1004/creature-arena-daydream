// Creature Arena local network server. Runs on the host laptop, with no internet needed:
// it serves the built game (dist/) to devices on the same WiFi or hotspot, and relays
// messages between the host's browser (which runs the game) and the joining player.
// No accounts, no logging of players, nothing leaves the local network.
//
// Start it with:  npm run lan        (builds the game, then runs this)
// or, after a build:  node server/lan.mjs [port]
import { createHash, randomInt } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8787);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webp": "image/webp",
};

if (!existsSync(join(ROOT, "index.html"))) {
  console.error("No build found in dist/. Run: npm run lan");
  process.exit(1);
}

/** This laptop's addresses on local networks (WiFi, Ethernet, phone hotspot). */
export function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push(a.address);
    }
  }
  return out;
}

// ------------------------------------------------------------------- web pages

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) { res.writeHead(404); res.end("Not found"); return; }
  let body = readFileSync(file);
  if (file.endsWith("index.html")) {
    // Let this page talk to this server only (the Netlify build stays connect-src 'none'),
    // and tell the game that local network play is available.
    const host = (req.headers.host ?? `localhost:${PORT}`).replace(/[^\w.:[\]-]/g, "");
    body = Buffer.from(body.toString("utf8")
      .replace("connect-src 'none'", `connect-src 'self' ws://${host}`)
      .replace("<head>", `<head>\n    <meta name="arena-lan" content="${lanAddresses().map((a) => `${a}:${PORT}`).join(" ")}">`));
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(body);
});

// ------------------------------------------------------- WebSocket (RFC 6455)
// Just enough of the protocol for small text messages between browsers.

class Socket {
  constructor(sock) {
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.onmessage = () => {};
    this.onclose = () => {};
    this.closed = false;
    sock.on("data", (d) => this.read(d));
    sock.on("close", () => this.close());
    sock.on("error", () => this.close());
    sock.setNoDelay(true);
  }

  read(data) {
    this.buf = Buffer.concat([this.buf, data]);
    for (;;) {
      if (this.buf.length < 2) return;
      const op = this.buf[0] & 0x0f, masked = this.buf[1] & 0x80;
      let len = this.buf[1] & 0x7f, at = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); at = 10; }
      if (len > 1 << 20) { this.close(); return; } // messages are small; refuse anything huge
      const need = at + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      let payload = this.buf.subarray(at + (masked ? 4 : 0), need);
      if (masked) {
        const mask = this.buf.subarray(at, at + 4);
        payload = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]));
      }
      this.buf = this.buf.subarray(need);
      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this.frame(0xa, payload); continue; }
      if (op === 0x1) {
        try { this.onmessage(JSON.parse(payload.toString("utf8"))); } catch { /* ignore bad messages */ }
      }
    }
  }

  frame(op, payload) {
    if (this.closed) return;
    const len = payload.length;
    const head = len < 126 ? Buffer.from([0x80 | op, len])
      : len < 65536 ? Buffer.from([0x80 | op, 126, len >> 8, len & 255])
      : Buffer.concat([Buffer.from([0x80 | op, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); return b; })()]);
    this.sock.write(Buffer.concat([head, payload]));
  }

  send(msg) { this.frame(0x1, Buffer.from(JSON.stringify(msg))); }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.sock.end(Buffer.from([0x88, 0])); } catch { /* already gone */ }
    this.onclose();
  }
}

// ----------------------------------------------------------------------- rooms
// A room has one host and up to `max` guests (1 for a versus fight, up to 3 for a
// Hatchling Expedition). Guest messages go to the host, tagged with the guest's number;
// host messages go to every guest, or to one guest when they carry `to`.

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O (they look like 1 and 0)
/** code -> { code, host, guests: Map<id, Socket>, max, mode, nextId } */
const rooms = new Map();

function newCode() {
  for (;;) {
    const code = Array.from({ length: 4 }, () => LETTERS[randomInt(LETTERS.length)]).join("");
    if (!rooms.has(code)) return code;
  }
}

server.on("upgrade", (req, sock) => {
  if (new URL(req.url ?? "/", "http://x").pathname !== "/ws" || !req.headers["sec-websocket-key"]) { sock.destroy(); return; }
  const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const ws = new Socket(sock);
  let room = null, role = null, id = -1;

  ws.onmessage = (m) => {
    if (m.t === "host" && !role) {
      role = "host";
      const code = newCode();
      const max = Math.max(1, Math.min(3, Number(m.max) || 1));
      room = { code, host: ws, guests: new Map(), max, mode: m.mode === "coop" ? "coop" : "versus", nextId: 1 };
      rooms.set(code, room);
      ws.send({ t: "room", code, addresses: lanAddresses().map((a) => `${a}:${PORT}`) });
      console.log(`Room ${code} open (${room.mode}). Players can join with code ${code}.`);
    } else if (m.t === "join" && !role) {
      const r = rooms.get(String(m.code ?? "").toUpperCase());
      if (!r) { ws.send({ t: "error", why: "No game with that code. Check the code on the host screen." }); return; }
      if (r.guests.size >= r.max) { ws.send({ t: "error", why: r.max === 1 ? "That game already has two players." : "That game is full." }); return; }
      role = "guest"; room = r; id = r.nextId++;
      r.guests.set(id, ws);
      ws.send({ t: "joined", code: r.code, mode: r.mode, id });
      r.host.send({ t: "guest-joined", id });
      console.log(`A player joined room ${r.code}.`);
    } else if (role === "host" && room) {
      // host -> one guest (to) or all guests
      if (m.to !== undefined) room.guests.get(m.to)?.send(m);
      else for (const g of room.guests.values()) g.send(m);
    } else if (role === "guest" && room) {
      room.host.send({ ...m, from: id }); // guest -> host, tagged
    }
  };

  ws.onclose = () => {
    if (!room) return;
    if (role === "host") {
      for (const g of room.guests.values()) { g.send({ t: "host-left" }); g.close(); }
      rooms.delete(room.code);
      console.log(`Room ${room.code} closed.`);
    } else if (role === "guest" && room.guests.get(id) === ws) {
      room.guests.delete(id);
      room.host.send({ t: "guest-left", id });
      console.log(`A player left room ${room.code}.`);
    }
  };
});

server.listen(PORT, "0.0.0.0", () => {
  const addrs = lanAddresses();
  console.log("\nCreature Arena local network server is running.\n");
  console.log(`  On this laptop, open:    http://localhost:${PORT}/  and choose "Host on local network"`);
  if (addrs.length) {
    console.log("  Other devices join at:   " + addrs.map((a) => `http://${a}:${PORT}/`).join("  or  "));
  } else {
    console.log("  No local network found. Connect to WiFi or turn on a phone hotspot, then restart.");
  }
  console.log("\n  Press Ctrl+C to stop.\n");
});
