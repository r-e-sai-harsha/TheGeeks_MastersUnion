/* Chaya web app: home, clinic, product tour, case walkthrough, glossary.
   Talks to the FastAPI + database backend when it is reachable; otherwise runs the same
   clinic from the bundled synthetic data (offline demo). The twin simulator below mirrors
   src/chaya/physiology.py exactly. */
(() => {
"use strict";

// ================================================================== helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fullName = c => c && c.surname ? `${c.name} ${c.surname}` : (c ? c.name : "");
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
function toast(msg, act) {
  const t = toastEl();
  t.innerHTML = `<span>${esc(msg)}</span>${act ? `<a class="toast-a" href="${act.href}">${esc(act.label)}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>` : ""}`;
  t.classList.toggle("act", !!act); t.classList.add("on"); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), act ? 9000 : 2600);
}
document.addEventListener("click", e => { if (e.target.closest(".toast-a")) toastEl().classList.remove("on"); });
/* Keep sticky panes below the header, whatever its height. */
new ResizeObserver(() => { const h = document.getElementById("letterhead"); if (h) document.documentElement.style.setProperty("--hdr", `${Math.round(h.getBoundingClientRect().height)}px`); }).observe(document.getElementById("letterhead"));

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
    // The API can take a few seconds on a cold start; wait up to 8 s, then try once more before falling back to the bundled data.
    for (let attempt = 0; attempt < 2 && !this.live; attempt++) {
      try {
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 8000);
        const r = await fetch("api/health", { signal: ctl.signal, cache: "no-store" }); clearTimeout(to);
        if (r.ok && (r.headers.get("content-type") || "").includes("json")) { const h = await r.json(); this.live = true; this.db = h.database; }
        else if (r.status === 404) break; // no API on this host (local file server): go offline straight away
      } catch { this.live = false; }
    }
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
  async json(url, opt) {
    const r = await fetch(url, opt ? { ...opt, headers: { "Content-Type": "application/json" }, body: JSON.stringify(opt.body) } : undefined);
    if (!r.ok) { let m = "The server didn't accept that."; try { m = (await r.json()).detail || m; } catch { /* not json */ } throw new Error(m); }
    return r.status === 204 ? null : r.json();
  },
  // patient acknowledges advice
  async ackNote(pid, id) {
    if (this.live) return this.json(`api/patients/${pid}/notes/${id}/ack`, { method: "POST", body: {} });
    store.set(`notes.${pid}`, store.get(`notes.${pid}`, []).map(n => n.id === id ? { ...n, ack_at: new Date().toISOString() } : n));
  },
  // escalations
  async escalations(pid) { return this.live ? this.json(`api/patients/${pid}/escalations`) : store.get(`esc.${pid}`, []); },
  async addEscalation(pid, body) {
    if (this.live) return this.json(`api/patients/${pid}/escalations`, { method: "POST", body });
    const row = { id: Date.now(), pid, status: "open", channel: null, outcome: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...body };
    store.set(`esc.${pid}`, [row, ...store.get(`esc.${pid}`, [])]); return row;
  },
  async updateEscalation(pid, id, patch) {
    if (this.live) return this.json(`api/escalations/${id}`, { method: "PATCH", body: patch });
    const list = store.get(`esc.${pid}`, []).map(e => e.id === id ? { ...e, ...patch, updated_at: new Date().toISOString() } : e);
    store.set(`esc.${pid}`, list); return list.find(e => e.id === id);
  },
  // patient app logs (meals and doses)
  async logs(pid) { return this.live ? this.json(`api/patients/${pid}/logs`) : store.get(`logs.${pid}`, []); },
  async addLog(pid, body) {
    if (this.live) return this.json(`api/patients/${pid}/logs`, { method: "POST", body });
    const row = { id: Date.now(), pid, created_at: new Date().toISOString(), ...body };
    store.set(`logs.${pid}`, [...store.get(`logs.${pid}`, []), row]); return row;
  },
  async deleteLog(pid, id) {
    if (this.live) return this.json(`api/patients/${pid}/logs/${id}`, { method: "DELETE" });
    store.set(`logs.${pid}`, store.get(`logs.${pid}`, []).filter(l => l.id !== id));
  },
  // panel outcomes: static (precomputed from the synthetic week) + live loop counts
  async outcomesStatic() { if (!this._out) this._out = await (await fetch("data/outcomes.json")).json(); return this._out; },
  async outcomesLive() {
    if (this.live) { try { return await this.json("api/outcomes"); } catch { /* fall through */ } }
    const reg = await this.getRegister(), by = {}; let notes = 0, acked = 0, reviews = 0, esc = [];
    reg.forEach(c => { const n = store.get(`notes.${c.pid}`, []), r = store.get(`reviewed.${c.pid}`, []), e = store.get(`esc.${c.pid}`, []);
      notes += n.length; acked += n.filter(x => x.ack_at).length; reviews += r.length; esc = esc.concat(e);
      if (n.length || r.length || e.length) by[c.pid] = { notes: n.length, acked: n.filter(x => x.ack_at).length, reviews: r.length, open: e.filter(x => x.status === "open").length, escalations: e.length }; });
    const mins = esc.filter(e => e.status !== "open").map(e => (new Date(e.updated_at) - new Date(e.created_at)) / 60000).sort((x, y) => x - y);
    return { notes, notes_acknowledged: acked, reviews, escalations: { total: esc.length, open: esc.filter(e => e.status === "open").length, contacted: esc.filter(e => e.status === "contacted").length,
      resolved: esc.filter(e => e.status === "resolved").length, low: esc.filter(e => e.kind === "low").length, median_minutes_to_contact: mins.length ? Math.round(mins[Math.floor(mins.length / 2)]) : null },
      patient_logs: { meals: 0, doses: 0 }, by_patient: by };
  },
};

// ================================================================== clinic settings: alert threshold
/* The clinic chooses how sensitive spike warnings are. Stored per browser; recomputes warnings from the model's probabilities. */
const Thr = {
  get(meta) { const v = store.get("threshold", null); return v == null ? meta.threshold : v; },
  set(v) { store.set("threshold", v); },
  apply(P, thr) {
    if (P._thr === thr) return;
    const pr = P.pred;
    pr.alert = pr.prob.map((p, i) => p >= thr && P.cgm[pr.k[i]] != null && P.cgm[pr.k[i]] < 180);
    pr.start = pr.alert.map((a, i) => a && !(i > 0 && pr.alert[i - 1] && pr.k[i] - pr.k[i - 1] <= 3));
    P._thr = thr;
  },
};
/* Meals and doses the patient logged in the app join the record the twin reads. */
function mergeLogs(P, logs) {
  if (!P._meals0) { P._meals0 = P.meals.slice(); P._meds0 = P.meds.slice(); }
  P.meals = P._meals0.concat(logs.filter(l => l.kind === "meal").map(l => ({ k: l.k, meal: l.meal, carbs: l.carbs, gi: l.gi, slot: "app", app: l.id, photo: l.photo })));
  P.meds = P._meds0.concat(logs.filter(l => l.kind === "dose").map(l => ({ k: l.k, drug: l.drug, app: l.id })));
  P._logs = logs;
}
/* Low-glucose risk from the twin: forecast dips below 80 mg/dL within 2 h (or glucose already below 70). */
const LOW_FLOOR = 80;
function lowRisk(P, i, k, fc) {
  const cg = P.cgm[k];
  if (cg != null && cg < 70) return { now: true, min: cg, at: 0 };
  if (!fc || cg == null) return null;
  const mn = Math.min(...fc);
  if (mn >= LOW_FLOOR) return null;
  return { now: false, min: mn, at: fc.indexOf(mn) + 1 };
}

// ================================================================== router
const views = { home: $("#view-home"), clinic: $("#view-clinic"), patient: $("#view-patient"), data: $("#view-data"), outcomes: $("#view-outcomes") };
let current = null;
function parseHash() {
  const h = location.hash || "#/";
  if (!h.startsWith("#/")) return { view: "home", anchor: h.slice(1) };
  const [path, q] = h.slice(2).split("?");
  const params = new URLSearchParams(q || "");
  const parts = path.split("/").filter(Boolean);
  return { view: ["clinic", "patient", "data", "outcomes"].includes(parts[0]) ? parts[0] : "home", pid: parts[1], params };
}
async function route() {
  const r = parseHash();
  Object.entries(views).forEach(([k, el]) => { el.hidden = k !== r.view; });
  renderNav(r.view);
  Sources.close();
  const tp = r.params && r.params.get("t");
  if (tp && /^[0-6]\.\d{1,2}$/.test(tp)) { const [dd, ss] = tp.split(".").map(Number); if (ss <= 95) { S.day = dd; S.slot = ss; } }
  if (r.view === "outcomes") { Clinic.togglePlay(false); if (current !== "outcomes") window.scrollTo(0, 0); await Outcomes.render(); }
  else if (r.view === "data") { Sources.renderPage(r.params.get("p")); if (current !== "data") window.scrollTo(0, 0); }
  else if (r.view === "patient") { Clinic.togglePlay(false); if (current !== "patient") window.scrollTo(0, 0); await Patient.init(r.pid, r.params); }
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
/* The patient the clinic and the patient app are looking at; the header switcher keeps them in step. */
let curPid = "GT-1102", navView = "home";
const NAV_ICON = {
  clinic: "M6 3v6a4 4 0 0 0 8 0V3M10 13v3a5 5 0 0 0 10 0v-2M20 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
  patient: "M8 2.5h8a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2zM10.5 18.5h3",
};
function renderNav(view) {
  if (view) navView = view; view = navView;
  const app = view !== "home", pid = curPid;
  $("#letterhead").classList.toggle("mode-app", app);
  $("#home-btn").hidden = !app;
  $("#modes").hidden = !app;
  $("#navlinks").innerHTML = ""; $("#navlinks").hidden = true;
  HomeNav.show(!app);
  const modes = [["clinic", `#/clinic/${pid}`, app ? "Clinic" : "Simulated clinic"], ["patient", `#/patient/${pid}`, "Patient app"]];
  $("#modes").innerHTML = modes.map(([id, h, t]) => {
    const on = app ? view === id : id === "clinic";
    return `<a href="${h}" class="mode${on ? " on" : ""}"${app && view === id ? ' aria-current="page"' : ""}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${NAV_ICON[id]}"/></svg>${t}</a>`;
  }).join("");
  $("#applinks").innerHTML = app ? [["#/outcomes", "Outcomes", "outcomes"], ["#/data", "Data sources", "data"]]
    .map(([h, t, id]) => `<a href="${h}"${view === id ? ' aria-current="page"' : ""}>${t}</a>`).join("") : "";
}
window.addEventListener("hashchange", route);

// ================================================================== home section nav (bottom, floating)
const HomeNav = {
  items: [["patient-app", "Patient app"], ["how", "How it works"], ["sources", "Data sources"], ["clinic-preview", "The clinic"], ["evidence", "Evidence"], ["india", "Built for India"], ["safety", "Safety"]],
  on: null, ready: false,
  init() {
    this.ready = true;
    $("#hn-track").innerHTML = this.items.map(([id, t]) => `<a href="#${id}" data-id="${id}">${t}</a>`).join("");
    $("#hn-track").addEventListener("click", e => {
      const a = e.target.closest("a[data-id]"); if (!a) return; e.preventDefault();
      const el = document.getElementById(a.dataset.id); if (!el) return;
      this.set(a.dataset.id, true); this.lock = Date.now() + 900;
      el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });
    const io = new IntersectionObserver(es => {
      if (this.lock && Date.now() < this.lock) return;
      es.forEach(en => { if (en.isIntersecting) this.set(en.target.id); });
    }, { rootMargin: "-45% 0px -50% 0px" });
    this.items.forEach(([id]) => { const el = document.getElementById(id); if (el) io.observe(el); });
    const hero = $("#view-home .hero");
    new IntersectionObserver(([en]) => { if (en.isIntersecting && !(this.lock && Date.now() < this.lock)) this.set(null); }, { rootMargin: "-45% 0px -50% 0px" }).observe(hero);
    window.addEventListener("resize", () => this.place());
    $("#hn-track").addEventListener("scroll", () => this.place(), { passive: true });
  },
  show(v) { if (v && !this.ready) this.init(); $("#homenav").hidden = !v; if (v) requestAnimationFrame(() => this.place()); },
  set(id, user) {
    this.on = id;
    $$("#hn-track a").forEach(a => { const on = a.dataset.id === id; a.classList.toggle("on", on); if (on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
    const a = id && $(`#hn-track a[data-id="${id}"]`);
    if (a && !user) a.scrollIntoView({ block: "nearest", inline: "center", behavior: "auto" });
    this.place();
  },
  place() {
    const ind = $("#hn-ind"), a = this.on && $(`#hn-track a[data-id="${this.on}"]`);
    if (!a) { ind.style.opacity = 0; return; }
    const nr = $("#homenav").getBoundingClientRect(), r = a.getBoundingClientRect();
    ind.style.opacity = 1; ind.style.width = `${r.width}px`; ind.style.transform = `translateX(${r.left - nr.left}px)`;
  },
};

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
      try { this.out = await Data.outcomesStatic(); } catch { this.out = null; }
      this.setupClock(); this.setupRx(); this.setupRegister(); this.setupThreshold(); this.setupEscalation();
      Data.outcomesLive().then(l => { this.loop = l; this.renderRegister(); }).catch(() => {});
      $("#notes").addEventListener("click", e => { const b = e.target.closest("[data-del]"); if (b) this.deleteNote(+b.dataset.del); });
      $("#save-note").addEventListener("click", () => this.saveNote());
      $("#review-wrap").addEventListener("click", e => { if (e.target.closest("#review-btn")) this.review(); });
      let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (S.pid && !views.clinic.hidden) { this.renderTrace(); this.renderRx(); } }, 120); });
      const rerender = () => { if (S.pid) this.renderTime(); };
      new MutationObserver(rerender).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    }
    await this.renderRegister();
    const target = pid || curPid || S.pid || "GT-1102";
    if (target !== S.pid) await this.open(target);
    else { const P = this.P(); if (P) { try { mergeLogs(P, await Data.logs(S.pid)); S.esc = await Data.escalations(S.pid); } catch { /* keep cached */ } } await this.loadNotes(); this.renderTime(); }
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
    const reg0 = await Data.getRegister(), q = $("#search").value.trim().toLowerCase(), sort = $("#sort").value;
    const thr = Thr.get(this.meta), out = this.out, key = out ? Object.keys(out.patients[reg0[0].pid].alerts_by_t).reduce((b, t) => Math.abs(+t - thr) < Math.abs(+b - thr) ? t : b) : null;
    const reg = reg0.map(c => { const o = out && out.patients[c.pid], l = this.loop && this.loop.by_patient[c.pid];
      return { ...c, alerts: o && key ? o.alerts_by_t[key] : c.alerts, low: o ? o.low_flags + o.lows : 0, hypo: o ? o.hypo_med : false, open: l ? l.open : 0 }; });
    const rows = reg.filter(c => !q || `${fullName(c)} ${c.city} ${c.pid}`.toLowerCase().includes(q));
    const by = { alerts: (a, b) => b.open - a.open || b.alerts - a.alerts || a.tir - b.tir, tir: (a, b) => a.tir - b.tir, a1c: (a, b) => b.hba1c - a.hba1c, low: (a, b) => b.low - a.low || b.hypo - a.hypo, name: (a, b) => fullName(a).localeCompare(fullName(b)) }[sort];
    rows.sort(by);
    $("#reg-count").textContent = `${rows.length} of ${reg.length}`;
    $("#rlist").innerHTML = rows.length ? rows.map(c => {
      const cls = c.alerts >= 35 ? "hi" : c.alerts >= 18 ? "mid" : "";
      return `<button class="rrow" role="listitem" data-pid="${c.pid}" aria-current="${c.pid === S.pid}">
        <span class="nm">${esc(fullName(c))}</span><span class="count ${cls}" title="Spike warnings this week">${c.alerts} warnings</span>
        <span class="mt">${c.age}${c.sex} · ${esc(c.city)} · ${c.condition}</span><span class="a1c num">A1c ${c.hba1c.toFixed(1)}%</span>
        ${c.open || (c.hypo && c.low) ? `<span class="rflags">${c.open ? `<span class="rf open">${c.open} open</span>` : ""}${c.hypo && c.low ? `<span class="rf low" title="On a sulfonylurea or insulin, with low-glucose risk this week">low risk</span>` : ""}</span>` : ""}
        <span class="tirbar" title="Time in range ${c.tir}%, above range ${c.tar}%"><i style="width:${c.tir}%;background:var(--ok)"></i><i style="width:${c.tar}%;background:var(--alert)"></i></span>
      </button>`; }).join("") : `<p class="empty">No patient matches “${esc(q)}”. Try a first name, a city or an ID such as GT-1102.</p>`;
  },

  // ---------------------------------------------------------------- open a case
  async open(pid) {
    S.pid = pid; curPid = pid; renderNav();
    $$(".rrow").forEach(b => b.setAttribute("aria-current", b.dataset.pid === pid));
    $("#case-head").innerHTML = `<div class="loading">Opening the case…</div>`;
    let P;
    try { P = await Data.getCase(pid); }
    catch { $("#case-head").innerHTML = `<div class="loading">We couldn't open ${esc(pid)}. Pick a patient from the register.</div>`; return; }
    if (S.pid !== pid) return;
    try { mergeLogs(P, await Data.logs(pid)); } catch { mergeLogs(P, []); }
    try { S.esc = await Data.escalations(pid); } catch { S.esc = []; }
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
    const e = P.ehr; $("#rx-who").textContent = fullName(P); $("#rx-fab span:last-child").textContent = `Advise / Prescribe to ${P.name}`; $("#rx-fab").setAttribute("aria-label", `Advise or prescribe to ${fullName(P)}`);
    const rx = [["on_metformin", "Metformin"], ["on_sulfonylurea", "Glimepiride"], ["on_dpp4", "Teneligliptin"], ["on_sglt2", "Dapagliflozin"], ["on_basal_insulin", "Glargine"]].filter(r => e[r[0]]).map(r => r[1]);
    const dx = [P.condition === "T2D" ? `Type 2 diabetes · ${e.diabetes_years} y` : "Prediabetes", e.hypertension && "Hypertension", e.dyslipidemia && "Dyslipidaemia", e.nafld && "Fatty liver"].filter(Boolean);
    $("#case-head").innerHTML = `<div><div class="pid">${P.pid} · synthetic</div><h2>${esc(fullName(P))}</h2><div class="who">${P.age} · ${P.sex === "F" ? "Female" : "Male"} · ${esc(P.city)} · ${e.vegetarian ? "Vegetarian" : "Non-vegetarian"} · BMI ${e.bmi}</div></div>
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
    const e = P.ehr, F = P.sex === "F", n1 = v => (Math.round(v * 10) / 10).toString();
    // [name, code, src, value, unit, target text, scale lo, hi, band a, b, ok, status]
    const bar = (lo, hi, a, b, v) => { const pc = x => Math.max(0, Math.min(100, (x - lo) / (hi - lo) * 100)); return [pc(a), pc(b), pc(v)]; };
    const bpHi = e.systolic_bp >= 130 || e.diastolic_bp >= 80;
    const bmiS = e.bmi < 18.5 ? "Underweight" : e.bmi < 23 ? "In range" : e.bmi < 25 ? "Overweight" : "Obese";
    const hdlT = F ? 50 : 40, waistT = F ? 80 : 90;
    const rows = [
      ["Blood pressure", "LOINC 8480-6 · 8462-4", "bp", `${e.systolic_bp}/${e.diastolic_bp}`, "mmHg", "target under 130/80", bar(90, 180, 90, 130, e.systolic_bp), !bpHi, bpHi ? "High" : "At target"],
      ["LDL cholesterol", "LOINC 13457-7", "lipids", e.ldl_mgdl, "mg/dL", "target under 100", bar(40, 200, 40, 100, e.ldl_mgdl), e.ldl_mgdl < 100, e.ldl_mgdl < 100 ? "At target" : "High"],
      ["HDL cholesterol", "LOINC 2085-9", "lipids", e.hdl_mgdl, "mg/dL", `target above ${hdlT} (${F ? "women" : "men"})`, bar(20, 80, hdlT, 80, e.hdl_mgdl), e.hdl_mgdl > hdlT, e.hdl_mgdl > hdlT ? "At target" : "Low"],
      ["Triglycerides", "LOINC 2571-8", "lipids", e.triglycerides_mgdl, "mg/dL", "target under 150", bar(50, 300, 50, 150, e.triglycerides_mgdl), e.triglycerides_mgdl < 150, e.triglycerides_mgdl < 150 ? "At target" : "High"],
      ["BMI", "LOINC 39156-5", "body", n1(e.bmi), "kg/m²", "Asian range 18.5–22.9", bar(16, 34, 18.5, 22.95, e.bmi), bmiS === "In range", bmiS],
      ["Waist", "LOINC 8280-0", "body", n1(e.waist_cm), "cm", `Indian ${F ? "women" : "men"} under ${waistT}`, bar(55, 125, 55, waistT, e.waist_cm), e.waist_cm < waistT, e.waist_cm < waistT ? "In range" : "High"],
      ["eGFR", "LOINC 33914-3", "kidney", Math.round(e.egfr), "mL/min", "normal 90 or above", bar(30, 130, 90, 130, e.egfr), e.egfr >= 90, e.egfr >= 90 ? "Normal" : e.egfr >= 60 ? "Mildly reduced" : "Reduced"],
      ["ALT", "LOINC 1742-6", "kidney", Math.round(e.alt_u_l), "U/L", "lab range up to 40", bar(0, 120, 0, 40, e.alt_u_l), e.alt_u_l <= 40, e.alt_u_l <= 40 ? "Normal" : "Raised"],
    ];
    const a1Ok = e.hba1c_pct < 7, fOk = e.fasting_glucose_mgdl >= 80 && e.fasting_glucose_mgdl <= 130;
    const gene = { CC: "CC · no risk allele", CT: "CT · one risk allele", TT: "TT · two risk alleles" }[e.tcf7l2_rs7903146] || e.tcf7l2_rs7903146;
    const conds = [e.hypertension && "Hypertension", e.dyslipidemia && "Dyslipidaemia", e.nafld && "Fatty liver (NAFLD)"].filter(Boolean).join(", ") || "None recorded";
    const pt = `<span class="rk-dot" aria-hidden="true"></span>`, tr = `<svg class="rk-tr" width="20" height="9" viewBox="0 0 22 10" aria-hidden="true"><path d="M1 7 L6 3 L11 6 L16 2 L21 4"/></svg>`;
    const code = (c, id) => `<button class="code" data-src="${id}" title="Where this comes from">${c}</button>`;
    $("#record").innerHTML = `
      <div class="rk-key"><span>${pt}Point in time · one reading in the record</span><span>${tr}Trend · this week's CGM, moves with the clock</span></div>
      <div class="rk-h"><h4>Glucose control</h4><span>The lab gives one number; the sensor shows the week</span></div>
      <div class="rk-pairs">
        <article class="rk-pair">
          <div class="rk-pt"><div class="rk-l">${pt}HbA1c · lab</div><div class="rk-big num">${e.hba1c_pct}<small> %</small></div>
            <div class="rk-s ${a1Ok ? "ok" : "off"}">${a1Ok ? "At target · under 7%" : "Above target · 7% or more"}</div>${code("LOINC 4548-4", "hba1c")}</div>
          <div class="rk-tw" id="rk-gmi"></div>
        </article>
        <article class="rk-pair">
          <div class="rk-pt"><div class="rk-l">${pt}Fasting glucose · lab</div><div class="rk-big num">${Math.round(e.fasting_glucose_mgdl)}<small> mg/dL</small></div>
            <div class="rk-s ${fOk ? "ok" : "off"}">${fOk ? "At target · 80–130" : e.fasting_glucose_mgdl > 130 ? "Above target · 80–130" : "Below target · 80–130"}</div>${code("LOINC 1558-6", "fpg")}</div>
          <div class="rk-tw" id="rk-wake"></div>
        </article>
      </div>
      <div class="rk-h"><h4>Last recorded values</h4><span>Point in time · green is the target range, the mark is this reading</span></div>
      <div class="rk-rows">${rows.map(([nm, c, id, v, u, t, [ba, bb, pv], ok, st]) => `<div class="rk-row">
        <div class="rk-n"><b>${nm}</b>${code(c, id)}</div>
        <div class="rk-bar"><div class="rk-track"><i class="rk-band" style="left:${ba}%;width:${bb - ba}%"></i><i class="rk-mark ${ok ? "ok" : "off"}" style="left:${pv}%"></i></div><span class="rk-t">${t}</span></div>
        <div class="rk-v"><span class="num">${v}<small> ${u}</small></span><span class="rk-s ${ok ? "ok" : "off"}">${st}</span></div></div>`).join("")}</div>
      <div class="rk-h"><h4>Background</h4><span>Rarely changes; it sets the twin's starting estimate</span></div>
      <dl class="rk-bg">
        <div><dt>Diagnosis</dt><dd>${P.condition === "T2D" ? `Type 2 diabetes · ${e.diabetes_years} y` : "Prediabetes"}</dd></div>
        <div><dt>Other conditions</dt><dd>${conds}</dd></div>
        <div><dt>Family history</dt><dd>${e.family_history_t2d ? "Type 2 diabetes" : "None recorded"} ${code("FamilyMemberHistory", "history")}</dd></div>
        <div><dt>TCF7L2 rs7903146</dt><dd>${gene} ${code("Genetic test", "gene")}</dd></div>
        <div><dt>Smoking · diet</dt><dd>${e.smoker ? "Smoker" : "Non-smoker"} · ${e.vegetarian ? "vegetarian" : "non-vegetarian"}</dd></div>
        <div><dt>Height · weight</dt><dd>${n1(e.height_cm)} cm · ${n1(e.weight_kg)} kg ${code("LOINC 8302-2 · 29463-7", "body")}</dd></div>
      </dl>`;
    this.renderRecTrend(P);
  },
  /* Trend half of the glucose pairs: GMI and waking (6–7 am) glucose from the CGM, up to the replay clock. */
  renderRecTrend(P) {
    if (!P || !$("#rk-gmi")) return;
    const k = S.day * 288 + S.slot * 3, e = P.ehr, mean = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    const gmiOf = m => m == null ? null : 3.31 + 0.02392 * m;
    const days = [], wake = [];
    for (let d = 0; d <= S.day; d++) {
      days.push(gmiOf(mean(P.cgm.slice(d * 288, Math.min(d * 288 + 288, k + 1)))));
      wake.push(k >= d * 288 + 84 ? mean(P.cgm.slice(d * 288 + 72, d * 288 + 84)) : null);
    }
    const gmi = gmiOf(mean(P.cgm.slice(0, k + 1)));
    const spark = (vals, span, label) => { const vv = vals.filter(v => v != null); if (!vv.length) return ""; const mid = (Math.max(...vv) + Math.min(...vv)) / 2, half = Math.max(span, Math.max(...vv) - Math.min(...vv)) / 2 * 1.15, lo = mid - half, hi = mid + half; const pts = vals.map((v, i) => v == null ? null : [i * 20, 26 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * 24]).filter(Boolean);
      if (!pts.length) return "";
      const last = pts[pts.length - 1];
      return `<svg class="rk-sp" width="140" height="30" viewBox="-3 -3 126 34" role="img" aria-label="${label}"><path d="M${pts.map(p => p.join(" ")).join(" L")}"/><circle cx="${last[0]}" cy="${last[1]}" r="3"/></svg>`; };
    const tr = `<svg class="rk-tr" width="20" height="9" viewBox="0 0 22 10" aria-hidden="true"><path d="M1 7 L6 3 L11 6 L16 2 L21 4"/></svg>`;
    const thru = `Mon–${DAYS[S.day]}`, d1 = gmi == null ? null : Math.round((gmi - e.hba1c_pct) * 10) / 10;
    $("#rk-gmi").innerHTML = gmi == null ? `<div class="rk-l">${tr}GMI · CGM</div><div class="rk-big num">–</div>` :
      `<div class="rk-l">${tr}GMI · CGM, ${thru}</div><div class="rk-big num">${gmi.toFixed(1)}<small> %</small></div>${spark(days, 0.6, `Daily GMI: ${days.map(v => v == null ? "no data" : v.toFixed(1)).join(", ")}`)}
       <div class="rk-s ${Math.abs(d1) < 0.5 ? "ok" : "off"}">${Math.abs(d1) < 0.5 ? "Agrees with the lab HbA1c" : d1 > 0 ? `${d1.toFixed(1)} above the lab: the sensor sees more than the HbA1c` : `${(-d1).toFixed(1)} below the lab HbA1c`}</div>`;
    const wv = wake.filter(v => v != null), wm = wv.length ? Math.round(mean(wv)) : null, above = wv.filter(v => v > 130).length;
    $("#rk-wake").innerHTML = wm == null ? `<div class="rk-l">${tr}Waking glucose · CGM 6–7 am</div><div class="rk-big num">–</div><div class="rk-s">No morning reading yet this week</div>` :
      `<div class="rk-l">${tr}Waking glucose · CGM 6–7 am</div><div class="rk-big num">${wm}<small> avg</small></div>${spark(wake, 30, `Waking glucose each day: ${wake.map(v => v == null ? "not yet" : Math.round(v)).join(", ")}`)}
       <div class="rk-s ${above ? "off" : "ok"}">${above ? `Above 130 on ${above} of ${wv.length} morning${wv.length > 1 ? "s" : ""}` : `In target on all ${wv.length} morning${wv.length > 1 ? "s" : ""}`}</div>`;
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
    Thr.apply(this.P(), Thr.get(this.meta));
    this.renderTrace(); this.renderWeek(); this.renderRisk(); this.renderTwin(); this.renderRx(); this.renderRecTrend(this.P());
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
    // low-glucose flags from the twin
    const lowS = this.out && this.out.patients[P.pid] ? this.out.patients[P.pid].low_starts : [];
    lowS.forEach(kk => { if (kk >= d0 && kk < d0 + 288 && kk <= this.kNow()) {
      const xx = x(kk - d0), v = P.cgm[kk] ?? 100;
      svg.append("path").attr("d", `M${xx} ${y(v) + 18} l5.5 -10 h-11z`).attr("fill", css("--low")).append("title").text(`Low-glucose warning at ${fmtT((kk - d0) * 5)}`);
    } });
    // meals
    const lane = M.t - 10;
    P.meals.filter(m => m.k >= d0 && m.k < d0 + 288).forEach(m => {
      const xx = x(m.k - d0), past = m.k <= this.kNow();
      svg.append("line").attr("x1", xx).attr("x2", xx).attr("y1", lane + 5).attr("y2", M.t + Hg).attr("stroke", css("--watch")).attr("stroke-opacity", past ? .35 : .15);
      const g = svg.append("g").attr("opacity", past ? 1 : .45);
      g.append("circle").attr("cx", xx).attr("cy", lane).attr("r", 4.2).attr("fill", m.app ? css("--sheet") : css("--watch")).attr("stroke", css("--watch")).attr("stroke-width", m.app ? 2 : 0);
      g.append("title").text(`${fmtT((m.k - d0) * 5)} ${m.meal} · ${m.carbs} g carbs · GI ${m.gi}${m.app ? " · logged in the patient app" : ""}`);
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
    const thr = Thr.get(this.meta), k = this.kNow(), cg = P.cgm[k];
    const pr = i >= 0 ? P.pred.prob[i] : null;
    const fc = this._fc && i >= 0 && this._fc.k === P.pred.k[i] ? this._fc.fc : null;
    const lo = lowRisk(P, i, k, fc);
    if (lo && lo.now) return { cls: "low", main: "Low now", sub: `${Math.round(cg)} mg/dL`, pr, cg, lo };
    if (cg != null && cg >= 180) return { cls: "watch", main: "Above range", sub: `now ${Math.round(cg)} mg/dL`, pr, cg };
    if (lo) return { cls: "low", main: "Low likely", sub: `dip to ${Math.round(lo.min)} · next 2 h`, pr, cg, lo };
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
    else if (s.cls === "low" && s.lo.now) line = `Glucose is <b>${Math.round(s.cg)} mg/dL</b>, below 70. Reach the patient now: 15 g of fast sugar, recheck in 15 minutes.`;
    else if (s.cls === "low") line = `The twin forecasts a dip to <b>${Math.round(s.lo.min)} mg/dL</b> around <b class="num">${fmtT(((P.pred.k[i] % 288) * 5 + 5 + s.lo.at * 5) % 1440)}</b>.`;
    else if (s.cg >= 180) line = `Glucose is already ${Math.round(s.cg)} mg/dL. Chaya forecasts spikes before they start, so the next forecast comes once it is back below 180.`;
    else line = `<b>${Math.round(s.pr * 100)}%</b> chance glucose goes above 180 mg/dL by <b class="num">${fmtT((S.slot * 15 + 120) % 1440)}</b>.`;
    $("#risk-line").innerHTML = line;
    const p2 = i >= 0 ? P.pred.p2h[i] : null;
    $("#p2h").innerHTML = p2 == null ? "–" : `${Math.round(p2)}<small> mg/dL</small>`;
    if (fc) { const pk = peakOf(fc), at = fc.indexOf(pk); $("#tpeak").innerHTML = `${Math.round(pk)}<small> at ${fmtT(((P.pred.k[i] % 288) * 5 + 5 + (at + 1) * 5) % 1440)}</small>`; }
    else $("#tpeak").textContent = "–";
    let why = i >= 0 ? P.pred.why[P.pred.k[i]] : null;
    if (s.cls === "low") why = this.lowReasons(P, s);
    const show = s.cls === "alert" || s.cls === "watch" || s.cls === "low";
    const fix = t => fc ? t.replace(/Twin projects a peak of \d+ mg\/dL/, `Twin projects a peak of ${Math.round(peakOf(fc))} mg/dL`) : t;
    $("#why").innerHTML = show && why && why.length ? why.map(([g, t]) => `<li><span class="g">${esc(g < 0 ? ["", "Low now", "Twin forecast", "Medication", "Meal gap", "Activity"][-g] : this.meta.groups[g])}</span><span>${esc(fix(t))}</span></li>`).join("")
      : `<li class="calm"><span class="g">Nothing pressing</span><span>${s.cls === "na" ? "Waiting for the sensor." : "No strong driver of a spike in the next two hours."}</span></li>`;
    $("#why").classList.toggle("lowwhy", s.cls === "low");
    this.renderEscalation(P, i, s);
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

  lowReasons(P, s) {
    const k = this.kNow(), e = P.ehr, out = [];
    if (s.lo.now) out.push([-1, `Glucose ${Math.round(s.cg)} mg/dL now, below 70`]);
    else out.push([-2, `Twin forecast dips to ${Math.round(s.lo.min)} mg/dL within 2 h`]);
    const drugs = [e.on_sulfonylurea && "glimepiride (a sulfonylurea)", e.on_basal_insulin && "basal insulin"].filter(Boolean);
    if (drugs.length) out.push([-3, `On ${drugs.join(" and ")}, which can push glucose low`]);
    const lastMeal = P.meals.filter(m => m.k <= k).reduce((a, m) => Math.max(a, m.k), -999);
    if (k - lastMeal > 48) out.push([-4, `No meal logged for ${Math.round((k - lastMeal) * 5 / 60)} h`]);
    const st = P.steps.slice(Math.max(0, k - 12), k + 1).reduce((a, b) => a + b, 0);
    if (st > 1500) out.push([-5, `${st.toLocaleString("en-IN")} steps in the last hour`]);
    return out.slice(0, 3);
  },

  // ---------------------------------------------------------------- escalation
  OWNERS: ["Care coordinator on duty", "Doctor on call", "Diabetes educator"],
  setupEscalation() {
    $("#esc-wrap").addEventListener("click", async e => {
      const b = e.target.closest("[data-esc]"); if (!b) return;
      const P = this.P(), act = b.dataset.esc, id = +b.dataset.id;
      try {
        if (act === "assign") {
          const st = JSON.parse(b.dataset.st);
          const row = await Data.addEscalation(S.pid, { k: st.k, kind: st.kind, owner: $("#esc-owner").value, due_k: st.k + (+$("#esc-due").value) });
          S.esc = [row, ...S.esc]; toast(`Assigned to ${row.owner}`);
        } else if (act === "wa") {
          const row = await Data.updateEscalation(S.pid, id, { channel: "whatsapp", status: "contacted", outcome: "WhatsApp message sent" });
          S.esc = S.esc.map(x => x.id === id ? row : x);
        } else if (act === "call") { $("#esc-out").hidden = false; return; }
        else if (act === "out") {
          const resolved = b.dataset.v === "resolved";
          const row = await Data.updateEscalation(S.pid, id, { channel: "call", status: resolved ? "resolved" : b.dataset.v === "noanswer" ? "open" : "contacted", outcome: b.textContent.trim() });
          S.esc = S.esc.map(x => x.id === id ? row : x); toast(resolved ? "Escalation resolved" : "Call logged");
        } else if (act === "resolve") {
          const row = await Data.updateEscalation(S.pid, id, { status: "resolved" }); S.esc = S.esc.map(x => x.id === id ? row : x); toast("Escalation resolved");
        }
        Data.outcomesLive().then(l => { this.loop = l; this.renderRegister(); }).catch(() => {});
        this.renderRisk();
      } catch (err) { toast(`Couldn't save that. ${err.message || "Try again."}`); }
    });
  },
  episodeKey(P, i, s) {
    if (s.cls === "low") { const ls = this.out && this.out.patients[P.pid] ? this.out.patients[P.pid].low_starts.filter(k => k <= this.kNow()) : []; return { kind: "low", k: ls.length && this.kNow() - ls[ls.length - 1] < 36 ? ls[ls.length - 1] : P.pred.k[i] }; }
    const ep = this.episodeStart(P, i); return ep == null ? null : { kind: "spike", k: ep };
  },
  waText(P, s) {
    const n = (S.notes || [])[0], t = fmtT((S.slot * 15 + (s.lo ? s.lo.at * 5 : 120)) % 1440);
    const body = s.cls === "low"
      ? `Your glucose may drop below 70 soon. Please have a small snack now and keep something sweet with you. If you feel shaky or sweaty, take 3 glucose tablets or half a glass of juice, check again in 15 minutes, and call us.`
      : `Chaya shows your glucose may go above 180 by ${t}. ${n ? `Your doctor's advice: ${n.summary}.` : "A 20-minute walk after eating will help."} Reply here or call us if you feel unwell.`;
    return `Namaste ${P.name} ji, this is your care team at the clinic. ${body} (Demo message: synthetic patient.)`;
  },
  renderEscalation(P, i, s) {
    const wrap = $("#esc-wrap");
    if (!(s.cls === "alert" || s.cls === "low") || i < 0) { wrap.innerHTML = ""; return; }
    const ek = this.episodeKey(P, i, s); if (!ek) { wrap.innerHTML = ""; return; }
    const row = (S.esc || []).find(x => x.kind === ek.kind && x.k === ek.k), now = this.kNow();
    const tm = k => `${DAYS[Math.floor(k / 288)]} ${fmtT((k % 288) * 5)}`;
    if (!row) {
      const fc = this._fc && this._fc.fc, cross = fc ? fc.findIndex(v => v > 180) : -1;
      const before = ek.kind === "spike" && cross > 0 ? Math.max(3, cross - 6) : 3;
      const opts = [[3, "15 min"], [6, "30 min"], [12, "1 h"]]; if (!opts.some(o => o[0] === before)) opts.unshift([before, `before ${ek.kind === "spike" ? "the spike" : "the dip"}`]);
      wrap.innerHTML = `<div class="esc"><div class="esc-h"><b>Who acts on this?</b><span>Nothing is assigned yet.</span></div>
        <div class="esc-form"><label>Owner<select id="esc-owner">${this.OWNERS.map((o, j) => `<option${(ek.kind === "low" ? 1 : 0) === j ? " selected" : ""}>${o}</option>`).join("")}</select></label>
        <label>Contact within<select id="esc-due">${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label></div>
        <button class="btn btn-primary btn-sm" data-esc="assign" data-st='${JSON.stringify(ek)}'>Assign and start the clock</button></div>`;
      return;
    }
    const due = row.due_k, left = (due - now) * 5, overdue = row.status === "open" && left < 0;
    const stTxt = { open: overdue ? `Overdue by ${-left} min · moves to Doctor on call` : `Due ${tm(due)} · ${left} min left`, contacted: "Patient contacted", resolved: "Resolved" }[row.status];
    const wa = `https://wa.me/?text=${encodeURIComponent(this.waText(P, s))}`;
    wrap.innerHTML = `<div class="esc ${row.status}${overdue ? " overdue" : ""}"><div class="esc-h"><b>${esc(row.owner)}</b><span class="esc-st">${stTxt}</span></div>
      ${row.outcome ? `<p class="esc-o">${esc(row.outcome)}${row.channel ? ` · ${row.channel === "whatsapp" ? "WhatsApp" : row.channel === "call" ? "call" : "app"}` : ""}</p>` : ""}
      ${row.status === "resolved" ? "" : `<div class="esc-acts"><a class="btn btn-quiet btn-sm" href="${wa}" target="_blank" rel="noopener" data-esc="wa" data-id="${row.id}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 10c.5 2 2 3.5 4 4l1.2-1.2 2 1-.6 1.6c-3.4.2-7-3.4-6.8-6.8L10.4 8l1 2z"/></svg>WhatsApp</a>
        <button class="btn btn-quiet btn-sm" data-esc="call" data-id="${row.id}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>Log a call</button>
        ${row.status === "contacted" ? `<button class="btn btn-quiet btn-sm" data-esc="resolve" data-id="${row.id}">Mark resolved</button>` : ""}</div>
        <div class="esc-out" id="esc-out" hidden>${[["reached", "Reached, advice given"], ["noanswer", "No answer, will retry"], ["resolved", "Reached, resolved"]].map(([v, l]) => `<button class="chip" data-esc="out" data-v="${v}" data-id="${row.id}">${l}</button>`).join("")}</div>`}</div>`;
  },

  // ---------------------------------------------------------------- alert threshold
  setupThreshold() {
    const btn = $("#thr-btn"), pop = $("#thr-pop");
    const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
    btn.addEventListener("click", e => { e.stopPropagation(); const open = pop.hidden; pop.hidden = !open; btn.setAttribute("aria-expanded", open); if (open) this.renderThreshold(); });
    document.addEventListener("click", e => { if (!e.target.closest("#thr-menu")) close(); });
    pop.addEventListener("keydown", e => { if (e.key === "Escape") { close(); btn.focus(); } });
    pop.addEventListener("input", e => { if (e.target.id === "thr-range") this.setThreshold(this.out.curve[+e.target.value].t); });
    pop.addEventListener("click", e => { const b = e.target.closest("[data-thr]"); if (b) this.setThreshold(b.dataset.thr === "default" ? null : +b.dataset.thr); });
    this.labelThreshold();
  },
  setThreshold(v) {
    if (v == null) { try { localStorage.removeItem("chaya.threshold"); } catch { /* storage unavailable */ } } else Thr.set(v);
    Data.cases.forEach(P => Thr.apply(P, Thr.get(this.meta)));
    this.labelThreshold(); this.renderThreshold(); this.renderRegister(); if (S.pid) this.renderTime();
  },
  curveAt(t) { const c = this.out.curve; return c.reduce((b, p) => Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b, c[0]); },
  labelThreshold() {
    if (!this.out) { $("#thr-btn").hidden = true; return; }
    const t = Thr.get(this.meta), p = this.curveAt(t), d = this.meta.threshold;
    const name = Math.abs(t - d) < .02 ? "Balanced" : t < d ? "Catch more" : "Fewer alerts";
    $("#thr-t").textContent = `${name} · ${p.alerts_per_patient_day.toFixed(1)}/day`;
  },
  renderThreshold() {
    if (!this.out || $("#thr-pop").hidden) return;
    const c = this.out.curve, t = Thr.get(this.meta), p = this.curveAt(t), j = c.indexOf(p), d = this.meta.threshold;
    const W = 300, H = 132, M = { l: 34, r: 8, t: 10, b: 24 };
    const x = d3.scaleLinear([2.4, 4.7], [M.l, W - M.r]), y = d3.scaleLinear([.7, 1], [H - M.b, M.t]);
    const path = d3.line().x(q => x(q.alerts_per_patient_day)).y(q => y(q.onsets_warned)).curve(d3.curveMonotoneX)([...c].sort((a, b) => a.alerts_per_patient_day - b.alerts_per_patient_day));
    $("#thr-body").innerHTML = `<p class="thr-lead">Set how readily Chaya warns about spikes. Lower means more warnings and fewer missed spikes. Applies to every patient in this browser.</p>
      <div class="thr-now"><div><b class="num">${p.alerts_per_patient_day.toFixed(1)}</b><span>warnings per patient a day</span></div><div><b class="num">${Math.round(p.onsets_warned * 100)}%</b><span>of spikes warned within 2 h</span></div></div>
      <svg viewBox="0 0 ${W} ${H}" class="thr-svg" role="img" aria-label="Trade-off between warnings per day and spikes caught">
        ${[.7, .8, .9, 1].map(v => `<line x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--edge)"/><text x="${M.l - 5}" y="${y(v) + 3}" text-anchor="end">${v * 100}%</text>`).join("")}
        ${[2.5, 3, 3.5, 4, 4.5].map(v => `<text x="${x(v)}" y="${H - 8}" text-anchor="middle">${v}</text>`).join("")}
        <path d="${path}" fill="none" stroke="var(--ink-3)" stroke-width="1.6"/>
        <circle cx="${x(this.curveAt(d).alerts_per_patient_day)}" cy="${y(this.curveAt(d).onsets_warned)}" r="3.5" fill="var(--sheet)" stroke="var(--ink-3)" stroke-width="1.5"><title>Model default</title></circle>
        <circle cx="${x(p.alerts_per_patient_day)}" cy="${y(p.onsets_warned)}" r="6" fill="var(--shadow)" stroke="var(--sheet)" stroke-width="2"/>
      </svg>
      <div class="thr-axis"><span>fewer warnings</span><span>warnings per patient a day →</span></div>
      <label class="thr-range"><span>Threshold <b class="num">${Math.round(t * 100)}%</b> chance of a spike</span><input id="thr-range" type="range" min="0" max="${c.length - 1}" step="1" value="${j}" aria-valuetext="${Math.round(t * 100)} percent"></label>
      <div class="seg thr-pre">${[[c.find(q => q.t === .25).t, "Catch more"], ["default", "Balanced"], [c.find(q => q.t === .85).t, "Fewer alerts"]].map(([v, l]) => `<button data-thr="${v}" aria-pressed="${v === "default" ? Math.abs(t - d) < .02 : Math.abs(t - v) < .001}">${l}</button>`).join("")}</div>
      <p class="thr-f">From the 45 held-out synthetic patients (scripts/build_outcomes.js). Low-glucose warnings come from the twin and are not affected.</p>`;
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
  openRx() { const d = $("#rxpad"); d.hidden = false; d.classList.remove("min"); $("#rx-fab").hidden = true; $("#rx-fab").setAttribute("aria-expanded", "true"); this.renderRx(); },
  closeRx() { $("#rxpad").hidden = true; $("#rx-fab").hidden = false; $("#rx-fab").setAttribute("aria-expanded", "false"); },
  setupRx() {
    $("#rx-fab").addEventListener("click", () => { this.openRx(); setTimeout(() => $("#w-meal").focus({ preventScroll: true }), 50); });
    $("#rx-close").addEventListener("click", () => { this.closeRx(); $("#rx-fab").focus(); });
    $("#rx-min").addEventListener("click", e => { e.stopPropagation(); $("#rxpad").classList.toggle("min"); });
    $("#rxpad .rxd-h").addEventListener("click", e => { if (e.target === e.currentTarget || e.target.id === "h-rx" || e.target.closest("#h-rx")) { if ($("#rxpad").classList.contains("min")) $("#rxpad").classList.remove("min"); } });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#rxpad").hidden && !views.clinic.hidden && !Tour.steps) this.closeRx(); });
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
    try { await Data.addNote(S.pid, body, { peak: Math.round(peakOf(r.scen)), above: above(r.scen) }); await this.loadNotes(); $("#notes-fold").open = true; toast(`Saved and sent to ${P.name}'s app${Data.live ? "" : " (kept in this browser)"}`, { label: `Open ${P.name}'s advice`, href: `#/patient/${P.pid}?tab=advice` }); }
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
  ["low", "Low likely / Low now", "Low now: glucose is under 70 mg/dL. Low likely: the patient's twin forecasts a dip below 80 mg/dL within two hours. Shown in deep blue with a downward triangle. On the held-out synthetic week the twin warned of 7 of 10 lows, a median 80 minutes early. Matters most for patients on a sulfonylurea (glimepiride) or insulin.", "Next 2 hours"],
  ["escalation", "Escalation", "Every spike or low warning can be given an owner and a deadline. The owner messages the patient on WhatsApp or logs a call; if it is still open after the deadline it is marked overdue and moves to the doctor on call. Stored in the clinic database.", "Next 2 hours"],
  ["threshold", "Alert threshold", "How high the model's spike probability must be before Chaya warns. Lower catches more spikes but sends more warnings. The Alerts control shows the trade-off measured on the 45 held-out patients. Saved in this browser.", "Top bar"],
  ["outcomes", "Clinic outcomes", "The panel's week: time in range per patient and per day, low-glucose safety, alert load, and how warnings turned into reviews, escalations, advice and patient acknowledgements.", "Outcomes"],
  ["papp", "Patient app", "What the patient sees on their phone: current glucose from their sensor with the next two hours as a violet shadow, the advice their doctor saved on the Rx pad, their week, and the devices sending data. No risk scores or twin parameters.", "Patient app"],
  ["sources", "Data sources", "Every parameter is tagged with where it comes from: the wearables (CGM, smartwatch), the patient's own logs (meals, doses), the health record (FHIR, with LOINC and SNOMED codes), or Chaya's own calculations. Open Guide → Where the data comes from, or any Sources button.", "Everywhere"],
  ["live", "Live or offline", "Live means the clinic is served by the Chaya API on Vercel and its PostgreSQL database on Supabase. Offline demo means the API is not reachable here, so the same data runs from files bundled with the page.", "Top bar"],
];
/* Info buttons explain themselves in a tooltip on hover or focus (tap on touch); the full glossary stays in Guide. */
const Tip = {
  el: null, cur: null,
  init() {
    this.el = $("#tip");
    document.querySelectorAll(".info").forEach(b => b.removeAttribute("title"));
    document.addEventListener("mouseover", e => { const b = e.target.closest(".info"); if (b && b !== this.cur) this.show(b); else if (!b && this.cur && !this.pinned) this.hide(); });
    document.addEventListener("focusin", e => { const b = e.target.closest(".info"); if (b) this.show(b); });
    document.addEventListener("focusout", e => { if (e.target.closest(".info")) this.hide(); });
    document.addEventListener("click", e => {
      const b = e.target.closest(".info");
      if (b) { e.preventDefault(); if (this.cur === b && this.pinned) this.hide(); else { this.show(b); this.pinned = true; } return; }
      if (this.pinned) this.hide();
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && this.cur) this.hide(); });
    window.addEventListener("scroll", () => { if (this.cur) this.place(); }, { passive: true, capture: true });
  },
  show(b) {
    const t = TERMS.find(x => x[0] === b.dataset.term); if (!t) return;
    this.cur = b; this.pinned = false;
    this.el.innerHTML = `<b>${t[1]}</b><span>${t[2]}</span>`;
    this.el.hidden = false; b.setAttribute("aria-describedby", "tip"); this.place();
    requestAnimationFrame(() => this.el.classList.add("on"));
  },
  hide() { if (this.cur) this.cur.removeAttribute("aria-describedby"); this.cur = null; this.pinned = false; this.el.classList.remove("on"); this.el.hidden = true; },
  place() {
    const b = this.cur; if (!b || !b.isConnected) return this.hide();
    const r = b.getBoundingClientRect(), w = this.el.offsetWidth, h = this.el.offsetHeight, vw = innerWidth, gap = 10;
    let x = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), vw - w - 12), y = r.bottom + gap, below = true;
    if (y + h > innerHeight - 12) { y = r.top - gap - h; below = false; }
    this.el.style.left = `${x}px`; this.el.style.top = `${Math.max(8, y)}px`;
    this.el.dataset.side = below ? "below" : "above";
    this.el.style.setProperty("--ax", `${r.left + r.width / 2 - x}px`);
  },
};
const Glossary = {
  init() {
    $("#gloss-list").innerHTML = TERMS.map(([id, t, d, w]) => `<div class="term" id="term-${id}"><dt>${t}${w ? `<span class="where">${w}</span>` : ""}</dt><dd>${d}</dd></div>`).join("");
    $("#gloss-close").addEventListener("click", () => this.close());
    $("#scrim").addEventListener("click", () => this.close());
    Tip.init();
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
    if (steps.view === "patient") {
      if (!location.hash.startsWith("#/patient")) location.hash = `#/patient/${curPid}`;
      for (let t = 0; t < 100 && !(Patient.P && !views.patient.hidden); t++) await new Promise(r => setTimeout(r, 100));
    } else {
      Patient.closeSheet && Patient.sheet && Patient.closeSheet(true);
      if (!location.hash.startsWith("#/clinic")) { location.hash = "#/clinic"; }
      for (let t = 0; t < 100 && !(Clinic.P() && !views.clinic.hidden); t++) await new Promise(r => setTimeout(r, 100));
    }
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
const setPCase = async (pid, day, slot, tab) => {
  if (Patient.sheet) Patient.closeSheet(true);
  if (Patient.pid !== pid) { history.replaceState(null, "", `#/patient/${pid}`); await Patient.init(pid); }
  S.day = day; S.slot = slot; Patient.tab = tab || "today"; Patient.render(); $("#pscreen").scrollTop = 0;
};
const catIdx = n => Clinic.meta.meal_catalog.findIndex(m => m.meal === n);
const runNow = () => ({ pk: Math.round(peakOf(Clinic.lastRun.scen)), ab: above(Clinic.lastRun.scen) });

const TOUR = Object.assign([
  { sel: "#register", title: "Start with the register", body: "Your patients, ranked by how many times Chaya warned about a spike this week. The bar under each name shows <b>time in range</b> in green and <b>time above 180</b> in red. Click a name to open the case.",
    before: () => { Clinic.closeRx(); return setCase("GT-1102", 6, 51, { meal: -1, walk: 0, metTouched: false, sleepTouched: false }); } },
  { sel: "#clockbar", title: "Move the clock", body: "This is a replay of one synthetic week. Pick a day, drag <b>Now</b>, or press Replay. Every panel shows only what Chaya knew at that moment.", block: "start" },
  { sel: "#case-head", title: "The case sheet", body: "Who the patient is, their diagnoses and medicines, then this week's numbers: time in range, GMI against the lab HbA1c, variability and the count of spike warnings." },
  { sel: "#trace", title: "Read the day trace", body: "Black ink is glucose so far. <b>Violet dashes are Chaya's forecast</b> for the next two hours. Grey is what actually happened next. Below: meals, steps and sleep." },
  { sel: "#risk", title: "The stamp on the slip", body: () => { const P = Clinic.P(), s = Clinic.status(P, Clinic.idx(P)); return `Right now Sanjay's slip reads <b>${s.main}</b> (${s.sub}). Stamps go from In range to Watch to Spike likely, so the urgent case is visible at a glance.`; } },
  { sel: "#why-wrap", title: "Every warning has reasons", body: "The three biggest drivers behind the score, in plain words: a meal just logged, the twin's projected peak, low activity, short sleep, a missed dose." },
  { sel: "#twin", title: "The patient's twin", body: "Chaya tuned these numbers to Sanjay on his first seven days. The violet mark is the twin; the grey tick is what the health record alone suggested. The gap is why a personal twin matters." },
  { sel: "#rxpad", title: "Try advice before you give it", body: "The ℞ Advise / Prescribe button at the bottom right opens the Rx pad, like composing an email. Pick a meal, a walk, last night's sleep or a missed metformin dose; the twin redraws the next four hours for this body. Save and send it to the patient's app.", before: () => Clinic.openRx() },
  { sel: "#help-menu", title: "Help is always here", body: "Reopen this tour, walk through Sanjay's case, see <b>where the data comes from</b>, or open <b>What's what</b> for every term. The <b>i</b> buttons explain a panel; <b>Sources</b> buttons show where its numbers come from." },
], { label: "Product tour", doneLabel: "Start exploring" });

const PTOUR = Object.assign([
  { sel: "#phone", title: "The patient's side of the same twin", body: () => `This is what ${esc(Patient.P.name)} sees on his phone. Same data, same forecast as the clinic, written for him instead of for a doctor. Nothing here asks him to read a chart.`,
    before: () => setPCase("GT-1102", 6, 51, "today") },
  { sel: ".pc-now", title: "His reading, with the carbon copy", body: "The big number is his glucose now and which way it is heading. The violet line under it is Chaya's two-hour forecast, the same violet the clinic uses." },
  { sel: ".pc-alert", title: "A warning he can act on", body: "When a spike is likely, the app says so in one plain sentence with the expected peak and time. For a low, it moves to the very top and lists what to do: take sugar now, recheck in 15 minutes, call if it does not lift." },
  { sel: ".pm-list", title: "Dose reminders", body: "Chaya learns his usual dose times from the week. Each dose shows as taken, due, missed or later. He can tap Taken or Snooze, and the clinic sees it." },
  { sel: "#ptabs", title: "Log a meal in two taps", body: "The raised button logs a meal or a dose: pick the dish from Indian thalis and snacks, choose when, add a photo if he likes. The meal lands on the clinic trace, marked as logged in the app.", block: "end" },
  { sel: ".pc-body", title: "Advice from his doctor", body: "Everything the doctor saves from the Rx pad arrives here, with the before-and-after peak the twin worked out. He marks it as read, and the clinic sees when he did.",
    before: () => Patient.go("advice") },
  { sel: ".pc-body", title: "His week, in plain words", body: "This week's time in range against his 70% goal, day by day, with how many warnings he had and his meals, doses, sleep and steps. Plain words, so he can see progress for himself.",
    before: () => Patient.go("week") },
  { sel: ".pc-body", title: "Where each number comes from", body: "My data lists every device and record feeding the twin: the CGM, his phone's steps, sleep, meals and the clinic's records. He can see what is shared.",
    before: () => Patient.go("data") },
  { sel: ".pc-lang", title: "English or Hindi", body: "One tap switches the whole app to Hindi. Medicine names stay in English, as they are on the strip.",
    before: () => Patient.go("today") },
  { sel: ".pc-alert", title: "What a low looks like", body: () => `Here is ${esc(Patient.P.name)}, on a sulfonylurea and basal insulin. Chaya expects her to dip below 70, so the low card leads the screen, ahead of everything else.`,
    before: () => setPCase("GT-1018", 0, 37, "today") },
  { sel: ".pside-ctl", title: "Replay any moment", body: "Pick a patient, a day and a time. The phone shows exactly what it would have shown then. Back to the clinic is one tap away, in the header or below.", block: "center" },
], { label: "Patient app tour", view: "patient", doneLabel: "Done" });

const CASE = Object.assign([
  { sel: "#case-head", title: "Sunday, 12:15. Sanjay is about to eat lunch.", body: "He is 53, has had Type 2 diabetes for about four years and takes metformin and glimepiride. His glucose is calm and in range.",
    before: () => { Clinic.closeRx(); return setCase("GT-1102", 6, 49, { meal: -1, walk: 0, metTouched: false, sleepTouched: false }); } },
  { sel: "#twin", title: "His twin has learned his body", body: "Over his first seven days Chaya found his insulin sensitivity is low for this group, lower than his health record suggested. That is why lunch hits him hard." },
  { sel: "#rx-result", title: "If he eats chicken biryani…", body: () => { const r = runNow(); return `…his twin projects a peak of <b>${r.pk} mg/dL</b>, with <b>${r.ab} minutes</b> above 180.`; },
    before: () => { Clinic.openRx(); S.wi.meal = catIdx("Chicken biryani"); S.wi.walk = 0; S.wi.when = 15; Clinic.renderRx(); } },
  { sel: "#rx-result", title: "Swap the rice for ragi mudde", body: () => { const r = runNow(); return `Same lunch slot, lower-GI millet. The peak drops to <b>${r.pk} mg/dL</b>, ${r.ab} minutes above 180.`; },
    before: () => { Clinic.openRx(); S.wi.meal = catIdx("Millet (ragi) mudde + saaru"); S.wi.walk = 0; Clinic.renderRx(); } },
  { sel: "#rx-result", title: "Add a 20-minute walk after lunch", body: () => { const r = runNow(); return `Now the peak is <b>${r.pk} mg/dL</b> and he spends <b>${r.ab} minutes</b> above 180. That is advice he can follow, with a number attached.`; },
    before: () => { Clinic.openRx(); S.wi.walk = 20; Clinic.renderRx(); } },
  { sel: "#risk", title: "What actually happened at 12:45", body: () => { const P = Clinic.P(), s = Clinic.status(P, Clinic.idx(P)); let m = null; for (let k = Clinic.kNow(); k < Clinic.kNow() + 36; k++) if (P.cgm[k] != null && P.cgm[k] > 180) { m = (k - Clinic.kNow()) * 5; break; }
      return `He logged an 81 g lunch. Chaya stamped <b>${s.main}</b> (${s.sub}) and listed why${m ? `, <b>${m} minutes</b> before his glucose actually crossed 180` : ""}. This is the warning a care coordinator would see, with time to call.`; },
    before: () => { Clinic.closeRx(); return setCase("GT-1102", 6, 51, { meal: -1, walk: 20 }); } },
  { sel: "#trace", title: "The forecast against reality", body: "Violet dashes are what Chaya expected; the grey line is what happened. Press Replay any time to watch the afternoon unfold." },
  { sel: "#save-note", before: () => Clinic.openRx(), title: "Put the advice on file", body: () => `Save it to his case notes. ${Data.live ? "It is stored in the database" : "In this offline demo it is kept in your browser"} with the twin's projection, so the next consult starts from it.` },
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
    ({ tour: () => Tour.start(TOUR), case: () => Tour.start(CASE), ptour: () => Tour.start(PTOUR), glossary: () => Glossary.open(), sources: () => Sources.open(views.clinic.hidden ? (views.patient.hidden ? null : Patient.pid) : S.pid) })[b.dataset.help]();
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
    proto: "Drawn from a library of 38 Indian dishes with carbs and GI. Patients log only 45–98% of meals and under-estimate carbs. data/wearables/meal_log.csv, plus meals logged in the patient app (Supabase table patient_logs).",
    real: "Logged in the patient app by searching a dish or taking a photo; carbs from India's food composition tables (NIN, IFCT 2017), GI from published tables.", std: "FHIR NutritionIntake", every: "Each meal" },
  { id: "unlogged", s: "calc", name: "Meals nobody logged", unit: "g carbs", use: "Violet rings on the trace; the Unlogged meal reason.",
    proto: "The twin compares glucose with what was logged; a rise it cannot explain is estimated as a hidden meal.",
    real: "Same method, on real sensor data.", std: "Derived", every: "Every 5 min" },
  { id: "meds", s: "log", name: "Medicine doses", unit: "dose taken", use: "Missed metformin raises the twin's resting glucose; the Medication reason; Rx pad default.",
    proto: "Prescribed doses, with misses simulated from each patient's adherence. data/wearables/medication_log.csv, plus doses marked in the patient app's reminders (patient_logs).",
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
  { id: "low", s: "calc", name: "Low-glucose risk", unit: "mg/dL", use: "Low likely / Low now stamp, blue triangles on the trace, the patient's low-glucose alert.",
    proto: "Low now when CGM is under 70. Low likely when the twin's 2-hour forecast dips below 80 while glucose is still 70 or more. Held-out week: 7 of 10 lows warned, median 80 min early. scripts/build_outcomes.js.", real: "Same, validated on real CGM from patients on sulfonylureas or insulin before use.", std: "Derived", every: "Every 15 min" },
  { id: "escalations", s: "calc", name: "Escalations", unit: "", use: "Owner, deadline and outcome for each warning; Outcomes funnel.", proto: "Created in the clinic and stored in the Supabase table escalations (owner, due time, status, channel, outcome).", real: "Same, tied to the clinic's staff roster and WhatsApp Business account.", std: "FHIR Task / Communication", every: "When staff act" },
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
/* ---------------- patient app: words in English and Hindi ---------------- */
const PT = {
  en: {
    morning: "Good morning", afternoon: "Good afternoon", evening: "Good evening", synthetic: "Synthetic demo",
    tToday: "Today", tAdvice: "Advice", tLog: "Log", tWeek: "Week", tData: "My data",
    inRange: "In range", above: "Above range", below: "Below range", noRead: "No reading",
    tr: { upfast: "rising fast", up: "rising", flat: "steady", down: "falling", downfast: "falling fast" },
    fromSensor: n => n == null ? "Sensor gap" : n ? `From your sensor · ${n} min ago` : "From your sensor · just now",
    legYou: "Your glucose", legChaya: "Chaya's forecast", legTarget: "Target 70–180",
    expect: (v, t) => `Chaya expects about <b>${v}</b> around ${t}.`, steady: "Looking steady for the next 2 hours.",
    lowNowH: "Your glucose is low", lowNow1: "Have 15 g of fast sugar: 3 glucose tablets, half a glass of juice, or 1 tablespoon of sugar in water.",
    lowNow2: "Rest, then check again in 15 minutes.", lowNow3: "If it is still under 70, repeat once and call your care team.", lowNowB: "I've had 15 g of sugar",
    lowSoonH: "Your glucose may go low in the next 2 hours", lowSoon: "Don't skip your next meal, and keep something sweet with you. Your care team can see this too.",
    spikeH: "Your glucose may go above 180", spike: (v, t) => `Chaya expects about ${v} around ${t}. A 15-minute walk after eating usually helps. Your care team can see this too.`,
    highH: "Your glucose is above 180", high: "A short walk helps bring it down. Drink some water.",
    fromDoc: "From your doctor", allAdvice: "See all advice",
    meds: "Medicines today", tlTaken: "Dose taken", taken: t => `Taken ${t}`, due: "Due now", missed: "Missed", later: t => `At ${t}`, snoozed: t => `Reminder at ${t}`,
    bTaken: "Taken", bSnooze: "Remind me in 30 min", bTook: "I took it",
    today: "Today so far", nothing: "Nothing logged yet today.", logMeal: "Log a meal", inApp: "logged in the app",
    fRange: "In range today", fSteps: "Steps", fSleep: "Sleep last night", goal: "goal 70%+", watch: "from your watch", bed: t => `bed ${t}`,
    weekH: p => `${p}% of this week in range`, weekGoal: "Your goal is 70% or more.", byDay: "Time in range, day by day",
    avg: "Average glucose", a1c: "Estimated A1c", lastLab: v => `last lab ${v}%`, warns: "Warnings this week", warnsS: "also sent to your care team",
    sleepSteps: "Sleep and steps", hSleep: "h sleep", steps: "steps",
    careTeam: "From your care team", should: "What it should do", peakVs: (a, b) => `Peak about <b>${a}</b> instead of ${b} mg/dL`,
    minAbove: n => n ? `${n} min above 180` : "Stays under 180", gotIt: "Got it", seen: "Seen",
    noAdvice: "No advice yet", noAdviceB: "When your doctor writes advice on the Rx pad, it arrives here with what it should do for your glucose.",
    adviceFoot: "Advice is written by your doctor and projected by your twin. Talk to your doctor before changing any medicine.",
    dataIntro: "Chaya combines these into your twin. Tap one to see exactly what it sends and why.",
    dCgm: "Glucose sensor (CGM)", dCgmS: "Reads every 5 minutes", dWatch: "Smartwatch", dWatchS: "Steps, heart rate, sleep and HRV",
    dMeal: "Meal log", dMealS: "What you log here", dMed: "Medicine log", dMedS: "Doses you mark as taken", dEhr: "Health record", dEhrS: "Linked to your ABHA number",
    last: t => `last ${t}`, cover: p => `${p}% of the week covered`, nights: n => `${n} nights recorded`, mealsN: n => `${n} meals logged`, dosesN: n => `${n} doses`,
    dataFoot: "Everything in this demo is synthetic. In the full app, you choose what to share and can withdraw consent at any time through ABDM.",
    sheetH: "Log", meal: "Meal", medicine: "Medicine", when: "When", now: "Now", ago: n => n >= 60 ? `${n / 60} h ago` : `${n} min ago`,
    photo: "Add a photo", photoOn: "Photo added", search: "Search 38 dishes", usual: "You often have", will: "What this meal will do",
    peakAt: (v, t) => `Peak about <b>${v}</b> around ${t}`, withWalk: v => `With a 15-minute walk after: <b>${v}</b>`, save: "Log this meal",
    pick: "Pick a dish to see what it will do.", doseH: "Mark a dose as taken", takenNow: "Taken now", saved: "Logged. Your twin has it.", carbs: "g carbs",
    close: "Close",
  },
  hi: {
    morning: "सुप्रभात", afternoon: "नमस्ते", evening: "शुभ संध्या", synthetic: "सिंथेटिक डेमो",
    tToday: "आज", tAdvice: "सलाह", tLog: "दर्ज करें", tWeek: "हफ़्ता", tData: "मेरा डेटा",
    inRange: "सीमा में", above: "सीमा से ऊपर", below: "सीमा से नीचे", noRead: "रीडिंग नहीं",
    tr: { upfast: "तेज़ी से बढ़ रहा", up: "बढ़ रहा", flat: "स्थिर", down: "घट रहा", downfast: "तेज़ी से घट रहा" },
    fromSensor: n => n == null ? "सेंसर से रीडिंग नहीं" : n ? `आपके सेंसर से · ${n} मिनट पहले` : "आपके सेंसर से · अभी",
    legYou: "आपका ग्लूकोज़", legChaya: "छाया का अनुमान", legTarget: "लक्ष्य 70–180",
    expect: (v, t) => `छाया का अनुमान: ${t} के आसपास लगभग <b>${v}</b>।`, steady: "अगले 2 घंटे स्थिर दिख रहे हैं।",
    lowNowH: "आपका ग्लूकोज़ कम है", lowNow1: "15 ग्राम जल्दी असर करने वाली चीनी लें: 3 ग्लूकोज़ की गोलियाँ, आधा गिलास जूस, या पानी में 1 बड़ा चम्मच चीनी।",
    lowNow2: "आराम करें, फिर 15 मिनट बाद दोबारा जाँचें।", lowNow3: "अगर तब भी 70 से कम हो, तो एक बार और लें और अपनी केयर टीम को फ़ोन करें।", lowNowB: "मैंने 15 ग्राम चीनी ले ली",
    lowSoonH: "अगले 2 घंटों में आपका ग्लूकोज़ कम हो सकता है", lowSoon: "अगला खाना न छोड़ें और कुछ मीठा साथ रखें। आपकी केयर टीम भी यह देख सकती है।",
    spikeH: "आपका ग्लूकोज़ 180 से ऊपर जा सकता है", spike: (v, t) => `छाया का अनुमान: ${t} के आसपास लगभग ${v}। खाने के बाद 15 मिनट टहलना आम तौर पर मदद करता है। आपकी केयर टीम भी यह देख सकती है।`,
    highH: "आपका ग्लूकोज़ 180 से ऊपर है", high: "थोड़ी देर टहलने से यह कम होता है। थोड़ा पानी पिएँ।",
    fromDoc: "आपके डॉक्टर की सलाह", allAdvice: "सारी सलाह देखें",
    meds: "आज की दवाइयाँ", tlTaken: "खुराक ली", taken: t => `${t} पर ली`, due: "अभी लेनी है", missed: "छूट गई", later: t => `${t} पर`, snoozed: t => `${t} पर याद दिलाएँगे`,
    bTaken: "ले ली", bSnooze: "30 मिनट बाद याद दिलाएँ", bTook: "मैंने ले ली थी",
    today: "आज अब तक", nothing: "आज अभी तक कुछ दर्ज नहीं किया।", logMeal: "खाना दर्ज करें", inApp: "ऐप में दर्ज",
    fRange: "आज सीमा में", fSteps: "कदम", fSleep: "कल रात की नींद", goal: "लक्ष्य 70%+", watch: "आपकी घड़ी से", bed: t => `सोए ${t}`,
    weekH: p => `इस हफ़्ते ${p}% समय सीमा में`, weekGoal: "आपका लक्ष्य 70% या उससे ज़्यादा है।", byDay: "हर दिन सीमा में समय",
    avg: "औसत ग्लूकोज़", a1c: "अनुमानित A1c", lastLab: v => `पिछली लैब ${v}%`, warns: "इस हफ़्ते की चेतावनियाँ", warnsS: "आपकी केयर टीम को भी भेजी गईं",
    sleepSteps: "नींद और कदम", hSleep: "घंटे नींद", steps: "कदम",
    careTeam: "आपकी केयर टीम से", should: "इससे क्या होगा", peakVs: (a, b) => `सबसे ऊँचा लगभग <b>${a}</b>, ${b} mg/dL की जगह`,
    minAbove: n => n ? `180 से ऊपर ${n} मिनट` : "180 से नीचे रहेगा", gotIt: "समझ गया", seen: "देख लिया",
    noAdvice: "अभी कोई सलाह नहीं", noAdviceB: "जब आपके डॉक्टर Rx पैड पर सलाह लिखेंगे, वह यहाँ आएगी, साथ में यह भी कि आपके ग्लूकोज़ पर उसका क्या असर होगा।",
    adviceFoot: "सलाह आपके डॉक्टर ने लिखी है और उसका असर आपके ट्विन ने आँका है। कोई भी दवा बदलने से पहले अपने डॉक्टर से बात करें।",
    dataIntro: "छाया इन्हें मिलाकर आपका ट्विन बनाती है। किसी पर टैप करें और देखें कि वह क्या भेजता है और क्यों।",
    dCgm: "ग्लूकोज़ सेंसर (CGM)", dCgmS: "हर 5 मिनट में पढ़ता है", dWatch: "स्मार्टवॉच", dWatchS: "कदम, धड़कन, नींद और HRV",
    dMeal: "खाने का रिकॉर्ड", dMealS: "जो आप यहाँ दर्ज करते हैं", dMed: "दवा का रिकॉर्ड", dMedS: "जो खुराक आप दर्ज करते हैं", dEhr: "हेल्थ रिकॉर्ड", dEhrS: "आपके ABHA नंबर से जुड़ा",
    last: t => `पिछली बार ${t}`, cover: p => `हफ़्ते का ${p}% दर्ज`, nights: n => `${n} रातें दर्ज`, mealsN: n => `${n} बार खाना दर्ज`, dosesN: n => `${n} खुराक`,
    dataFoot: "इस डेमो का सारा डेटा सिंथेटिक है। असली ऐप में आप तय करते हैं कि क्या साझा करना है, और ABDM के ज़रिए कभी भी सहमति वापस ले सकते हैं।",
    sheetH: "दर्ज करें", meal: "खाना", medicine: "दवा", when: "कब", now: "अभी", ago: n => n >= 60 ? `${n / 60} घंटा पहले` : `${n} मिनट पहले`,
    photo: "फ़ोटो जोड़ें", photoOn: "फ़ोटो जुड़ गई", search: "38 व्यंजनों में खोजें", usual: "आप अक्सर खाते हैं", will: "यह खाना क्या करेगा",
    peakAt: (v, t) => `${t} के आसपास लगभग <b>${v}</b> तक`, withWalk: v => `खाने के बाद 15 मिनट टहलें तो: <b>${v}</b>`, save: "यह खाना दर्ज करें",
    pick: "असर देखने के लिए कोई व्यंजन चुनें।", doseH: "ली गई खुराक दर्ज करें", takenNow: "अभी ली", saved: "दर्ज हो गया। आपके ट्विन ने इसे जोड़ लिया।", carbs: "ग्रा. कार्ब्स",
    close: "बंद करें",
  },
};
const ICON = {
  today: "M3 12h4l3-8 4 16 3-8h4", advice: "M7 3.5h10l3 3V20.5H4V3.5zM8 11h8M8 15h5", week: "M4 20V10M10 20V4M16 20v-7M21 20H3",
  data: "M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3",
  plus: "M12 5v14M5 12h14", check: "M5 12.5l4.5 4.5L19 7.5", close: "M6 6l12 12M18 6 6 18", camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7",
  pill: "M10.5 3.5a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7-7zM7 10l7 7", meal: "M4 11h16a8 8 0 0 1-16 0zM8 8c0-2 2-2 2-4M12 8c0-2 2-2 2-4", bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20h4",
  cgm: "M12 3a9 9 0 1 0 .01 0M12 8v4l3 2", watch: "M8 3h8l1 4H7zM7 17h10l-1 4H8zM6 7h12v10H6z", ehr: "M8 4h8l4 4v12H4V4zM9 13h6M12 10v6", chev: "M9 6l6 6-6 6",
};
const svgI = (d, s = 20, w = 1.9) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

const Patient = {
  pid: null, tab: "today", ready: false, lang: "en", sheet: null,
  t(key, ...a) { const v = PT[this.lang][key]; return typeof v === "function" ? v(...a) : v; },
  async init(pid, params) {
    pid = pid || curPid || this.pid || "GT-1102"; curPid = pid; renderNav();
    if (!this.ready) {
      this.ready = true; this.meta = await Data.getMeta(); this.lang = store.get("plang", "en");
      $("#ps-days").innerHTML = DAYS.map((d, i) => `<button data-d="${i}" aria-pressed="false">${d} ${14 + i}</button>`).join("");
      $("#ps-days").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { S.day = +b.dataset.d; this.render(); } });
      $("#ps-slider").addEventListener("input", e => { S.slot = +e.target.value; this.render(); });
      $("#ps-pick").addEventListener("change", e => { location.hash = `#/patient/${e.target.value}`; });
      $("#ptabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (!b) return; if (b.dataset.tab === "log") { this.openSheet("meal"); return; } this.go(b.dataset.tab); });
      $("#phone").addEventListener("click", e => this.onClick(e));
      $("#phone").addEventListener("input", e => { if (e.target.id === "ps-search") { this.sheet.q = e.target.value; this.renderSheet(true); } });
      $("#phone").addEventListener("change", e => { if (e.target.id === "ps-photo" && e.target.files[0]) { const r = new FileReader(); r.onload = () => { this.sheet.photo = r.result; this.renderSheet(); }; r.readAsDataURL(e.target.files[0]); } });
      document.addEventListener("keydown", e => { if (e.key === "Escape" && this.sheet && !views.patient.hidden) this.closeSheet(); });
    }
    const reg = await Data.getRegister();
    $("#ps-pick").innerHTML = [...reg].sort((a, b) => fullName(a).localeCompare(fullName(b))).map(c => `<option value="${c.pid}"${c.pid === pid ? " selected" : ""}>${esc(fullName(c))} · ${c.pid}</option>`).join("");
    if (pid !== this.pid) { this.pid = pid; this.tab = "today"; this.closeSheet(true); }
    const wantTab = params && params.get("tab"); if (wantTab && ["today", "advice", "week", "data"].includes(wantTab)) this.tab = wantTab;
    $("#pscreen").innerHTML = `<div class="loading">…</div>`;
    try { this.P = await Data.getCase(pid); } catch { $("#pscreen").innerHTML = `<div class="loading">We couldn't open ${esc(pid)}. Pick a patient above.</div>`; return; }
    try { mergeLogs(this.P, await Data.logs(pid)); } catch { mergeLogs(this.P, []); }
    try { this.notes = await Data.notes(pid); } catch { this.notes = []; }
    $("#ps-name").textContent = fullName(this.P); $$(".ps-his").forEach(e => { e.textContent = this.P.sex === "F" ? "her" : "his"; });
    $("#ps-back").href = `#/clinic/${pid}`;
    const pt = $("#ps-tour"); if (pt && !pt.dataset.on) { pt.dataset.on = 1; pt.addEventListener("click", () => Tour.start(PTOUR)); }
    this.render();
  },
  go(tab) { this.tab = tab; this.render(); $("#pscreen").scrollTop = 0; if (matchMedia("(max-width: 720px)").matches) window.scrollTo(0, 0); },
  kNow() { return S.day * 288 + S.slot * 3; },
  idx(P) { const k = this.kNow(); let i = -1; for (let j = 0; j < P.pred.k.length; j++) { if (P.pred.k[j] <= k) i = j; else break; } return i; },
  tm(k) { return fmtT((k % 288) * 5); },

  /* ---------- shell ---------- */
  render() {
    const P = this.P; if (!P) return;
    $$("#ps-days button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.d === S.day));
    $("#ps-slider").value = S.slot; $("#ps-tout").textContent = fmtT(S.slot * 15);
    $("#phone").classList.toggle("hi", this.lang === "hi"); $("#phone").setAttribute("lang", this.lang);
    const k = this.kNow(), notes = (this.notes || []).filter(n => n.at_k <= k);
    const unseen = notes.filter(n => !this.isSeen(n)).length;
    const tabs = [["today", "tToday", ICON.today], ["advice", "tAdvice", ICON.advice], ["log", "tLog", ICON.plus], ["week", "tWeek", ICON.week], ["data", "tData", ICON.data]];
    $("#ptabs").innerHTML = tabs.map(([id, key, d]) => id === "log"
      ? `<button data-tab="log" class="ptab-log" aria-label="${this.t("logMeal")}"><span>${svgI(d, 24, 2.4)}</span></button>`
      : `<button data-tab="${id}" aria-current="${this.tab === id}">${svgI(d, 22)}<span>${this.t(key)}</span>${id === "advice" && unseen ? `<i class="badge">${unseen}</i>` : ""}</button>`).join("");
    const greet = this.t(S.slot < 48 ? "morning" : S.slot < 68 ? "afternoon" : "evening");
    const date = this.lang === "hi" ? `${DAYS_HI[S.day]}, ${14 + S.day} सितंबर · ${fmtT(S.slot * 15)}` : `${DAYS_LONG[S.day]} ${14 + S.day} Sep · ${fmtT(S.slot * 15)}`;
    const head = `<header class="pc-band"><span class="pc-mark"><svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true"><path d="M21 9.5a8 8 0 1 0 0 13" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><path d="M25.5 12.5a8.5 8.5 0 0 1 0 7" fill="none" stroke="#ad94ff" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="2 3"/></svg><b>Chaya</b><span lang="hi">छाया</span></span>
        <div class="pc-lang" role="group" aria-label="Language"><button data-lang="en" aria-pressed="${this.lang === "en"}">EN</button><button data-lang="hi" aria-pressed="${this.lang === "hi"}" lang="hi">हिं</button></div></header>
      <div class="pc-strip">${this.t("synthetic")}</div>
      <div class="pc-greet"><h2>${greet}, ${esc(P.name)}</h2><p>${date}</p></div>`;
    const body = { today: () => this.today(P, k, notes), advice: () => this.advice(P, notes), week: () => this.week(P, k), data: () => this.data(P, k) }[this.tab]();
    $("#pscreen").innerHTML = head + `<div class="pc-body">${body}</div>`;
    const svg = $("#p-chart"); if (svg) this.chart(P, k, svg);
    if (this.sheet) this.renderSheet();
  },
  isSeen(n) { return !!n.ack_at || store.get(`ack.${this.pid}`, []).includes(String(n.id)); },
  async onClick(e) {
    const el = e.target.closest("[data-lang],[data-ack],[data-go],[data-go-log],[data-dose],[data-snooze],[data-sheet],[data-dish],[data-when],[data-logsave],[data-sugar],[data-closesheet]");
    if (!el) return;
    const d = el.dataset;
    if (d.lang) { this.lang = d.lang; store.set("plang", this.lang); this.render(); return; }
    if (d.goLog !== undefined) { this.openSheet("meal"); return; }
    if (d.go) { this.go(d.go); return; }
    if (d.closesheet !== undefined) { this.closeSheet(); return; }
    if (d.sheet) { this.sheet.mode = d.sheet; this.renderSheet(); return; }
    if (d.dish !== undefined) { this.sheet.dish = +d.dish; this.renderSheet(); return; }
    if (d.when !== undefined) { this.sheet.ago = +d.when; this.renderSheet(); return; }
    try {
      if (d.ack) {
        const id = isNaN(+d.ack) ? d.ack : +d.ack;
        try { await Data.ackNote(this.pid, id); } catch { /* keep a local mark */ }
        const s = new Set(store.get(`ack.${this.pid}`, [])); s.add(String(d.ack)); store.set(`ack.${this.pid}`, [...s]);
        this.notes = this.notes.map(n => String(n.id) === String(d.ack) ? { ...n, ack_at: n.ack_at || new Date().toISOString() } : n); this.render(); return;
      }
      if (d.snooze) { store.set(`snooze.${this.pid}.${d.snooze}`, this.kNow() + 6); this.render(); return; }
      if (d.dose) { await this.log({ kind: "dose", drug: d.dose, k: this.kNow() }); return; }
      if (d.sugar !== undefined) { await this.log({ kind: "meal", meal: "Glucose tablets (3)", carbs: 15, gi: 100, k: this.kNow() }); return; }
      if (d.logsave !== undefined) {
        const m = this.meta.meal_catalog[this.sheet.dish]; if (!m) return;
        await this.log({ kind: "meal", meal: m.meal, carbs: m.carbs, gi: m.gi, photo: !!this.sheet.photo, k: Math.max(0, this.kNow() - this.sheet.ago / 5) });
        this.closeSheet(); return;
      }
    } catch (err) { toast(err.message || "Couldn't save that. Try again."); }
  },
  async log(body) {
    const row = await Data.addLog(this.pid, body);
    mergeLogs(this.P, [...(this.P._logs || []), row]);
    toast(this.t("saved")); this.render();
  },

  /* ---------- today ---------- */
  reading(P, k) {
    let last = -1; for (let j = k; j >= Math.max(0, k - 12); j--) if (P.cgm[j] != null) { last = j; break; }
    const g = last >= 0 ? P.cgm[last] : null, prev = last >= 3 ? P.cgm[last - 3] : null, dv = g != null && prev != null ? g - prev : 0;
    const tr = dv > 15 ? ["upfast", -70] : dv > 5 ? ["up", -35] : dv < -15 ? ["downfast", 70] : dv < -5 ? ["down", 35] : ["flat", 0];
    const band = g == null ? "na" : g < 70 ? "low" : g > 180 ? "high" : "ok";
    return { g, tr, band, ago: last >= 0 ? (k - last) * 5 : null };
  },
  schedule(P) {
    // each medicine at the patient's own usual times, learned from their dose history
    const by = {};
    P._meds0.forEach(m => { const t = (m.k % 288) * 5; (by[m.drug] = by[m.drug] || []).push(t); });
    const out = [];
    Object.entries(by).forEach(([drug, ts]) => {
      [ts.filter(t => t < 840), ts.filter(t => t >= 840)].forEach(g => { if (g.length >= 3) { g.sort((a, b) => a - b); out.push({ drug, at: Math.round(g[Math.floor(g.length / 2)] / 15) * 15 }); } });
    });
    return out.sort((a, b) => a.at - b.at);
  },
  medsToday(P, k) {
    const d0 = S.day * 288, now = (k - d0) * 5;
    return this.schedule(P).map(s => {
      const dose = P.meds.find(m => m.drug === s.drug && m.k >= d0 && m.k <= k && Math.abs((m.k - d0) * 5 - s.at) <= 180);
      const key = `${s.drug}.${S.day}.${s.at}`, snooze = store.get(`snooze.${this.pid}.${key}`, null);
      let st = dose ? "taken" : now < s.at - 30 ? "later" : now <= s.at + 120 ? "due" : "missed";
      if (st === "due" && snooze != null && snooze > k) st = "snoozed";
      return { ...s, st, dose, key, snooze };
    });
  },
  today(P, k, notes) {
    const d0 = S.day * 288, i = this.idx(P), r = this.reading(P, k);
    const fcOk = i >= 0 && k - P.pred.k[i] < 6, fc = fcOk ? twinForecast(P, i) : null;
    const pk = fc ? Math.round(peakOf(fc.fc)) : null, pkAt = fc ? fmtT(((fc.k % 288) * 5 + 5 + (fc.fc.indexOf(peakOf(fc.fc)) + 1) * 5) % 1440) : "";
    const lo = lowRisk(P, i, k, fc ? fc.fc : null);
    const pr = i >= 0 ? P.pred.prob[i] : null, thr = Thr.get(this.meta);
    let state = "ok";
    if (lo && lo.now) state = "lownow"; else if (r.g != null && r.g > 180) state = "high"; else if (lo) state = "lowsoon"; else if (pr != null && pr >= thr) state = "spike";
    const latest = notes[0];
    const statusWord = { ok: "inRange", high: "above", low: "below", na: "noRead" }[r.band];
    const statusIcon = { ok: ICON.check, high: "M12 5l7 12H5z", low: "M12 19L5 7h14z", na: "M6 12h12" }[r.band];
    const now = `<section class="pc-now" aria-labelledby="pc-now-h">
        <h3 id="pc-now-h" class="sr">${this.t("tToday")}</h3>
        <div class="pc-read"><span class="pc-val num">${r.g == null ? "–" : Math.round(r.g)}</span><span class="pc-unit">mg/dL</span>
          <span class="pc-arrow" title="${this.t("tr")[r.tr[0]]}" style="--rot:${r.tr[1]}deg">${svgI("M5 12h13M13 6l6 6-6 6", 26, 2.4)}</span></div>
        <div class="pc-stat"><span class="pc-pill ${r.band}">${svgI(statusIcon, 14, 2.6)}${this.t(statusWord)}</span><span>${this.t("tr")[r.tr[0]]}</span>
          <button class="pc-src" data-src="cgm,forecast" data-pid="${P.pid}">${this.t("fromSensor", r.ago)}</button></div>
        <svg id="p-chart" role="img" aria-label="${this.t("legYou")} · ${this.t("legChaya")}"></svg>
        <div class="pc-leg"><span><i class="l-ink"></i>${this.t("legYou")}</span><span><i class="l-sh"></i>${this.t("legChaya")}</span><span><i class="l-band"></i>${this.t("legTarget")}</span></div>
        ${fc && state === "ok" ? `<p class="pc-carbon">${this.t("expect", pk, pkAt)} ${this.t("steady")}</p>` : ""}
      </section>`;
    let alert = "";
    if (state === "lownow") alert = `<section class="pc-alert low" role="alert"><div class="pa-h">${svgI("M12 19L5 7h14z", 20, 2.4)}<h3>${this.t("lowNowH")}</h3></div>
        <ol><li>${this.t("lowNow1")}</li><li>${this.t("lowNow2")}</li><li>${this.t("lowNow3")}</li></ol>
        <button class="pc-btn" data-sugar>${svgI(ICON.check, 18, 2.4)}${this.t("lowNowB")}</button></section>`;
    else if (state === "lowsoon") alert = `<section class="pc-alert low soft"><div class="pa-h">${svgI("M12 19L5 7h14z", 20, 2.4)}<h3>${this.t("lowSoonH")}</h3></div><p>${this.t("lowSoon")}</p></section>`;
    else if (state === "high") alert = `<section class="pc-alert high soft"><div class="pa-h">${svgI("M12 5l7 12H5z", 20, 2.4)}<h3>${this.t("highH")}</h3></div><p>${this.t("high")}</p></section>`;
    else if (state === "spike") alert = `<section class="pc-alert high soft"><div class="pa-h">${svgI("M12 5l7 12H5z", 20, 2.4)}<h3>${this.t("spikeH")}</h3></div><p>${this.t("spike", pk || "–", pkAt)}</p></section>`;
    const chit = latest ? `<button class="pc-chit" data-go="advice"><span class="pc-chit-k">${this.t("fromDoc")}</span><span class="pc-chit-t" lang="en">℞ ${esc(latest.summary)}</span><span class="pc-chit-a">${this.t("allAdvice")} ${svgI(ICON.chev, 14, 2.4)}</span></button>` : "";
    const meds = this.medsToday(P, k);
    const medRows = meds.map(m => {
      const lab = { taken: this.t("taken", m.dose ? this.tm(m.dose.k) : ""), due: this.t("due"), missed: this.t("missed"), later: this.t("later", fmtT(m.at)), snoozed: this.t("snoozed", this.tm(m.snooze)) }[m.st];
      const act = m.st === "due" ? `<div class="pm-acts"><button class="pc-btn sm" data-dose="${esc(m.drug)}">${svgI(ICON.check, 16, 2.6)}${this.t("bTaken")}</button><button class="pc-btn sm quiet" data-snooze="${esc(m.key)}">${this.t("bSnooze")}</button></div>`
        : m.st === "missed" ? `<div class="pm-acts"><button class="pc-btn sm quiet" data-dose="${esc(m.drug)}">${this.t("bTook")}</button></div>` : "";
      return `<li class="pm ${m.st}"><span class="pm-t num">${fmtT(m.at)}</span><span class="pm-i">${m.st === "taken" ? svgI(ICON.check, 16, 2.8) : m.st === "due" || m.st === "snoozed" ? svgI(ICON.bell, 16, 2.2) : svgI(ICON.pill, 16, 2)}</span>
        <span class="pm-n" lang="en">${esc(m.drug)}</span><span class="pm-s">${lab}</span>${act}</li>`;
    }).join("");
    const meals = P.meals.filter(m => m.k >= d0 && m.k <= k), doses = P.meds.filter(m => m.k >= d0 && m.k <= k);
    const items = [...meals.map(m => ({ k: m.k, t: m.meal, s: `${m.carbs} ${this.t("carbs")}`, c: "meal", app: m.app })), ...doses.map(m => ({ k: m.k, t: m.drug, s: this.t("tlTaken"), c: "dose", app: m.app }))].sort((a, b) => a.k - b.k);
    const seg = P.cgm.slice(d0, k + 1).filter(v => v != null), tir = seg.length ? Math.round(seg.filter(v => v >= 70 && v <= 180).length / seg.length * 100) : null;
    const steps = P.steps.slice(d0, k + 1).reduce((a, b) => a + b, 0), night = P.nights.find(n => n.day === S.day + 7);
    const urgent = state === "lownow" || state === "lowsoon";
    return (urgent ? alert + now : now + alert) + chit +
      (meds.length ? `<section class="pc-sec"><h3>${this.t("meds")}</h3><ul class="pm-list">${medRows}</ul></section>` : "") +
      `<section class="pc-sec"><h3>${this.t("today")}</h3>${items.length ? `<ol class="pc-tl">${items.map(x => `<li class="${x.c}"><span class="num">${this.tm(x.k)}</span><i></i><span class="tl-n" lang="en">${esc(x.t)}</span><span class="tl-s">${x.s}${x.app ? ` · ${this.t("inApp")}` : ""}</span></li>`).join("")}</ol>` : `<p class="pc-empty">${this.t("nothing")}</p>`}
        <button class="pc-btn quiet wide" data-go-log>${svgI(ICON.plus, 18, 2.4)}${this.t("logMeal")}</button></section>
      <section class="pc-fields"><div><span>${this.t("fRange")}</span><b class="num">${tir == null ? "–" : tir + "%"}</b><small>${this.t("goal")}</small></div>
        <div><span>${this.t("fSteps")}</span><b class="num">${steps.toLocaleString("en-IN")}</b><small>${this.t("watch")}</small></div>
        <div><span>${this.t("fSleep")}</span><b class="num">${night ? night.sleep_hours.toFixed(1) + " h" : "–"}</b><small>${night ? this.t("bed", fmtT(night.bedtime * 60)) : ""}</small></div></section>`;
  },
  chart(P, k, el) {
    const W = el.clientWidth || 330, H = 164, M = { l: 26, r: 4, t: 10, b: 20 };
    const svg = d3.select(el).attr("viewBox", `0 0 ${W} ${H}`).attr("height", H); svg.selectAll("*").remove();
    const x = d3.scaleLinear([-36, 24], [M.l, W - M.r]), y = d3.scaleLinear([40, 300], [H - M.b, M.t]).clamp(true);
    svg.append("rect").attr("x", M.l).attr("width", W - M.l - M.r).attr("y", y(180)).attr("height", y(70) - y(180)).attr("fill", css("--band"));
    svg.append("rect").attr("x", x(0)).attr("width", W - M.r - x(0)).attr("y", M.t).attr("height", H - M.b - M.t).attr("fill", css("--shadow-soft")).attr("opacity", .35);
    [70, 180].forEach(v => svg.append("text").attr("x", M.l - 4).attr("y", y(v) + 3).attr("text-anchor", "end").text(v));
    const i = this.idx(P);
    if (i >= 0 && k - P.pred.k[i] < 6) {
      const f = twinForecast(P, i), off = f.k - k;
      const pts = [[off, f.start], ...f.fc.map((v, j) => [off + j + 1, v])].filter(p => p[0] <= 24);
      svg.append("path").attr("d", d3.area().x(d => x(d[0])).y0(d => y(d[1] - 14 - (d[0] - off) * .8)).y1(d => y(d[1] + 14 + (d[0] - off) * .8)).curve(d3.curveMonotoneX)(pts)).attr("fill", css("--shadow")).attr("opacity", .16);
      svg.append("path").attr("d", d3.line().x(d => x(d[0])).y(d => y(d[1])).curve(d3.curveMonotoneX)(pts)).attr("fill", "none").attr("stroke", css("--shadow")).attr("stroke-width", 2.6).attr("stroke-dasharray", "6 5").attr("stroke-linecap", "round");
    }
    const past = d3.range(-36, 1).map(j => [j, P.cgm[k + j] ?? null]);
    svg.append("path").attr("d", d3.line().defined(d => d[1] != null).x(d => x(d[0])).y(d => y(d[1])).curve(d3.curveMonotoneX)(past)).attr("fill", "none").attr("stroke", css("--ink")).attr("stroke-width", 3).attr("stroke-linecap", "round");
    const g0 = P.cgm[k]; if (g0 != null) svg.append("circle").attr("cx", x(0)).attr("cy", y(g0)).attr("r", 5).attr("fill", css("--ink")).attr("stroke", css("--sheet")).attr("stroke-width", 2.5);
    P.meals.filter(m => m.k > k - 36 && m.k <= k).forEach(m => svg.append("circle").attr("cx", x(m.k - k)).attr("cy", H - M.b - 6).attr("r", 4).attr("fill", m.app ? css("--sheet") : css("--watch")).attr("stroke", css("--watch")).attr("stroke-width", 2));
    [[-36, "−3 h"], [-12, "−1 h"], [0, this.lang === "hi" ? "अभी" : "now"], [24, "+2 h"]].forEach(([t, l]) => svg.append("text").attr("x", x(t)).attr("y", H - 4).attr("text-anchor", t === -36 ? "start" : t === 24 ? "end" : "middle").text(l));
  },

  /* ---------- advice ---------- */
  advice(P, notes) {
    if (!notes.length) return `<div class="pc-emptybig"><span class="pc-rx" aria-hidden="true">℞</span><h3>${this.t("noAdvice")}</h3><p>${this.t("noAdviceB")}</p></div>`;
    return `<h3 class="pc-h3">${this.t("careTeam")}</h3>` + notes.map(n => {
      const d = Math.floor(n.at_k / 288), seen = this.isSeen(n), a = Math.round(n.projected_peak), b = Math.round(n.baseline_peak), mx = Math.max(a, b, 200);
      return `<article class="pc-note${seen ? " seen" : ""}"><div class="pn-top"><span>${n.author && !/^You/.test(n.author) ? esc(n.author) : this.t("careTeam")}</span><span class="num">${DAYS[d]} ${14 + d} Sep · ${this.tm(n.at_k)}</span></div>
        <p class="pn-rx" lang="en">℞ ${esc(n.summary)}</p>
        <div class="pn-what"><span class="pn-k">${this.t("should")}</span><p>${this.t("peakVs", a, b)}</p>
          <div class="pn-bars" aria-hidden="true"><i class="was" style="width:${b / mx * 100}%"></i><i class="now ${a > 180 ? "hi" : ""}" style="width:${a / mx * 100}%"></i><span style="left:${180 / mx * 100}%"></span></div>
          <small>${this.t("minAbove", n.projected_minutes_above)}</small></div>
        ${seen ? `<p class="pn-seen">${svgI(ICON.check, 16, 2.8)}${this.t("seen")}</p>` : `<button class="pc-btn" data-ack="${n.id}">${svgI(ICON.check, 18, 2.6)}${this.t("gotIt")}</button>`}</article>`;
    }).join("") + `<p class="pc-foot">${this.t("adviceFoot")}</p>`;
  },

  /* ---------- week ---------- */
  week(P, k) {
    const rows = DAYS.map((dn, d) => {
      const hi = Math.min(k, d * 288 + 287), seg = d * 288 <= k ? P.cgm.slice(d * 288, hi + 1).filter(v => v != null) : [];
      const tir = seg.length ? seg.filter(v => v >= 70 && v <= 180).length / seg.length * 100 : null;
      const n = P.nights.find(x => x.day === d + 7), st = d * 288 <= k ? P.steps.slice(d * 288, hi + 1).reduce((a, b) => a + b, 0) : null;
      return { dn: this.lang === "hi" ? DAYS_HI_S[d] : dn, dd: 14 + d, tir, sleep: d <= S.day && n ? n.sleep_hours : null, st, today: d === S.day };
    });
    const all = P.cgm.slice(0, k + 1).filter(v => v != null), mean = all.reduce((a, b) => a + b, 0) / Math.max(all.length, 1);
    const tirW = Math.round(all.filter(v => v >= 70 && v <= 180).length / Math.max(all.length, 1) * 100), gmi = 3.31 + 0.02392 * mean;
    const warns = P.pred.start.filter((s, j) => s && P.pred.k[j] <= k).length;
    return `<section class="pc-weekh"><h3 class="${tirW >= 70 ? "good" : "low"}">${this.t("weekH", tirW)}</h3><p>${this.t("weekGoal")}</p></section>
      <section class="pc-sec"><h3>${this.t("byDay")}</h3><div class="wk">${rows.map(r => `<div class="wk-d${r.today ? " today" : ""}"><div class="wk-bar"><span class="wk-goal"></span><i style="height:${r.tir == null ? 0 : r.tir}%" class="${r.tir != null && r.tir < 70 ? "low" : ""}"></i></div><b class="num">${r.tir == null ? "–" : Math.round(r.tir)}</b><span>${r.dn}</span></div>`).join("")}</div></section>
      <section class="pc-fields"><div><span>${this.t("avg")}</span><b class="num">${Math.round(mean)}</b><small>mg/dL</small></div>
        <div><span>${this.t("a1c")}</span><b class="num">${gmi.toFixed(1)}%</b><small>${this.t("lastLab", P.ehr.hba1c_pct.toFixed(1))}</small></div>
        <div><span>${this.t("warns")}</span><b class="num">${warns}</b><small>${this.t("warnsS")}</small></div></section>
      <section class="pc-sec"><h3>${this.t("sleepSteps")}</h3><ul class="pc-rows">${rows.map(r => `<li><span>${r.dn} ${r.dd}</span><span class="num">${r.sleep == null ? "–" : r.sleep.toFixed(1)} <small>${this.t("hSleep")}</small></span><span class="num">${r.st == null ? "–" : r.st.toLocaleString("en-IN")} <small>${this.t("steps")}</small></span></li>`).join("")}</ul></section>`;
  },

  /* ---------- my data ---------- */
  data(P, k) {
    const c = Sources.completeness(P), t = kk => kk < 0 ? "—" : `${DAYS[Math.floor(kk / 288)]} ${this.tm(kk)}`;
    const lastOf = arr => arr.filter(m => m.k <= k).reduce((a, m) => Math.max(a, m.k), -1), e = P.ehr;
    const devs = [
      ["dCgm", "dCgmS", `${this.t("last", t(c.last))} · ${this.t("cover", c.cov.toFixed(0))}`, "cgm", ICON.cgm],
      ["dWatch", "dWatchS", `${this.t("last", t(k))} · ${this.t("nights", c.nights)}`, "steps,hr,hrv,sleep", ICON.watch],
      ["dMeal", "dMealS", `${this.t("mealsN", c.meals)} · ${this.t("last", t(lastOf(P.meals)))}`, "meals,unlogged", ICON.meal],
      ["dMed", "dMedS", `${this.t("dosesN", c.doses)} · ${this.t("last", t(lastOf(P.meds)))}`, "meds", ICON.pill],
      ["dEhr", "dEhrS", `HbA1c ${e.hba1c_pct}% · FPG ${e.fasting_glucose_mgdl} mg/dL`, "ehr,hba1c,fpg,body,bp,lipids,kidney", ICON.ehr],
    ];
    return `<p class="pc-intro">${this.t("dataIntro")}</p><ul class="pc-devs">` + devs.map(([n, s, st, ids, d]) => `<li><button data-src="${ids}" data-pid="${P.pid}"><span class="pd-i">${svgI(d, 22, 1.8)}</span>
        <span class="pd-t"><b>${this.t(n)}</b><span>${this.t(s)}</span><span class="pd-st"><i></i>${st}</span></span>${svgI(ICON.chev, 18, 2.2)}</button></li>`).join("") +
      `</ul><p class="pc-foot">${this.t("dataFoot")}</p>`;
  },

  /* ---------- log sheet ---------- */
  openSheet(mode) {
    const slot = S.slot < 44 ? "breakfast" : S.slot < 64 ? "lunch" : S.slot < 76 ? "snack" : "dinner";
    this.sheet = { mode, dish: -1, ago: 0, q: "", photo: null, slot };
    $("#psheet").hidden = false; $("#phone").classList.add("sheet-on");
    this.renderSheet(); setTimeout(() => { const f = $("#psheet [data-closesheet]"); if (f) f.focus(); }, 30);
  },
  closeSheet(silent) { this.sheet = null; const s = $("#psheet"); if (s) { s.hidden = true; s.innerHTML = ""; } $("#phone").classList.remove("sheet-on"); },
  renderSheet(listOnly) {
    const sh = this.sheet, P = this.P, cat = this.meta.meal_catalog; if (!sh) return;
    const usual = Object.entries(P._meals0.reduce((a, m) => { a[m.meal] = (a[m.meal] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([m]) => cat.findIndex(c => c.meal === m)).filter(j => j >= 0);
    const q = sh.q.trim().toLowerCase(), list = cat.map((m, j) => ({ ...m, j })).filter(m => !q || m.meal.toLowerCase().includes(q));
    const listHtml = list.map(m => `<li><button data-dish="${m.j}" aria-pressed="${sh.dish === m.j}"><span lang="en">${esc(m.meal)}</span><span class="num">${m.carbs} g · GI ${m.gi}</span></button></li>`).join("") || `<li class="pc-empty">No dish matches “${esc(sh.q)}”.</li>`;
    if (listOnly && $("#ps-list")) { $("#ps-list").innerHTML = listHtml; return; }
    let preview = `<p class="ps-hint">${this.t("pick")}</p>`;
    if (sh.dish >= 0) {
      const i = this.idx(P), m = cat[sh.dish];
      if (i >= 0) {
        const a = simulate(P, i, { meal: m, when: 0, walk: 0, met: 1, sleep: 7, metTouched: false, sleepTouched: false });
        const w = simulate(P, i, { meal: m, when: 0, walk: 15, met: 1, sleep: 7, metTouched: false, sleepTouched: false });
        const pk = Math.round(peakOf(a.scen)), at = fmtT((a.sm + (a.scen.indexOf(peakOf(a.scen)) + 1) * 5) % 1440), wk = Math.round(peakOf(w.scen));
        preview = `<div class="ps-prev"><span class="pn-k">${this.t("will")}</span><p class="${pk > 180 ? "hi" : ""}">${this.t("peakAt", pk, at)}</p><p class="ps-walk">${this.t("withWalk", wk)}</p></div>`;
      }
    }
    $("#psheet").innerHTML = `<div class="ps-scrim" data-closesheet></div><div class="ps-panel" role="dialog" aria-modal="true" aria-labelledby="ps-h">
      <div class="ps-grab" aria-hidden="true"></div>
      <div class="ps-head"><h3 id="ps-h">${this.t("sheetH")}</h3><div class="ps-seg" role="group"><button data-sheet="meal" aria-pressed="${sh.mode === "meal"}">${this.t("meal")}</button><button data-sheet="dose" aria-pressed="${sh.mode === "dose"}">${this.t("medicine")}</button></div>
        <button class="ps-x" data-closesheet aria-label="${this.t("close")}">${svgI(ICON.close, 18, 2.4)}</button></div>
      ${sh.mode === "meal" ? `<div class="ps-body">
        <div class="ps-row"><span class="ps-l">${this.t("when")}</span><div class="ps-chips">${[0, 15, 30, 60].map(v => `<button data-when="${v}" aria-pressed="${sh.ago === v}">${v ? this.t("ago", v) : this.t("now")}</button>`).join("")}</div></div>
        <label class="ps-photo${sh.photo ? " on" : ""}">${sh.photo ? `<img src="${sh.photo}" alt="">` : svgI(ICON.camera, 20, 1.9)}<span>${sh.photo ? this.t("photoOn") : this.t("photo")}</span><input id="ps-photo" type="file" accept="image/*" capture="environment"></label>
        ${usual.length ? `<div class="ps-row"><span class="ps-l">${this.t("usual")}</span><div class="ps-chips">${usual.map(j => `<button data-dish="${j}" aria-pressed="${sh.dish === j}" lang="en">${esc(cat[j].meal)}</button>`).join("")}</div></div>` : ""}
        <input id="ps-search" class="ps-search" type="search" placeholder="${this.t("search")}" value="${esc(sh.q)}" autocomplete="off">
        <ul class="ps-list" id="ps-list">${listHtml}</ul>
        ${preview}
        <button class="pc-btn wide" data-logsave ${sh.dish >= 0 ? "" : "disabled"}>${this.t("save")}</button></div>`
      : `<div class="ps-body"><p class="ps-l">${this.t("doseH")}</p><ul class="ps-doses">${[...new Set(this.schedule(P).map(s => s.drug))].map(dr => `<li><span lang="en">${esc(dr)}</span><button class="pc-btn sm" data-dose="${esc(dr)}">${svgI(ICON.check, 16, 2.6)}${this.t("takenNow")}</button></li>`).join("") || `<li class="pc-empty">No medicines to track.</li>`}</ul></div>`}
    </div>`;
    const se = $("#ps-search"); if (se && document.activeElement && document.activeElement.id === "ps-search") se.focus();
  },
};
const DAYS_HI = ["सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार", "रविवार"], DAYS_HI_S = ["सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि", "रवि"];

// ================================================================== clinic outcomes
const Outcomes = {
  async render() {
    const meta = await Data.getMeta(), reg = await Data.getRegister();
    let out; try { out = await Data.outcomesStatic(); } catch { $("#outc-body").innerHTML = `<p class="empty">The outcome tables could not be loaded. Reload the page to try again.</p>`; return; }
    const loop = await Data.outcomesLive().catch(() => null);
    const thr = Thr.get(meta), key = Object.keys(out.patients[reg[0].pid].alerts_by_t).reduce((b, t) => Math.abs(+t - thr) < Math.abs(+b - thr) ? t : b);
    const cur = out.curve.reduce((b, p) => Math.abs(p.t - thr) < Math.abs(b.t - thr) ? p : b, out.curve[0]);
    const rows = reg.map(c => { const o = out.patients[c.pid], l = loop && loop.by_patient[c.pid] || {};
      return { ...c, o, warn: o.alerts_by_t[key], lows: o.lows, lowf: o.low_flags, tbr: o.tbr, hypo: o.hypo_med, open: l.open || 0, esc: l.escalations || 0, notes: l.notes || 0, acked: l.acked || 0, reviews: l.reviews || 0 }; });
    const n = rows.length, goal = rows.filter(r => r.tir >= 70).length, warn = rows.reduce((a, r) => a + r.warn, 0);
    const med = a => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
    const hypo = rows.filter(r => r.hypo), lowsAll = rows.reduce((a, r) => a + r.lows, 0);
    $("#outc-lede").innerHTML = `<b class="num">${goal}</b> of ${n} patients met the 70% time-in-range goal this week. Median time in range was <b class="num">${med(rows.map(r => r.tir))}%</b>; Chaya raised <b class="num">${warn.toLocaleString("en-IN")}</b> spike warnings at the current threshold.`;
    const L = loop || { reviews: 0, notes: 0, notes_acknowledged: 0, escalations: { total: 0, contacted: 0, resolved: 0, open: 0, median_minutes_to_contact: null }, patient_logs: { meals: 0, doses: 0 } };
    const steps = [["Warnings raised", warn, "spike warnings this week, at the current threshold"], ["Reviewed", L.reviews, "marked reviewed by a clinician"], ["Escalated", L.escalations.total, "given an owner and a deadline"],
      ["Patient contacted", L.escalations.contacted + L.escalations.resolved, L.escalations.median_minutes_to_contact != null ? `median ${L.escalations.median_minutes_to_contact} min to contact` : "by WhatsApp or call"],
      ["Advice sent", L.notes, "saved on the Rx pad and sent to the app"], ["Seen by patient", L.notes_acknowledged, "patient tapped Got it"]];
    const days = DAYS.map((d, j) => ({ d: `${d} ${14 + j}`, v: rows.map(r => r.o.daily[j]).filter(v => v != null) }));
    const W = 560, H = 210, M = { l: 34, r: 10, t: 12, b: 26 }, x = j => M.l + (W - M.l - M.r) * (j + .5) / 7, y = v => M.t + (H - M.t - M.b) * (1 - v / 100);
    const strip = days.map((dd, j) => dd.v.map((v, q) => `<circle cx="${(x(j) + ((q * 37) % 23 - 11)).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.6" fill="${v >= 70 ? "var(--ok)" : "var(--alert)"}" opacity=".55"/>`).join("") +
      `<line x1="${x(j) - 16}" x2="${x(j) + 16}" y1="${y(med(dd.v))}" y2="${y(med(dd.v))}" stroke="var(--ink)" stroke-width="2.5"/><text x="${x(j)}" y="${H - 8}" text-anchor="middle">${dd.d}</text>`).join("");
    const sorted = [...rows].sort((a, b) => a.tir - b.tir), bw = (W - M.l - M.r) / n;
    const bars = sorted.map((r, j) => `<rect x="${(M.l + j * bw + 1).toFixed(1)}" y="${y(r.tir).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${(y(0) - y(r.tir)).toFixed(1)}" fill="${r.tir >= 70 ? "var(--ok)" : "var(--alert)"}" opacity=".8"><title>${esc(fullName(r))} · ${r.tir}%</title></rect>`).join("");
    const grid = [0, 50, 70, 100].map(v => `<line x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 70 ? "var(--ink-3)" : "var(--edge)"}" stroke-dasharray="${v === 70 ? "4 3" : ""}"/><text x="${M.l - 6}" y="${y(v) + 3}" text-anchor="end">${v}%</text>`).join("");
    const tbl = [...rows].sort((a, b) => b.open - a.open || (b.hypo && b.lows + b.lowf) - (a.hypo && a.lows + a.lowf) || a.tir - b.tir);
    $("#outc-body").innerHTML = `
      <section class="oblock"><h2>From warning to action</h2>
        <ol class="funnel">${steps.map(([t, v, sub], j) => `<li><span class="fn-v num">${v.toLocaleString("en-IN")}</span><b>${t}</b><span class="fn-s">${sub}</span></li>`).join("")}</ol>
        <p class="ofoot">${loop && Data.live ? "Counts after Warnings raised come live from the clinic database." : "Offline demo: counts after Warnings raised are what you did in this browser."} Patients also logged ${L.patient_logs.meals} meals and ${L.patient_logs.doses} doses in the app.</p></section>
      <div class="ogrid">
        <section class="oblock"><h2>Time in range, day by day</h2><p class="osub">Each dot is a patient; the bar is the panel median. Dashed line: the 70% goal.</p>
          <svg viewBox="0 0 ${W} ${H}" class="osvg" role="img" aria-label="Daily time in range for every patient">${grid}${strip}</svg></section>
        <section class="oblock"><h2>Every patient, lowest first</h2><p class="osub">${goal} of ${n} meet the goal. Hover a bar for the name.</p>
          <svg viewBox="0 0 ${W} ${H}" class="osvg" role="img" aria-label="Time in range for each patient, sorted">${grid}${bars}</svg></section>
      </div>
      <div class="ogrid">
        <section class="oblock"><h2>Low-glucose safety</h2>
          <p class="olead"><b class="num">${hypo.length}</b> patients take a sulfonylurea or insulin. The panel had <b class="num">${lowsAll}</b> drops below 70 this week. The twin warned <b class="num">${out.low.caught} of ${out.low.onsets}</b> ahead of time, a median <b class="num">${out.low.median_lead_min} min</b> early, at about ${Math.round(out.low.flags_per_patient_day * 7 * 10) / 10} low warnings per patient a week.</p>
          <ul class="olist">${hypo.sort((a, b) => (b.lows + b.lowf) - (a.lows + a.lowf)).slice(0, 6).map(r => `<li><a href="#/clinic/${r.pid}">${esc(fullName(r))}</a><span class="num">${r.tbr}% below 70</span><span>${r.lows} lows · ${r.lowf} warned</span></li>`).join("")}</ul>
          <p class="ofoot">Small sample: 10 low episodes in 45 synthetic patients. Validation on real CGM data comes first.</p></section>
        <section class="oblock"><h2>Alert load</h2>
          <p class="olead">At the current threshold Chaya sends <b class="num">${cur.alerts_per_patient_day.toFixed(1)}</b> spike warnings per patient a day and warns about <b class="num">${Math.round(cur.onsets_warned * 100)}%</b> of spikes within two hours.</p>
          <div class="oload">${out.curve.filter(p => [.25, .45, .65, .85, .95].includes(p.t)).map(p => `<div class="${Math.abs(p.t - cur.t) < .03 ? "on" : ""}"><span class="num">${Math.round(p.t * 100)}%</span><b class="num">${p.alerts_per_patient_day.toFixed(1)}</b><span>${Math.round(p.onsets_warned * 100)}% caught</span></div>`).join("")}</div>
          <p class="ofoot">Change it from <a href="#/clinic">Alerts</a> in the clinic bar. Merged warnings count once.</p></section>
      </div>
      <section class="oblock"><h2>Patients</h2><p class="osub">Open escalations first, then low-glucose risk, then lowest time in range. Select a name to open the case.</p>
        <div class="table-scroll"><table class="otable"><thead><tr><th>Patient</th><th>In range</th><th>Below 70</th><th>Spike warnings</th><th>Lows · low warnings</th><th>Escalations</th><th>Advice sent · seen</th></tr></thead>
        <tbody>${tbl.map(r => `<tr><td><a href="#/clinic/${r.pid}">${esc(fullName(r))}</a><span class="ot-m">${r.pid}${r.hypo ? " · SU/insulin" : ""}</span></td><td class="num ${r.tir < 70 ? "bad" : ""}">${r.tir}%</td><td class="num">${r.tbr}%</td><td class="num">${r.warn}</td><td class="num">${r.lows} · ${r.lowf}</td><td class="num">${r.open ? `<span class="rf open">${r.open} open</span>` : r.esc || "–"}</td><td class="num">${r.notes ? `${r.notes} · ${r.acked}` : "–"}</td></tr>`).join("")}</tbody></table></div></section>`;
  },
};
// ================================================================== boot
(async function boot() {
  setupHelp(); Glossary.init(); Sources.init();
  await Data.init();
  await route();
})();
})();
