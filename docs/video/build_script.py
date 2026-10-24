"""Write docs/video_script.md from docs/video/narration.json (run-sheet + narration with timings)."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
n = json.loads((HERE / "narration.json").read_text())
ACT = {
    "broll+title": "Title slide (slide 1) or b-roll; Chaya wordmark.",
    "card:team": "Team card: three names, Masters' Union.",
    "app:home": "Live app home page. On the forecast slip click **Chicken biryani** + **Rest** (SPIKE LIKELY), then **Ragi mudde** + **Walk 20 min** (IN RANGE). Scroll past the *The clinic* and *Patient app* sections.",
    "app:clinic": "Click **Open the simulated clinic** in the hero. Point at the header (home icon, Clinic / Patient app switcher, Outcomes, Data sources), the purple synthetic strip and the *Live · Supabase* pill.",
    "app:tour": "Welcome slip → **Take the 1-minute tour**. Let it run: register pinned left, forecast and twin pinned right, ℞ *Advise / Prescribe* bottom right.",
    "app:case1-3": "**Guide → Walk through a case**, steps 1–3 (Sanjay Krishnan at 12:15; biryani 237).",
    "app:case4-5": "Case steps 4–5 (ragi mudde 194; + 20-min walk 178, 0 min above 180).",
    "app:case6-8": "Case steps 6–8 (12:45, SPIKE LIKELY 92%), then **Save and send to patient**. Wait for the toast.",
    "app:patient": "Click **Open Sanjay's advice** in the toast → Advice tab → **Got it**. Then Today: scroll to medicines, tap **+** (log sheet, close), tap **हिं** and back to **EN**.",
    "app:register": "Switch to **Clinic** in the header. Sort the register by *Lowest time in range* and *Low-glucose risk*; open another patient; press **Replay** for ~15 s.",
    "app:review": "Click **Mark warning as reviewed**; click an **i** and a **Sources** button.",
    "app:low": "Home → patient app section → **See a low-glucose warning** (Geeta Mukherjee, Mon 09:15). Show the phone, then switch to **Clinic**: LOW LIKELY stamp and reasons.",
    "app:escalate": "Under *Who acts on this?* pick an owner and 15 min → **Assign and start the clock** → show **WhatsApp** and **Log a call** (log one outcome).",
    "app:rx": "Open ℞ **Advise / Prescribe**; set metformin *Missed* and sleep 5 h; the peak rises; minimise and reopen the dock.",
    "app:outcomes": "Header → **Outcomes**: TIR goal, daily TIR, low safety, alert load, funnel. Back to Clinic → **Alerts** control: *Catch more* ↔ *Fewer alerts*.",
    "app:data": "Header → **Data sources**: the four groups; open one parameter.",
    "app:ptour": "**Guide → Patient app tour**: click through 3–4 steps.",
    "app:backend": "Open `https://chaya-tau.vercel.app/api/health`; optionally local `/docs` and `/api/pipeline/GT-1102/risk?at=2026-09-20T12:45`.",
}


def act(v):
    return f"Presentation slide {v.split(':')[1]}." if v.startswith("slide:") else ACT.get(v, v)


WPM, PAUSE = 134, 3
fmt = lambda s: f"{int(s // 60)}:{int(s % 60):02d}"
t, rows = 0.0, []
for x in n:
    d = len(x["text"].split()) / WPM * 60 + PAUSE
    rows.append((t, x)); t += d

out = ["# Chaya: demo video script (about 19 minutes; the form allows 15–20)", "",
       "Updated for the submission build: low-glucose warnings, escalation, clinic outcomes, alert threshold, the bilingual patient app with logging and read receipts, the new header and clinic workspace (pinned panes, ℞ dock, toast link), patient surnames, data sources and the patient app tour.", "",
       "Record your voice over the slides (`docs/Chaya_Presentation.pdf`, 22 slides) and the live app (https://chaya-tau.vercel.app), then upload to YouTube as **Unlisted**. The narration is also in [`video/narration.json`](video/narration.json), one segment per shot, so the voice-over can be regenerated; this file is rebuilt from it by `python docs/video/build_script.py`. Timings assume 134 words a minute plus a 3-second pause per shot.", "",
       "**Before you record**",
       "- Open the presentation full-screen, and the live app in a private window so the welcome slip appears.",
       "- Check the header pill says *Live · Supabase*. If it says *Offline demo*, reload once (the first request can be a cold start).",
       "- 1080p, mic close, notifications off. A webcam bubble in a corner helps.", "",
       "## Run-sheet", "", "| Time | Shot | On screen |", "|---|---|---|"]
out += [f"| {fmt(t0)} | `{x['id']}` | {act(x['visual'])} |" for t0, x in rows]
out += ["", f"Total ≈ {fmt(t)}.", "", "## Narration", ""]
for t0, x in rows:
    out += [f"### {fmt(t0)} · {x['id']}", "", f"*{act(x['visual'])}*", "", f"> {x['text']}", ""]
out += ["## What is new since the first cut of the video", "",
        "| New in the product | Where it appears in this script |", "|---|---|",
        "| Header: section links on home; inside, home icon, Clinic / Patient app switcher, Outcomes, Data sources | `13_clinic` |",
        "| Register and forecast panes pinned to the screen edges; ℞ *Advise / Prescribe* dock | `13b_tour`, `20_rx` |",
        "| *Save and send to patient* toast linking to the patient's Advice tab | `16_case_c`, `16b_patient` |",
        "| Bilingual patient app: advice with read receipt, today, dose reminders, meal logging, Hindi | `16b_patient` |",
        "| Surnames for every patient | `14_case_a`, `17_register` |",
        "| Low-glucose warnings (7 of 10 lows, median 80 min ahead) | `07_arch`, `19b_low` |",
        "| Escalation: owner, contact-by time, WhatsApp, call log | `19c_escalate` |",
        "| Clinic outcomes and the alert threshold trade-off | `20b_outcomes` |",
        "| Data sources page and Sources buttons | `19_review`, `20c_data` |",
        "| Patient app tour | `20d_ptour` |",
        "| API in Mumbai, data in Supabase | `13_clinic`, `22_backend` |", "",
        "### Speaking tips", "- Talk to one doctor, not to \"the jury\".",
        "- Pause on each result slide for two seconds before you speak.",
        "- If a number feels dense, say what it means: \"eight in ten spikes, warned an hour early.\""]
(HERE.parent / "video_script.md").write_text("\n".join(out) + "\n")
print("video_script.md", fmt(t))
