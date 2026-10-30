import { defineConfig } from "vite";

// Static build for Netlify. The CSP goes into the built page only (Vite's dev server
// injects inline scripts). connect-src 'none': the game makes no network calls.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'none'",
  "font-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export default defineConfig({
  base: "./",
  // One classic (non-module) script: browsers block module scripts on file:// pages, and the game
  // is also opened from the built Genome Wrapped page on disk.
  build: { target: "es2022", assetsInlineLimit: 0, modulePreload: false, cssCodeSplit: false, rollupOptions: { output: { format: "iife" } } },
  // npm test runs tests/ only; scripts/balance.test.ts is run by hand: BALANCE=1 npx vitest run --silent=false.
  test: { include: process.env.BALANCE ? ["scripts/balance.test.ts"] : ["tests/**/*.test.ts"] },
  plugins: [{
    name: "csp",
    apply: "build",
    transformIndexHtml: (html) =>
      html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}">`),
  }, {
    name: "classic-script",
    apply: "build",
    enforce: "post",
    // The iife bundle runs as a classic script, at the end of the body so the page is parsed first.
    transformIndexHtml: (html) => {
      const tag = /<script type="module" crossorigin src="([^"]+)"><\/script>\n?/.exec(html);
      if (!tag) throw new Error("classic-script: no module script tag found");
      return html.replace(tag[0], "").replace(/ crossorigin(?=[ >])/g, "").replace("</body>", `  <script src="${tag[1]}"></script>\n  </body>`);
    },
  }],
});
