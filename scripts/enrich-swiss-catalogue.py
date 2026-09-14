#!/usr/bin/env python3
"""Merge Open Food Facts bulk fields into the shipped Swiss Coop/Migros index.

Streams the public products dump (ODbL). Fills barcodes, photos and ingredients
from every dump field available. Does not scrape retailer sites or claim official
assortment.
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
INGREDIENT_FIELDS = (
    "ingredients_text",
    "ingredients_text_en",
    "ingredients_text_de",
    "ingredients_text_fr",
    "ingredients_text_it",
    "ingredients_text_es",
)


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


def stores(value) -> list[str]:
    if isinstance(value, list):
        return [str(s).strip() for s in value if str(s).strip()][:50]
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


def digits_only(code: str) -> str:
    return re.sub(r"\D", "", code or "")


def barcode_key(code: str) -> str:
    digits = digits_only(code)
    if not digits:
        return ""
    if len(digits) == 12:
        digits = "0" + digits
    if len(digits) == 14 and digits.startswith("0"):
        digits = digits[1:]
    return digits.lstrip("0") or "0"


def gtin(code: str) -> str | None:
    digits = digits_only(code)
    if len(digits) == 12:
        digits = "0" + digits
    if len(digits) == 14 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) in (8, 13):
        return digits
    return None


def assign_codes(product: dict, raw: str) -> None:
    digits = digits_only(raw) or digits_only(str(product.get("id") or "").split(":")[-1])
    standard = gtin(digits) if digits else None
    if standard:
        product["barcode"] = standard
        product["id"] = product.get("id") or ("off:" + standard)
        product.pop("sourceIdentifier", None)
        return
    if digits:
        product["sourceIdentifier"] = digits[:48]
        product["id"] = product.get("id") or ("off:" + digits[:48])
        if "barcode" in product and not gtin(product.get("barcode") or ""):
            product.pop("barcode", None)


def off_image(*urls: str | None) -> str | None:
    for url in urls:
        if url and str(url).startswith("https://images.openfoodfacts.org/"):
            return str(url)
    return None


def readable_tags(values: list[str]) -> str:
    names = []
    for item in values:
        name = re.sub(r"^[a-z]{2}:", "", item).replace("_", " ").replace("-", " ").strip()
        if name and name not in names:
            names.append(name)
    return ", ".join(names)[:6000]


def ingredients_from_row(row: dict) -> tuple[str | None, str | None]:
    for field in INGREDIENT_FIELDS:
        text = (row.get(field) or "").strip()
        if text:
            return text[:6000], "open-food-facts-text"
    tagged = tags(row.get("ingredients_tags") or "")
    if tagged:
        text = readable_tags(tagged)
        if text:
            return text, "open-food-facts-taxonomy"
    return None, None


def merge_nutrition(old: dict, row: dict) -> dict:
    next_n = dict(old or {})
    for key in NUTRIENTS:
        if key in next_n:
            continue
        value = num(row.get(f"{key}_100g") or "")
        if value is not None:
            next_n[key] = value
    return next_n


def pick_image(row: dict) -> str | None:
    return off_image(
        row.get("image_url"),
        row.get("image_small_url"),
        row.get("image_front_url"),
        row.get("image_ingredients_url"),
        row.get("image_ingredients_small_url"),
        row.get("image_nutrition_url"),
        row.get("image_nutrition_small_url"),
    )


def enrich_product(product: dict, row: dict) -> dict:
    ingredients, source = ingredients_from_row(row)
    if ingredients and not product.get("ingredients"):
        product["ingredients"] = ingredients
        product["ingredientsSource"] = source
    elif ingredients and product.get("ingredientsSource") == "open-food-facts-taxonomy" and source == "open-food-facts-text":
        product["ingredients"] = ingredients
        product["ingredientsSource"] = source
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
    image = pick_image(row)
    if image and not product.get("image"):
        product["image"] = image
    ingredients_image = off_image(row.get("image_ingredients_url"), row.get("image_ingredients_small_url"))
    if ingredients_image and not product.get("ingredientsImage"):
        product["ingredientsImage"] = ingredients_image
    if row.get("quantity") and not product.get("pack"):
        product["pack"] = row["quantity"][:100]
    countries = tags(row.get("countries_tags") or "")
    if countries:
        product["countries"] = list(dict.fromkeys((product.get("countries") or []) + countries))[:100]
    store_values = stores(row.get("stores") or "")
    if store_values:
        product["stores"] = list(dict.fromkeys((product.get("stores") or []) + store_values))[:50]
    name = (row.get("product_name") or "").strip()
    if name and (not product.get("name") or product.get("name") == "Unnamed product"):
        product["name"] = name[:160]
    brand = (row.get("brands") or "").split(",")[0].strip()
    if brand and not product.get("brand"):
        product["brand"] = brand[:200]
    assign_codes(product, row.get("code") or product.get("barcode") or product.get("sourceIdentifier") or "")
    return product


def new_product(row: dict) -> dict | None:
    code = digits_only(row.get("code") or "")
    name = (row.get("product_name") or "").strip()
    if not code or not name or name.lower() == "unnamed product":
        return None
    store_values = stores(row.get("stores") or "")
    countries = tags(row.get("countries_tags") or "")
    tagged_swiss = "en:switzerland" in countries
    retailer = has_store(store_values, "coop") or has_store(store_values, "migros")
    if not retailer:
        return None
    if not tagged_swiss and not code.startswith("76"):
        return None
    if "en:switzerland" not in countries:
        countries = countries + ["en:switzerland"]
    ingredients, source = ingredients_from_row(row)
    product = {
        "id": "off:" + (gtin(code) or code[:48]),
        "name": name[:160],
        "brand": (row.get("brands") or "").split(",")[0].strip()[:200],
        "image": pick_image(row),
        "pack": (row.get("quantity") or "")[:100],
        "stores": store_values,
        "additives": tags(row.get("additives_tags") or ""),
        "categories": tags(row.get("categories_tags") or ""),
        "countries": countries or ["en:switzerland"],
        "ingredients": ingredients,
        "ingredientsSource": source,
        "ingredientTags": tags(row.get("ingredients_tags") or ""),
        "allergens": tags(row.get("allergens") or ""),
        "traces": tags(row.get("traces_tags") or ""),
        "labels": tags(row.get("labels_tags") or ""),
        "nutrition": merge_nutrition({}, row),
        "source": "Open Food Facts",
        "sourceUrl": f"https://world.openfoodfacts.org/product/{gtin(code) or code}",
        "retrieved": int(time.time() * 1000),
    }
    ingredients_image = off_image(row.get("image_ingredients_url"), row.get("image_ingredients_small_url"))
    if ingredients_image:
        product["ingredientsImage"] = ingredients_image
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
    assign_codes(product, code)
    return product


def open_dump():
    if DUMP.exists() and DUMP.stat().st_size > 100_000_000:
        return gzip.open(DUMP, "rt", encoding="utf-8", errors="replace", newline="")
    req = urllib.request.Request(DUMP_URL, headers={"User-Agent": USER_AGENT})
    return gzip.open(urllib.request.urlopen(req), "rt", encoding="utf-8", errors="replace", newline="")


def has_code(product: dict) -> bool:
    return bool(digits_only(product.get("barcode") or product.get("sourceIdentifier") or product.get("id") or ""))


def coverage(products: list[dict], tag: str | None = None):
    subset = products if tag is None else [p for p in products if has_store(p.get("stores") or [], tag)]
    return {
        "records": len(subset),
        "withBarcode": sum(1 for p in subset if has_code(p)),
        "withPhoto": sum(1 for p in subset if p.get("image")),
        "withIngredients": sum(1 for p in subset if p.get("ingredients")),
        "withAdditives": sum(1 for p in subset if p.get("additives")),
        "withNutrition": sum(1 for p in subset if p.get("nutrition")),
        "withNutriscore": sum(1 for p in subset if p.get("nutriscoreGrade")),
        "withIngredientsImage": sum(1 for p in subset if p.get("ingredientsImage")),
    }


def write_report(products: list[dict], extra: dict):
    report = json.loads(REPORT.read_text()) if REPORT.exists() else {}
    report.update(
        {
            "retrieved": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "source": "Open Food Facts",
            "completeRetailerCatalogue": False,
            "harvestMethod": extra.get("harvestMethod")
            or "off-csv-complete-barcodes-photos-ingredients",
            "records": len(products),
            "coverageByRetailer": {"coop": coverage(products, "coop"), "migros": coverage(products, "migros")},
            "analysisCoverage": {
                **coverage(products),
                **{k: v for k, v in extra.items() if k not in ("harvestMethod", "notice")},
            },
            "licence": "ODbL 1.0; contents DbCL 1.0; images CC BY-SA 3.0",
            "notice": extra.get("notice")
            or "Community records with retailer tags, filled from the Open Food Facts dump so every available barcode, photo and ingredient list is in the snapshot. This is still not an official assortment or branch stock.",
        }
    )
    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    return report


def save(products: list[dict]):
    products.sort(key=lambda p: p.get("id") or "")
    INDEX.write_text(json.dumps(products, ensure_ascii=False, separators=(",", ":")))


def main() -> int:
    products = json.loads(INDEX.read_text())
    by_barcode = {}
    for product in products:
        assign_codes(product, product.get("barcode") or product.get("sourceIdentifier") or product.get("id") or "")
        key = barcode_key(product.get("barcode") or product.get("sourceIdentifier") or "")
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
                    extra_key = barcode_key(extra.get("barcode") or extra.get("sourceIdentifier") or "")
                    if extra_key:
                        by_barcode[extra_key] = extra
                    added += 1
            if rows % 200000 == 0:
                print(json.dumps({"rows": rows, "matched": matched, "added": added}), flush=True)
    save(products)
    report = write_report(
        products,
        {
            "dumpRowsRead": rows,
            "matchedExisting": matched,
            "addedFromDump": added,
            "harvestMethod": "off-csv-complete-barcodes-photos-ingredients",
        },
    )
    print(json.dumps({"records": len(products), "matched": matched, "added": added, "analysis": report["analysisCoverage"]}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
