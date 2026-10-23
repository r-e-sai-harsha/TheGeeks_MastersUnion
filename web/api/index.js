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
    if (parts[0] === "seed") return send(res, 200, await seed());   // idempotent: loads only into an empty database
    if (parts[0] === "meta") {
      const rows = await sb("meta?select=key,value");
      const out = Object.fromEntries(rows.map(r => [r.key, r.value]));
      out.database = "Supabase PostgreSQL";
      return send(res, 200, out);
    }
    if (parts[0] === "outcomes") {
      const [notes, reviews, esc, logs] = await Promise.all([
        sb("case_notes?select=id,pid,at_k,ack_at,created_at"), sb("alert_reviews?select=pid,k"),
        sb("escalations?select=id,pid,kind,status,channel,created_at,updated_at"), sb("patient_logs?select=id,pid,kind,created_at")]);
      const mins = esc.filter(e => e.status !== "open").map(e => (new Date(e.updated_at) - new Date(e.created_at)) / 60000).sort((x, y) => x - y);
      return send(res, 200, { notes: notes.length, notes_acknowledged: notes.filter(n => n.ack_at).length, reviews: reviews.length,
        escalations: { total: esc.length, open: esc.filter(e => e.status === "open").length, contacted: esc.filter(e => e.status === "contacted").length, resolved: esc.filter(e => e.status === "resolved").length,
          low: esc.filter(e => e.kind === "low").length, median_minutes_to_contact: mins.length ? Math.round(mins[Math.floor(mins.length / 2)]) : null },
        patient_logs: { meals: logs.filter(l => l.kind === "meal").length, doses: logs.filter(l => l.kind === "dose").length },
        by_patient: Object.fromEntries([...new Set([...notes, ...esc, ...reviews].map(x => x.pid))].map(pid => [pid, {
          notes: notes.filter(n => n.pid === pid).length, acked: notes.filter(n => n.pid === pid && n.ack_at).length,
          reviews: reviews.filter(r => r.pid === pid).length, open: esc.filter(e => e.pid === pid && e.status === "open").length, escalations: esc.filter(e => e.pid === pid).length }])) });
    }
    if (parts[0] === "escalations" && parts.length === 2 && (m === "PATCH" || m === "POST")) {
      const id = Number(parts[1]); if (!Number.isInteger(id)) return send(res, 404, { detail: "Not found." });
      const bd = await readBody(req), patch = { updated_at: new Date().toISOString() };
      if (bd.status) { if (!["open", "contacted", "resolved"].includes(bd.status)) return send(res, 422, { detail: "Status must be open, contacted or resolved." }); patch.status = bd.status; }
      if (bd.channel) { if (!["whatsapp", "call", "app"].includes(bd.channel)) return send(res, 422, { detail: "Channel must be whatsapp, call or app." }); patch.channel = bd.channel; }
      if (bd.outcome != null) patch.outcome = String(bd.outcome).slice(0, 280);
      const [row] = await sb(`escalations?id=eq.${id}`, { method: "PATCH", prefer: "return=representation", body: patch });
      return row ? send(res, 200, row) : send(res, 404, { detail: "No escalation with that ID." });
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
    if (parts[2] === "notes" && parts.length === 5 && parts[4] === "ack" && m === "POST") {
      const [row] = await sb(`case_notes?pid=eq.${pid}&id=eq.${Number(parts[3])}`, { method: "PATCH", prefer: "return=representation", body: { ack_at: new Date().toISOString() } });
      return row ? send(res, 200, row) : send(res, 404, { detail: "No note with that ID." });
    }
    if (parts[2] === "escalations" && parts.length === 3 && m === "GET") return send(res, 200, await sb(`escalations?pid=eq.${pid}&select=*&order=created_at.desc`));
    if (parts[2] === "escalations" && parts.length === 3 && m === "POST") {
      const bd = await readBody(req), k = Math.round(Number(bd.k));
      if (!Number.isFinite(k) || k < 0 || k > 2015) return send(res, 422, { detail: "The warning time is missing." });
      const owner = String(bd.owner || "").trim();
      if (owner.length < 2 || owner.length > 64) return send(res, 422, { detail: "Name who owns this warning (2 to 64 characters)." });
      const kind = bd.kind === "low" ? "low" : "spike";
      const [row] = await sb("escalations", { method: "POST", prefer: "return=representation", body: { pid, k, kind, owner, due_k: Math.min(2100, Math.max(k, Math.round(Number(bd.due_k) || k + 6))), status: "open" } });
      return send(res, 201, row);
    }
    if (parts[2] === "logs" && parts.length === 3 && m === "GET") return send(res, 200, await sb(`patient_logs?pid=eq.${pid}&select=*&order=k.asc`));
    if (parts[2] === "logs" && parts.length === 3 && m === "POST") {
      const bd = await readBody(req), k = Math.round(Number(bd.k));
      if (!Number.isFinite(k) || k < 0 || k > 2015) return send(res, 422, { detail: "The time of the log is missing." });
      const kind = bd.kind === "dose" ? "dose" : "meal", num = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
      const body = kind === "meal"
        ? { pid, k, kind, meal: String(bd.meal || "").slice(0, 80), carbs: num(bd.carbs, 0, 300), gi: num(bd.gi, 0, 110), photo: !!bd.photo }
        : { pid, k, kind, drug: String(bd.drug || "").slice(0, 80) };
      if (kind === "meal" && !body.meal) return send(res, 422, { detail: "Pick a dish before saving." });
      if (kind === "dose" && !body.drug) return send(res, 422, { detail: "Pick the medicine before saving." });
      const [row] = await sb("patient_logs", { method: "POST", prefer: "return=representation", body });
      return send(res, 201, row);
    }
    if (parts[2] === "logs" && parts.length === 4 && m === "DELETE") {
      await sb(`patient_logs?pid=eq.${pid}&id=eq.${Number(parts[3])}`, { method: "DELETE" });
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
