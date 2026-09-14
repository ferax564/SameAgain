#!/usr/bin/env python3
"""Stream the Open Food Facts JSONL dump and keep Swiss Coop/Migros products.

ODbL/DbCL community data. Does not scrape retailer sites or claim official stock.
"""
from __future__ import annotations

import gzip
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

URL = "https://openfoodfacts-ds.s3.eu-west-3.amazonaws.com/openfoodfacts-products.jsonl.gz"
OUT = Path("/tmp/off-dump/swiss-retailer.jsonl")
USER_AGENT = "SameAgain/1.1 (https://same-again.frx.chatgpt.site)"


def has_store(values, tag: str) -> bool:
    expected = tag.lower()
    for item in values or []:
        normalised = re.sub(r"^[a-z]{2}:", "", str(item).lower()).replace("_", " ").replace(".", " ").strip()
        if normalised == expected:
            return True
    return False


def keep(product: dict) -> bool:
    countries = product.get("countries_tags") or []
    stores = product.get("stores_tags") or product.get("stores") or []
    if isinstance(stores, str):
        stores = [s.strip() for s in re.split(r"[,;]", stores) if s.strip()]
    swiss = "en:switzerland" in countries
    retailer = has_store(stores, "coop") or has_store(stores, "migros")
    if swiss and retailer:
        return True
    # Swiss GTIN prefix 76, tagged Coop/Migros but missing the country tag.
    code = re.sub(r"\D", "", str(product.get("code") or ""))
    return retailer and code.startswith("76")


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(URL, headers={"User-Agent": USER_AGENT})
    rows = kept = 0
    started = time.time()
    with gzip.open(urllib.request.urlopen(req, timeout=120), "rt", encoding="utf-8", errors="replace") as src, OUT.open(
        "w", encoding="utf-8"
    ) as dest:
        for line in src:
            rows += 1
            low = line.lower()
            if "coop" not in low and "migros" not in low:
                continue
            if "switzerland" not in low and '"76' not in low and "en:ch" not in low:
                continue
            try:
                product = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not keep(product):
                continue
            dest.write(json.dumps(product, ensure_ascii=False, separators=(",", ":")) + "\n")
            kept += 1
            if kept % 500 == 0:
                print(json.dumps({"rows": rows, "kept": kept, "seconds": round(time.time() - started)}), flush=True)
            if rows % 200000 == 0:
                print(json.dumps({"rows": rows, "kept": kept, "seconds": round(time.time() - started)}), flush=True)
    print(json.dumps({"rows": rows, "kept": kept, "out": str(OUT), "seconds": round(time.time() - started)}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
