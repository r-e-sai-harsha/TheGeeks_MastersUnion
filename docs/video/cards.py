"""Title cards for the demo video, in the Chaya Rx-pad style. Writes cards/*.html; render with render_cards.js."""
import os, sys
FONTS = sys.argv[1] if len(sys.argv) > 1 else "../../web/assets/fonts"
OUT = sys.argv[2] if len(sys.argv) > 2 else "cards"
os.makedirs(OUT, exist_ok=True)

HEAD = f"""<!doctype html><meta charset=utf-8><style>
@font-face{{font-family:Archivo;src:url({FONTS}/archivo-var.woff2) format('woff2');font-weight:100 900;font-stretch:62% 125%}}
@font-face{{font-family:Mono;src:url({FONTS}/jetbrains-mono-var.woff2) format('woff2');font-weight:100 800}}
@font-face{{font-family:Kalam;src:url({FONTS}/kalam-400.woff2) format('woff2');font-weight:400}}
@font-face{{font-family:Kalam;src:url({FONTS}/kalam-700.woff2) format('woff2');font-weight:700}}
@font-face{{font-family:KalamD;src:url({FONTS}/kalam-deva-400.woff2) format('woff2')}}
*{{margin:0;box-sizing:border-box}}
html,body{{width:1440px;height:810px;overflow:hidden}}
body{{font-family:Archivo,sans-serif;color:#18225a}}
.paper{{background:#edf2e9;background-image:repeating-linear-gradient(to bottom,transparent 0 31px,#d2ddcc 31px 32px)}}
.night{{background:#141d49;color:#f2f5ef}}
.k{{font-family:Mono;font-size:15px;letter-spacing:.16em;text-transform:uppercase}}
h1{{font-stretch:72%;font-weight:800;letter-spacing:-.01em;line-height:.95}}
.hand{{font-family:Kalam,KalamD;}}
</style>"""

SHADOW = """<svg width="1440" height="300" viewBox="0 0 1440 300" style="position:absolute;left:0;bottom:70px">
<path d="M0 230 C 180 226, 300 240, 420 222 S 620 236, 700 214" fill="none" stroke="#b9c0dd" stroke-width="3"/>
<path d="M700 214 C 790 196, 840 70, 930 64 S 1050 190, 1180 200 S 1380 206, 1440 204" fill="none" stroke="#8f74e0" stroke-width="4" stroke-dasharray="14 9"/>
<line x1="700" y1="20" x2="700" y2="280" stroke="#f2f5ef" stroke-width="1.5" opacity=".7"/>
<text x="710" y="36" font-family="Mono" font-size="14" fill="#b9c0dd">now</text></svg>"""


def divider(n, title, kicker):
    return HEAD + f"""<body class=night style="position:relative">
<div style="position:absolute;left:120px;top:210px">
<div class=k style="color:#b9a8f0">{n:02d} &nbsp;·&nbsp; Chaya छाया</div>
<h1 style="font-size:132px;margin-top:26px">{title}</h1>
<p style="font-size:30px;margin-top:26px;color:#b9c0dd;max-width:980px;line-height:1.3">{kicker}</p></div>{SHADOW}</body>"""


cards = {
    "d1": divider(1, "The problem", "India’s diabetes care runs on one number every three months."),
    "d2": divider(2, "The digital twin", "One virtual patient, built from two data streams."),
    "d3": divider(3, "Data &amp; sandbox", "A synthetic Indian cohort, made realistically messy."),
    "d4": divider(4, "Architecture", "From two streams to a two-hour warning, with reasons."),
    "d5": divider(5, "Results", "Tested on 45 patients the model never saw."),
    "d6": divider(6, "Live demo", "chaya-tau.vercel.app &nbsp;·&nbsp; a simulated clinic on Vercel and Supabase."),
    "d7": divider(7, "Safety &amp; roadmap", "Built to support the doctor, not to replace them."),
}

TEAM = [("Sanskriti Saraf", "PGP TBM"), ("Muskan Sharma", "PGP TBM"), ("R. E. Sai Harsha Sadhu", "PGP TBM")]
rows = "".join(f"""<div style="display:flex;align-items:baseline;gap:28px;padding:22px 0;border-bottom:1.5px solid #d5dfd0">
<span class=hand style="font-size:44px;font-weight:700;color:#18225a;flex:1">{n}</span><span class=k style="color:#5d658f">{p} · Masters’ Union</span></div>""" for n, p in TEAM)
cards["team"] = HEAD + f"""<body class=paper style="display:grid;place-items:center">
<div style="width:1040px;background:#fbfcf8;border:1.5px solid #d5dfd0;box-shadow:0 18px 50px rgba(20,29,73,.14);padding:56px 72px 60px;transform:rotate(-.6deg)">
<div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #18225a;padding-bottom:16px">
<div><div class=k style="color:#553a9e">Team</div><h1 style="font-size:96px;margin-top:8px">The Geeks</h1></div>
<div class=k style="text-align:right;color:#5d658f;line-height:1.8">Happiest Health<br>Digital Twin Challenge 2026<br>Phase 1</div></div>
<div style="margin-top:14px">{rows}</div>
<div style="margin-top:30px;display:inline-block;border:3px solid #553a9e;color:#553a9e;padding:8px 18px;transform:rotate(-2deg);font-family:Mono;font-weight:700;letter-spacing:.12em;font-size:18px">MASTERS’ UNION</div>
</div></body>"""

cards["end"] = HEAD + f"""<body class=night style="position:relative">
<div style="position:absolute;left:120px;top:150px;right:120px">
<div class=k style="color:#b9a8f0">Thank you</div>
<h1 style="font-size:120px;margin-top:22px">See the spike before it happens.</h1>
<div style="margin-top:56px;display:grid;grid-template-columns:200px 1fr;row-gap:20px;font-size:30px">
<span class=k style="color:#b9c0dd;padding-top:9px">Live app</span><span>chaya-tau.vercel.app</span>
<span class=k style="color:#b9c0dd;padding-top:9px">Code</span><span>github.com/r-e-sai-harsha/TheGeeks_MastersUnion</span>
<span class=k style="color:#b9c0dd;padding-top:9px">Team</span><span>The Geeks · Sanskriti Saraf · Muskan Sharma · R. E. Sai Harsha Sadhu</span>
<span class=k style="color:#b9c0dd;padding-top:9px"></span><span style="color:#b9c0dd;font-size:24px">Masters’ Union · All patient data is synthetic · MIT licence</span>
</div></div></body>"""

for k, v in cards.items():
    open(f"{OUT}/{k}.html", "w").write(v)
print(" ".join(cards))
