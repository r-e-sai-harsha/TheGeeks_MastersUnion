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
| Target band 70–180 | `--band` | #dcebd6 | #18302a |
| What happened next | `--replay` | #a3a9c2 | #59618a |
| Tour slip | `--chit` | #fff5c4 | #3b3518 |
| Synthetic strip | `--strip` | #553a9e | #3d2c7a |

Type: **Archivo** variable (UI at 100% width; letterhead and headings at 70–74% width, 800 weight), **Kalam** for handwriting (patient fields, Rx advice, tour headings, Devanagari छाया), **JetBrains Mono** for readings and times only. Scale `--t-xs` 12px → `--t-3xl` clamp(2.6–4.6rem). Spacing 4/8/12/16/24/32/48/72. Radii 3px and 6px. Elevation: neutral `--lift`, `--lift-hi`. Motion: `--ease` cubic-bezier(.16,1,.3,1); one signature moment, the stamp press.

## Components

- **Stamp** (`.stamp.alert|watch|ok|na`): double-ruled rubber stamp, rotated −4°, grain mask, press animation on change. The only place state colour is loud.
- **Slip** (`.slip`): white sheet with a perforated top edge; letterhead title, handwritten fields, chart, ℞ advice lines with chips.
- **Panel** (`.panel` + `.panel-h`): case-file section with heading and an `i` button that opens the matching glossary entry.
- **Register row** (`.rrow`): name, demographics, HbA1c, warning count chip, time-in-range bar. Current row: violet tint, violet name.
- **Segmented control** (`.seg`), **chip** (`.chip`), **quick advice** (`.quick`, dashed violet).
- **Tour card** (`.tour-card`): yellow tear-off chit with Kalam heading, step dots, Back / Next / Skip; spotlight ring in `--shadow`.
- **Glossary drawer** (`.drawer`), **welcome slip** (`.welcome`), **toast**.

## Rules

- Violet means forecast and Chaya's own marks; vermilion means a spike warning; never swap them.
- State is always shape plus word (stamp text, triangle markers), never colour alone.
- Synthetic-data status is visible on every screen (strip under the letterhead).
- Handwriting is for things a doctor writes; numbers are always mono.
