// Chaya API on Vercel (Node serverless) backed by Supabase Postgres.
// Same routes and response shapes as api/server.py, so the web app works unchanged.
// Env: SUPABASE_URL, SUPABASE_KEY (publishable key; access is governed by row-level security).
const fs = require("fs");
const path = require("path");

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;

async function sb(p, { method = "GET", body, prefer, count } = {}) {
  const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
  const pref = [prefer, count ? "count=exact" : null].filter(Boolean).join(",");
  if (pref) headers.Prefer = pref;
  const r = await fetch(`${SB_URL}/rest/v1/${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) { const e = new Error(text || r.statusText); e.status = r.status; throw e; }
  const data = text ? JSON.parse(text) : null;
  return count ? { data, total: Number((r.headers.get("content-range") || "").split("/")[1] || 0) } : data;
}

const send = (res, code, obj) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(obj === undefined ? "" : JSON.stringify(obj)); };
const readBody = req => new Promise(ok => { if (req.body && typeof req.body === "object") return ok(req.body); let s = ""; req.on("data", c => { s += c; }); req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch { ok({}); } }); });
const PID = /^GT-\d{4}$/;

async function seed() {
  const { total } = await sb("patients?select=pid&limit=1", { count: true });
  if (total > 0) return { seeded: false, message: `Already seeded with ${total} patients.` };
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "demo.json"), "utf8"));
  await sb("meta", { method: "POST", body: ["start", "threshold", "metrics", "groups", "meal_catalog", "population"].map(key => ({ key, value: d[key] })) });
  await sb("patients", { method: "POST", body: d.cohort.map(c => ({ pid: c.pid, name: c.name, age: c.age, sex: c.sex, city: c.city, condition: c.condition, hba1c: c.hba1c, tir: c.tir, tar: c.tar, alerts: c.alerts })) });
  const pids = Object.keys(d.patients);
  for (let i = 0; i < pids.length; i += 5) {
    await sb("cases", { method: "POST", body: pids.slice(i, i + 5).map(pid => ({ pid, bundle: d.patients[pid] })) });
  }
  return { seeded: true, patients: pids.length };
}

module.exports = async (req, res) => {
  try {
    if (!SB_URL || !SB_KEY) return send(res, 500, { detail: "The API is missing its database settings (SUPABASE_URL, SUPABASE_KEY)." });
    const parts = String(req.query.path || "").split("/").filter(Boolean);
    const m = req.method;

    if (parts[0] === "health") {
      const { total } = await sb("patients?select=pid&limit=1", { count: true });
      return send(res, 200, { status: "ok", database: "Supabase PostgreSQL", patients: total, synthetic: true });
    }
    if (parts[0] === "seed" && m === "POST") return send(res, 200, await seed());
    if (parts[0] === "meta") {
      const rows = await sb("meta?select=key,value");
      const out = Object.fromEntries(rows.map(r => [r.key, r.value]));
      out.database = "Supabase PostgreSQL";
      return send(res, 200, out);
    }
    if (parts[0] !== "patients") return send(res, 404, { detail: "Not found." });

    if (parts.length === 1) return send(res, 200, await sb("patients?select=*&order=alerts.desc,tir.asc"));
    const pid = parts[1];
    if (!PID.test(pid)) return send(res, 404, { detail: `No patient with ID ${pid}. Check the register for valid IDs.` });

    if (parts.length === 2) {
      const [row] = await sb(`cases?pid=eq.${pid}&select=bundle`);
      if (!row) return send(res, 404, { detail: `No patient with ID ${pid}. Check the register for valid IDs.` });
      const rev = await sb(`alert_reviews?pid=eq.${pid}&select=k`);
      return send(res, 200, { ...row.bundle, reviewed: rev.map(r => r.k) });
    }
    if (parts[2] === "notes" && parts.length === 3 && m === "GET") {
      return send(res, 200, await sb(`case_notes?pid=eq.${pid}&select=*&order=created_at.desc`));
    }
    if (parts[2] === "notes" && parts.length === 3 && m === "POST") {
      const b = await readBody(req);
      const summary = String(b.summary || "").trim();
      if (summary.length < 3 || summary.length > 500) return send(res, 422, { detail: "Write the advice in 3 to 500 characters before saving." });
      const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
      const advice = { k: b.k, meal_name: b.meal_name ?? null, carbs_g: num(b.carbs_g), gi: num(b.gi, 65), eat_in_min: num(b.eat_in_min, 15), walk_min: num(b.walk_min), sleep_hours: b.sleep_hours ?? null, metformin_taken: b.metformin_taken ?? null };
      const [row] = await sb("case_notes", { method: "POST", prefer: "return=representation", body: {
        pid, at_k: Math.max(0, Math.min(2015, Math.round(num(b.k)))), advice, summary,
        projected_peak: num(b.projected_peak), projected_minutes_above: Math.round(num(b.projected_minutes_above)),
        baseline_peak: num(b.baseline_peak), author: String(b.author || "Demo clinician").slice(0, 64) } });
      return send(res, 201, row);
    }
    if (parts[2] === "notes" && parts.length === 4 && m === "DELETE") {
      await sb(`case_notes?pid=eq.${pid}&id=eq.${Number(parts[3])}`, { method: "DELETE" });
      return send(res, 204);
    }
    if (parts[2] === "alerts" && parts[4] === "review" && m === "POST") {
      const k = Number(parts[3]);
      await sb("alert_reviews", { method: "POST", prefer: "resolution=ignore-duplicates", body: { pid, k } });
      return send(res, 200, { pid, k, reviewed: true });
    }
    return send(res, 404, { detail: "Not found." });
  } catch (e) {
    return send(res, e.status && e.status < 500 ? e.status : 502, { detail: "The database didn't respond as expected. Try again in a moment.", error: String(e.message).slice(0, 300) });
  }
};
