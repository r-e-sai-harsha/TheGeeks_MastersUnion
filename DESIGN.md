# Chaya design system

World: the Indian OPD prescription pad. Pale pad-green ruled paper, ballpoint-blue ink, a navy letterhead band, violet carbon "shadow" for Chaya's forecast, rubber stamps for state. Source of truth: `web/assets/chaya.css` (`:root` tokens, light and dark).

## Tokens

| Role | Token | Light | Dark |
|---|---|---|---|
| Page (pad paper) | `--paper` | #edf2e9 | #10162b |
| Ruled line | `--paper-rule` | #d2ddcc | #1d2645 |
| Slip / panel | `--sheet` | #fbfcf8 | #161e38 |
| Inset field | `--sheet-2` | #f3f6ef | #1c2545 |
| Hairline | `--edge` | #d5dfd0 | #28325a |
| Ink (text, glucose line) | `--ink` | #18225a | #e6e9f6 |
| Secondary ink | `--ink-2` / `--ink-3` | #434c7c / #5d658f | #b6bcda / #959cc0 |
| Letterhead band | `--letterhead` | #141d49 | #0b1024 |
| Forecast (the shadow) | `--shadow` | #6a44c9 | #ad94ff |
| Spike likely stamp | `--alert` | #bd3326 | #ff7d6b |
| Watch stamp | `--watch` | #8f5400 | #f0b252 |
| In range stamp | `--ok` | #276f45 | #74cf98 |
| Low-glucose risk | `--low` / `--low-soft` | #0e6688 / #d9edf4 | (light only) |
| Target band 70–180 | `--band` | #dcebd6 | #18302a |
| What happened next | `--replay` | #a3a9c2 | #59618a |
| Tour slip | `--chit` | #fff5c4 | #3b3518 |
| Synthetic strip | `--strip` | #553a9e | #3d2c7a |

Type: **Hind** (self-hosted, Devanagari only) backs Archivo for Hindi text. **Archivo** variable (UI at 100% width; letterhead and headings at 70–74% width, 800 weight), **Kalam** for handwriting (patient fields, Rx advice, tour headings, Devanagari छाया), **JetBrains Mono** for readings and times only. Scale `--t-xs` 12px → `--t-3xl` clamp(2.6–4.6rem). Spacing 4/8/12/16/24/32/48/72. Radii 3px and 6px. Elevation: neutral `--lift`, `--lift-hi`. Motion: `--ease` cubic-bezier(.16,1,.3,1); one signature moment, the stamp press.

## Components

- **Stamp** (`.stamp.alert|watch|ok|na`): double-ruled rubber stamp, rotated −4°, grain mask, press animation on change. The only place state colour is loud.
- **Slip** (`.slip`): white sheet with a perforated top edge; letterhead title, handwritten fields, chart, ℞ advice lines with chips.
- **Panel** (`.panel` + `.panel-h`): case-file section with heading and an `i` button that opens the matching glossary entry.
- **Register row** (`.rrow`): name, demographics, HbA1c, warning count chip, time-in-range bar. Current row: violet tint, violet name.
- **Segmented control** (`.seg`), **chip** (`.chip`), **quick advice** (`.quick`, dashed violet).
- **Tour card** (`.tour-card`): yellow tear-off chit with Kalam heading, step dots, Back / Next / Skip; spotlight ring in `--shadow`.
- **Glossary drawer** (`.drawer`), **welcome slip** (`.welcome`), **toast**.

- **Patient app** (`.phone`, `.pc-*`): the patient's carbon copy. Navy letterhead band with an EN/हिं toggle, the reading on a perforated slip, the doctor's advice as a yellow chit in Kalam, alerts as the one loud surface (solid `--low` for a low now), medicine rows, a ruled fields strip, and a five-slot tab bar with a raised violet Log button that opens a bottom sheet.
- **Escalation card** (`.esc`): owner, contact-by time and status in the Next 2 hours panel; yellow while open, vermilion tint when overdue, green when resolved.
- **Threshold popover** (`.thr-pop`): measured trade-off curve with presets.

- **Header modes**: home shows section links only (entry is through the hero CTA and the patient app section). In-product (`.mode-app`) adds a home icon, a pill track (navy #090e2c, active pill violet gradient) as a Clinic / Patient app switcher, and *Outcomes* · *Data sources* at the right.
- **Rx dock**: `.rx-fab` (letterhead navy, violet ℞ chip) fixed bottom right; `.rxdock` opens above it with a navy title bar (minimise, close) and a scrolling body; a full-width bottom sheet under 640px.
- **Action toast**: `toast(msg, {label, href})` adds a violet-soft link button and stays for 9 s.
- **Names**: every synthetic patient has a surname (`scripts/surnames.json`); full names in lists, headings and pickers, first names in greetings.

## Rules

- Violet means forecast and Chaya's own marks; vermilion means a spike warning; deep blue means low glucose; never swap them.
- State is always shape plus word (stamp text, triangle markers), never colour alone.
- Synthetic-data status is visible on every screen (strip under the letterhead).
- Handwriting is for things a doctor writes; numbers are always mono.
