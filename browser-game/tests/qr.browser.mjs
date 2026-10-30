// Checks src/qr.ts with Chrome's own QR reader (BarcodeDetector). Run: node tests/qr.browser.mjs
// (needs a build of the QR module: it is bundled on the fly with Vite's library mode).
import { build } from "vite";
import { chromium } from "playwright-core";
import { createServer } from "node:http";

const out = await build({ logLevel: "silent", build: { write: false, lib: { entry: "src/qr.ts", formats: ["es"], fileName: "qr" } } });
const code = out[0].output[0].code;
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage();
// BarcodeDetector needs a secure context: serve a blank page from localhost.
const srv = createServer((_q, r) => { r.writeHead(200, { "content-type": "text/html" }); r.end("<body></body>"); });
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
await page.goto(`http://127.0.0.1:${srv.address().port}/`);
const texts = ["http://192.168.1.23:8787/#join=KQTX", "A", "http://172.20.10.2:8787/#join=ZZZZ&x=1234567890", "x".repeat(100)];
const results = await page.evaluate(async ({ code, texts }) => {
  const mod = await import(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
  if (!("BarcodeDetector" in window)) return "no BarcodeDetector";
  const det = new BarcodeDetector({ formats: ["qr_code"] });
  const out = [];
  for (const t of texts) {
    const c = document.createElement("canvas");
    mod.drawQr(c, t, 400);
    const found = await det.detect(c);
    out.push({ want: t, got: found[0]?.rawValue ?? null, size: mod.qrMatrix(t).length });
  }
  return out;
}, { code, texts });
console.log(results);
await browser.close();
srv.close();
const ok = Array.isArray(results) && results.every((r) => r.got === r.want);
console.log(ok ? "QR OK" : "QR FAILED");
process.exit(ok ? 0 : 1);
