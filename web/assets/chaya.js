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
const views = { home: $("#view-home"), clinic: $("#view-clinic"), patient: $("#view-patient"), data: $("#view-data") };
let current = null;
function parseHash() {
  const h = location.hash || "#/";
  if (!h.startsWith("#/")) return { view: "home", anchor: h.slice(1) };
  const [path, q] = h.slice(2).split("?");
  const params = new URLSearchParams(q || "");
  const parts = path.split("/").filter(Boolean);
  return { view: ["clinic", "patient", "data"].includes(parts[0]) ? parts[0] : "home", pid: parts[1], params };
}
async function route() {
  const r = parseHash();
  Object.entries(views).forEach(([k, el]) => { el.hidden = k !== r.view; });
  $("#cta-top").hidden = r.view !== "home";
  renderNav(r.view);
  Sources.close();
  if (r.view === "data") { Sources.renderPage(r.params.get("p")); if (current !== "data") window.scrollTo(0, 0); }
  else if (r.view === "patient") { Clinic.togglePlay(false); if (current !== "patient") window.scrollTo(0, 0); await Patient.init(r.pid); }
  else if (r.view === "home") {
    if (current !== "home") { await Home.init(); window.scrollTo(0, 0); }
    if (r.anchor) { const t = document.getElementById(r.anchor); if (t) t.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); }
  } else {
    if (current !== "clinic") window.scrollTo(0, 0);
    await Clinic.init(r.pid);
    if (r.params.get("tour")) { history.replaceState(null, "", "#/clinic"); Tour.start(TOUR); }
    else if (r.params.get("case")) { history.replaceState(null, "", "#/clinic"); Tour.start(CASE); }
    else Welcome.maybe();
  }
  if (r.view !== "clinic") Welcome.hide();
  current = r.view;
}
function renderNav(view) {
  const pid = Patient.pid || S.pid || "GT-1102";
  const links = view === "home"
    ? [["#how", "How it works"], ["#sources", "Data sources"], ["#evidence", "Evidence"], ["#india", "Built for India"], ["#safety", "Safety"]]
    : [["#/", "Home"], [`#/clinic/${S.pid || pid}`, "Clinic", view === "clinic"], [`#/patient/${pid}`, "Patient app", view === "patient"], ["#/data", "Data sources", view === "data"]];
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
    else { await this.loadNotes(); this.renderTime(); }
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
      <div class="tags">${dx.map(d => `<span class="tag">${d}</span>`).join("")}${rx.map(r => `<span class="tag rx">${r}</span>`).join("") || '<span class="tag">No glucose-lowering medicine</span>'}</div>
      <div class="head-acts"><a class="btn btn-quiet btn-sm" id="open-papp" href="#/patient/${P.pid}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>${esc(P.name)}'s app</a>
        <button class="btn btn-quiet btn-sm" data-src="cgm,steps,hr,hrv,sleep,meals,meds,ehr" data-pid="${P.pid}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/></svg>Data sources</button></div>`;
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
    const items = [["HbA1c", `${e.hba1c_pct}%`, "LOINC 4548-4", "hba1c"], ["Fasting glucose", `${e.fasting_glucose_mgdl} mg/dL`, "LOINC 1558-6", "fpg"],
      ["BMI · waist", `${e.bmi} · ${e.waist_cm} cm`, "LOINC 39156-5 · 8280-0", "body"], ["Blood pressure", `${e.systolic_bp}/${e.diastolic_bp} mmHg`, "LOINC 8480-6 · 8462-4", "bp"],
      ["TG · HDL · LDL", `${e.triglycerides_mgdl} · ${e.hdl_mgdl} · ${e.ldl_mgdl}`, "LOINC 2571-8 · 2085-9 · 13457-7", "lipids"], ["eGFR · ALT", `${e.egfr} · ${e.alt_u_l}`, "LOINC 33914-3 · 1742-6", "kidney"],
      ["TCF7L2 rs7903146", `${e.tcf7l2_rs7903146}${e.tcf7l2_rs7903146.includes("T") ? " (risk allele)" : ""}`, "Genetic test report", "gene"],
      ["Family history", e.family_history_t2d ? "Type 2 diabetes" : "None recorded", "FamilyMemberHistory", "history"], ["Smoker", e.smoker ? "Yes" : "No", "LOINC 72166-2", "history"],
      ["Height · weight", `${e.height_cm} cm · ${e.weight_kg} kg`, "LOINC 8302-2 · 29463-7", "body"]];
    $("#record").innerHTML = items.map(([a, b, c, id]) => `<div><div class="l">${a}</div><div class="v">${esc(b)}</div><button class="code" data-src="${id}" title="Where this comes from">${c}</button></div>`).join("");
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
    }).join("") : `<p class="empty">No advice saved for ${esc(P ? P.name : "this patient")} yet. Write it on the Rx pad and choose “Save and send to patient”.</p>`;
  },
  async saveNote() {
    const P = this.P(), i = this.idx(P); if (i < 0 || !this.lastRun) return;
    const wi = S.wi, meal = wi.meal >= 0 ? this.meta.meal_catalog[wi.meal] : null, r = this.lastRun;
    const body = { k: P.pred.k[i], meal_name: meal ? meal.meal : null, carbs_g: meal ? meal.carbs : 0, gi: meal ? meal.gi : 65, eat_in_min: wi.when, walk_min: wi.walk,
      sleep_hours: wi.sleepTouched ? wi.sleep : null, metformin_taken: P.ehr.on_metformin && wi.metTouched ? !!wi.met : null, summary: this.adviceText(P), baseline_peak: Math.round(peakOf(r.cmp)) };
    const btn = $("#save-note"); btn.disabled = true; btn.textContent = "Saving…";
    try { await Data.addNote(S.pid, body, { peak: Math.round(peakOf(r.scen)), above: above(r.scen) }); await this.loadNotes(); $("#notes-fold").open = true; toast(`Saved to ${P.name}'s case notes and sent to his app${Data.live ? "" : " (kept in this browser)"}`); }
    catch (e) { toast(`Couldn't save the note. ${e.message || "Try again."}`); }
    finally { btn.disabled = false; btn.textContent = "Save and send to patient"; }
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
  ["papp", "Patient app", "What the patient sees on their phone: current glucose from their sensor with the next two hours as a violet shadow, the advice their doctor saved on the Rx pad, their week, and the devices sending data. No risk scores or twin parameters.", "Patient app"],
  ["sources", "Data sources", "Every parameter is tagged with where it comes from: the wearables (CGM, smartwatch), the patient's own logs (meals, doses), the health record (FHIR, with LOINC and SNOMED codes), or Chaya's own calculations. Open Guide → Where the data comes from, or any Sources button.", "Everywhere"],
  ["live", "Live or offline", "Live means the clinic is served by the Chaya API on Vercel and its PostgreSQL database on Supabase. Offline demo means the API is not reachable here, so the same data runs from files bundled with the page.", "Top bar"],
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
  { sel: "#help-menu", title: "Help is always here", body: "Reopen this tour, walk through Sanjay's case, see <b>where the data comes from</b>, or open <b>What's what</b> for every term. The <b>i</b> buttons explain a panel; <b>Sources</b> buttons show where its numbers come from." },
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
  { sel: "#open-papp", title: "…and it reaches Sanjay's phone", body: "Saved advice appears in his patient app, in the doctor's handwriting, beside his own glucose, steps and sleep. Open the patient view to see it.", block: "center" },
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
    ({ tour: () => Tour.start(TOUR), case: () => Tour.start(CASE), glossary: () => Glossary.open(), sources: () => Sources.open(views.clinic.hidden ? (views.patient.hidden ? null : Patient.pid) : S.pid) })[b.dataset.help]();
  });
}

// ================================================================== data sources
/* Every parameter Chaya monitors: what it is used for, where this prototype gets it,
   where it would come from in a clinic, its standard and its cadence. */
const STREAMS = {
  wear: { name: "Wearables", sub: "Dynamic stream", icon: "M8 3h8l1 4H7zM7 17h10l-1 4H8zM6 7h12v10H6zM10 12h4", note: "CGM sensor and smartwatch, read through the phone." },
  log: { name: "Patient app logs", sub: "Dynamic stream", icon: "M7 4h10l3 3v13H4V4zM8 11h8M8 15h5", note: "What the patient taps in: meals and medicine doses." },
  ehr: { name: "Health record", sub: "Static stream", icon: "M8 4h8l4 4v12H4V4zM9 13h6M12 10v6", note: "Labs, diagnoses and prescriptions as FHIR R4." },
  calc: { name: "Computed by Chaya", sub: "From the two streams", icon: "M4 17l5-5 4 4 7-8M15 8h5v5", note: "The twin, forecasts, risk and reasons." },
};
const SRC = [
  // wearables
  { id: "cgm", s: "wear", name: "Glucose (CGM)", unit: "mg/dL", use: "The core signal: day trace, current glucose, time in range, and the twin's correction every 5 minutes.",
    proto: "Simulated per patient by the physiology model, then passed through sensor physics: about 8 min interstitial lag, noise, drift and 2–7 dropouts a fortnight. File: data/wearables/stream_5min.parquet (cgm_mgdl).",
    real: "A continuous glucose monitor worn on the arm (for example FreeStyle Libre or Dexcom), read through the maker's cloud API or the phone's health store (Apple HealthKit, Android Health Connect).",
    std: "FHIR Observation · mg/dL", every: "Every 5 min" },
  { id: "steps", s: "wear", name: "Steps", unit: "steps / 5 min", use: "Activity lane on the trace; walking speeds glucose uptake in the twin; the Activity reason.",
    proto: "Simulated from each patient's daily step habit, short walks and post-dinner walks. stream_5min.parquet (steps).",
    real: "Smartwatch, fitness band or the phone's pedometer, through HealthKit or Health Connect.", std: "FHIR Observation · LOINC 55423-8", every: "Every 5 min" },
  { id: "hr", s: "wear", name: "Heart rate", unit: "bpm", use: "Model input: current and 60-minute average heart rate.",
    proto: "Simulated from resting heart rate, activity and sleep. stream_5min.parquet (heart_rate).",
    real: "Optical sensor on a smartwatch or band.", std: "FHIR Observation · LOINC 8867-4", every: "Every 5 min" },
  { id: "hrv", s: "wear", name: "Heart-rate variability", unit: "ms (RMSSD)", use: "Recovery signal: overnight HRV against the patient's own baseline, a model input.",
    proto: "Nightly RMSSD, simulated with the sleep model. data/wearables/sleep_nightly.csv (hrv_rmssd).",
    real: "Overnight HRV from the smartwatch.", std: "FHIR Observation · RMSSD, ms", every: "Nightly" },
  { id: "sleep", s: "wear", name: "Sleep", unit: "hours, stages", use: "Sleep lane on the trace; short sleep lowers insulin sensitivity in the twin; default for the Rx pad.",
    proto: "Bedtime, hours and stages simulated per night. stream_5min.parquet (sleep_stage) and sleep_nightly.csv.",
    real: "Sleep tracking on the smartwatch.", std: "FHIR Observation · LOINC 93832-4", every: "Nightly, staged every 5 min" },
  // patient logs
  { id: "meals", s: "log", name: "Meals", unit: "dish, carbs g, GI", use: "Meal markers; the twin's gut model; the Recent meal and Usual meal reasons; Rx pad choices.",
    proto: "Drawn from a library of 38 Indian dishes with carbs and GI. Patients log only 45–98% of meals and under-estimate carbs. data/wearables/meal_log.csv.",
    real: "Logged in the patient app by searching a dish or taking a photo; carbs from India's food composition tables (NIN, IFCT 2017), GI from published tables.", std: "FHIR NutritionIntake", every: "Each meal" },
  { id: "unlogged", s: "calc", name: "Meals nobody logged", unit: "g carbs", use: "Violet rings on the trace; the Unlogged meal reason.",
    proto: "The twin compares glucose with what was logged; a rise it cannot explain is estimated as a hidden meal.",
    real: "Same method, on real sensor data.", std: "Derived", every: "Every 5 min" },
  { id: "meds", s: "log", name: "Medicine doses", unit: "dose taken", use: "Missed metformin raises the twin's resting glucose; the Medication reason; Rx pad default.",
    proto: "Prescribed doses, with misses simulated from each patient's adherence. data/wearables/medication_log.csv.",
    real: "A tap in the patient app or a smart pill box reminder; the prescription itself comes from the record.", std: "FHIR MedicationAdministration", every: "Each dose" },
  // EHR
  { id: "ehr", s: "ehr", name: "Patient, diagnoses and prescriptions", unit: "", use: "Case header; diabetes type and medicines set the twin's starting point.",
    proto: "One FHIR R4 bundle per patient: Patient, Condition (SNOMED CT: 44054006 Type 2 diabetes, 714628002 prediabetes, 38341003 hypertension, 370992007 dyslipidaemia, 197321007 fatty liver) and MedicationStatement. data/ehr/fhir/GT-xxxx.json.",
    real: "The hospital or clinic record, shared with consent through ABDM against the patient's ABHA number.", std: "FHIR Patient · Condition · MedicationStatement", every: "Each visit" },
  { id: "hba1c", s: "ehr", name: "HbA1c", unit: "%", use: "Twin's starting resting glucose; compared with GMI from the sensor.",
    proto: "Generated from each patient's simulated average glucose (ADAG relation) plus lab noise. FHIR bundle.", real: "Lab report in the health record.", std: "LOINC 4548-4", every: "Every 3 months" },
  { id: "fpg", s: "ehr", name: "Fasting glucose", unit: "mg/dL", use: "Twin's starting resting glucose.", proto: "Generated from the patient's physiology. FHIR bundle.", real: "Lab report.", std: "LOINC 1558-6", every: "Each visit" },
  { id: "body", s: "ehr", name: "BMI, waist, height, weight", unit: "", use: "Twin's starting insulin sensitivity; South Asians develop resistance at lower BMI.",
    proto: "BMI and waist in the FHIR bundle; height and weight in the registry table data/ehr/patients.csv.", real: "Clinic vitals in the record.", std: "LOINC 39156-5 · 8280-0 · 8302-2 · 29463-7", every: "Each visit" },
  { id: "bp", s: "ehr", name: "Blood pressure", unit: "mmHg", use: "Model input; context for the doctor.", proto: "Systolic in the FHIR bundle, diastolic in the registry table.", real: "Clinic vitals or a home BP cuff.", std: "LOINC 8480-6 · 8462-4", every: "Each visit" },
  { id: "lipids", s: "ehr", name: "Triglycerides, HDL, LDL", unit: "mg/dL", use: "Model inputs that track insulin resistance.", proto: "TG and HDL in the FHIR bundle, LDL in the registry table.", real: "Lipid panel in the record.", std: "LOINC 2571-8 · 2085-9 · 13457-7", every: "Yearly" },
  { id: "kidney", s: "ehr", name: "eGFR and ALT", unit: "", use: "Kidney and liver context for the doctor; model inputs.", proto: "eGFR in the FHIR bundle, ALT in the registry table.", real: "Lab reports.", std: "LOINC 33914-3 · 1742-6", every: "Yearly" },
  { id: "gene", s: "ehr", name: "TCF7L2 genotype", unit: "rs7903146", use: "Lowers the twin's starting insulin response for risk-allele carriers.", proto: "Simulated genotype in the FHIR bundle.", real: "Optional genetic test report; most patients will not have one.", std: "FHIR Observation (genotype)", every: "Once" },
  { id: "history", s: "ehr", name: "Diabetes duration, family history, smoking, diet", unit: "", use: "Twin's starting insulin response weakens with years of diabetes; model inputs.", proto: "Registry table data/ehr/patients.csv.", real: "Intake form and history in the record.", std: "FamilyMemberHistory · LOINC 72166-2", every: "Once, then updated" },
  // computed
  { id: "twin", s: "calc", name: "Twin parameters", unit: "", use: "Patient's twin panel: insulin sensitivity, insulin response, resting glucose, meal absorption, dawn effect.",
    proto: "Starts from the record, then tuned to days 1–7 of CGM, meals, steps, sleep and doses (extended Bergman model, MAP fit). src/chaya/twin.py.", real: "Same, retuned weekly.", std: "Derived", every: "After 7 days, then weekly" },
  { id: "forecast", s: "calc", name: "2-hour glucose forecast", unit: "mg/dL", use: "The violet shadow on every chart; Glucose in 2 h; the patient's Today chart.",
    proto: "The twin runs ahead from now on the patient's usual routine, combined with a LightGBM regressor. src/chaya/model.py.", real: "Same.", std: "Derived", every: "Every 15 min" },
  { id: "risk", s: "calc", name: "Spike risk and stamp", unit: "probability", use: "Next 2 hours stamp, warnings, register counts.", proto: "LightGBM classifier on 54 fused features (18 record, 25 wearable, 11 twin). Back-to-back warnings merge into one episode.", real: "Same, with the threshold set by the clinic.", std: "Derived", every: "Every 15 min" },
  { id: "reasons", s: "calc", name: "Reasons for a warning", unit: "", use: "Why Chaya says this.", proto: "SHAP values per feature, grouped into plain-language drivers. src/chaya/explain.py.", real: "Same.", std: "Derived", every: "With each warning" },
  { id: "kpi", s: "calc", name: "Time in range, GMI, variability", unit: "", use: "Case sheet tiles and the patient's Week view.", proto: "From the CGM: share of readings 70–180 mg/dL; GMI = 3.31 + 0.02392 × mean glucose; CV = SD / mean.", real: "Same, per international CGM consensus targets.", std: "Derived", every: "Live" },
  { id: "notes", s: "calc", name: "Doctor's advice and reviews", unit: "", use: "Case notes in the clinic; Advice in the patient app.", proto: "Written on the Rx pad and stored in the Supabase database (tables case_notes and alert_reviews) with the twin's projection.", real: "Same, inside the clinic's system, with the doctor's identity.", std: "FHIR CarePlan / Communication", every: "When the doctor saves" },
];
const SRC_BY = Object.fromEntries(SRC.map(x => [x.id, x]));

const Sources = {
  init() {
    $("#srcd-close").addEventListener("click", () => this.close());
    $("#scrim").addEventListener("click", () => this.close());
    document.addEventListener("click", e => { const b = e.target.closest("[data-src]"); if (b) { e.preventDefault(); this.open(b.dataset.pid || this.ctxPid(), b.dataset.src.split(",")); } });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && $("#srcdrawer").classList.contains("on")) this.close(); });
    this.renderStreams("#home-streams");
  },
  ctxPid() { return !views.clinic.hidden ? S.pid : !views.patient.hidden ? Patient.pid : null; },
  streamCards() {
    return Object.entries(STREAMS).map(([k, st]) => {
      const items = SRC.filter(x => x.s === k);
      return `<div class="stream"><div class="st-h"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${st.icon}"/></svg><div><b>${st.name}</b><span>${st.sub}</span></div></div>
        <p>${st.note}</p><ul>${items.map(x => `<li><a href="#/data?p=${x.id}">${x.name}</a></li>`).join("")}</ul></div>`;
    }).join("");
  },
  renderStreams(sel) { const el = $(sel); if (el) el.innerHTML = this.streamCards(); },
  row(x, open) {
    return `<div class="srow${open ? " hl" : ""}" id="src-${x.id}">
      <div class="sr-name"><b>${x.name}</b>${x.unit ? `<span>${x.unit}</span>` : ""}<span class="sr-std">${x.std}</span><span class="sr-every">${x.every}</span></div>
      <div><div class="sr-l">Used for</div><p>${x.use}</p></div>
      <div><div class="sr-l">In this prototype</div><p>${esc(x.proto)}</p></div>
      <div><div class="sr-l">In a clinic</div><p>${esc(x.real)}</p></div></div>`;
  },
  renderPage(focus) {
    this.renderStreams("#data-streams");
    $("#data-list").innerHTML = Object.entries(STREAMS).map(([k, st]) => `<div class="sgroup"><h2>${st.name} <span>${st.sub}</span></h2>
      <div class="shead" aria-hidden="true"><span>Parameter</span><span>Used for</span><span>In this prototype</span><span>In a clinic</span></div>
      ${SRC.filter(x => x.s === k).map(x => this.row(x, x.id === focus)).join("")}</div>`).join("");
    if (focus) setTimeout(() => { const t = $(`#src-${focus}`); if (t) t.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" }); }, 60);
  },
  /* Completeness of one patient's data over the replayed week, up to the clock. */
  completeness(P) {
    const kEnd = Math.min(S.day * 288 + S.slot * 3, P.cgm.length - 1);
    const cg = P.cgm.slice(0, kEnd + 1), got = cg.filter(v => v != null).length;
    let last = -1; for (let k = kEnd; k >= 0; k--) if (P.cgm[k] != null) { last = k; break; }
    const meals = P.meals.filter(m => m.k <= kEnd).length;
    let unl = 0, prevK = -99; Object.entries(P.twin.inferred).map(([k, g]) => [+k, g]).filter(([k, g]) => k <= kEnd && g >= 4).sort((a, b) => a[0] - b[0]).forEach(([k]) => { if (k - prevK > 12) unl++; prevK = k; });
    const doses = P.meds.filter(m => m.k <= kEnd).length, nights = P.nights.filter(n => n.day >= 7 && n.day <= S.day + 7).length;
    return { cov: got / Math.max(cg.length, 1) * 100, last, meals, unl, doses, nights, kEnd };
  },
  async open(pid, ids) {
    this.prev = document.activeElement;
    let head = "";
    if (pid) {
      try {
        const P = await Data.getCase(pid), c = this.completeness(P);
        const t = k => `${DAYS[Math.floor(k / 288)]} ${fmtT((k % 288) * 5)}`;
        head = `<div class="dq"><div class="dq-h">${esc(P.name)}'s data this week, up to ${DAYS[S.day]} ${fmtT(S.slot * 15)}</div>
          <div class="dq-grid"><div><b class="num">${c.cov.toFixed(0)}%</b><span>CGM coverage${c.last >= 0 ? ` · last ${t(c.last)}` : ""}</span></div>
          <div><b class="num">${c.meals}</b><span>meals logged · ${c.unl} more noticed by the twin</span></div>
          <div><b class="num">${c.doses}</b><span>doses logged</span></div>
          <div><b class="num">${c.nights}</b><span>nights of sleep and HRV</span></div></div>
          <p class="dq-f">All values are synthetic. Gaps in the CGM are simulated sensor dropouts.</p></div>`;
      } catch { /* case not loaded; show the list only */ }
    }
    const pick = ids && ids.length ? ids.map(i => SRC_BY[i]).filter(Boolean) : SRC;
    const rest = ids && ids.length ? SRC.filter(x => !ids.includes(x.id)) : [];
    $("#srcd-body").innerHTML = head + pick.map(x => this.card(x)).join("") +
      (rest.length ? `<details class="more"><summary>All other parameters (${rest.length})</summary>${rest.map(x => this.card(x)).join("")}</details>` : "") +
      `<p class="dq-f" style="margin-top:16px"><a href="#/data">Open the full table</a> · the same list, grouped by stream.</p>`;
    $("#srcdrawer").classList.add("on"); $("#srcdrawer").setAttribute("aria-hidden", "false"); $("#scrim").classList.add("on");
    $("#srcd-body").scrollTop = 0; $("#srcd-close").focus();
  },
  card(x) {
    return `<div class="scard"><div class="sc-h"><span class="sc-s">${STREAMS[x.s].name}</span><b>${x.name}</b><span class="sc-meta">${x.std} · ${x.every}</span></div>
      <p>${x.use}</p><dl><dt>In this prototype</dt><dd>${esc(x.proto)}</dd><dt>In a clinic</dt><dd>${esc(x.real)}</dd></dl></div>`;
  },
  close() {
    const d = $("#srcdrawer"); if (!d || !d.classList.contains("on")) return;
    d.classList.remove("on"); d.setAttribute("aria-hidden", "true");
    if (!$("#glossary").classList.contains("on")) $("#scrim").classList.remove("on");
    if (this.prev && document.contains(this.prev)) this.prev.focus();
  },
};

// ================================================================== patient app
/* The twin's 2-hour forecast from prediction index i, on the patient's usual routine. */
function twinForecast(P, i, H = 120) {
  const k = P.pred.k[i], st = P.twin.states[i], sm = (k % 288) * 5 + 5, day = Math.floor(k / 288) + 7;
  const r = carryMeals(P, k, routine(P.twin, sm, H, true));
  return { k, start: st[0], fc: forecast(P.twin.params, st, sm, H, r.steps, r.meal, r.kab, P.twin.si_mult[day], P.twin.gb_shift[day], P.twin.su[i]) };
}
const Patient = {
  pid: null, tab: "today", ready: false,
  async init(pid) {
    pid = pid || this.pid || S.pid || "GT-1102";
    if (!this.ready) {
      this.ready = true; this.meta = await Data.getMeta();
      $("#ps-days").innerHTML = DAYS.map((d, i) => `<button data-d="${i}" aria-pressed="false">${d} ${14 + i}</button>`).join("");
      $("#ps-days").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { S.day = +b.dataset.d; this.render(); } });
      $("#ps-slider").addEventListener("input", e => { S.slot = +e.target.value; this.render(); });
      $("#ps-pick").addEventListener("change", e => { location.hash = `#/patient/${e.target.value}`; });
      $("#ptabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) { this.tab = b.dataset.tab; this.render(); $("#pscreen").scrollTop = 0; if (matchMedia("(max-width: 720px)").matches) window.scrollTo(0, 0); } });
      $("#pscreen").addEventListener("click", e => {
        const a = e.target.closest("[data-ack]"); if (a) { const s = new Set(store.get(`ack.${this.pid}`, [])); s.add(a.dataset.ack); store.set(`ack.${this.pid}`, [...s]); this.render(); return; }
        const g = e.target.closest("[data-go]"); if (g) { this.tab = g.dataset.go; this.render(); $("#pscreen").scrollTop = 0; }
      });
    }
    const reg = await Data.getRegister();
    $("#ps-pick").innerHTML = [...reg].sort((a, b) => a.name.localeCompare(b.name)).map(c => `<option value="${c.pid}"${c.pid === pid ? " selected" : ""}>${esc(c.name)} · ${c.pid}</option>`).join("");
    if (pid !== this.pid) { this.pid = pid; this.tab = "today"; }
    $("#pscreen").innerHTML = `<div class="loading">Opening the app…</div>`;
    try { this.P = await Data.getCase(pid); } catch { $("#pscreen").innerHTML = `<div class="loading">We couldn't open ${esc(pid)}. Pick a patient above.</div>`; return; }
    try { this.notes = await Data.notes(pid); } catch { this.notes = []; }
    $("#ps-name").textContent = this.P.name;
    $("#ps-back").href = `#/clinic/${pid}`;
    renderNav("patient");
    this.render();
  },
  kNow() { return S.day * 288 + S.slot * 3; },
  idx(P) { const k = this.kNow(); let i = -1; for (let j = 0; j < P.pred.k.length; j++) { if (P.pred.k[j] <= k) i = j; else break; } return i; },
  render() {
    const P = this.P; if (!P) return;
    $$("#ps-days button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.d === S.day));
    $("#ps-slider").value = S.slot; $("#ps-tout").textContent = fmtT(S.slot * 15);
    const k = this.kNow(), notes = (this.notes || []).filter(n => n.at_k <= k), ack = new Set(store.get(`ack.${this.pid}`, []));
    const unseen = notes.filter(n => !ack.has(String(n.id))).length;
    const tabs = [["today", "Today", "M3 12h4l3-8 4 16 3-8h4"], ["advice", "Advice", "M7 4h10l3 3v13H4V4zM8 11h8M8 15h5"], ["week", "Week", "M4 20V10M10 20V4M16 20v-7M22 20H2"], ["data", "My data", "M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"]];
    $("#ptabs").innerHTML = tabs.map(([id, t, d]) => `<button data-tab="${id}" aria-current="${this.tab === id}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg><span>${t}</span>${id === "advice" && unseen ? `<i class="badge">${unseen}</i>` : ""}</button>`).join("");
    const greet = S.slot < 48 ? "Good morning" : S.slot < 68 ? "Good afternoon" : "Good evening";
    const top = `<header class="papp-h"><div><div class="papp-brand"><svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true"><path d="M21 9.5a8 8 0 1 0 0 13" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><path d="M25.5 12.5a8.5 8.5 0 0 1 0 7" fill="none" stroke="var(--shadow)" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="2 3"/></svg>Chaya</div>
      <h2>${greet}, ${esc(P.name)}</h2><div class="papp-when">${DAYS_LONG[S.day]} ${14 + S.day} Sep · ${fmtT(S.slot * 15)}</div></div><span class="papp-syn">Synthetic</span></header>`;
    const body = { today: () => this.today(P, k, notes), advice: () => this.advice(P, notes, ack), week: () => this.week(P, k), data: () => this.data(P, k) }[this.tab]();
    $("#pscreen").innerHTML = top + body;
    const svg = $("#p-chart"); if (svg) this.chart(P, k, svg);
  },
  status(P, i, k) {
    const thr = this.meta.threshold, cg = P.cgm[k], pr = i >= 0 ? P.pred.prob[i] : null;
    if (cg != null && cg >= 180) return "high"; if (pr == null || cg == null) return "na";
    return pr >= thr ? "alert" : pr >= thr * 0.6 ? "watch" : "ok";
  },
  today(P, k, notes) {
    const d0 = S.day * 288, i = this.idx(P);
    let last = -1; for (let j = k; j >= Math.max(0, k - 12); j--) if (P.cgm[j] != null) { last = j; break; }
    const g = last >= 0 ? P.cgm[last] : null, prev = last >= 3 ? P.cgm[last - 3] : null;
    const dv = g != null && prev != null ? g - prev : 0;
    const arrow = dv > 15 ? ["↑", "rising fast"] : dv > 5 ? ["↗", "rising"] : dv < -15 ? ["↓", "falling fast"] : dv < -5 ? ["↘", "falling"] : ["→", "steady"];
    const band = g == null ? ["na", "No reading"] : g < 70 ? ["low", "Below range"] : g > 180 ? ["high", "Above range"] : ["ok", "In range"];
    const st = this.status(P, i, k);
    const fc = i >= 0 && P.pred.k[i] >= d0 ? twinForecast(P, i) : null;
    const pk = fc ? Math.round(peakOf(fc.fc)) : null, pkAt = fc ? fmtT(((fc.k % 288) * 5 + 5 + (fc.fc.indexOf(peakOf(fc.fc)) + 1) * 5) % 1440) : "";
    const latest = notes[0];
    let heads = "";
    if (st === "alert" || st === "watch") heads = `<div class="pcard heads ${st}"><div class="ph-k">${st === "alert" ? "Heads-up for the next 2 hours" : "Worth a look"}</div>
      <p>${st === "alert" ? `Your glucose may go above 180 ${pk ? `(about <b>${pk}</b> around ${pkAt})` : "soon"}. Your care team can see this too.` : "Your glucose may rise a little after your next meal."}</p>
      ${latest ? `<button class="pnote-mini" data-go="advice"><span class="hand">℞ ${esc(latest.summary)}</span><span>Your doctor's latest advice →</span></button>` : `<p class="ph-f">A short walk after eating usually helps. Your doctor may send advice.</p>`}</div>`;
    else if (st === "high") heads = `<div class="pcard heads alert"><div class="ph-k">Above range now</div><p>Your glucose is above 180. ${latest ? "Your doctor's latest advice is below." : "A short walk usually helps it come down."}</p>${latest ? `<button class="pnote-mini" data-go="advice"><span class="hand">℞ ${esc(latest.summary)}</span><span>Open your advice →</span></button>` : ""}</div>`;
    else if (st === "ok") heads = `<div class="pcard heads ok"><div class="ph-k">Next 2 hours</div><p>Looking steady${pk ? `, peaking around <b>${pk}</b>` : ""}.</p></div>`;
    const seg = P.cgm.slice(d0, k + 1).filter(v => v != null), tir = seg.length ? seg.filter(v => v >= 70 && v <= 180).length / seg.length * 100 : null;
    const steps = P.steps.slice(d0, k + 1).reduce((a, b) => a + b, 0), night = P.nights.find(n => n.day === S.day + 7);
    const meals = P.meals.filter(m => m.k >= d0 && m.k <= k).sort((a, b) => a.k - b.k), doses = P.meds.filter(m => m.k >= d0 && m.k <= k).sort((a, b) => a.k - b.k);
    const ago = last >= 0 ? (k - last) * 5 : null;
    return `<section class="pcard glu"><div class="glu-top"><div><div class="glu-v num">${g == null ? "–" : Math.round(g)}<small>mg/dL</small><span class="arr" title="${arrow[1]}">${arrow[0]}</span></div>
        <div class="glu-s"><span class="pill2 ${band[0]}">${band[1]}</span><span>${arrow[1]} · ${ago == null ? "sensor gap" : ago ? `${ago} min ago` : "just now"}</span></div></div>
        <button class="src-mini" data-src="cgm,forecast" aria-label="Where this number comes from">from your sensor</button></div>
        <svg id="p-chart" role="img" aria-label="Glucose for the last 3 hours and Chaya's forecast for the next 2"></svg>
        <div class="p-leg"><span><i style="background:var(--ink)"></i>Your glucose</span><span><i class="dash"></i>Chaya's forecast</span><span><i style="background:var(--band);height:8px"></i>Target 70–180</span></div></section>
      ${heads}
      <section class="ptiles">
        <div class="pt"><span class="pt-l">In range today</span><b class="num">${tir == null ? "–" : tir.toFixed(0) + "%"}</b><span class="pt-g">goal 70% or more</span></div>
        <div class="pt"><span class="pt-l">Steps today</span><b class="num">${steps.toLocaleString("en-IN")}</b><span class="pt-g">from your watch</span></div>
        <div class="pt"><span class="pt-l">Sleep last night</span><b class="num">${night ? night.sleep_hours.toFixed(1) + " h" : "–"}</b><span class="pt-g">${night ? `bed ${fmtT(night.bedtime * 60)}` : "no data"}</span></div>
        <div class="pt"><span class="pt-l">Medicines today</span><b class="num">${doses.length}</b><span class="pt-g">${doses.length ? "doses logged" : "none logged yet"}</span></div>
      </section>
      <section class="pcard plist"><div class="pl-h">Today so far</div>
        ${[...meals.map(m => ({ k: m.k, t: m.meal, s: `${m.carbs} g carbs`, c: "meal" })), ...doses.map(m => ({ k: m.k, t: m.drug, s: "taken", c: "dose" }))].sort((a, b) => a.k - b.k)
          .map(x => `<div class="pl-row"><span class="pl-t num">${fmtT((x.k % 288) * 5)}</span><span class="dot ${x.c}"></span><span class="pl-n">${esc(x.t)}</span><span class="pl-s">${x.s}</span></div>`).join("") || `<p class="pl-empty">Nothing logged yet today.</p>`}
      </section>`;
  },
  chart(P, k, el) {
    const W = el.clientWidth || 330, H = 150, M = { l: 26, r: 6, t: 8, b: 18 };
    const svg = d3.select(el).attr("viewBox", `0 0 ${W} ${H}`).attr("height", H); svg.selectAll("*").remove();
    const x = d3.scaleLinear([-36, 24], [M.l, W - M.r]), y = d3.scaleLinear([50, 300], [H - M.b, M.t]).clamp(true);
    svg.append("rect").attr("x", M.l).attr("width", W - M.l - M.r).attr("y", y(180)).attr("height", y(70) - y(180)).attr("fill", css("--band")).attr("rx", 3);
    [70, 180].forEach(v => svg.append("text").attr("x", M.l - 4).attr("y", y(v) + 3).attr("text-anchor", "end").text(v));
    const past = d3.range(-36, 1).map(j => [j, P.cgm[k + j] ?? null]);
    svg.append("path").attr("d", d3.line().defined(d => d[1] != null).x(d => x(d[0])).y(d => y(d[1])).curve(d3.curveMonotoneX)(past)).attr("fill", "none").attr("stroke", css("--ink")).attr("stroke-width", 2.6).attr("stroke-linecap", "round");
    const i = this.idx(P);
    if (i >= 0 && k - P.pred.k[i] < 6) {
      const f = twinForecast(P, i), off = f.k - k;
      const pts = [[off, f.start], ...f.fc.map((v, j) => [off + j + 1, v])].filter(p => p[0] <= 24);
      svg.append("path").attr("d", d3.area().x(d => x(d[0])).y0(d => y(d[1] - 18 - (d[0] - off) * .9)).y1(d => y(d[1] + 18 + (d[0] - off) * .9)).curve(d3.curveMonotoneX)(pts)).attr("fill", css("--shadow")).attr("opacity", .13);
      svg.append("path").attr("d", d3.line().x(d => x(d[0])).y(d => y(d[1])).curve(d3.curveMonotoneX)(pts)).attr("fill", "none").attr("stroke", css("--shadow")).attr("stroke-width", 2.4).attr("stroke-dasharray", "6 4");
    }
    svg.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", M.t).attr("y2", H - M.b).attr("stroke", css("--ink-3")).attr("stroke-width", 1);
    [[-36, "-3 h"], [-12, "-1 h"], [0, "now"], [24, "+2 h"]].forEach(([t, l]) => svg.append("text").attr("x", x(t)).attr("y", H - 4).attr("text-anchor", t === -36 ? "start" : t === 24 ? "end" : "middle").text(l));
  },
  advice(P, notes, ack) {
    if (!notes.length) return `<div class="pempty"><div class="hand" style="font-size:2.4rem;line-height:1">℞</div><b>No advice yet</b><p>When your doctor writes advice on the Rx pad, it appears here with what it should do for your glucose.</p></div>`;
    return `<div class="pl-h" style="padding:0 4px">From your care team</div>` + notes.map(n => {
      const d = Math.floor(n.at_k / 288), seen = ack.has(String(n.id)), better = n.projected_peak < n.baseline_peak - 2;
      return `<article class="pnote${seen ? " seen" : ""}"><div class="pn-h"><span>Your care team${n.author && !/^You/.test(n.author) ? ` · ${esc(n.author)}` : ""}</span><span class="num">${DAYS[d]} ${14 + d} Sep, ${fmtT((n.at_k % 288) * 5)}</span></div>
        <p class="hand pn-t">℞ ${esc(n.summary)}</p>
        <div class="pn-e"><span>What it should do</span><b>peak about <span class="num ${better ? "good" : ""}">${Math.round(n.projected_peak)}</span> instead of <span class="num">${Math.round(n.baseline_peak)}</span> mg/dL</b><span>${n.projected_minutes_above ? `${n.projected_minutes_above} min above 180` : "staying under 180"}</span></div>
        ${seen ? `<div class="pn-ok">✓ Seen</div>` : `<button class="btn btn-primary btn-sm" data-ack="${n.id}">Got it</button>`}</article>`;
    }).join("") + `<p class="pfoot">Advice is written by your doctor and projected by your twin. Talk to your doctor before changing any medicine.</p>`;
  },
  week(P, k) {
    const rows = DAYS.map((dn, d) => {
      const hi = Math.min(k, d * 288 + 287), seg = d * 288 <= k ? P.cgm.slice(d * 288, hi + 1).filter(v => v != null) : [];
      const tir = seg.length ? seg.filter(v => v >= 70 && v <= 180).length / seg.length * 100 : null;
      const n = P.nights.find(x => x.day === d + 7), st = d * 288 <= k ? P.steps.slice(d * 288, hi + 1).reduce((a, b) => a + b, 0) : null;
      return { dn: `${dn} ${14 + d}`, tir, sleep: d <= S.day && n ? n.sleep_hours : null, st, today: d === S.day };
    });
    const all = P.cgm.slice(0, k + 1).filter(v => v != null), mean = all.reduce((a, b) => a + b, 0) / Math.max(all.length, 1);
    const tirW = all.filter(v => v >= 70 && v <= 180).length / Math.max(all.length, 1) * 100, gmi = 3.31 + 0.02392 * mean;
    return `<section class="ptiles"><div class="pt"><span class="pt-l">In range this week</span><b class="num">${tirW.toFixed(0)}%</b><span class="pt-g">goal 70% or more</span></div>
        <div class="pt"><span class="pt-l">Average glucose</span><b class="num">${Math.round(mean)}</b><span class="pt-g">mg/dL</span></div>
        <div class="pt"><span class="pt-l">Estimated A1c (GMI)</span><b class="num">${gmi.toFixed(1)}%</b><span class="pt-g">last lab ${P.ehr.hba1c_pct.toFixed(1)}%</span></div>
        <div class="pt"><span class="pt-l">Warnings this week</span><b class="num">${P.pred.start.filter((s, j) => s && P.pred.k[j] <= k).length}</b><span class="pt-g">also sent to your doctor</span></div></section>
      <section class="pcard"><div class="pl-h">Time in range, day by day</div><div class="wbars">${rows.map(r => `<div class="wb${r.today ? " today" : ""}"><div class="wb-bar"><i style="height:${r.tir == null ? 0 : r.tir}%" class="${r.tir != null && r.tir < 70 ? "low" : ""}"></i></div><b class="num">${r.tir == null ? "–" : r.tir.toFixed(0)}</b><span>${r.dn.split(" ")[0]}</span></div>`).join("")}</div></section>
      <section class="pcard plist"><div class="pl-h">Sleep and steps</div>${rows.map(r => `<div class="pl-row"><span class="pl-t">${r.dn}</span><span class="pl-n num">${r.sleep == null ? "–" : r.sleep.toFixed(1) + " h sleep"}</span><span class="pl-s num">${r.st == null ? "–" : r.st.toLocaleString("en-IN") + " steps"}</span></div>`).join("")}</section>`;
  },
  data(P, k) {
    const c = Sources.completeness(P), t = kk => kk < 0 ? "—" : `${DAYS[Math.floor(kk / 288)]} ${fmtT((kk % 288) * 5)}`;
    const lastOf = arr => arr.filter(m => m.k <= k).reduce((a, m) => Math.max(a, m.k), -1);
    const e = P.ehr;
    const devs = [
      ["Glucose sensor (CGM)", "Reads every 5 minutes", `Last reading ${t(c.last)} · ${c.cov.toFixed(0)}% of the week covered`, "cgm", "M12 3a9 9 0 1 0 .01 0M12 8v4l3 2"],
      ["Smartwatch", "Steps, heart rate, sleep and HRV", `Synced ${t(k)} · ${c.nights} nights recorded`, "steps,hr,hrv,sleep", "M8 3h8l1 4H7zM7 17h10l-1 4H8zM6 7h12v10H6z"],
      ["Meal log", "What you tap in", `${c.meals} meals logged · last ${t(lastOf(P.meals))}`, "meals,unlogged", "M7 4h10l3 3v13H4V4zM8 11h8M8 15h5"],
      ["Medicine log", "Doses you mark as taken", `${c.doses} doses · last ${t(lastOf(P.meds))}`, "meds", "M10.5 3.5a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7-7zM7 10l7 7"],
      ["Health record", "Linked to your ABHA number", `HbA1c ${e.hba1c_pct}% · fasting ${e.fasting_glucose_mgdl} mg/dL · from your clinic`, "ehr,hba1c,fpg,body,bp,lipids,kidney", "M8 4h8l4 4v12H4V4zM9 13h6M12 10v6"],
    ];
    return `<p class="pintro">Chaya combines these sources into your twin. Tap one to see exactly what it sends and why.</p>` +
      devs.map(([n, s, st, ids, d]) => `<button class="pdev" data-src="${ids}" data-pid="${P.pid}"><span class="pd-i"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg></span>
        <span class="pd-t"><b>${n}</b><span>${s}</span><span class="pd-st"><i></i>${st}</span></span><span class="pd-c" aria-hidden="true">›</span></button>`).join("") +
      `<p class="pfoot">Everything in this demo is synthetic. In the full app, you choose what to share and can withdraw consent at any time through ABDM.</p>`;
  },
};

// ================================================================== boot
(async function boot() {
  setupHelp(); Glossary.init(); Sources.init();
  await Data.init();
  await route();
})();
})();
