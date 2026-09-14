#!/usr/bin/env python3
"""Fill remaining missing photos/ingredients from the Open Food Facts product API."""
from __future__ import annotations

import importlib.util
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("enrich_swiss_catalogue", ROOT / "enrich-swiss-catalogue.py")
enrich = importlib.util.module_from_spec(spec)
spec.loader.exec_module(enrich)

FIELDS = (
    "code,product_name,product_name_en,product_name_de,product_name_fr,product_name_it,"
    "brands,quantity,image_front_url,image_url,image_ingredients_url,selected_images,"
    "ingredients_text,ingredients_text_en,ingredients_text_de,ingredients_text_fr,"
    "ingredients_text_it,ingredients_text_es,ingredients,allergens_tags,traces_tags,"
    "labels_tags,categories_tags,countries_tags,stores,stores_tags,additives_tags,"
    "nutriscore_grade,nova_group,nutriments"
)


def flatten_api(product: dict) -> dict:
    selected = product.get("selected_images") or {}
    front = (selected.get("front") or {}).get("display") or {}
    ingredients = (selected.get("ingredients") or {}).get("display") or {}
    nutrition = (selected.get("nutrition") or {}).get("display") or {}
    langs = ("en", "de", "fr", "it", "es")
    row = {
        "code": product.get("code"),
        "product_name": product.get("product_name") or product.get("product_name_de") or product.get("product_name_fr"),
        "brands": product.get("brands") if isinstance(product.get("brands"), str) else ",".join(product.get("brands") or []),
        "quantity": product.get("quantity"),
        "image_url": enrich.off_image(product.get("image_front_url"), product.get("image_url"), *(front.get(lang) for lang in langs)),
        "image_ingredients_url": enrich.off_image(product.get("image_ingredients_url"), *(ingredients.get(lang) for lang in langs)),
        "image_nutrition_url": enrich.off_image(*(nutrition.get(lang) for lang in langs)),
        "stores": ",".join(product.get("stores_tags") or product.get("stores") or [])
        if not isinstance(product.get("stores"), str)
        else product.get("stores"),
        "countries_tags": ",".join(product.get("countries_tags") or []),
        "categories_tags": ",".join(product.get("categories_tags") or []),
        "labels_tags": ",".join(product.get("labels_tags") or []),
        "additives_tags": ",".join(product.get("additives_tags") or []),
        "ingredients_text": product.get("ingredients_text"),
        "ingredients_text_en": product.get("ingredients_text_en"),
        "ingredients_text_de": product.get("ingredients_text_de"),
        "ingredients_text_fr": product.get("ingredients_text_fr"),
        "ingredients_text_it": product.get("ingredients_text_it"),
        "ingredients_text_es": product.get("ingredients_text_es"),
        "ingredients_tags": ",".join(
            i.get("id") for i in (product.get("ingredients") or []) if isinstance(i, dict) and i.get("id")
        ),
        "allergens": ",".join(product.get("allergens_tags") or []),
        "traces_tags": ",".join(product.get("traces_tags") or []),
        "nutriscore_grade": product.get("nutriscore_grade"),
        "nova_group": product.get("nova_group"),
    }
    nutriments = product.get("nutriments") or {}
    for key in ("energy-kcal", "fat", "saturated-fat", "carbohydrates", "sugars", "fiber", "proteins", "salt"):
        value = nutriments.get(f"{key}_100g")
        if value is not None:
            row[f"{key}_100g"] = value
    return row


def fetch(code: str) -> dict | None:
    query = urllib.parse.urlencode({"fields": FIELDS})
    url = f"https://world.openfoodfacts.org/api/v3.6/product/{urllib.parse.quote(code)}.json?{query}"
    req = urllib.request.Request(url, headers={"User-Agent": enrich.USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=25) as response:
        data = json.load(response)
    return data.get("product") if data.get("status") in (1, "success") or data.get("product") else None


def needs_fill(product: dict) -> bool:
    return not product.get("image") or not (product.get("ingredients") or "").strip()


def main() -> int:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    products = json.loads(enrich.INDEX.read_text())
    jobs = [p for p in products if needs_fill(p) and (p.get("barcode") or p.get("sourceIdentifier"))]
    if limit:
        jobs = jobs[:limit]
    filled_image = filled_ing = failed = 0
    started = time.time()
    for i, product in enumerate(jobs, 1):
        code = product.get("barcode") or product.get("sourceIdentifier")
        try:
            raw = fetch(str(code))
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(json.dumps({"i": i, "code": code, "error": str(exc)[:180]}), flush=True)
            time.sleep(1)
            continue
        if not raw:
            failed += 1
        else:
            before_image = bool(product.get("image"))
            before_ing = bool((product.get("ingredients") or "").strip())
            enrich.enrich_product(product, flatten_api(raw))
            if product.get("image") and not before_image:
                filled_image += 1
            if (product.get("ingredients") or "").strip() and not before_ing:
                filled_ing += 1
        if i % 25 == 0:
            enrich.save(products)
            print(json.dumps({"done": i, "of": len(jobs), "images": filled_image, "ingredients": filled_ing, "failed": failed, "seconds": round(time.time() - started)}), flush=True)
        time.sleep(1)
    enrich.save(products)
    report = enrich.write_report(
        products,
        {
            "apiJobs": len(jobs),
            "apiFilledImages": filled_image,
            "apiFilledIngredients": filled_ing,
            "apiFailed": failed,
            "harvestMethod": "off-csv-jsonl-and-product-api",
        },
    )
    print(json.dumps({"jobs": len(jobs), "images": filled_image, "ingredients": filled_ing, "failed": failed, "analysis": report["analysisCoverage"]}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
