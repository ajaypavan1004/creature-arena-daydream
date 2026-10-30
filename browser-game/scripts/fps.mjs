import { chromium } from "/Users/ajaypavan/creature-arena/node_modules/playwright-core/index.mjs";
import { serve } from "./serve.mjs";
const srv = await serve("/Users/ajaypavan/creature-arena/dist");
for (const args of [[], ["--enable-gpu", "--use-angle=metal"], ["--use-gl=angle", "--use-angle=swiftshader"]]) {
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--force-device-scale-factor=1.5", ...args] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  await page.goto(srv.url + "#rec"); await page.getByTestId("start").click(); await page.waitForTimeout(500);
  const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
  console.log(args.join(" ") || "default", "fps", fps);
  await browser.close();
}
srv.close();
