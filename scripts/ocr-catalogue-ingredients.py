#!/usr/bin/env python3
"""OCR Open Food Facts ingredients photos into the Swiss catalogue snapshot.

Uses the published ingredients image (CC BY-SA) when the dump has no typed list.
Does not scrape retailer sites. OCR text is labelled as such and is not a
manufacturer declaration.
"""
from __future__ import annotations

import importlib.util
import json
import os
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
    if re.search(
        r"\b(kcal|kj|energiewert|nutri-?score|nährwerte|valeurs nutritives|matières grasses)\b",
        text or "",
        re.I,
    ) and not re.search(r"zutaten|ingr[eé]dients?|ingredienti", text or "", re.I):
        return False
    return bool(re.search(r"[,;]|zutaten|ingr[eé]dients?|ingredienti", text or "", re.I))


def ocr_url(url: str, full: bool = False) -> str:
    url = url or ""
    if full:
        return re.sub(r"\.(100|200|400)\.jpg$", ".full.jpg", url)
    return url


def ocr_image(url: str, path: Path | None = None, psm: str = "6") -> str:
    dest = Path("/tmp/off-ing-ocr")
    dest.mkdir(parents=True, exist_ok=True)
    if path is None:
        path = dest / (re.sub(r"\W+", "", (url or "")[-80:]) + ".jpg")
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
    env = dict(os.environ)
    env["OMP_THREAD_LIMIT"] = "1"
    try:
        ocr = subprocess.run(
            ["tesseract", str(path), "stdout", "-l", LANGS, "--psm", psm],
            check=False,
            capture_output=True,
            timeout=40,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return ""
    return clean_ocr(ocr.stdout.decode("utf-8", "replace"))


def image_filename(product: dict) -> str:
    code = product.get("barcode") or product.get("sourceIdentifier") or product.get("id") or "unknown"
    return re.sub(r"\W+", "", str(code)) + ".jpg"


def download_jobs(jobs: list[dict], dest: Path, full: bool = False) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    listing = dest / "aria2.txt"
    lines = []
    for product in jobs:
        url = ocr_url(product.get("ingredientsImage"), full)
        name = image_filename(product)
        path = dest / name
        if path.exists() and path.stat().st_size >= 800:
            continue
        lines.append(url)
        lines.append(f"  out={name}")
    if lines:
        listing.write_text("\n".join(lines) + "\n")
        subprocess.run(
            [
                "aria2c",
                "-i",
                str(listing),
                "-d",
                str(dest),
                "-j",
                "6" if full else "8",
                "-x",
                "2",
                "-s",
                "2",
                "--max-tries=4",
                "--timeout=60" if full else "--timeout=35",
                "--connect-timeout=20" if full else "--connect-timeout=15",
                "--auto-file-renaming=false",
                "--user-agent",
                USER_AGENT,
                "--quiet=true",
            ],
            check=False,
            timeout=2400,
        )
    missing = [
        product
        for product in jobs
        if not ((dest / image_filename(product)).exists() and (dest / image_filename(product)).stat().st_size >= 800)
    ]
    if not missing:
        return

    def curl_one(product: dict) -> None:
        path = dest / image_filename(product)
        subprocess.run(
            [
                "curl",
                "-fsSL",
                "-A",
                USER_AGENT,
                "--max-time",
                "40",
                "--retry",
                "2",
                "-o",
                str(path),
                ocr_url(product.get("ingredientsImage"), full),
            ],
            check=False,
            capture_output=True,
            timeout=90,
        )

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(curl_one, missing))


def main() -> int:
    args = sys.argv[1:]
    full = "full" in args
    nums = [int(a) for a in args if a.isdigit()]
    limit = nums[0] if nums else 0
    workers = nums[1] if len(nums) > 1 else 3
    products = json.loads(INDEX.read_text())
    jobs = [
        p
        for p in products
        if not (p.get("ingredients") or "").strip()
        and (p.get("ingredientsImage") or "").startswith("https://images.openfoodfacts.org/")
    ]
    if limit:
        jobs = jobs[:limit]
    dest = Path("/tmp/off-ing-ocr-full" if full else "/tmp/off-ing-ocr")
    print(json.dumps({"downloading": len(jobs), "full": full}), flush=True)
    download_jobs(jobs, dest, full)
    filled = failed = 0
    started = time.time()
    lock = threading.Lock()
    done = 0
    psm = "4" if full else "6"

    def work(product: dict):
        path = dest / image_filename(product)
        text = ocr_image(ocr_url(product.get("ingredientsImage"), full), path, psm)
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
