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
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
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
    if letters < 24 or len(text or "") < 20:
        return False
    if letters / max(len(text), 1) < 0.45:
        return False
    return bool(re.search(r"[,;]|zutaten|ingr[eé]dients?|ingredienti", text or "", re.I))


def ocr_url(url: str) -> str:
    return re.sub(r"\.(100|200|400)\.jpg$", ".full.jpg", url or "")


def ocr_image(url: str) -> str:
    url = ocr_url(url)
    dest = Path("/tmp/off-ing-ocr")
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / (re.sub(r"\W+", "", url[-80:]) + ".jpg")
    result = subprocess.run(
        ["curl", "-fsSL", "-A", USER_AGENT, "--max-time", "45", "-o", str(path), url],
        check=False,
        capture_output=True,
        timeout=50,
    )
    if result.returncode != 0 or not path.exists() or path.stat().st_size < 800:
        return ""
    ocr = subprocess.run(
        ["tesseract", str(path), "stdout", "-l", LANGS, "--psm", "4"],
        check=False,
        capture_output=True,
        timeout=60,
    )
    return clean_ocr(ocr.stdout.decode("utf-8", "replace"))


def main() -> int:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    workers = int(sys.argv[2]) if len(sys.argv) > 2 else 2
    products = json.loads(INDEX.read_text())
    jobs = [
        p
        for p in products
        if not (p.get("ingredients") or "").strip()
        and (p.get("ingredientsImage") or "").startswith("https://images.openfoodfacts.org/")
    ]
    if limit:
        jobs = jobs[:limit]
    filled = failed = 0
    started = time.time()
    lock = threading.Lock()
    done = 0

    def work(product: dict):
        url = product.get("ingredientsImage")
        text = ocr_image(url)
        return product, text

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(work, product) for product in jobs]
        for future in as_completed(futures):
            product, text = None, ""
            try:
                product, text = future.result()
            except Exception as exc:  # noqa: BLE001
                with lock:
                    failed += 1
                    done += 1
                print(json.dumps({"done": done, "error": str(exc)[:200]}), flush=True)
                continue
            with lock:
                done += 1
                if useful(text):
                    product["ingredients"] = text
                    product["ingredientsSource"] = "ocr-from-open-food-facts-ingredients-photo"
                    filled += 1
                else:
                    failed += 1
                if done % 25 == 0:
                    INDEX.write_text(json.dumps(products, ensure_ascii=False, separators=(",", ":")))
                    print(json.dumps({"done": done, "of": len(jobs), "filled": filled, "failed": failed, "seconds": round(time.time() - started)}), flush=True)
    enrich.save(products)
    report = enrich.write_report(
        products,
        {
            "ocrJobs": len(jobs),
            "ocrFilled": filled,
            "ocrFailed": failed,
            "harvestMethod": "off-csv-jsonl-and-ocr-ingredients-photos",
        },
    )
    print(json.dumps({"jobs": len(jobs), "filled": filled, "failed": failed, "seconds": round(time.time() - started), "analysis": report["analysisCoverage"]}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
