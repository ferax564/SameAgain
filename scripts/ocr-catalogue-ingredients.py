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
LANGS = "fra+deu"
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
    return url or ""


def ocr_image(url: str, path: Path | None = None) -> str:
    dest = Path("/tmp/off-ing-ocr")
    dest.mkdir(parents=True, exist_ok=True)
    url = ocr_url(url)
    if path is None:
        path = dest / (re.sub(r"\W+", "", url[-80:]) + ".jpg")
        result = subprocess.run(
            [
                "aria2c",
                "-q",
                "--max-tries=3",
                "--timeout=25",
                "--user-agent",
                USER_AGENT,
                "-d",
                str(dest),
                "-o",
                path.name,
                url,
            ],
            check=False,
            capture_output=True,
            timeout=40,
        )
        if result.returncode != 0 or not path.exists() or path.stat().st_size < 800:
            return ""
    elif not path.exists() or path.stat().st_size < 800:
        return ""
    ocr = subprocess.run(
        ["tesseract", str(path), "stdout", "-l", LANGS, "--psm", "6"],
        check=False,
        capture_output=True,
        timeout=20,
    )
    return clean_ocr(ocr.stdout.decode("utf-8", "replace"))


def image_filename(product: dict) -> str:
    code = product.get("barcode") or product.get("sourceIdentifier") or product.get("id") or "unknown"
    return re.sub(r"\W+", "", str(code)) + ".jpg"


def download_jobs(jobs: list[dict], dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    listing = dest / "aria2.txt"
    lines = []
    for product in jobs:
        url = product.get("ingredientsImage")
        name = image_filename(product)
        path = dest / name
        if path.exists() and path.stat().st_size >= 800:
            continue
        lines.append(url)
        lines.append(f"  out={name}")
    if not lines:
        return
    listing.write_text("\n".join(lines) + "\n")
    subprocess.run(
        [
            "aria2c",
            "-i",
            str(listing),
            "-d",
            str(dest),
            "-j",
            "12",
            "-x",
            "4",
            "-s",
            "4",
            "--max-tries=3",
            "--timeout=20",
            "--connect-timeout=10",
            "--auto-file-renaming=false",
            "--user-agent",
            USER_AGENT,
            "--quiet=true",
        ],
        check=False,
        timeout=1800,
    )


def main() -> int:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    workers = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    products = json.loads(INDEX.read_text())
    jobs = [
        p
        for p in products
        if not (p.get("ingredients") or "").strip()
        and (p.get("ingredientsImage") or "").startswith("https://images.openfoodfacts.org/")
    ]
    if limit:
        jobs = jobs[:limit]
    dest = Path("/tmp/off-ing-ocr")
    print(json.dumps({"downloading": len(jobs)}), flush=True)
    download_jobs(jobs, dest)
    filled = failed = 0
    started = time.time()
    lock = threading.Lock()
    done = 0

    def work(product: dict):
        path = dest / image_filename(product)
        text = ocr_image(product.get("ingredientsImage"), path)
        return product, text

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(work, product) for product in jobs]
        for future in as_completed(futures):
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
                if done % 50 == 0:
                    INDEX.write_text(json.dumps(products, ensure_ascii=False, separators=(",", ":")))
                    print(json.dumps({"done": done, "of": len(jobs), "filled": filled, "failed": failed, "seconds": round(time.time() - started)}), flush=True)
    enrich.save(products)
    report = enrich.write_report(
        products,
        {
            "ocrJobs": len(jobs),
            "ocrFilled": filled,
            "ocrFailed": failed,
            "harvestMethod": "off-csv-jsonl-uploaded-photos-and-ocr-ingredients",
        },
    )
    print(json.dumps({"jobs": len(jobs), "filled": filled, "failed": failed, "seconds": round(time.time() - started), "analysis": report["analysisCoverage"]}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
