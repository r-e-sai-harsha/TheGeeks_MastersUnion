"""Turn VO word timings into a timed action list for record.js, and the matching app audio track.
Usage: python3 build_cues.py narration.json vo_dir out_dir
Writes out_dir/app_audio.wav, out_dir/cues.json, out_dir/app_segments.json (start offsets per segment)."""
import json, re, subprocess, sys, difflib
from faster_whisper import WhisperModel

narr, vo, out = sys.argv[1:4]
N = {s["id"]: s["text"] for s in json.load(open(narr))}
APP = "https://chaya-tau.vercel.app/"
REPO = "https://github.com/r-e-sai-harsha/TheGeeks_MastersUnion"
NEXT = "#tour-card [data-t=next]"
SEGS = ["12_home", "12b_howitworks", "13_clinic", "13b_tour", "14_case_a", "15_case_b", "16_case_c",
        "17_register", "18_replay", "19_review", "20_rx", "21_festival", "22_backend", "22b_code"]
GAP = {"13_clinic": 1.4, "13b_tour": 1.2, "18_replay": 13.0, "19_review": 1.6, "21_festival": 1.4, "22b_code": 1.5}
LEAD = 1.2  # seconds of picture before the first word

# (segment, phrase or "@start"/"@end", offset seconds, action dict)
C = [
 ("12_home", "chicken biryani", -0.2, {"a": "click", "s": "#slip [data-meal=biryani]"}),
 ("12_home", "and rests", 0, {"a": "click", "s": "#slip [data-walk='0']"}),
 ("12_home", "stamp reads spike", 0, {"a": "move", "s": "#slip-stamp"}),
 ("12_home", "switch to ragi", 0.3, {"a": "click", "s": "#slip [data-meal=ragi]"}),
 ("12_home", "add a twentyminute", 0, {"a": "click", "s": "#slip [data-walk='20']"}),
 ("12_home", "shadow flattens", 0, {"a": "move", "s": "#slip-svg", "fx": .62, "fy": .45}),
 ("12_home", "stamp reads in", 0, {"a": "move", "s": "#slip-stamp"}),
 ("12_home", "whole idea", 0, {"a": "xy", "x": 560, "y": 640}),
 ("12b_howitworks", "scroll down", 0, {"a": "scroll", "s": "#how"}),
 ("12b_howitworks", "evidence section", -0.4, {"a": "scroll", "s": "#evidence"}),
 ("12b_howitworks", "built for india", -0.4, {"a": "scroll", "s": "#india"}),
 ("12b_howitworks", "safety section", -0.4, {"a": "scroll", "s": "#safety"}),
 ("13_clinic", "@start", -1.0, {"a": "top"}),
 ("13_clinic", "simulated clinic", -0.6, {"a": "click", "s": "#cta-top"}),
 ("13_clinic", "the strip", 0, {"a": "xy", "x": 720, "y": 74}),
 ("13_clinic", "the pill", 0, {"a": "move", "s": "#conn"}),
 ("13_clinic", "welcome slip", 0, {"a": "move", "s": ".welcome h3"}),
 ("13_clinic", "start with the tour", 0.2, {"a": "click", "s": "[data-w=tour]"}),
 ("13b_tour", "the clock bar", -0.3, {"a": "click", "s": NEXT}),
 ("13b_tour", "the case sheet", -0.3, {"a": "click", "s": NEXT}),
 ("13b_tour", "the day trace", -0.3, {"a": "click", "s": NEXT}),
 ("13b_tour", "the stamp on", -0.3, {"a": "click", "s": NEXT}),
 ("13b_tour", "every warning lists", -0.3, {"a": "click", "s": NEXT}),
 ("13b_tour", "the twin panel", -0.3, {"a": "click", "s": NEXT}),
 ("13b_tour", "the rx pad", -0.3, {"a": "click", "s": NEXT}),
 ("13b_tour", "and help is", -0.3, {"a": "click", "s": NEXT}),
 ("13b_tour", "@end", 0.5, {"a": "click", "s": NEXT}),
 ("14_case_a", "from the guide", 0, {"a": "click", "s": "#help-btn"}),
 ("14_case_a", "walk through sanjays", 0, {"a": "click", "s": "[data-help=case]"}),
 ("14_case_a", "over his first", -0.3, {"a": "click", "s": NEXT}),
 ("14_case_a", "if he eats", -0.3, {"a": "click", "s": NEXT}),
 ("15_case_b", "swap the rice", -0.3, {"a": "click", "s": NEXT}),
 ("15_case_b", "add a twentyminute", -0.3, {"a": "click", "s": NEXT}),
 ("16_case_c", "now what actually", -0.3, {"a": "click", "s": NEXT}),
 ("16_case_c", "on the day trace", -0.3, {"a": "click", "s": NEXT}),
 ("16_case_c", "finally the doctor", -0.3, {"a": "click", "s": NEXT}),
 ("16_case_c", "it is written", -0.4, {"a": "click", "s": NEXT}),
 ("16_case_c", "along with the", 0, {"a": "click", "s": "#save-note"}),
 ("17_register", "on the left", -0.4, {"a": "top"}),
 ("17_register", "register of forty", 0, {"a": "move", "s": "#register", "fy": .3}),
 ("17_register", "each bar shows", 0, {"a": "move", "s": ".rrow", "fy": .92}),
 ("17_register", "sort by lowest", 0, {"a": "select", "s": "#sort", "v": "tir"}),
 ("17_register", "open another patient", 0, {"a": "click", "s": ".rrow"}),
 ("17_register", "drag the clock", 0, {"a": "drag", "from": -1, "to": -34, "ms": 6500}),
 ("18_replay", "@start", -0.9, {"a": "click", "s": "#days [data-d='5']"}),
 ("18_replay", "press replay", 0, {"a": "click", "s": "#play"}),
 ("18_replay", "@end", 12.0, {"a": "click", "s": "#play"}),
 ("19_review", "@start", -1.4, {"a": "hash", "v": "#/clinic/GT-1102"}),
 ("19_review", "@start", -0.6, {"a": "click", "s": "#days [data-d='6']"}),
 ("19_review", "@start", 0.0, {"a": "range", "s": "#tslider", "v": 51}),
 ("19_review", "marked as reviewed", -0.3, {"a": "click", "s": "#review-btn"}),
 ("19_review", "the guide opens", -0.2, {"a": "click", "s": "#help-btn"}),
 ("19_review", "whats what", -0.2, {"a": "click", "s": "[data-help=glossary]"}),
 ("19_review", "each panel has", 0, {"a": "click", "s": "#gloss-close"}),
 ("19_review", "small i button", 0, {"a": "click", "s": "#risk .info"}),
 ("19_review", "@end", 1.2, {"a": "click", "s": "#gloss-close"}),
 ("20_rx", "the rx pad", 0, {"a": "scroll", "s": "#rxpad"}),
 ("20_rx", "set metformin", 0, {"a": "click", "s": "#w-met [data-m='0']"}),
 ("20_rx", "last nights sleep", 0.2, {"a": "range", "s": "#w-sleep", "v": 5}),
 ("20_rx", "the peak rises", 0, {"a": "move", "s": "#rx-result"}),
 ("20_rx", "this is a conversation", 0, {"a": "move", "s": "#wi-svg"}),
 ("21_festival", "switch to wednesday", 0, {"a": "click", "s": "#days [data-d='2']"}),
 ("21_festival", "the swings", 0, {"a": "drag", "from": -1, "to": -26, "ms": 3500}),
 ("21_festival", "warnings rise", 0.4, {"a": "move", "s": "#risk", "fy": .25}),
 ("22_backend", "the health endpoint", -0.2, {"a": "goto", "v": APP + "api/health"}),
 ("22_backend", "the health endpoint", 0.6, {"a": "css", "v": "html,body{background:#edf2e9!important}body{padding:120px 110px!important}pre{font:500 40px/1.6 'JetBrains Mono',monospace!important;color:#18225a!important;white-space:pre-wrap!important;background:#fbfcf8;border:2px solid #d5dfd0;padding:48px 56px;border-radius:6px}"}),
 ("22_backend", "the health endpoint", 0.9, {"a": "pretty"}),
 ("22_backend", "open source on", -0.3, {"a": "goto", "v": REPO}),
 ("22b_code", "the repository holds", 0, {"a": "wheel", "n": 9, "v": 140, "ms": 380}),
 ("22b_code", "here is one", -0.3, {"a": "goto", "v": REPO + "/blob/main/data/ehr/fhir/GT-1102.json"}),
 ("22b_code", "with conditions medications", 0, {"a": "wheel", "n": 10, "v": 160, "ms": 420}),
 ("22b_code", "a single script", -0.3, {"a": "goto", "v": REPO + "/blob/main/run_all.sh"}),
]

norm = lambda w: re.sub(r"[^a-z0-9]", "", w.lower())
m = WhisperModel("base.en", compute_type="int8")
dur, words = {}, {}
for s in SEGS:
    f = f"{vo}/{s}.wav"
    dur[s] = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]))
    segs, _ = m.transcribe(f, word_timestamps=True)
    ww = [(norm(w.word), w.start) for x in segs for w in x.words]
    script = [norm(w) for w in N[s].replace("-", "").split()]
    sm = difflib.SequenceMatcher(a=script, b=[w for w, _ in ww], autojunk=False)
    t = [None] * len(script)
    for a, b, n in sm.get_matching_blocks():
        for i in range(n): t[a + i] = ww[b + i][1]
    # fill unmatched words by interpolation
    known = [(i, v) for i, v in enumerate(t) if v is not None]
    for i in range(len(t)):
        if t[i] is None:
            lo = max([k for k in known if k[0] < i], default=(-1, 0.0), key=lambda k: k[0])
            hi = min([k for k in known if k[0] > i], default=(len(t), dur[s]), key=lambda k: k[0])
            t[i] = lo[1] + (hi[1] - lo[1]) * (i - lo[0]) / (hi[0] - lo[0])
    words[s] = (script, t)
    print(s, round(dur[s], 1), f"matched {sum(n for *_, n in sm.get_matching_blocks())}/{len(script)}")

start, cur = {}, LEAD
for s in SEGS:
    start[s] = cur; cur += dur[s] + GAP.get(s, 0.9)
total = cur
cues = []
for s, ph, off, act in C:
    script, t = words[s]
    if ph == "@start": at = 0
    elif ph == "@end": at = dur[s]
    else:
        p = [norm(w) for w in ph.split()]
        idx = next((i for i in range(len(script)) if script[i:i + len(p)] == p), None)
        if idx is None: raise SystemExit(f"phrase not found: {s}: {ph}")
        at = t[idx]
    cues.append({"t": round(start[s] + at + off, 2), **act})
cues.sort(key=lambda c: c["t"])
cues.append({"t": round(total, 2), "a": "xy", "x": 1400, "y": 790})
json.dump(cues, open(f"{out}/cues.json", "w"), indent=0)
json.dump({"start": start, "dur": dur, "total": total}, open(f"{out}/app_segments.json", "w"), indent=1)

# app audio: lead silence, segments with gaps
parts, filt = [], []
for i, s in enumerate(SEGS):
    parts += ["-i", f"{vo}/{s}.wav"]
    filt.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=mono,adelay={int(start[s]*1000)}[a{i}]")
mix = "".join(f"[a{i}]" for i in range(len(SEGS)))
filt.append(f"{mix}amix=inputs={len(SEGS)}:normalize=0,apad,atrim=0:{total:.3f}[out]")
subprocess.check_call(["ffmpeg", "-y", "-v", "error", *parts, "-filter_complex", ";".join(filt), "-map", "[out]", "-ar", "48000", f"{out}/app_audio.wav"])
print("app total", round(total, 1), "cues", len(cues))
