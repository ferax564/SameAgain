#!/usr/bin/env python3
"""OCR Open Food Facts ingredients photos into the Swiss catalogue snapshot.

Uses the published ingredients image (CC BY-SA) when the dump has no typed list.
Does not scrape retailer sites. OCR text is labelled as such and is not a
manufacturer declaration.
"""
from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("enrich_swiss_catalogue", ROOT / "enrich-swiss-catalogue.py")
enrich = importlib.util.module_from_spec(spec)
spec.loader.exec_module(enrich)

INDEX = enrich.INDEX
USER_AGENT = enrich.USER_AGENT
LANGS = "deu+fra+ita+eng"
HEADER = re.compile(
    r"^(zutaten|ingredients?|ingr[eé]dients?|ingredienti|samenstelling|zusammensetzung)\s*[:.]?\s*",
    re.I,
)


def clean_ocr(text: str) -> str:
    lines = []
    for raw in (text or "").splitlines():
        line = re.sub(r"\s+", " ", raw).strip(" -•*|")
        if not line or len(line) < 2:
            continue
        lines.append(line)
    joined = ", ".join(lines) if lines and all(len(l) < 80 for l in lines) else " ".join(lines)
    joined = HEADER.sub("", joined).strip(" ,;:")
    joined = re.sub(r"\s+,", ",", joined)
    joined = re.sub(r",\s*,+", ", ", joined)
    joined = re.sub(r"\s{2,}", " ", joined)
    return joined[:6000]


def useful(text: str) -> bool:
    letters = len(re.findall(r"[A-Za-zÀ-ÿ]", text or ""))
    return letters >= 12 and len(text) >= 16


def ocr_image(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "image/*"})
    with urllib.request.urlopen(req, timeout=25) as response:
        data = response.read()
    if len(data) < 800:
        return ""
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=True) as handle:
        handle.write(data)
        handle.flush()
        result = subprocess.run(
            ["tesseract", handle.name, "stdout", "-l", LANGS, "--psm", "6"],
            check=False,
            capture_output=True,
            timeout=40,
        )
    return clean_ocr(result.stdout.decode("utf-8", "replace"))


def main() -> int:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    products = json.loads(INDEX.read_text())
    jobs = [
        p
        for p in products
        if not (p.get("ingredients") or "").strip()
        and (p.get("ingredientsImage") or p.get("image") or "").startswith("https://images.openfoodfacts.org/")
        and "ingredients" in (p.get("ingredientsImage") or "")
    ]
    # Prefer a dedicated ingredients photo; fall back to any remaining ingredients URL on image.
    extra = [
        p
        for p in products
        if p not in jobs
        and not (p.get("ingredients") or "").strip()
        and (p.get("ingredientsImage") or "").startswith("https://images.openfoodfacts.org/")
    ]
    jobs.extend(extra)
    if limit:
        jobs = jobs[:limit]
    filled = failed = 0
    started = time.time()
    for i, product in enumerate(jobs, 1):
        url = product.get("ingredientsImage") or product.get("image")
        try:
            text = ocr_image(url)
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(json.dumps({"i": i, "barcode": product.get("barcode"), "error": str(exc)[:200]}), flush=True)
            continue
        if useful(text):
            product["ingredients"] = text
            product["ingredientsSource"] = "ocr-from-open-food-facts-ingredients-photo"
            filled += 1
        else:
            failed += 1
        if i % 25 == 0:
            INDEX.write_text(json.dumps(products, ensure_ascii=False, separators=(",", ":")))
            print(json.dumps({"done": i, "of": len(jobs), "filled": filled, "failed": failed, "seconds": round(time.time() - started)}), flush=True)
        time.sleep(0.05)
    enrich.save(products)
    report = enrich.write_report(
        products,
        {
            "ocrJobs": len(jobs),
            "ocrFilled": filled,
            "ocrFailed": failed,
            "harvestMethod": "off-csv-and-ocr-ingredients-photos",
        },
    )
    print(json.dumps({"jobs": len(jobs), "filled": filled, "failed": failed, "seconds": round(time.time() - started), "analysis": report["analysisCoverage"]}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
