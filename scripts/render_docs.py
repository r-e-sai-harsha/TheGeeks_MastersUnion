"""Render docs/src/*.html to PDF (architecture diagram, presentation) with headless Chromium."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
JOBS = [("architecture.html", "Chaya_Architecture.pdf", 1600, 880),
        ("presentation.html", "Chaya_Presentation.pdf", 1280, 720)]


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for src, out, w, h in JOBS:
            f = ROOT / "docs/src" / src
            if not f.exists():
                continue
            pg = await b.new_page(viewport={"width": w, "height": h})
            await pg.goto(f.as_uri()); await pg.wait_for_timeout(800)
            await pg.pdf(path=str(ROOT / "docs" / out), width=f"{w}px", height=f"{h}px", print_background=True)
            await pg.screenshot(path=str(ROOT / "docs/src" / (src.replace(".html", ".png"))), full_page=False)
            print("wrote", out)
        await b.close()

asyncio.run(main())
