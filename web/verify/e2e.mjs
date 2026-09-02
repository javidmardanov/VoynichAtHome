// Headless end-to-end check of the verification page: serve this directory,
// open index.html?auto=1 in Chromium, wait for the verdict, require MATCH.
//
//   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install   (uses a preinstalled Chromium via CHROME or PLAYWRIGHT_BROWSERS_PATH)
//   npx playwright install --with-deps chromium      (CI)
//   node e2e.mjs
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".wasm": "application/wasm" };
const server = createServer(async (req, res) => {
  const clean = req.url.split("?")[0];
  const path = join(here, clean === "/" ? "index.html" : clean);
  try {
    const body = await readFile(path);
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

async function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && existsSync(base)) {
    for (const d of (await readdir(base)).sort().reverse()) {
      if (!d.startsWith("chromium")) continue;
      for (const rel of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
        const p = join(base, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return undefined; // let playwright use its own download
}

const executablePath = await findChrome();
const browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.error("console:", m.text()); });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/index.html?auto=1`);
await page.waitForFunction(() => /MATCH|Error/.test(document.getElementById("s4d").textContent), null, { timeout: 180000 });
const verdict = await page.locator("#s4d").textContent();
const digest = await page.locator("#s2d").textContent();
const specimen = (await page.locator("#s5d").textContent()).split("\n")[0];
await browser.close();
server.close();
console.log(`digest: ${digest}`);
console.log(`verdict: ${verdict} (${Date.now() - t0} ms)`);
console.log(`specimen: ${specimen}`);
if (!verdict.startsWith("MATCH")) process.exit(1);
