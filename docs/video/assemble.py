"""Assemble the Chaya demo video.
Usage: python3 assemble.py <work_dir>
Expects in work_dir: vo/<id>.wav, slides/s-NN.png, cards/*.png, broll.mp4, rec2/app_video.mp4, app/app_audio.wav,
chaya/docs/video/narration.json. Writes out/chaya_demo.mp4 and out/chaya_demo.srt."""
import json, os, re, subprocess, sys, difflib

W = sys.argv[1]; os.chdir(W)
os.makedirs("out/clips", exist_ok=True)
FPS, X = 30, 0.5  # frame rate, crossfade length
N = {s["id"]: s["text"] for s in json.load(open("chaya/docs/video/narration.json"))}
dur = lambda f: float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]))
VO = {k: dur(f"vo/{k}.wav") for k in N}

# (kind, source, duration, vo_id, vo_offset, motion)
items = []
def still(src, vo=None, lead=0.6, tail=0.9, d=None, motion="zoom"):
    items.append(("still", src, d if d else lead + VO[vo] + tail, vo, lead, motion))
def card(name, d=2.8):
    items.append(("still", f"cards/{name}.png", d, None, 0, "drift"))

B = dur("broll.mp4")
items.append(("video", "broll.mp4", B, "01_hook", 0.9, None))
still("slides/s-01.png", d=0.9 + VO["01_hook"] + 1.4 - (B - X), motion="zoom")
still("cards/team.png", "02_team", 0.6, 1.0, motion="drift")
card("d1"); still("slides/s-02.png", "03_problem"); still("slides/s-03.png", "04_india")
card("d2"); still("slides/s-04.png", "05_twin", tail=1.2)
card("d3"); still("slides/s-05.png", "06_data", tail=1.2)
card("d4"); still("slides/s-06.png", "07_arch", tail=1.2, motion="pan")
card("d5"); still("slides/s-07.png", "08_validity"); still("slides/s-08.png", "09_results")
still("slides/s-09.png", "10_fusion"); still("slides/s-10.png", "11_coldstart"); still("slides/s-12.png", "11b_explain", tail=1.2)
card("d6", 3.0)
items.append(("video", "rec2/app_video.mp4", dur("rec2/app_video.mp4"), "@app", 0, None))
card("d7"); still("slides/s-14.png", "23_safety"); still("slides/s-15.png", "24_roadmap")
still("slides/s-16.png", "25_close", tail=2.4)
card("end", 7.0)

# render each visual clip (video only), 1920x1080@30
clips = []
for i, (kind, src, d, vo, off, motion) in enumerate(items):
    out = f"out/clips/{i:02d}.mp4"; clips.append(out)
    n = int(round(d * FPS))
    if kind == "still":
        if motion == "zoom":
            vf = f"scale=3840:2160,zoompan=z='1+0.045*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s=1920x1080:fps={FPS}"
        elif motion == "pan":
            vf = f"scale=3840:2160,zoompan=z='1.16':x='(iw-iw/zoom)*on/{n}':y='(ih-ih/zoom)/2':d={n}:s=1920x1080:fps={FPS}"
        else:
            vf = f"scale=3840:2160,zoompan=z='1.02+0.02*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s=1920x1080:fps={FPS}"
        cmd = ["-loop", "1", "-framerate", str(FPS), "-t", f"{d:.3f}", "-i", src, "-vf", vf + ",format=yuv420p"]
    else:
        cmd = ["-i", src, "-vf", f"scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps={FPS},format=yuv420p", "-t", f"{d:.3f}"]
    if not os.path.exists(out):
        subprocess.check_call(["ffmpeg", "-y", "-v", "error", *cmd, "-an", "-frames:v", str(n), "-c:v", "libx264", "-preset", "fast", "-crf", "17", out])
    print("clip", i, src, round(d, 2), flush=True)

# timeline with crossfades; item i starts at S[i]
S, t = [], 0.0
for (_, _, d, *_) in items:
    S.append(t); t += d - X
total = t + X
# video: chained xfade
inp, f, last = [], [], "[0:v]"
for c in clips: inp += ["-i", c]
for i in range(1, len(clips)):
    off = S[i]
    tr = "fade" if items[i][3] == "@app" or items[i - 1][3] == "@app" else "fade"
    f.append(f"{last}[{i}:v]xfade=transition={tr}:duration={X}:offset={off:.3f}[v{i}]"); last = f"[v{i}]"
f.append(f"{last}fade=t=in:st=0:d=0.8,fade=t=out:st={total-1.2:.3f}:d=1.2[vout]")
subprocess.check_call(["ffmpeg", "-y", "-v", "error", *inp, "-filter_complex", ";".join(f), "-map", "[vout]",
                       "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS), "out/video.mp4"])

# audio: place each VO at its absolute time
place = []  # (file, start_seconds, id)
for i, (kind, src, d, vo, off, _) in enumerate(items):
    if vo == "@app": place.append(("app/app_audio.wav", S[i], "@app"))
    elif vo: place.append((f"vo/{vo}.wav", S[i] + off, vo))
ain, af = [], []
for j, (fname, st, _) in enumerate(place):
    ain += ["-i", fname]
    af.append(f"[{j}:a]aresample=48000,aformat=channel_layouts=mono,adelay={int(st*1000)}[a{j}]")
af.append("".join(f"[a{j}]" for j in range(len(place))) + f"amix=inputs={len(place)}:normalize=0,apad,atrim=0:{total:.3f},"
          "highpass=f=70,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=120,loudnorm=I=-16:TP=-1.5:LRA=9,aformat=channel_layouts=stereo[aout]")
subprocess.check_call(["ffmpeg", "-y", "-v", "error", *ain, "-filter_complex", ";".join(af), "-map", "[aout]", "-ar", "48000", "out/audio.wav"])
subprocess.check_call(["ffmpeg", "-y", "-v", "error", "-i", "out/video.mp4", "-i", "out/audio.wav", "-map", "0:v", "-map", "1:a",
                       "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", "out/chaya_demo.mp4"])

# subtitles from authored text, timed by word alignment
from faster_whisper import WhisperModel
m = WhisperModel("base.en", compute_type="int8")
norm = lambda w: re.sub(r"[^a-z0-9]", "", w.lower())
app = json.load(open("app/app_segments.json"))
segs = []
for fname, st, vid in place:
    if vid == "@app":
        for k, s0 in app["start"].items(): segs.append((k, st + s0))
    else: segs.append((vid, st))
cues = []
for vid, st in segs:
    raw = N[vid].split()
    script = [norm(w) for w in raw]
    ww = [(norm(w.word), w.start, w.end) for x in m.transcribe(f"vo/{vid}.wav", word_timestamps=True)[0] for w in x.words]
    sm = difflib.SequenceMatcher(a=script, b=[w for w, *_ in ww], autojunk=False)
    ts = [None] * len(script)
    for a, b, n in sm.get_matching_blocks():
        for k in range(n): ts[a + k] = (ww[b + k][1], ww[b + k][2])
    for k in range(len(ts)):  # interpolate gaps
        if ts[k] is None:
            prev = next((ts[j] for j in range(k - 1, -1, -1) if ts[j]), (0, 0))
            nxt = next((ts[j] for j in range(k + 1, len(ts)) if ts[j]), (VO[vid], VO[vid]))
            ts[k] = (prev[1], max(prev[1] + .05, nxt[0]))
    line = []
    for k, w in enumerate(raw):
        line.append(k)
        txt = " ".join(raw[j] for j in line)
        if len(txt) > 34 and (w.endswith((",", ".", "?", ":", ";")) or len(txt) > 62) or k == len(raw) - 1:
            cues.append((st + ts[line[0]][0], st + ts[line[-1]][1], txt)); line = []
fmt = lambda s: f"{int(s//3600):02d}:{int(s%3600//60):02d}:{int(s%60):02d},{int(s*1000%1000):03d}"
with open("out/chaya_demo.srt", "w") as fh:
    for k, (a, b, txt) in enumerate(cues, 1):
        txt = txt.replace("H-b-A-1-c", "HbA1c")
        fh.write(f"{k}\n{fmt(a)} --> {fmt(max(b, a + .8))}\n{txt}\n\n")
print("total", round(total, 1), "s ->", round(total / 60, 2), "min; subtitles", len(cues))
