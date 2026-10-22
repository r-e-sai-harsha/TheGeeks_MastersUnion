/* Chaya web app: home, clinic, product tour, case walkthrough, glossary.
   Talks to the FastAPI + database backend when it is reachable; otherwise runs the same
   clinic from the bundled synthetic data (offline demo). The twin simulator below mirrors
   src/chaya/physiology.py exactly. */
(() => {
"use strict";

// ================================================================== helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const fmtT = m => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const store = {
  get(k, d) { try { const v = localStorage.getItem("chaya." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("chaya." + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const toastEl = () => $("#toast");
let toastTimer;
function toast(msg) { const t = toastEl(); t.textContent = msg; t.classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 2600); }

// ================================================================== twin simulator (mirror of physiology.py)
const P2 = 0.025, NCL = 0.14, TAUE = 240, KE = 0.0008;
const gi2k = gi => 0.012 + 0.00045 * gi;
const dawn = m => { const x = (m - 360) / 75; return Math.exp(-0.5 * x * x); };
function forecast(p, s0, startMin, H, stepsMin, mealMg, kabs, si, gbShift, su) {
  const [Gb, Sg, SI, gamma, Ib, Vg, f, dawnA, kEx] = p;
  let [G, X, I, Q1, Q2, E] = s0; const out = [];
  for (let t = 0; t < H; t++) {
    const mod = (startMin + t) % 1440, gbe = Gb + gbShift, ra = f * kabs[t] * Q2;
    const dG = -(Sg + X * (1 + E)) * G + Sg * gbe + ra / Vg + dawnA * dawn(mod) - kEx * stepsMin[t] * G;
    const dX = -P2 * X + P2 * SI * si * (I - Ib);
    const dI = -NCL * (I - Ib) + gamma * Math.max(G - gbe, 0) + su * Math.exp(-t / 600);
    const dQ1 = -kabs[t] * Q1 + mealMg[t], dQ2 = kabs[t] * (Q1 - Q2), dE = -E / TAUE + KE * stepsMin[t];
    G = Math.max(G + dG, 20); X += dX; I = Math.max(I + dI, 0); Q1 = Math.max(Q1 + dQ1, 0); Q2 = Math.max(Q2 + dQ2, 0); E = Math.max(E + dE, 0);
    if ((t + 1) % 5 === 0) out.push(G);
  }
  return out;
}
function routine(tw, startMin, H, withMeals) {
  const steps = [], meal = [], kab = [];
  for (let t = 0; t < H; t++) {
    const b = Math.floor(((startMin + t) % 1440) / 5);
    steps.push(tw.steps_prof[b]); meal.push(withMeals ? tw.habit_carbs[b] * 1000 / 5 : 0); kab.push(gi2k(tw.habit_gi[b]));
  }
  return { steps, meal, kab };
}
/* A meal logged in the last 15 minutes is still being eaten: carry its remaining carbs into the forecast. */
function carryMeals(P, k, r) {
  P.meals.forEach(m => {
    const left = 15 - (k * 5 + 5 - m.k * 5);
    if (m.k <= k && left > 0) { for (let t = 0; t < left; t++) r.meal[t] += m.carbs * 1000 / 15; for (let t = 0; t < r.kab.length; t++) r.kab[t] = gi2k(m.gi); }
  });
  return r;
}
/* Run a patient's twin from prediction index i under advice. Returns {base, scen, cmp}. */
function simulate(P, i, adv, H = 240) {
  const tw = P.twin, k = P.pred.k[i], st = tw.states[i], sm = (k % 288) * 5 + 5, day = Math.floor(k / 288) + 7;
  const r = carryMeals(P, k, routine(tw, sm, H, false));
  const n = P.nights.find(x => x.day === day), nPrev = P.nights.find(x => x.day === day - 1);
  const siFor = h => Math.max(0.6, 1 - 0.07 * (Math.max(0, 7 - h) + 0.5 * Math.max(0, 7 - (nPrev ? nPrev.sleep_hours : 7))));
  const siAct = tw.si_mult[day], gbAct = tw.gb_shift[day];
  const si = adv.sleepTouched ? siFor(adv.sleep) : siAct;
  const gb = P.ehr.on_metformin && adv.metTouched ? (adv.met ? 0 : 14) : gbAct;
  const base = forecast(tw.params, st, sm, H, r.steps, r.meal, r.kab, si, gb, tw.su[i]);
  const meal = r.meal.slice(), kab = r.kab.slice(), steps = r.steps.slice();
  if (adv.meal) {
    for (let t = adv.when; t < Math.min(H, adv.when + 15); t++) meal[t] += adv.meal.carbs * 1000 / 15;
    for (let t = adv.when; t < H; t++) kab[t] = gi2k(adv.meal.gi);
  }
  const cmp = forecast(tw.params, st, sm, H, steps, meal, kab, siAct, gbAct, tw.su[i]); // meal alone, as things stand
  for (let t = adv.when + 20; t < Math.min(H, adv.when + 20 + adv.walk); t++) steps[t] += 100;
  const scen = forecast(tw.params, st, sm, H, steps, meal, kab, si, gb, tw.su[i]);
  return { base, scen, cmp, start: st[0], sm, night: n };
}
const peakOf = a => Math.max(...a);
const above = a => a.filter(v => v > 180).length * 5;

// ================================================================== data layer
const Data = {
  live: false, db: null, meta: null, register: null, cases: new Map(), demo: null,
  async init() {
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch("api/health", { signal: ctl.signal }); clearTimeout(to);
      if (r.ok && (r.headers.get("content-type") || "").includes("json")) { const h = await r.json(); this.live = true; this.db = h.database; }
    } catch { this.live = false; }
    const pill = $("#conn"), t = $("#conn-t");
    if (this.live) { pill.classList.add("live"); t.textContent = `Live · ${this.db.replace(" PostgreSQL", "")}`; pill.title = `Clinic data is served by the Chaya API from ${this.db}. Notes you save are stored there.`; }
    else { t.textContent = "Offline demo"; pill.title = "The API is not reachable here, so the clinic runs on the bundled synthetic data. Notes are kept in this browser."; }
  },
  async demoData() { if (!this.demo) this.demo = await (await fetch("data/demo.json")).json(); return this.demo; },
  async getMeta() {
    if (this.meta) return this.meta;
    if (this.live) this.meta = await (await fetch("api/meta")).json();
    else { const d = await this.demoData(); this.meta = { start: d.start, threshold: d.threshold, metrics: d.metrics, groups: d.groups, meal_catalog: d.meal_catalog, population: d.population }; }
    return this.meta;
  },
  async getRegister() {
    if (this.register) return this.register;
    this.register = this.live ? await (await fetch("api/patients")).json() : (await this.demoData()).cohort;
    return this.register;
  },
  async getCase(pid) {
    if (this.cases.has(pid)) return this.cases.get(pid);
    let c;
    if (this.live) { const r = await fetch(`api/patients/${encodeURIComponent(pid)}`); if (!r.ok) throw new Error("not found"); c = await r.json(); }
    else { const d = await this.demoData(); c = d.patients[pid]; if (!c) throw new Error("not found"); c.reviewed = store.get(`reviewed.${pid}`, []); }
    this.cases.set(pid, c); return c;
  },
  async notes(pid) {
    if (this.live) return (await fetch(`api/patients/${pid}/notes`)).json();
    return store.get(`notes.${pid}`, []);
  },
  async addNote(pid, body, projection) {
    if (this.live) {
      const r = await fetch(`api/patients/${pid}/notes`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, projected_peak: projection.peak, projected_minutes_above: projection.above }) });
      if (!r.ok) throw new Error((await r.json()).detail || "Could not save");
      return r.json();
    }
    const list = store.get(`notes.${pid}`, []);
    const n = { id: Date.now(), created_at: new Date().toISOString(), at_k: body.k, summary: body.summary, projected_peak: projection.peak, projected_minutes_above: projection.above, baseline_peak: body.baseline_peak, author: "You (this browser)" };
    list.unshift(n); store.set(`notes.${pid}`, list); return n;
  },
  async deleteNote(pid, id) {
    if (this.live) { await fetch(`api/patients/${pid}/notes/${id}`, { method: "DELETE" }); return; }
    store.set(`notes.${pid}`, store.get(`notes.${pid}`, []).filter(n => n.id !== id));
  },
  async review(pid, k) {
    if (this.live) await fetch(`api/patients/${pid}/alerts/${k}/review`, { method: "POST" });
    else { const s = new Set(store.get(`reviewed.${pid}`, [])); s.add(k); store.set(`reviewed.${pid}`, [...s]); }
  },
};

// ================================================================== router
const views = { home: $("#view-home"), clinic: $("#view-clinic") };
let current = null;
function parseHash() {
  const h = location.hash || "#/";
  if (!h.startsWith("#/")) return { view: "home", anchor: h.slice(1) };
  const [path, q] = h.slice(2).split("?");
  const params = new URLSearchParams(q || "");
  const parts = path.split("/").filter(Boolean);
  return { view: parts[0] === "clinic" ? "clinic" : "home", pid: parts[1], params };
}
async function route() {
  const r = parseHash();
  Object.entries(views).forEach(([k, el]) => { el.hidden = k !== r.view; });
  $("#cta-top").hidden = r.view === "clinic";
  renderNav(r.view);
  if (r.view === "home") {
    if (current !== "home") { await Home.init(); window.scrollTo(0, 0); }
    if (r.anchor) { const t = document.getElementById(r.anchor); if (t) t.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); }
  } else {
    if (current !== "clinic") window.scrollTo(0, 0);
    await Clinic.init(r.pid);
    if (r.params.get("tour")) { history.replaceState(null, "", "#/clinic"); Tour.start(TOUR); }
    else if (r.params.get("case")) { history.replaceState(null, "", "#/clinic"); Tour.start(CASE); }
    else Welcome.maybe();
  }
  current = r.view;
}
function renderNav(view) {
  const links = view === "home"
    ? [["#how", "How it works"], ["#evidence", "Evidence"], ["#india", "Built for India"], ["#safety", "Safety"]]
    : [["#/", "Home"], ["#/clinic", "Clinic", true]];
  $("#navlinks").innerHTML = links.map(([h, t, cur]) => `<a href="${h}"${cur ? ' aria-current="page"' : ""}>${t}</a>`).join("");
}
window.addEventListener("hashchange", route);

// ================================================================== HOME
const Home = {
  ready: false, P: null, i: null, choice: { meal: "ragi", walk: 20 },
  MEALS: { biryani: ["Chicken biryani", 90, 72], rice: ["Rice + sambar + poriyal", 85, 73], ragi: ["Ragi mudde + saaru", 60, 55] },
  async init() {
    if (this.ready) return; this.ready = true;
    const d = await (await fetch("data/home-case.json")).json();
    this.d = d; this.P = d.patients["GT-1102"];
    const k = 6 * 288 + 49 * 3; this.k = k;
    this.i = this.P.pred.k.findIndex(x => x >= k);
    $("#slip-meals").innerHTML = Object.entries(this.MEALS).map(([id, m]) => `<button class="chip" data-meal="${id}" aria-pressed="false">${esc(m[0].replace(" + poriyal", ""))}</button>`).join(" ");
    $("#slip-walk").innerHTML = `<button class="chip" data-walk="0" aria-pressed="false">Rest</button> <button class="chip" data-walk="20" aria-pressed="false">Walk 20 min</button>`;
    $("#slip").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.meal) this.choice.meal = b.dataset.meal;
      if (b.dataset.walk) this.choice.walk = +b.dataset.walk;
      this.renderSlip(true);
    });
    this.choice = { meal: "biryani", walk: 0 };
    this.renderSlip(false);
    this.renderTimeline(); this.renderReport();
    // the first viewport demonstrates the mechanism: swap to the better advice after a beat
    if (!reduceMotion) setTimeout(() => { if (this.choice.meal === "biryani" && this.choice.walk === 0) { this.choice = { meal: "ragi", walk: 20 }; this.renderSlip(true); } }, 2600);
  },
  run(c) {
    const m = this.MEALS[c.meal];
    return simulate(this.P, this.i, { meal: { carbs: m[1], gi: m[2] }, when: 15, walk: c.walk, sleep: 7, met: 1 });
  },
  renderSlip(animate) {
    const c = this.choice;
    $$("#slip [data-meal]").forEach(b => b.setAttribute("aria-pressed", b.dataset.meal === c.meal));
    $$("#slip [data-walk]").forEach(b => b.setAttribute("aria-pressed", +b.dataset.walk === c.walk));
    const P = this.P, k = this.k, r = this.run(c), ref = this.run({ meal: "biryani", walk: 0 });
    const svg = d3.select("#slip-svg"), W = 560, H = 220, M = { l: 34, r: 10, t: 14, b: 22 };
    const past = P.cgm.slice(k - 24, k + 1).map((v, j) => [j - 24, v]);
    const x = d3.scaleLinear([-24, 48], [M.l, W - M.r]), y = d3.scaleLinear([60, 300], [H - M.b, M.t]);
    if (!svg.select(".base").size()) {
      svg.append("rect").attr("class", "band").attr("x", M.l).attr("width", W - M.l - M.r).attr("y", y(180)).attr("height", y(70) - y(180)).attr("fill", "var(--band)");
      [70, 180, 250].forEach(v => { svg.append("line").attr("x1", M.l).attr("x2", W - M.r).attr("y1", y(v)).attr("y2", y(v)).attr("stroke", "var(--edge)").attr("stroke-dasharray", v === 250 ? "3 3" : null);
        svg.append("text").attr("x", M.l - 6).attr("y", y(v) + 3).attr("text-anchor", "end").text(v); });
      [[-24, "10:15"], [0, "12:15"], [12, "13:15"], [24, "14:15"], [36, "15:15"], [48, "16:15"]].forEach(([t, l]) => svg.append("text").attr("x", x(t)).attr("y", H - 6).attr("text-anchor", t === -24 ? "start" : t === 48 ? "end" : "middle").text(l));
      svg.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", M.t).attr("y2", H - M.b).attr("stroke", "var(--ink)").attr("stroke-width", 1);
      svg.append("text").attr("x", x(0) + 5).attr("y", M.t + 9).style("fill", "var(--ink)").text("now");
      svg.append("text").attr("x", x(3) + 7).attr("y", y(70) - 8).style("fill", "var(--watch)").text("lunch 12:30");
      svg.append("circle").attr("cx", x(3)).attr("cy", y(70) - 11).attr("r", 3.5).attr("fill", "var(--watch)");
      svg.append("path").attr("class", "past").attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 2.2)
        .attr("d", d3.line().defined(d => d[1] != null).x(d => x(d[0])).y(d => y(d[1]))(past));
      svg.append("path").attr("class", "ref").attr("fill", "none").attr("stroke", "var(--replay)").attr("stroke-width", 1.4).attr("stroke-dasharray", "2 3");
      svg.append("path").attr("class", "base").attr("fill", "none").attr("stroke", "var(--shadow)").attr("stroke-width", 2.8).attr("stroke-dasharray", "7 4");
    }
    const ln = d3.line().x((d, j) => x(j)).y(d => y(d)).curve(d3.curveMonotoneX);
    svg.select(".ref").attr("d", ln([r.start, ...ref.scen])).attr("opacity", c.meal === "biryani" && c.walk === 0 ? 0 : 1);
    const pth = svg.select(".base"); const dNew = ln([r.start, ...r.scen]);
    (animate && !reduceMotion ? pth.transition().duration(700).ease(d3.easeCubicOut) : pth).attr("d", dNew);
    const pk = peakOf(r.scen), ab = above(r.scen), refPk = peakOf(ref.scen);
    const hot = pk > 180;
    $("#slip-stamp").innerHTML = `<div class="stamp ${hot ? "alert" : "ok"} ${animate ? "press" : ""}" role="img" aria-label="${hot ? "Spike likely" : "In range"}"><span class="s-main">${hot ? "Spike likely" : "In range"}</span><span class="s-sub">peak ${Math.round(pk)} mg/dL</span></div>`;
    const dlt = Math.round(pk - refPk);
    $("#slip-out").innerHTML = `<span>Forecast peak <b>${Math.round(pk)}</b> mg/dL</span><span>Above 180 for <b>${ab}</b> min</span>` +
      (dlt < 0 ? `<span class="delta good">${dlt} mg/dL against biryani with no walk</span>` : `<span>Try ragi mudde, then add a walk.</span>`);
  },
  renderTimeline() {
    const P = this.P, svg = d3.select("#timeline-svg"), W = 1180, H = 190, M = { l: 10, r: 10, t: 30, b: 34 };
    const x = d3.scaleLinear([0, 14 * 288], [M.l, W - M.r]), y = d3.scaleLinear([60, 320], [H - M.b, M.t]);
    svg.append("rect").attr("x", x(0)).attr("y", M.t).attr("width", x(7 * 288) - x(0)).attr("height", H - M.t - M.b).attr("fill", "var(--sheet-2)");
    svg.append("rect").attr("x", x(7 * 288)).attr("y", y(180)).attr("width", x(14 * 288) - x(7 * 288)).attr("height", y(70) - y(180)).attr("fill", "var(--band)");
    svg.append("text").attr("x", x(0) + 12).attr("y", M.t + 22).style("font-family", "var(--f-hand)").style("font-size", "20px").style("fill", "var(--ink)").text("Days 1–7: learning Sanjay's body");
    svg.append("text").attr("x", x(0) + 12).attr("y", M.t + 44).style("fill", "var(--ink-3)").text("calibrate insulin sensitivity, insulin response, resting glucose, meal absorption, dawn rise");
    svg.append("text").attr("x", x(7 * 288) + 12).attr("y", M.t - 10).style("font-family", "var(--f-hand)").style("font-size", "20px").style("fill", "var(--ink)").text("Days 8–14: forecasting every 15 minutes");
    const pts = P.cgm.map((v, j) => [7 * 288 + j, v]);
    svg.append("path").attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 1.1).attr("d", d3.line().defined(d => d[1] != null).x(d => x(d[0])).y(d => y(d[1])).curve(d3.curveMonotoneX)(pts));
    P.pred.k.forEach((k, j) => { if (P.pred.start[j]) svg.append("path").attr("d", `M${x(7 * 288 + k)} ${H - M.b + 6} l4 8 h-8z`).attr("fill", "var(--alert)"); });
    for (let d = 0; d <= 14; d++) svg.append("line").attr("x1", x(d * 288)).attr("x2", x(d * 288)).attr("y1", M.t).attr("y2", H - M.b).attr("stroke", "var(--edge)");
    for (let d = 0; d < 14; d++) svg.append("text").attr("x", x(d * 288 + 144)).attr("y", H - 2).attr("text-anchor", "middle").text(`day ${d + 1}`);
    svg.append("line").attr("x1", x(7 * 288)).attr("x2", x(7 * 288)).attr("y1", M.t - 22).attr("y2", H - M.b).attr("stroke", "var(--shadow)").attr("stroke-width", 2);
  },
  renderReport() {
    const m = this.d.metrics, c = m.classification["Chaya: fusion + digital twin"], tr = m.classification["Trend extrapolation (CGM only)"];
    const r = m.regression, tc = m.twin_calibration;
    const rows = [
      ["Spike prediction, 2 h ahead (AUROC)", c.auroc.toFixed(3), `CGM trend alone ${tr.auroc.toFixed(3)}`, "Better"],
      ["Spikes caught (sensitivity)", `${Math.round(c.sensitivity * 100)}%`, `at ${Math.round(c.precision * 100)}% precision`, "—"],
      ["Spikes flagged an hour or more ahead", `${Math.round(c.event_detection_60min * 100)}%`, `${c.n_onsets} spike onsets`, "—"],
      ["Alert episodes per patient a day", c.alerts_per_patient_day.toFixed(1), "merged, threshold adjustable", "—"],
      ["Glucose 2 h ahead, average error", `${r["Chaya hybrid"].rmse.toFixed(0)} mg/dL`, `${r["Persistence (last CGM)"].rmse.toFixed(0)} if glucose assumed flat`, "Better"],
      ["Forecasts in safe Clarke zones A+B", `${r["Chaya hybrid"].clarke_AB_pct.toFixed(1)}%`, `${r["Persistence (last CGM)"].clarke_AB_pct.toFixed(1)}% flat`, "Better"],
      ["Twin recovers true insulin sensitivity (r)", tc.SI.r_calibrated.toFixed(2), `${tc.SI.r_ehr_prior.toFixed(2)} from EHR alone`, "Better"],
      ["Twin recovers resting glucose (r)", tc.Gb.r_calibrated.toFixed(2), `${tc.Gb.r_ehr_prior.toFixed(2)} from EHR alone`, "Better"],
    ];
    $("#report-rows").innerHTML = rows.map(([a, b, cc, f]) => `<tr><td>${a}</td><td class="res">${b}</td><td class="ref">${cc}</td><td class="flag">${f === "—" ? '<span style="color:var(--ink-3)">—</span>' : f}</td></tr>`).join("");
  },
};

// ================================================================== CLINIC
const S = { pid: null, day: 6, slot: 51, wi: { meal: null, when: 15, walk: 0, met: 1, sleep: 7, metTouched: false, sleepTouched: false }, playing: null, notes: [] };
const Clinic = {
  ready: false,
  async init(pid) {
    if (!this.ready) {
      this.ready = true;
      this.meta = await Data.getMeta();
      this.setupClock(); this.setupRx(); this.setupRegister();
      $("#notes").addEventListener("click", e => { const b = e.target.closest("[data-del]"); if (b) this.deleteNote(+b.dataset.del); });
      $("#save-note").addEventListener("click", () => this.saveNote());
      $("#review-wrap").addEventListener("click", e => { if (e.target.closest("#review-btn")) this.review(); });
      let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (S.pid && !views.clinic.hidden) { this.renderTrace(); this.renderRx(); } }, 120); });
      const rerender = () => { if (S.pid) this.renderTime(); };
      new MutationObserver(rerender).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    }
    await this.renderRegister();
    const target = pid || S.pid || "GT-1102";
    if (target !== S.pid) await this.open(target);
  },
  P() { return Data.cases.get(S.pid); },
  kNow() { return S.day * 288 + S.slot * 3; },
  idx(P = this.P()) { const k = this.kNow(); let i = -1; for (let j = 0; j < P.pred.k.length; j++) { if (P.pred.k[j] <= k) i = j; else break; } return i; },

  // ---------------------------------------------------------------- register
  setupRegister() {
    $("#search").addEventListener("input", () => this.renderRegister());
    $("#sort").addEventListener("change", () => this.renderRegister());
    $("#rlist").addEventListener("click", e => { const b = e.target.closest(".rrow"); if (b) { history.replaceState(null, "", `#/clinic/${b.dataset.pid}`); this.open(b.dataset.pid); } });
  },
  async renderRegister() {
    const reg = await Data.getRegister(), q = $("#search").value.trim().toLowerCase(), sort = $("#sort").value;
    const rows = reg.filter(c => !q || `${c.name} ${c.city} ${c.pid}`.toLowerCase().includes(q));
    const by = { alerts: (a, b) => b.alerts - a.alerts || a.tir - b.tir, tir: (a, b) => a.tir - b.tir, a1c: (a, b) => b.hba1c - a.hba1c, name: (a, b) => a.name.localeCompare(b.name) }[sort];
    rows.sort(by);
    $("#reg-count").textContent = `${rows.length} of ${reg.length}`;
    $("#rlist").innerHTML = rows.length ? rows.map(c => {
      const cls = c.alerts >= 35 ? "hi" : c.alerts >= 18 ? "mid" : "";
      return `<button class="rrow" role="listitem" data-pid="${c.pid}" aria-current="${c.pid === S.pid}">
        <span class="nm">${esc(c.name)}</span><span class="count ${cls}" title="Spike warnings this week">${c.alerts} warnings</span>
        <span class="mt">${c.age}${c.sex} · ${esc(c.city)} · ${c.condition}</span><span class="a1c num">A1c ${c.hba1c.toFixed(1)}%</span>
        <span class="tirbar" title="Time in range ${c.tir}%, above range ${c.tar}%"><i style="width:${c.tir}%;background:var(--ok)"></i><i style="width:${c.tar}%;background:var(--alert)"></i></span>
      </button>`; }).join("") : `<p class="empty">No patient matches “${esc(q)}”. Try a first name, a city or an ID such as GT-1102.</p>`;
  },

  // ---------------------------------------------------------------- open a case
  async open(pid) {
    S.pid = pid;
    $$(".rrow").forEach(b => b.setAttribute("aria-current", b.dataset.pid === pid));
    $("#case-head").innerHTML = `<div class="loading">Opening the case…</div>`;
    let P;
    try { P = await Data.getCase(pid); }
    catch { $("#case-head").innerHTML = `<div class="loading">We couldn't open ${esc(pid)}. Pick a patient from the register.</div>`; return; }
    if (S.pid !== pid) return;
    S.wi = { meal: null, when: 15, walk: 0, met: 1, sleep: 7, metTouched: false, sleepTouched: false };
    S.wi.meal = this.defaultMeal(P);
    this.renderHead(P); this.renderRecord(P);
    await this.loadNotes();
    this.renderTime();
  },
  defaultMeal(P) {
    const k = this.kNow(), recent = P.meals.filter(m => m.k <= k && k - m.k < 18);
    if (recent.length) return -1;
    const usual = P.meals.find(m => m.slot === "lunch") || P.meals[0];
    const i = usual ? this.meta.meal_catalog.findIndex(c => c.meal === usual.meal) : -1;
    return i;
  },
  renderHead(P) {
    const e = P.ehr;
    const rx = [["on_metformin", "Metformin"], ["on_sulfonylurea", "Glimepiride"], ["on_dpp4", "Teneligliptin"], ["on_sglt2", "Dapagliflozin"], ["on_basal_insulin", "Glargine"]].filter(r => e[r[0]]).map(r => r[1]);
    const dx = [P.condition === "T2D" ? `Type 2 diabetes · ${e.diabetes_years} y` : "Prediabetes", e.hypertension && "Hypertension", e.dyslipidemia && "Dyslipidaemia", e.nafld && "Fatty liver"].filter(Boolean);
    $("#case-head").innerHTML = `<div><div class="pid">${P.pid} · synthetic</div><h2>${esc(P.name)}</h2><div class="who">${P.age} · ${P.sex === "F" ? "Female" : "Male"} · ${esc(P.city)} · ${e.vegetarian ? "Vegetarian" : "Non-vegetarian"} · BMI ${e.bmi}</div></div>
      <div class="tags">${dx.map(d => `<span class="tag">${d}</span>`).join("")}${rx.map(r => `<span class="tag rx">${r}</span>`).join("") || '<span class="tag">No glucose-lowering medicine</span>'}</div>`;
    const k = P.kpi;
    const tile = (l, v, u, g, cls = "") => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}<small> ${u}</small></div><div class="g ${cls}">${g}</div></div>`;
    $("#kpis").innerHTML = tile("Time in range", k.tir.toFixed(0), "%", k.tir >= 70 ? "meets goal of 70%" : "below goal of 70%", k.tir >= 70 ? "good" : "bad") +
      tile("Above 180", k.tar.toFixed(0), "%", `above 250: ${k.tar250.toFixed(0)}%`) +
      tile("GMI", k.gmi.toFixed(1), "%", `lab HbA1c ${e.hba1c_pct.toFixed(1)}%`) +
      tile("Variability", k.cv.toFixed(0), "% CV", k.cv <= 36 ? "stable (goal ≤ 36%)" : "high (goal ≤ 36%)", k.cv <= 36 ? "good" : "bad") +
      tile("Spike warnings", k.alerts, "", "this week, 2 h ahead");
  },
  renderRecord(P) {
    const e = P.ehr;
    const items = [["HbA1c", `${e.hba1c_pct}%`], ["Fasting glucose", `${e.fasting_glucose_mgdl} mg/dL`], ["BMI · waist", `${e.bmi} · ${e.waist_cm} cm`], ["Blood pressure", `${e.systolic_bp}/${e.diastolic_bp} mmHg`],
      ["TG · HDL · LDL", `${e.triglycerides_mgdl} · ${e.hdl_mgdl} · ${e.ldl_mgdl}`], ["eGFR · ALT", `${e.egfr} · ${e.alt_u_l}`], ["TCF7L2 rs7903146", `${e.tcf7l2_rs7903146}${e.tcf7l2_rs7903146.includes("T") ? " (risk allele)" : ""}`],
      ["Family history", e.family_history_t2d ? "Type 2 diabetes" : "None recorded"], ["Smoker", e.smoker ? "Yes" : "No"], ["Height · weight", `${e.height_cm} cm · ${e.weight_kg} kg`]];
    $("#record").innerHTML = items.map(([a, b]) => `<div><div class="l">${a}</div><div class="v">${esc(b)}</div></div>`).join("");
  },

  // ---------------------------------------------------------------- clock
  setupClock() {
    $("#days").innerHTML = DAYS.map((d, i) => `<button data-d="${i}" aria-pressed="false">${d} ${14 + i}</button>`).join("");
    $("#days").addEventListener("click", e => { const b = e.target.closest("button"); if (b) this.setTime(+b.dataset.d, S.slot); });
    $("#tslider").addEventListener("input", e => this.setTime(S.day, +e.target.value));
    $("#play").addEventListener("click", () => this.togglePlay());
  },
  setTime(day, slot) { S.day = day; S.slot = slot; this.renderTime(); },
  togglePlay(force) {
    const on = force === undefined ? !S.playing : force;
    clearInterval(S.playing); S.playing = null;
    $("#play").setAttribute("aria-pressed", on); $("#play-t").textContent = on ? "Pause" : "Replay";
    $("#play-ico").setAttribute("d", on ? "M6 4h4v16H6zM14 4h4v16h-4z" : "M7 4l13 8-13 8z");
    if (on) S.playing = setInterval(() => { let s = S.slot + 1, d = S.day; if (s > 95) { s = 0; d++; } if (d > 6) { this.togglePlay(false); return; } this.setTime(d, s); }, 320);
  },
  renderTime() {
    $$("#days button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.d === S.day));
    $("#tslider").value = S.slot; $("#tout").textContent = fmtT(S.slot * 15);
    $("#tslider").setAttribute("aria-valuetext", `${DAYS_LONG[S.day]} ${fmtT(S.slot * 15)}`);
    if (!this.P()) return;
    this.renderTrace(); this.renderWeek(); this.renderRisk(); this.renderTwin(); this.renderRx();
  },

  // ---------------------------------------------------------------- day trace
  renderTrace() {
    const P = this.P(), el = $("#trace-svg"), svg = d3.select(el); svg.selectAll("*").remove();
    const W = Math.max(el.clientWidth || 600, 320), narrow = W < 620;
    const M = { l: 38, r: 10, t: 22 }, Hg = narrow ? 210 : 260, Hs = 40, Hz = 12, gap = 12;
    const H = M.t + Hg + gap + Hs + gap + Hz + 22;
    svg.attr("height", H).attr("viewBox", `0 0 ${W} ${H}`);
    const d0 = S.day * 288, x = d3.scaleLinear([0, 288], [M.l, W - M.r]), y = d3.scaleLinear([40, 340], [M.t + Hg, M.t]).clamp(true);
    const kn = this.kNow() - d0;
    $("#trace-aside").textContent = `${DAYS_LONG[S.day]} ${14 + S.day} Sep`;
    svg.append("rect").attr("x", M.l).attr("width", W - M.l - M.r).attr("y", y(180)).attr("height", y(70) - y(180)).attr("fill", css("--band"));
    [70, 180, 250].forEach(v => { svg.append("line").attr("x1", M.l).attr("x2", W - M.r).attr("y1", y(v)).attr("y2", y(v)).attr("stroke", css("--edge")).attr("stroke-dasharray", v === 250 ? "3 3" : null);
      svg.append("text").attr("x", M.l - 6).attr("y", y(v) + 3).attr("text-anchor", "end").text(v); });
    svg.append("text").attr("x", 2).attr("y", M.t - 8).text("mg/dL");
    d3.range(0, 289, narrow ? 72 : 36).forEach(t => svg.append("text").attr("x", x(t)).attr("y", H - 5).attr("text-anchor", t === 0 ? "start" : t === 288 ? "end" : "middle").text(fmtT(t * 5)));
    const seg = P.cgm.slice(d0, d0 + 288).map((v, i) => [i, v]);
    const line = d3.line().defined(d => d[1] != null).x(d => x(d[0])).y(d => y(d[1]));
    svg.append("path").attr("d", line(seg.filter(d => d[0] >= kn))).attr("fill", "none").attr("stroke", css("--replay")).attr("stroke-width", 1.6);
    svg.append("path").attr("d", line(seg.filter(d => d[0] <= kn))).attr("fill", "none").attr("stroke", css("--ink")).attr("stroke-width", 2.1);
    // forecast
    const i = this.idx(P); this._fc = null;
    if (i >= 0 && P.pred.k[i] >= d0 && P.pred.k[i] < d0 + 288) {
      const k = P.pred.k[i], st = P.twin.states[i], sm = (k % 288) * 5 + 5, day = Math.floor(k / 288) + 7;
      const r = carryMeals(P, k, routine(P.twin, sm, 120, true));
      const fc = forecast(P.twin.params, st, sm, 120, r.steps, r.meal, r.kab, P.twin.si_mult[day], P.twin.gb_shift[day], P.twin.su[i]);
      this._fc = { fc, k };
      const pts = [[k - d0, st[0]], ...fc.map((v, j) => [k - d0 + j + 1, v])].filter(p => p[0] <= 288);
      svg.append("path").attr("d", d3.line().x(d => x(d[0])).y(d => y(d[1])).curve(d3.curveMonotoneX)(pts)).attr("fill", "none").attr("stroke", css("--shadow")).attr("stroke-width", 2.6).attr("stroke-dasharray", "7 4");
      const p2 = P.pred.p2h[i]; if (p2 != null && k - d0 + 24 <= 288) svg.append("circle").attr("cx", x(k - d0 + 24)).attr("cy", y(p2)).attr("r", 4.5).attr("fill", css("--sheet")).attr("stroke", css("--shadow")).attr("stroke-width", 2).append("title").text(`Model: ${p2} mg/dL at ${fmtT((k - d0 + 24) * 5)}`);
    }
    // warnings
    P.pred.k.forEach((kk, j) => { if (P.pred.start[j] && kk >= d0 && kk < d0 + 288 && kk <= this.kNow()) {
      const xx = x(kk - d0), v = P.cgm[kk] ?? 120;
      svg.append("path").attr("d", `M${xx} ${y(v) - 18} l5.5 10 h-11z`).attr("fill", css("--alert")).append("title").text(`Spike warning at ${fmtT((kk - d0) * 5)}`);
    } });
    // meals
    const lane = M.t - 10;
    P.meals.filter(m => m.k >= d0 && m.k < d0 + 288).forEach(m => {
      const xx = x(m.k - d0), past = m.k <= this.kNow();
      svg.append("line").attr("x1", xx).attr("x2", xx).attr("y1", lane + 5).attr("y2", M.t + Hg).attr("stroke", css("--watch")).attr("stroke-opacity", past ? .35 : .15);
      const g = svg.append("g").attr("opacity", past ? 1 : .45);
      g.append("circle").attr("cx", xx).attr("cy", lane).attr("r", 4.2).attr("fill", css("--watch"));
      g.append("title").text(`${fmtT((m.k - d0) * 5)} ${m.meal} · ${m.carbs} g carbs · GI ${m.gi}`);
      if (!narrow) svg.append("text").attr("x", xx + 7).attr("y", lane + 4).attr("opacity", past ? 1 : .5).text(`${m.carbs} g`);
    });
    Object.entries(P.twin.inferred).forEach(([kk, g]) => { kk = +kk; if (kk >= d0 && kk < d0 + 288 && kk <= this.kNow() && g >= 4) {
      svg.append("circle").attr("cx", x(kk - d0)).attr("cy", M.t + Hg - 8).attr("r", 3.6).attr("fill", "none").attr("stroke", css("--shadow")).attr("stroke-width", 1.6).append("title").text(`Chaya noticed about ${g} g of carbs that were not logged`);
    } });
    // steps + sleep
    const ys0 = M.t + Hg + gap, st = P.steps.slice(d0, d0 + 288), ys = d3.scaleLinear([0, Math.max(500, d3.max(st))], [ys0 + Hs, ys0]);
    svg.append("text").attr("x", M.l - 6).attr("y", ys0 + 9).attr("text-anchor", "end").text("steps");
    const bw = Math.max((W - M.l - M.r) / 288 - .3, .6);
    st.forEach((v, j) => { if (v > 0) svg.append("rect").attr("x", x(j)).attr("y", ys(v)).attr("width", bw).attr("height", ys0 + Hs - ys(v)).attr("fill", j <= kn ? css("--ink-3") : css("--edge")); });
    const yz = ys0 + Hs + gap;
    const scol = { 1: css("--watch"), 2: css("--shadow-soft"), 3: css("--ink-2"), 4: css("--shadow") };
    svg.append("text").attr("x", M.l - 6).attr("y", yz + 9).attr("text-anchor", "end").text("sleep");
    P.sleep.slice(d0, d0 + 288).split("").forEach((c, j) => { if (c !== "0") svg.append("rect").attr("x", x(j)).attr("y", yz).attr("width", bw + .4).attr("height", Hz).attr("fill", scol[+c]); });
    svg.append("line").attr("x1", x(kn)).attr("x2", x(kn)).attr("y1", M.t - 16).attr("y2", yz + Hz).attr("stroke", css("--ink")).attr("stroke-width", 1.2);
    svg.append("text").attr("x", x(kn) + (kn > 250 ? -5 : 5)).attr("y", M.t + Hg - 6).attr("text-anchor", kn > 250 ? "end" : "start").style("fill", css("--ink")).style("font-weight", 600).text(`now ${fmtT(S.slot * 15)}`);
  },
  renderWeek() {
    const P = this.P();
    $("#week").innerHTML = DAYS.map((dn, d) => {
      const vals = P.cgm.slice(d * 288, d * 288 + 288), seg = vals.filter(v => v != null);
      const tir = seg.filter(v => v >= 70 && v <= 180).length / Math.max(seg.length, 1) * 100;
      const al = P.pred.start.filter((s, i) => s && Math.floor(P.pred.k[i] / 288) === d).length;
      const n = P.nights.find(x => x.day === d + 7);
      let path = "", pen = false;
      vals.forEach((v, i) => { if (v == null) { pen = false; return; } path += `${pen ? "L" : "M"}${(i / 287 * 100).toFixed(1)},${(28 - Math.min(Math.max((v - 50) / 300 * 28, 0), 28)).toFixed(1)}`; pen = true; });
      const y180 = 28 - 130 / 300 * 28, y70 = 28 - 20 / 300 * 28;
      return `<button class="dcard" data-day="${d}" aria-pressed="${d === S.day}" aria-label="${DAYS_LONG[d]}: ${tir.toFixed(0)}% in range, ${al} warnings">
        <span class="d"><span>${dn} ${14 + d}</span><span class="count ${al >= 5 ? "hi" : al >= 3 ? "mid" : ""}">${al}</span></span>
        <svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><rect x="0" y="${y180}" width="100" height="${y70 - y180}" fill="var(--band)"/><path d="${path}" fill="none" stroke="var(--ink)" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>
        <span class="s" title="Time in range · sleep the night before" style="display:flex;justify-content:space-between;gap:4px"><span>${tir.toFixed(0)}%</span><span>${n ? n.sleep_hours.toFixed(1) : "–"} h</span></span></button>`;
    }).join("");
    $("#week").onclick = e => { const b = e.target.closest(".dcard"); if (b) this.setTime(+b.dataset.day, S.slot); };
  },

  // ---------------------------------------------------------------- next 2 hours
  status(P, i) {
    const thr = this.meta.threshold, cg = P.cgm[this.kNow()];
    const pr = i >= 0 ? P.pred.prob[i] : null;
    if (cg != null && cg >= 180) return { cls: "watch", main: "Above range", sub: `now ${Math.round(cg)} mg/dL`, pr, cg };
    if (pr == null || cg == null) return { cls: "na", main: "No signal", sub: "sensor gap", pr, cg };
    if (pr >= thr) return { cls: "alert", main: "Spike likely", sub: `${Math.round(pr * 100)}% · next 2 h`, pr, cg };
    if (pr >= thr * 0.6) return { cls: "watch", main: "Watch", sub: `${Math.round(pr * 100)}% · next 2 h`, pr, cg };
    return { cls: "ok", main: "In range", sub: `${Math.round(pr * 100)}% spike risk`, pr, cg };
  },
  renderRisk() {
    const P = this.P(), i = this.idx(P), s = this.status(P, i);
    const key = `${S.pid}|${s.cls}`, pressed = this._lastStamp !== key; this._lastStamp = key;
    $("#risk-at").textContent = `${DAYS[S.day]} ${fmtT(S.slot * 15)}`;
    $("#risk-stamp").innerHTML = `<div class="stamp ${s.cls} ${pressed && !reduceMotion ? "press" : ""}" role="img" aria-label="${s.main}"><span class="s-main">${s.main}</span><span class="s-sub">${s.sub}</span></div>`;
    const fc = this._fc && this._fc.k === P.pred.k[i] ? this._fc.fc : null;
    let line;
    if (s.cls === "na") line = "The sensor has no reading right now, so Chaya holds its forecast until the signal returns.";
    else if (s.cg >= 180) line = `Glucose is already ${Math.round(s.cg)} mg/dL. Chaya forecasts spikes before they start, so the next forecast comes once it is back below 180.`;
    else line = `<b>${Math.round(s.pr * 100)}%</b> chance glucose goes above 180 mg/dL by <b class="num">${fmtT((S.slot * 15 + 120) % 1440)}</b>.`;
    $("#risk-line").innerHTML = line;
    const p2 = i >= 0 ? P.pred.p2h[i] : null;
    $("#p2h").innerHTML = p2 == null ? "–" : `${Math.round(p2)}<small> mg/dL</small>`;
    if (fc) { const pk = peakOf(fc), at = fc.indexOf(pk); $("#tpeak").innerHTML = `${Math.round(pk)}<small> at ${fmtT(((P.pred.k[i] % 288) * 5 + 5 + (at + 1) * 5) % 1440)}</small>`; }
    else $("#tpeak").textContent = "–";
    const why = i >= 0 ? P.pred.why[P.pred.k[i]] : null;
    const show = s.cls === "alert" || s.cls === "watch";
    const fix = t => fc ? t.replace(/Twin projects a peak of \d+ mg\/dL/, `Twin projects a peak of ${Math.round(peakOf(fc))} mg/dL`) : t;
    $("#why").innerHTML = show && why && why.length ? why.map(([g, t]) => `<li><span class="g">${esc(this.meta.groups[g])}</span><span>${esc(fix(t))}</span></li>`).join("")
      : `<li class="calm"><span class="g">Nothing pressing</span><span>${s.cls === "na" ? "Waiting for the sensor." : "No strong driver of a spike in the next two hours."}</span></li>`;
    // review
    const ep = this.episodeStart(P, i);
    const rev = new Set(P.reviewed || []);
    $("#review-wrap").innerHTML = s.cls === "alert" && ep != null
      ? (rev.has(ep) ? `<span class="reviewed"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>Reviewed. Advice can go on the Rx pad.</span>`
        : `<button class="btn btn-quiet btn-sm" id="review-btn">Mark warning as reviewed</button>`) : "";
  },
  episodeStart(P, i) { if (i < 0 || !P.pred.alert[i]) return null; let j = i; while (j > 0 && P.pred.alert[j - 1] && P.pred.k[j] - P.pred.k[j - 1] <= 3) j--; return P.pred.k[j]; },
  async review() {
    const P = this.P(), ep = this.episodeStart(P, this.idx(P)); if (ep == null) return;
    try { await Data.review(S.pid, ep); P.reviewed = [...(P.reviewed || []), ep]; this.renderRisk(); toast("Warning marked as reviewed"); }
    catch { toast("Couldn't reach the server. Try again in a moment."); }
  },

  // ---------------------------------------------------------------- twin
  renderTwin() {
    const P = this.P(), t = P.twin, pop = this.meta.population;
    const pctOf = (arr, v) => arr.filter(a => a < v).length / arr.length * 100;
    $("#fit").textContent = `fits within ±${t.fit_rmse} mg/dL`;
    const item = (nm, v, unit, arr, val, prior, note) => {
      const p = pctOf(arr, val), q = pctOf(arr, prior);
      return `<div class="prm"><div class="top"><span class="nm">${nm}</span><span class="v">${v} <small>${unit}</small></span></div>
        <div class="scale" role="img" aria-label="${nm}: ${p.toFixed(0)}th percentile of the cohort"><span class="pr" style="left:${q}%"></span><span class="tw" style="left:${p}%"></span></div>
        <div class="note2">${note}</div></div>`;
    };
    const si = t.params[2], ga = t.params[3], gb = t.params[0];
    const pSI = pctOf(pop.SI, si), pG = pctOf(pop.gamma, ga);
    $("#twin-body").innerHTML =
      item("Insulin sensitivity", (si * 1e4).toFixed(2), "×10⁻⁴", pop.SI, si, t.prior[2], `${pSI < 33 ? "Low" : pSI < 66 ? "Middling" : "High"} for this cohort. The record alone suggested ${(t.prior[2] * 1e4).toFixed(2)}.`) +
      item("Insulin response", (ga * 1e3).toFixed(2), "×10⁻³", pop.gamma, ga, t.prior[3], `${pG < 33 ? "Weak" : pG < 66 ? "Moderate" : "Strong"} insulin release when glucose rises.`) +
      item("Resting glucose", gb.toFixed(0), "mg/dL", pop.Gb, gb, t.prior[0], `Where glucose settles without food. The record alone suggested ${t.prior[0].toFixed(0)}.`) +
      `<p style="font-size:var(--t-xs);color:var(--ink-3)">Violet mark: tuned on 7 days of data. Grey tick: estimate from the health record alone. Scale: all 150 patients, low to high.</p>`;
  },

  // ---------------------------------------------------------------- Rx pad
  setupRx() {
    const cat = this.meta.meal_catalog;
    $("#w-meal").innerHTML = `<option value="-1">No new meal</option>` + cat.map((m, i) => `<option value="${i}">${esc(m.meal)} · ${m.carbs} g · GI ${m.gi}</option>`).join("");
    $("#w-walk").innerHTML = [0, 10, 20, 30].map(w => `<button data-w="${w}" aria-pressed="false">${w ? w + " min" : "None"}</button>`).join("");
    $("#w-met").innerHTML = `<button data-m="1" aria-pressed="false">Taken</button><button data-m="0" aria-pressed="false">Missed</button>`;
    const pick = n => { const i = cat.findIndex(m => m.meal === n); if (i >= 0) S.wi.meal = i; };
    this.QUICK = [["Swap rice for ragi mudde", () => pick("Millet (ragi) mudde + saaru")], ["Walk 20 min after", () => { S.wi.walk = 20; }],
      ["Chicken biryani", () => pick("Chicken biryani")], ["Festival sweets", () => pick("Gulab jamun (2)")]];
    $("#quick").innerHTML = this.QUICK.map((q, i) => `<button data-q="${i}">${q[0]}</button>`).join("");
    $("#quick").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { this.QUICK[+b.dataset.q][1](); this.renderRx(); } });
    $("#w-meal").addEventListener("change", e => { S.wi.meal = +e.target.value; this.renderRx(); });
    $("#w-when").addEventListener("input", e => { S.wi.when = Math.max(0, Math.min(120, +e.target.value || 0)); this.renderRx(); });
    $("#w-sleep").addEventListener("input", e => { S.wi.sleep = Math.max(3, Math.min(10, +e.target.value || 7)); S.wi.sleepTouched = true; this.renderRx(); });
    $("#w-walk").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { S.wi.walk = +b.dataset.w; this.renderRx(); } });
    $("#w-met").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { S.wi.met = +b.dataset.m; S.wi.metTouched = true; this.renderRx(); } });
  },
  adviceText(P) {
    const wi = S.wi, m = wi.meal >= 0 ? this.meta.meal_catalog[wi.meal] : null, parts = [];
    parts.push(m ? `${m.meal}${wi.when ? ` in ${wi.when} min` : " now"}` : "No new meal");
    if (wi.walk) parts.push(`walk ${wi.walk} min ${m ? "after eating" : "soon"}`);
    if (wi.sleepTouched) parts.push(`sleep ${wi.sleep} h`);
    if (P.ehr.on_metformin && wi.metTouched) parts.push(wi.met ? "metformin as prescribed" : "metformin missed");
    return parts.join(" · ");
  },
  lastRun: null,
  renderRx() {
    const P = this.P(); if (!P) return;
    const i = this.idx(P), wi = S.wi;
    $("#w-meal").value = wi.meal; $("#w-when").value = wi.when;
    $$("#w-walk button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.w === wi.walk));
    $("#w-met-wrap").hidden = !P.ehr.on_metformin;
    const day = S.day + 7;
    if (!wi.metTouched) wi.met = P.twin.gb_shift[day] > 0 ? 0 : 1;
    if (!wi.sleepTouched) { const n = P.nights.find(x => x.day === day); if (n) wi.sleep = Math.round(n.sleep_hours * 2) / 2; }
    $("#w-sleep").value = wi.sleep;
    $$("#w-met button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.m === wi.met));
    $("#rx-written").innerHTML = `<span class="g" aria-hidden="true">℞</span>${esc(this.adviceText(P))}`;
    const svg = d3.select("#wi-svg"); svg.selectAll("*").remove();
    if (i < 0) { $("#w-res").innerHTML = `<p class="empty" style="grid-column:1/-1;border:0;padding:0">No twin state yet at this time. Move the clock forward.</p>`; $("#save-note").disabled = true; return; }
    $("#save-note").disabled = false;
    const meal = wi.meal >= 0 ? this.meta.meal_catalog[wi.meal] : null;
    const r = simulate(P, i, { ...wi, meal });
    this.lastRun = r;
    const el = $("#wi-svg"), W = Math.max(el.clientWidth || 340, 260), Hh = 180, M = { l: 32, r: 8, t: 18, b: 20 };
    svg.attr("height", Hh).attr("viewBox", `0 0 ${W} ${Hh}`);
    const k = P.pred.k[i], actual = P.cgm.slice(k, k + 49);
    const ymax = Math.max(260, peakOf(r.scen) + 10, peakOf(r.base) + 10);
    const x = d3.scaleLinear([0, 48], [M.l, W - M.r]), y = d3.scaleLinear([60, ymax], [Hh - M.b, M.t]);
    svg.append("rect").attr("x", M.l).attr("width", W - M.l - M.r).attr("y", y(180)).attr("height", y(70) - y(180)).attr("fill", css("--band"));
    [100, 180, 250].forEach(v => svg.append("text").attr("x", M.l - 5).attr("y", y(v) + 3).attr("text-anchor", "end").text(v));
    [0, 12, 24, 36, 48].forEach(t => svg.append("text").attr("x", x(t)).attr("y", Hh - 4).attr("text-anchor", t === 0 ? "start" : t === 48 ? "end" : "middle").text(t ? `+${t / 12} h` : "now"));
    const ln = d3.line().x((d, j) => x(j)).y(d => y(d)).curve(d3.curveMonotoneX);
    svg.append("path").attr("d", d3.line().defined(d => d != null).x((d, j) => x(j)).y(d => y(d))(actual)).attr("fill", "none").attr("stroke", css("--replay")).attr("stroke-width", 1.4).attr("stroke-dasharray", "2 3");
    svg.append("path").attr("d", ln([r.start, ...r.base])).attr("fill", "none").attr("stroke", css("--ink-3")).attr("stroke-width", 1.6);
    svg.append("path").attr("d", ln([r.start, ...r.scen])).attr("fill", "none").attr("stroke", css("--shadow")).attr("stroke-width", 2.8);
    [[css("--shadow"), "With advice"], [css("--ink-3"), "No new meal"], [css("--replay"), "What happened", true]].forEach(([c, t, dash], j) => {
      const gx = M.l + 4 + j * (W < 330 ? 72 : 92);
      svg.append("line").attr("x1", gx).attr("x2", gx + 14).attr("y1", 7).attr("y2", 7).attr("stroke", c).attr("stroke-width", 2.4).attr("stroke-dasharray", dash ? "2 3" : null);
      svg.append("text").attr("x", gx + 18).attr("y", 10).text(t);
    });
    const pk = peakOf(r.scen), ab = above(r.scen), d = Math.round(pk - peakOf(r.cmp));
    const dTxt = !meal && !wi.walk && !wi.sleepTouched && !wi.metTouched ? "–" : `${d > 0 ? "+" : ""}${d}`;
    $("#w-res").innerHTML = `<div><div class="l">Peak</div><div class="v ${pk > 180 ? "bad" : "good"}">${Math.round(pk)}</div></div>
      <div><div class="l">Min above 180</div><div class="v">${ab}</div></div>
      <div title="Peak change from the walk, sleep and metformin choices compared with the meal as things stand"><div class="l">Change</div><div class="v ${d < -2 ? "good" : d > 2 ? "bad" : ""}">${dTxt}</div></div>`;
  },

  // ---------------------------------------------------------------- notes
  async loadNotes() {
    try { S.notes = await Data.notes(S.pid); } catch { S.notes = []; }
    this.renderNotes();
  },
  renderNotes() {
    const P = this.P();
    $("#notes-count").textContent = S.notes.length ? `${S.notes.length} saved` : "";
    $("#notes").innerHTML = S.notes.length ? S.notes.map(n => {
      const k = n.at_k, d = Math.floor(k / 288), t = fmtT((k % 288) * 5);
      const good = n.projected_peak < n.baseline_peak - 2;
      return `<div class="note"><div><div class="when">${DAYS[d]} ${14 + d} Sep, ${t} · ${esc(n.author || "Demo clinician")}</div><div class="txt">℞ ${esc(n.summary)}</div></div>
        <div style="display:grid;justify-items:end;gap:4px"><span class="proj">peak <b class="${good ? "good" : ""}">${Math.round(n.projected_peak)}</b> (was ${Math.round(n.baseline_peak)})<br>${n.projected_minutes_above} min above 180</span>
        <button class="btn btn-quiet btn-sm" data-del="${n.id}" aria-label="Delete this note">Delete</button></div></div>`;
    }).join("") : `<p class="empty">No advice saved for ${esc(P ? P.name : "this patient")} yet. Write it on the Rx pad and choose “Save to case notes”.</p>`;
  },
  async saveNote() {
    const P = this.P(), i = this.idx(P); if (i < 0 || !this.lastRun) return;
    const wi = S.wi, meal = wi.meal >= 0 ? this.meta.meal_catalog[wi.meal] : null, r = this.lastRun;
    const body = { k: P.pred.k[i], meal_name: meal ? meal.meal : null, carbs_g: meal ? meal.carbs : 0, gi: meal ? meal.gi : 65, eat_in_min: wi.when, walk_min: wi.walk,
      sleep_hours: wi.sleepTouched ? wi.sleep : null, metformin_taken: P.ehr.on_metformin && wi.metTouched ? !!wi.met : null, summary: this.adviceText(P), baseline_peak: Math.round(peakOf(r.cmp)) };
    const btn = $("#save-note"); btn.disabled = true; btn.textContent = "Saving…";
    try { await Data.addNote(S.pid, body, { peak: Math.round(peakOf(r.scen)), above: above(r.scen) }); await this.loadNotes(); $("#notes-fold").open = true; toast(`Saved to ${P.name}'s case notes${Data.live ? "" : " in this browser"}`); }
    catch (e) { toast(`Couldn't save the note. ${e.message || "Try again."}`); }
    finally { btn.disabled = false; btn.textContent = "Save to case notes"; }
  },
  async deleteNote(id) { try { await Data.deleteNote(S.pid, id); await this.loadNotes(); toast("Note deleted"); } catch { toast("Couldn't delete the note. Try again."); } },
};

// ================================================================== glossary
const TERMS = [
  ["synthetic", "Synthetic data", "Every patient here is generated by a physiology simulator. No real person's data is used. The week shown is Mon 14 to Sun 20 Sep 2026.", "Everywhere"],
  ["register", "Register", "Your patient list. By default it is sorted by how many spike warnings Chaya raised this week. The bar under each name is time in range (green) and time above 180 mg/dL (red).", "Left column"],
  ["clock", "Replay clock", "This demo replays one week. Pick a day and drag Now; everything on screen shows only what Chaya knew at that moment. Replay plays the week forward.", "Top bar"],
  ["trace", "Day trace", "Black ink is glucose measured so far. Violet dashes are Chaya's forecast for the next two hours. The grey line after Now is what actually happened, shown because this is a replay. Yellow dots are logged meals; violet rings are meals Chaya noticed that nobody logged. Bars below are steps, then sleep.", "Case sheet"],
  ["forecast", "Forecast (the shadow)", "Chaya means shadow. The forecast is the patient's twin running two hours ahead of the real body, assuming their usual routine.", "Case sheet"],
  ["spike", "Spike", "Glucose rising above 180 mg/dL. Chaya predicts the start of a spike while glucose is still in range, up to two hours ahead.", ""],
  ["stamp", "Stamps", "Spike likely: the model's chance of a spike in the next two hours is above the alert threshold. Watch: elevated but below the threshold. In range: low risk. Above range: glucose is already over 180. No signal: the sensor has a gap.", "Next 2 hours"],
  ["reasons", "Why Chaya says this", "The three biggest reasons behind the model's score, from SHAP values grouped the way a clinician thinks: recent meal, usual meal coming up, twin forecast, sleep, activity, medication and physiology.", "Next 2 hours"],
  ["twin", "Patient's twin", "A small physiological model of this patient: gut absorption, glucose, insulin and their effect on each other. It starts from the health record and is tuned on the first seven days of wearable data.", "Right column"],
  ["sensitivity", "Insulin sensitivity", "How strongly insulin pushes glucose down. Lower means more insulin resistance.", "Patient's twin"],
  ["response", "Insulin response", "How much insulin the pancreas releases when glucose rises (β-cell response). It weakens over years of diabetes.", "Patient's twin"],
  ["basal", "Resting glucose", "The level glucose settles at without food, before medicines and activity.", "Patient's twin"],
  ["rxpad", "Rx pad", "Write advice for the next meal: what to eat and when, a walk after eating, last night's sleep and today's metformin. The twin simulates the next four hours. Change compares the walk, sleep and metformin choices against the same meal as things stand.", "Right column"],
  ["notes", "Case notes", "Advice you save, with the twin's projection at that moment. On the live service it is stored in the database; in the offline demo, in this browser.", "Case sheet"],
  ["tir", "Time in range", "Share of readings between 70 and 180 mg/dL this week. The usual goal is above 70%.", "Case sheet"],
  ["gmi", "GMI", "Glucose management indicator: an HbA1c-like number estimated from the week's average CGM reading.", "Case sheet"],
  ["cv", "Variability (CV)", "How much glucose swings, as a coefficient of variation. 36% or lower is considered stable.", "Case sheet"],
  ["live", "Live or offline", "Live means the clinic is served by the Chaya API and its database (PostgreSQL on Railway). Offline demo means the API is not reachable here, so the same data runs from files bundled with the page.", "Top bar"],
];
const Glossary = {
  init() {
    $("#gloss-list").innerHTML = TERMS.map(([id, t, d, w]) => `<div class="term" id="term-${id}"><dt>${t}${w ? `<span class="where">${w}</span>` : ""}</dt><dd>${d}</dd></div>`).join("");
    $("#gloss-close").addEventListener("click", () => this.close());
    $("#scrim").addEventListener("click", () => this.close());
    document.addEventListener("click", e => { const b = e.target.closest(".info"); if (b) this.open(b.dataset.term); });
  },
  open(term) {
    this.prev = document.activeElement;
    $("#glossary").classList.add("on"); $("#glossary").setAttribute("aria-hidden", "false"); $("#scrim").classList.add("on");
    $("#gloss-close").focus();
    if (term) { const t = $(`#term-${term}`); if (t) { t.scrollIntoView({ block: "start" }); t.classList.remove("hl"); void t.offsetWidth; t.classList.add("hl"); } }
  },
  close() { $("#glossary").classList.remove("on"); $("#glossary").setAttribute("aria-hidden", "true"); $("#scrim").classList.remove("on"); if (this.prev) this.prev.focus(); },
};

// ================================================================== tour engine
const Tour = {
  steps: null, i: 0,
  async start(steps) {
    Welcome.hide(); Clinic.togglePlay(false); Glossary.close();
    if (!location.hash.startsWith("#/clinic")) { location.hash = "#/clinic"; }
    for (let t = 0; t < 100 && !(Clinic.P() && !views.clinic.hidden); t++) await new Promise(r => setTimeout(r, 100));
    this.steps = steps; this.i = 0;
    $("#tour-root").innerHTML = `<div class="tour-veil" id="tour-veil"></div><div class="tour-spot" id="tour-spot"></div><div class="tour-card" id="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-h"></div>`;
    this.onKey = e => { if (e.key === "Escape") this.end(); else if (e.key === "ArrowRight") this.go(1); else if (e.key === "ArrowLeft") this.go(-1); };
    document.addEventListener("keydown", this.onKey);
    this.onResize = () => this.place();
    window.addEventListener("resize", this.onResize); window.addEventListener("scroll", this.onResize, { passive: true });
    await this.show();
  },
  async go(d) { const n = this.i + d; if (n < 0) return; if (n >= this.steps.length) { this.end(true); return; } this.i = n; await this.show(); },
  async show() {
    const st = this.steps[this.i];
    if (st.before) await st.before();
    const tgt = st.sel ? $(st.sel) : null;
    if (tgt) tgt.scrollIntoView({ block: st.block || "center", behavior: reduceMotion ? "auto" : "smooth" });
    const body = typeof st.body === "function" ? st.body() : st.body;
    const n = this.steps.length, last = this.i === n - 1;
    $("#tour-card").innerHTML = `<div class="k"><span>${esc(this.steps.label)}</span><span class="num">${this.i + 1} / ${n}</span></div>
      <h3 id="tour-h">${st.title}</h3><p>${body}</p>
      <div class="acts"><div class="dots" aria-hidden="true">${this.steps.map((_, j) => `<i class="${j === this.i ? "on" : ""}"></i>`).join("")}</div><span class="grow"></span>
      ${this.i ? `<button class="btn btn-quiet btn-sm" data-t="back">Back</button>` : `<button class="btn btn-quiet btn-sm" data-t="skip">Skip</button>`}
      <button class="btn btn-primary btn-sm" data-t="next">${last ? (this.steps.doneLabel || "Finish") : "Next"}</button></div>`;
    $("#tour-card").onclick = e => { const b = e.target.closest("[data-t]"); if (!b) return; ({ back: () => this.go(-1), next: () => this.go(1), skip: () => this.end() })[b.dataset.t](); };
    setTimeout(() => { this.place(); $("#tour-card [data-t=next]").focus({ preventScroll: true }); }, reduceMotion ? 0 : 380);
    this.place();
  },
  place() {
    if (!this.steps) return;
    const st = this.steps[this.i], tgt = st.sel ? $(st.sel) : null, spot = $("#tour-spot"), card = $("#tour-card");
    const vw = innerWidth, vh = innerHeight, cw = card.offsetWidth, ch = card.offsetHeight, pad = 8;
    if (!tgt) { spot.style.cssText = `top:${vh / 2}px;left:${vw / 2}px;width:0;height:0`; card.style.top = `${Math.max(16, (vh - ch) / 2)}px`; card.style.left = `${Math.max(16, (vw - cw) / 2)}px`; return; }
    const r = tgt.getBoundingClientRect();
    const top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad), w = Math.min(vw - 8, r.width + pad * 2), h = Math.min(vh - top - 4, r.height + pad * 2);
    spot.style.cssText = `top:${top}px;left:${left}px;width:${w}px;height:${Math.max(h, 24)}px`;
    let cx, cy; const gap = 18;
    if (left + w + gap + cw < vw - 12) { cx = left + w + gap; cy = top; }
    else if (left - gap - cw > 12) { cx = left - gap - cw; cy = top; }
    else if (top + h + gap + ch < vh - 12) { cx = left; cy = top + h + gap; }
    else { cx = left; cy = Math.max(12, top - gap - ch); }
    cx = Math.min(Math.max(16, cx), vw - cw - 16); cy = Math.min(Math.max(16, cy), vh - ch - 16);
    card.style.left = `${cx}px`; card.style.top = `${cy}px`;
  },
  end(done) {
    document.removeEventListener("keydown", this.onKey); window.removeEventListener("resize", this.onResize); window.removeEventListener("scroll", this.onResize);
    $("#tour-root").innerHTML = ""; const was = this.steps; this.steps = null; store.set("welcomed", true);
    if (done && was && was.after) was.after();
  },
};
const setCase = async (pid, day, slot, wi) => {
  if (S.pid !== pid) { history.replaceState(null, "", `#/clinic/${pid}`); await Clinic.open(pid); }
  S.day = day; S.slot = slot; if (wi) Object.assign(S.wi, wi); Clinic.renderTime();
};
const catIdx = n => Clinic.meta.meal_catalog.findIndex(m => m.meal === n);
const runNow = () => ({ pk: Math.round(peakOf(Clinic.lastRun.scen)), ab: above(Clinic.lastRun.scen) });

const TOUR = Object.assign([
  { sel: "#register", title: "Start with the register", body: "Your patients, ranked by how many times Chaya warned about a spike this week. The bar under each name shows <b>time in range</b> in green and <b>time above 180</b> in red. Click a name to open the case.",
    before: () => setCase("GT-1102", 6, 51, { meal: -1, walk: 0, metTouched: false, sleepTouched: false }) },
  { sel: "#clockbar", title: "Move the clock", body: "This is a replay of one synthetic week. Pick a day, drag <b>Now</b>, or press Replay. Every panel shows only what Chaya knew at that moment.", block: "start" },
  { sel: "#case-head", title: "The case sheet", body: "Who the patient is, their diagnoses and medicines, then this week's numbers: time in range, GMI against the lab HbA1c, variability and the count of spike warnings." },
  { sel: "#trace", title: "Read the day trace", body: "Black ink is glucose so far. <b>Violet dashes are Chaya's forecast</b> for the next two hours. Grey is what actually happened next. Below: meals, steps and sleep." },
  { sel: "#risk", title: "The stamp on the slip", body: () => { const P = Clinic.P(), s = Clinic.status(P, Clinic.idx(P)); return `Right now Sanjay's slip reads <b>${s.main}</b> (${s.sub}). Stamps go from In range to Watch to Spike likely, so the urgent case is visible at a glance.`; } },
  { sel: "#why-wrap", title: "Every warning has reasons", body: "The three biggest drivers behind the score, in plain words: a meal just logged, the twin's projected peak, low activity, short sleep, a missed dose." },
  { sel: "#twin", title: "The patient's twin", body: "Chaya tuned these numbers to Sanjay on his first seven days. The violet mark is the twin; the grey tick is what the health record alone suggested. The gap is why a personal twin matters." },
  { sel: "#rxpad", title: "Try advice before you give it", body: "Pick a meal, a walk, last night's sleep or a missed metformin dose. The twin redraws the next four hours for this body. Save the advice to the case notes.", block: "start" },
  { sel: "#help-menu", title: "Help is always here", body: "Reopen this tour, walk through Sanjay's case step by step, or open <b>What's what</b> for every term. The small <b>i</b> buttons explain each panel." },
], { label: "Product tour", doneLabel: "Start exploring" });

const CASE = Object.assign([
  { sel: "#case-head", title: "Sunday, 12:15. Sanjay is about to eat lunch.", body: "He is 53, has had Type 2 diabetes for about four years and takes metformin and glimepiride. His glucose is calm and in range.",
    before: () => setCase("GT-1102", 6, 49, { meal: -1, walk: 0, metTouched: false, sleepTouched: false }) },
  { sel: "#twin", title: "His twin has learned his body", body: "Over his first seven days Chaya found his insulin sensitivity is low for this group, lower than his health record suggested. That is why lunch hits him hard." },
  { sel: "#rx-result", title: "If he eats chicken biryani…", body: () => { const r = runNow(); return `…his twin projects a peak of <b>${r.pk} mg/dL</b>, with <b>${r.ab} minutes</b> above 180.`; },
    before: () => { S.wi.meal = catIdx("Chicken biryani"); S.wi.walk = 0; S.wi.when = 15; Clinic.renderRx(); } },
  { sel: "#rx-result", title: "Swap the rice for ragi mudde", body: () => { const r = runNow(); return `Same lunch slot, lower-GI millet. The peak drops to <b>${r.pk} mg/dL</b>, ${r.ab} minutes above 180.`; },
    before: () => { S.wi.meal = catIdx("Millet (ragi) mudde + saaru"); S.wi.walk = 0; Clinic.renderRx(); } },
  { sel: "#rx-result", title: "Add a 20-minute walk after lunch", body: () => { const r = runNow(); return `Now the peak is <b>${r.pk} mg/dL</b> and he spends <b>${r.ab} minutes</b> above 180. That is advice he can follow, with a number attached.`; },
    before: () => { S.wi.walk = 20; Clinic.renderRx(); } },
  { sel: "#risk", title: "What actually happened at 12:45", body: () => { const P = Clinic.P(), s = Clinic.status(P, Clinic.idx(P)); let m = null; for (let k = Clinic.kNow(); k < Clinic.kNow() + 36; k++) if (P.cgm[k] != null && P.cgm[k] > 180) { m = (k - Clinic.kNow()) * 5; break; }
      return `He logged an 81 g lunch. Chaya stamped <b>${s.main}</b> (${s.sub}) and listed why${m ? `, <b>${m} minutes</b> before his glucose actually crossed 180` : ""}. This is the warning a care coordinator would see, with time to call.`; },
    before: () => setCase("GT-1102", 6, 51, { meal: -1, walk: 20 }) },
  { sel: "#trace", title: "The forecast against reality", body: "Violet dashes are what Chaya expected; the grey line is what happened. Press Replay any time to watch the afternoon unfold." },
  { sel: "#save-note", title: "Put the advice on file", body: () => `Save it to his case notes. ${Data.live ? "It is stored in the database" : "In this offline demo it is kept in your browser"} with the twin's projection, so the next consult starts from it.` },
], { label: "Case walkthrough", doneLabel: "Done" });

// ================================================================== welcome slip
const Welcome = {
  maybe() { if (!store.get("welcomed", false) && !Tour.steps) this.show(); },
  show() {
    $("#welcome-root").innerHTML = `<div class="welcome" role="dialog" aria-labelledby="wel-h">
      <button class="close" aria-label="Close and explore on my own"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <h3 id="wel-h">Welcome to the Chaya clinic</h3>
      <p>Forty-five synthetic patients, one replayed week. Sanjay's case is open: a spike warning was just raised at 12:45.</p>
      <div class="acts"><button class="btn btn-primary" data-w="tour">Take the 1-minute tour</button><button class="btn btn-quiet" data-w="case">Walk through Sanjay's case</button><button class="btn btn-quiet" data-w="skip">Explore on my own</button></div></div>`;
    $("#welcome-root .welcome").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      const w = b.dataset.w || "skip"; store.set("welcomed", true); this.hide();
      if (w === "tour") Tour.start(TOUR); else if (w === "case") Tour.start(CASE);
    });
  },
  hide() { $("#welcome-root").innerHTML = ""; },
};

// ================================================================== help menu
function setupHelp() {
  const btn = $("#help-btn"), pop = $("#help-pop");
  const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", e => { e.stopPropagation(); const open = pop.hidden; pop.hidden = !open; btn.setAttribute("aria-expanded", open); if (open) pop.querySelector("button").focus(); });
  document.addEventListener("click", e => { if (!e.target.closest("#help-menu")) close(); });
  pop.addEventListener("keydown", e => { if (e.key === "Escape") { close(); btn.focus(); } });
  pop.addEventListener("click", e => {
    const b = e.target.closest("[data-help]"); if (!b) return; close();
    ({ tour: () => Tour.start(TOUR), case: () => Tour.start(CASE), glossary: () => Glossary.open() })[b.dataset.help]();
  });
}

// ================================================================== boot
(async function boot() {
  setupHelp(); Glossary.init();
  await Data.init();
  await route();
})();
})();
