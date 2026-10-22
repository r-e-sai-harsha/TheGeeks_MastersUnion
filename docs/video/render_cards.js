// node render_cards.js <cards_dir>  -> <cards_dir>/*.png at 1920x1080
const { chromium } = require("playwright"); const fs = require("fs"); const dir = process.argv[2];
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3 });
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".html"))) { await p.goto("file://" + require("path").resolve(dir, f)); await p.waitForTimeout(500); await p.screenshot({ path: `${dir}/${f.replace(".html", ".png")}` }); }
  await b.close(); })();
