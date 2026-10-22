// Records the live Chaya app for the demo video, timed to the voice-over.
// Usage: node record.js <cues.json> <outdir>
// cues.json: [{t: seconds from start, a: action, s: selector, v: value}], produced from the VO word timings.
// Frames come from the Chrome DevTools screencast (JPEG, 1920x1080) with their real timestamps.
const { chromium } = require("playwright");
const fs = require("fs");
const [, , cuesPath, out] = process.argv;
const cues = JSON.parse(fs.readFileSync(cuesPath, "utf8"));
const APP = "https://chaya-tau.vercel.app/";
const REPO = "https://github.com/r-e-sai-harsha/TheGeeks_MastersUnion";

const CURSOR = () => {
  const add = () => {
    if (document.getElementById("__cur")) return;
    const c = document.createElement("div");
    c.id = "__cur";
    c.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M3 2 L3 24 L9 18.5 L13 27.5 L17 25.8 L13 17 L21 17 Z" fill="#18225a" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
    c.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);transition:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.25))";
    document.documentElement.appendChild(c);
    const st = document.createElement("style");
    st.textContent = "@keyframes __rip{from{transform:translate(-50%,-50%) scale(.3);opacity:.55}to{transform:translate(-50%,-50%) scale(1.6);opacity:0}}.__rip{position:fixed;width:44px;height:44px;border-radius:50%;background:#6a44c9;pointer-events:none;z-index:2147483646;animation:__rip .55s ease-out forwards}";
    document.documentElement.appendChild(st);
    const p = window.__curPos || { x: 720, y: 405 };
    c.style.left = p.x + "px"; c.style.top = p.y + "px";
  };
  document.addEventListener("mousemove", e => { add(); const c = document.getElementById("__cur"); c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; window.__curPos = { x: e.clientX, y: e.clientY }; }, true);
  document.addEventListener("mousedown", e => { const r = document.createElement("div"); r.className = "__rip"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px"; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 700); }, true);
  if (document.readyState !== "loading") add(); else document.addEventListener("DOMContentLoaded", add);
};

(async () => {
  fs.mkdirSync(`${out}/f`, { recursive: true });
  const b = await chromium.launch({ args: ["--hide-scrollbars", "--font-render-hinting=none"] });
  const c = await b.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3 });
  await c.addInitScript(CURSOR);
  const p = await c.newPage();
  let mx = 720, my = 405;
  await p.goto(APP, { waitUntil: "networkidle" });
  await p.waitForTimeout(4000); // let the home slip settle on its default advice
  await p.mouse.move(mx, my);

  const cdp = await c.newCDPSession(p);
  const log = fs.createWriteStream(`${out}/frames.txt`);
  let n = 0;
  cdp.on("Page.screencastFrame", async f => {
    const name = `f/${String(n++).padStart(6, "0")}.jpg`;
    fs.writeFileSync(`${out}/${name}`, Buffer.from(f.data, "base64"));
    log.write(`${name} ${f.metadata.timestamp}\n`);
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  const T0 = Date.now() / 1000;
  fs.writeFileSync(`${out}/t0.txt`, String(T0));
  const wait = async t => { const d = T0 + t - Date.now() / 1000; if (d > 0) await p.waitForTimeout(d * 1000); };

  const box = async sel => {
    const el = p.locator(sel).first();
    await el.evaluate(e => { const r = e.getBoundingClientRect(); if (r.top < 70 || r.bottom > innerHeight - 10) e.scrollIntoView({ block: "center", behavior: "smooth" }); }).catch(() => {});
    await p.waitForTimeout(450);
    return el.boundingBox({ timeout: 2500 }).catch(() => null);
  };
  const glide = async (x, y, ms = 650) => {
    const steps = Math.max(8, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps, e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      await p.mouse.move(mx + (x - mx) * e, my + (y - my) * e);
      await p.waitForTimeout(ms / steps);
    }
    mx = x; my = y;
  };
  const to = async (sel, fx = .5, fy = .5) => { const bb = await box(sel); if (!bb) { console.log("miss", sel); return null; } await glide(bb.x + bb.width * fx, bb.y + bb.height * fy); return bb; };
  const click = async sel => { const bb = await to(sel); if (bb) { await p.mouse.down(); await p.waitForTimeout(70); await p.mouse.up(); } };
  const scrollTo = async (sel, block = "start") => { await p.locator(sel).first().evaluate((e, b) => e.scrollIntoView({ block: b, behavior: "smooth" }), block).catch(() => {}); };
  const setRange = async (sel, v) => {
    await p.locator(sel).first().evaluate((e, v) => { e.value = String(v); e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); }, v);
  };
  const dragSlot = async (from, to_, ms) => {
    const bb = await box("#tslider"); if (!bb) return;
    if (from < 0) from = +(await p.locator("#tslider").inputValue());
    if (to_ < 0) to_ = Math.min(95, from - to_);
    const X = s => bb.x + 8 + (bb.width - 16) * s / 95, Y = bb.y + bb.height / 2;
    await glide(X(from), Y); await p.mouse.down();
    const steps = Math.round(ms / 40);
    for (let i = 1; i <= steps; i++) { const s = from + (to_ - from) * i / steps; mx = X(s); await p.mouse.move(mx, Y); await p.waitForTimeout(40); }
    await p.mouse.up();
  };

  const A = {
    move: c => to(c.s, c.fx ?? .5, c.fy ?? .5),
    xy: c => glide(c.x, c.y),
    click: c => click(c.s),
    scroll: c => scrollTo(c.s, c.v || "start"),
    top: () => p.evaluate(() => scrollTo({ top: 0, behavior: "smooth" })),
    wheel: async c => { for (let i = 0; i < (c.n || 6); i++) { await p.mouse.wheel(0, c.v || 120); await p.waitForTimeout(c.ms || 220); } },
    select: async c => { await to(c.s); await p.selectOption(c.s, c.v); },
    range: async c => { await to(c.s); await setRange(c.s, c.v); },
    drag: c => dragSlot(c.from, c.to, c.ms || 5000),
    hash: c => p.evaluate(h => { location.hash = h; }, c.v),
    goto: async c => {
      await p.goto(c.v, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(500);
      await cdp.send("Page.stopScreencast").catch(() => {});
      await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
      await p.mouse.move(mx, my);
    },
    key: c => p.keyboard.press(c.v),
    pause: async () => { if (/pause/i.test(await p.locator("#play").innerText())) { await click("#play"); } },
    css: c => p.addStyleTag({ content: c.v }),
    pretty: () => p.evaluate(() => { const pre = document.querySelector("pre"); if (pre) { try { pre.textContent = JSON.stringify(JSON.parse(pre.textContent), null, 2); } catch (e) {} } const pp = document.querySelector(".json-formatter-container, #pretty-print"); }),
  };
  for (const cue of cues) {
    await wait(cue.t);
    try { await A[cue.a](cue); } catch (e) { console.log("cue failed", JSON.stringify(cue), String(e).slice(0, 160)); }
  }
  await wait(cues.at(-1).t + 1);
  await cdp.send("Page.stopScreencast");
  fs.writeFileSync(`${out}/t1.txt`, String(Date.now() / 1000));
  log.end(); await b.close();
  console.log("frames", n);
})();
