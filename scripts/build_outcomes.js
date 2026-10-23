// Precompute what the clinic needs beyond the per-patient bundles:
//  - low-glucose flags from the twin (2-h forecast dips below LOW_TH while glucose is still >= 70)
//  - the alert-threshold trade-off (warnings per patient-day vs spike onsets warned within 2 h)
//  - panel outcomes (daily time in range, lows, warnings)
// Uses the exact simulator the browser runs (copied from web/assets/chaya.js), on web/data/demo.json.
// Run: node scripts/build_outcomes.js   ->  web/data/outcomes.json
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "web/assets/chaya.js"), "utf8");
const a = src.indexOf("// ================================================================== twin simulator");
const b = src.indexOf("// ================================================================== data layer");
const sim = new Function(src.slice(a, b) + "\nreturn { forecast, routine, carryMeals };")();
const d = JSON.parse(fs.readFileSync(path.join(ROOT, "web/data/demo.json"), "utf8"));

const LOW_TH = 80;            // forecast floor that raises "Low likely"
const LOW = 70, HIGH = 180, HORIZON = 24; // 24 x 5 min = 2 h
const THRESHOLDS = [];
for (let t = 0.2; t <= 0.951; t += 0.05) THRESHOLDS.push(+t.toFixed(2));
if (!THRESHOLDS.includes(+d.threshold.toFixed(2))) THRESHOLDS.push(+d.threshold.toFixed(2));
THRESHOLDS.sort((x, y) => x - y);

function fc2h(P, i) {
  const k = P.pred.k[i], st = P.twin.states[i], sm = (k % 288) * 5 + 5, day = Math.floor(k / 288) + 7;
  const r = sim.carryMeals(P, k, sim.routine(P.twin, sm, 120, true));
  return sim.forecast(P.twin.params, st, sm, 120, r.steps, r.meal, r.kab, P.twin.si_mult[day], P.twin.gb_shift[day], P.twin.su[i]);
}
function onsets(cgm, test, back = 6) {
  const out = [];
  for (let k = back; k < cgm.length; k++) {
    const v = cgm[k];
    if (v != null && test(v) && cgm.slice(k - back, k).every(x => x == null || !test(x))) out.push(k);
  }
  return out;
}
function episodes(ks, gap = 3) { const s = []; let prev = -99; ks.forEach(k => { if (k - prev > gap) s.push(k); prev = k; }); return s; }

const days = 7, patients = {};
const curve = THRESHOLDS.map(t => ({ t, alerts: 0, onsets: 0, caught: 0 }));
let lowOn = 0, lowCaught = 0, lowLeads = [], lowFlagSteps = 0, lowFlagTrue = 0;
for (const [pid, P] of Object.entries(d.patients)) {
  const e = P.ehr, hypoMed = !!(e.on_sulfonylurea || e.on_basal_insulin);
  // daily time in range and lows
  const daily = [];
  for (let dd = 0; dd < days; dd++) {
    const v = P.cgm.slice(dd * 288, dd * 288 + 288).filter(x => x != null);
    daily.push(v.length ? Math.round(v.filter(x => x >= LOW && x <= HIGH).length / v.length * 1000) / 10 : null);
  }
  const all = P.cgm.filter(x => x != null);
  const tbr = Math.round(all.filter(x => x < LOW).length / all.length * 1000) / 10;
  // low flags from the twin
  const lowK = [];
  P.pred.k.forEach((k, i) => {
    const cg = P.cgm[k]; if (cg == null || cg < LOW) return;
    const mn = Math.min(...fc2h(P, i));
    const fut = P.cgm.slice(k + 1, k + HORIZON + 1).some(v => v != null && v < LOW);
    if (mn < LOW_TH) { lowK.push(k); lowFlagSteps++; if (fut) lowFlagTrue++; }
  });
  const lowStarts = episodes(lowK);
  const lowOnsets = onsets(P.cgm, v => v < LOW);
  lowOn += lowOnsets.length;
  lowOnsets.forEach(o => { const f = lowK.filter(k => k < o && o - k <= HORIZON); if (f.length) { lowCaught++; lowLeads.push((o - Math.min(...f)) * 5); } });
  // spike alerts at each threshold
  const spikeOn = onsets(P.cgm, v => v > HIGH);
  const byT = {};
  THRESHOLDS.forEach((t, j) => {
    const ak = P.pred.k.filter((k, i) => P.pred.prob[i] >= t && P.cgm[k] != null && P.cgm[k] < HIGH);
    const st = episodes(ak);
    byT[t.toFixed(2)] = st.length;
    curve[j].alerts += st.length; curve[j].onsets += spikeOn.length;
    curve[j].caught += spikeOn.filter(o => ak.some(k => k < o && o - k <= HORIZON)).length;
  });
  patients[pid] = { daily, tbr, lows: lowOnsets.length, low_starts: lowStarts, low_flags: lowStarts.length, hypo_med: hypoMed, alerts_by_t: byT };
}
lowLeads.sort((x, y) => x - y);
const n = Object.keys(patients).length;
const out = {
  note: "Computed by scripts/build_outcomes.js from web/data/demo.json (45 held-out synthetic patients, Mon 14 - Sun 20 Sep 2026).",
  default_threshold: d.threshold,
  low: { forecast_floor: LOW_TH, onsets: lowOn, caught: lowCaught, median_lead_min: lowLeads.length ? lowLeads[Math.floor(lowLeads.length / 2)] : null,
    flags_per_patient_day: +(lowFlagSteps / (n * days)).toFixed(3), step_precision: +(lowFlagTrue / Math.max(lowFlagSteps, 1)).toFixed(2) },
  curve: curve.map(c => ({ t: c.t, alerts_per_patient_day: +(c.alerts / (n * days)).toFixed(2), onsets_warned: +(c.caught / Math.max(c.onsets, 1)).toFixed(3) })),
  patients,
};
fs.writeFileSync(path.join(ROOT, "web/data/outcomes.json"), JSON.stringify(out));
console.log(JSON.stringify({ low: out.low, curve: out.curve }, null, 1));
