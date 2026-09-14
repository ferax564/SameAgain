#!/usr/bin/env python3
"""Merge Open Food Facts bulk CSV fields into the shipped Swiss Coop/Migros index.

Streams the public products dump (ODbL). Does not scrape retailer sites or claim
official assortment. Existing richer index fields are kept.
"""
from __future__ import annotations

import csv
import gzip
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

csv.field_size_limit(sys.maxsize)

DUMP = Path("/tmp/off-dump/en.openfoodfacts.org.products.csv.gz")
DUMP_URL = "https://openfoodfacts-ds.s3.eu-west-3.amazonaws.com/en.openfoodfacts.org.products.csv.gz"
INDEX = Path("public/catalogue/swiss-retailer-products.json")
REPORT = Path("lib/swiss-retailer-report.json")
USER_AGENT = "SameAgain/1.1 (https://same-again.frx.chatgpt.site)"
NUTRIENTS = ("energy-kcal", "fat", "saturated-fat", "carbohydrates", "sugars", "fiber", "proteins", "salt")

def tags(value: str) -> list[str]:
    if not value:
        return []
    parts = re.split(r"[,|]", value)
    out = []
    for part in parts:
        item = part.strip()
        if item:
            out.append(item)
    return out[:100]

def stores(value: str) -> list[str]:
    return [s.strip() for s in re.split(r"[,;]", value or "") if s.strip()][:50]

def has_store(values: list[str], tag: str) -> bool:
    expected = tag.lower()
    for item in values:
        normalised = re.sub(r"^[a-z]{2}:", "", item.lower()).replace("_", " ").replace(".", " ").strip()
        if normalised == expected:
            return True
    return False

def num(value: str):
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    if n < 0 or n != n:
        return None
    return n

def barcode_key(code: str) -> str:
    digits = re.sub(r"\D", "", code or "")
    if not digits:
        return ""
    if len(digits) == 12:
        digits = "0" + digits
    if len(digits) == 14 and digits.startswith("0"):
        digits = digits[1:]
    return digits.lstrip("0") or "0"

def off_image(url: str) -> str | None:
    if url and url.startswith("https://images.openfoodfacts.org/"):
        return url
    return None

def merge_nutrition(old: dict, row: dict) -> dict:
    next_n = dict(old or {})
    for key in NUTRIENTS:
        if key in next_n:
            continue
        value = num(row.get(f"{key}_100g") or "")
        if value is not None:
            next_n[key] = value
    return next_n

def enrich_product(product: dict, row: dict) -> dict:
    ingredients = (row.get("ingredients_text") or "").strip()
    if ingredients and not product.get("ingredients"):
        product["ingredients"] = ingredients[:6000]
    tags_in = tags(row.get("ingredients_tags") or "")
    if tags_in:
        product["ingredientTags"] = list(dict.fromkeys((product.get("ingredientTags") or []) + tags_in))[:100]
    additives = tags(row.get("additives_tags") or "")
    if additives:
        product["additives"] = list(dict.fromkeys((product.get("additives") or []) + additives))[:100]
    allergens = tags(row.get("allergens") or row.get("allergens_en") or "")
    if allergens and not product.get("allergens"):
        product["allergens"] = allergens[:60]
    traces = tags(row.get("traces_tags") or "")
    if traces and not product.get("traces"):
        product["traces"] = traces[:60]
    labels = tags(row.get("labels_tags") or "")
    if labels:
        product["labels"] = list(dict.fromkeys((product.get("labels") or []) + labels))[:100]
    grade = (row.get("nutriscore_grade") or "").strip().lower()
    if grade in "abcde" and not product.get("nutriscoreGrade"):
        product["nutriscoreGrade"] = grade
    try:
        nova = int(float(row.get("nova_group") or ""))
    except (TypeError, ValueError):
        nova = None
    if nova in (1, 2, 3, 4) and not product.get("novaGroup"):
        product["novaGroup"] = nova
    product["nutrition"] = merge_nutrition(product.get("nutrition") or {}, row)
    if product.get("nutrition") and not product.get("basis"):
        product["basis"] = "100g"
    image = off_image(row.get("image_url") or "")
    if image and not product.get("image"):
        product["image"] = image
    if row.get("quantity") and not product.get("pack"):
        product["pack"] = row["quantity"][:100]
    countries = tags(row.get("countries_tags") or "")
    if countries:
        product["countries"] = list(dict.fromkeys((product.get("countries") or []) + countries))[:100]
    store_values = stores(row.get("stores") or "")
    if store_values:
        product["stores"] = list(dict.fromkeys((product.get("stores") or []) + store_values))[:50]
    return product

def new_product(row: dict) -> dict | None:
    code = re.sub(r"\D", "", row.get("code") or "")
    name = (row.get("product_name") or "").strip()
    if not code or not name or name.lower() == "unnamed product":
        return None
    store_values = stores(row.get("stores") or "")
    countries = tags(row.get("countries_tags") or "")
    if "en:switzerland" not in countries:
        return None
    if not (has_store(store_values, "coop") or has_store(store_values, "migros")):
        return None
    if len(code) == 12:
        code = "0" + code
    if len(code) == 14 and code.startswith("0"):
        code = code[1:]
    product = {
        "id": "off:" + code,
        "barcode": code,
        "name": name[:160],
        "brand": (row.get("brands") or "").split(",")[0].strip()[:200],
        "image": off_image(row.get("image_url") or ""),
        "pack": (row.get("quantity") or "")[:100],
        "stores": store_values,
        "additives": tags(row.get("additives_tags") or ""),
        "categories": tags(row.get("categories_tags") or ""),
        "countries": countries,
        "ingredients": (row.get("ingredients_text") or "").strip()[:6000] or None,
        "ingredientTags": tags(row.get("ingredients_tags") or ""),
        "allergens": tags(row.get("allergens") or ""),
        "traces": tags(row.get("traces_tags") or ""),
        "labels": tags(row.get("labels_tags") or ""),
        "nutrition": merge_nutrition({}, row),
        "source": "Open Food Facts",
        "sourceUrl": f"https://world.openfoodfacts.org/product/{code}",
        "retrieved": int(time.time() * 1000),
    }
    grade = (row.get("nutriscore_grade") or "").strip().lower()
    if grade in "abcde":
        product["nutriscoreGrade"] = grade
    try:
        nova = int(float(row.get("nova_group") or ""))
    except (TypeError, ValueError):
        nova = None
    if nova in (1, 2, 3, 4):
        product["novaGroup"] = nova
    if product["nutrition"]:
        product["basis"] = "100g"
    return product

def open_dump():
    if DUMP.exists() and DUMP.stat().st_size > 100_000_000:
        return gzip.open(DUMP, "rt", encoding="utf-8", errors="replace", newline="")
    req = urllib.request.Request(DUMP_URL, headers={"User-Agent": USER_AGENT})
    return gzip.open(urllib.request.urlopen(req), "rt", encoding="utf-8", errors="replace", newline="")

def main() -> int:
    products = json.loads(INDEX.read_text())
    by_barcode = {}
    for product in products:
        key = barcode_key(product.get("barcode") or "")
        if key:
            by_barcode[key] = product
    matched = added = rows = 0
    with open_dump() as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        for row in reader:
            rows += 1
            key = barcode_key(row.get("code") or "")
            if key in by_barcode:
                enrich_product(by_barcode[key], row)
                matched += 1
            else:
                extra = new_product(row)
                if extra:
                    products.append(extra)
                    by_barcode[key] = extra
                    added += 1
            if rows % 200000 == 0:
                print(json.dumps({"rows": rows, "matched": matched, "added": added}), flush=True)
    products.sort(key=lambda p: p.get("id") or "")
    INDEX.write_text(json.dumps(products, ensure_ascii=False, separators=(",", ":")))
    def coverage(tag: str):
        subset = [p for p in products if has_store(p.get("stores") or [], tag)]
        return {
            "records": len(subset),
            "withPhoto": sum(1 for p in subset if p.get("image")),
            "withIngredients": sum(1 for p in subset if p.get("ingredients")),
            "withAdditives": sum(1 for p in subset if p.get("additives")),
            "withNutrition": sum(1 for p in subset if p.get("nutrition")),
            "withNutriscore": sum(1 for p in subset if p.get("nutriscoreGrade")),
        }
    report = json.loads(REPORT.read_text()) if REPORT.exists() else {}
    report.update({
        "retrieved": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        "source": "Open Food Facts",
        "completeRetailerCatalogue": False,
        "harvestMethod": "coop-store-query-migros-prefixes-and-off-csv-ingredients",
        "records": len(products),
        "coverageByRetailer": {"coop": coverage("coop"), "migros": coverage("migros")},
        "analysisCoverage": {
            "withIngredients": sum(1 for p in products if p.get("ingredients")),
            "withAdditives": sum(1 for p in products if p.get("additives")),
            "withNutrition": sum(1 for p in products if p.get("nutrition")),
            "withNutriscore": sum(1 for p in products if p.get("nutriscoreGrade")),
            "dumpRowsRead": rows,
            "matchedExisting": matched,
            "addedFromDump": added,
        },
        "licence": "ODbL 1.0; contents DbCL 1.0; images CC BY-SA 3.0",
        "notice": "Community records with retailer and Switzerland tags, enriched from the Open Food Facts bulk CSV so ingredients, additives and Nutri-Score can be reviewed. This is still not an official assortment or branch stock.",
    })
    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"records": len(products), "matched": matched, "added": added, "analysis": report["analysisCoverage"]}, indent=2))
    return 0

if __name__ == "__main__":
    sys.exit(main())
