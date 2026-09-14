#!/usr/bin/env python3
"""Merge filtered Open Food Facts JSONL records into the Swiss catalogue snapshot."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("enrich_swiss_catalogue", ROOT / "enrich-swiss-catalogue.py")
enrich = importlib.util.module_from_spec(spec)
spec.loader.exec_module(enrich)

JSONL = Path("/tmp/off-dump/swiss-retailer.jsonl")


def structured_ingredients(product: dict) -> str:
    values = product.get("ingredients")
    if not isinstance(values, list):
        return ""
    names = []
    for item in values:
        if not isinstance(item, dict):
            continue
        text = (item.get("text") or "").strip()
        if not text:
            ident = str(item.get("id") or "")
            text = ident.split(":")[-1].replace("-", " ").strip()
        if text and text not in names:
            names.append(text)
    return ", ".join(names)[:6000]


def flatten(product: dict) -> dict:
    selected = product.get("selected_images") or {}
    front = (selected.get("front") or {}).get("display") or {}
    ingredients = (selected.get("ingredients") or {}).get("display") or {}
    nutrition = (selected.get("nutrition") or {}).get("display") or {}
    langs = ("en", "de", "fr", "it", "es")
    image = enrich.off_image(
        product.get("image_front_url"),
        product.get("image_url"),
        *(front.get(lang) for lang in langs),
        *(ingredients.get(lang) for lang in langs),
        *(nutrition.get(lang) for lang in langs),
    )
    ingredients_image = enrich.off_image(
        product.get("image_ingredients_url"),
        *(ingredients.get(lang) for lang in langs),
    )
    stores = product.get("stores_tags") or product.get("stores") or []
    if isinstance(stores, str):
        stores = [s.strip() for s in stores.split(",") if s.strip()]
    row = {
        "code": product.get("code"),
        "product_name": product.get("product_name")
        or product.get("product_name_en")
        or product.get("product_name_de")
        or product.get("product_name_fr")
        or product.get("product_name_it"),
        "brands": product.get("brands"),
        "quantity": product.get("quantity"),
        "image_url": image,
        "image_ingredients_url": ingredients_image,
        "stores": ",".join(stores) if isinstance(stores, list) else stores,
        "countries_tags": ",".join(product.get("countries_tags") or []),
        "categories_tags": ",".join(product.get("categories_tags") or []),
        "labels_tags": ",".join(product.get("labels_tags") or []),
        "additives_tags": ",".join(product.get("additives_tags") or []),
        "ingredients_tags": ",".join(
            i.get("id") for i in (product.get("ingredients") or []) if isinstance(i, dict) and i.get("id")
        )
        or ",".join(product.get("ingredients_tags") or []),
        "ingredients_text": product.get("ingredients_text") or structured_ingredients(product),
        "ingredients_text_en": product.get("ingredients_text_en"),
        "ingredients_text_de": product.get("ingredients_text_de"),
        "ingredients_text_fr": product.get("ingredients_text_fr"),
        "ingredients_text_it": product.get("ingredients_text_it"),
        "ingredients_text_es": product.get("ingredients_text_es"),
        "allergens": ",".join(product.get("allergens_tags") or []) or product.get("allergens"),
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


def main() -> int:
    if not JSONL.exists():
        print(json.dumps({"error": f"missing {JSONL}"}))
        return 1
    products = json.loads(enrich.INDEX.read_text())
    by_barcode = {}
    for product in products:
        key = enrich.barcode_key(product.get("barcode") or product.get("sourceIdentifier") or "")
        if key:
            by_barcode[key] = product
    matched = added = rows = 0
    with JSONL.open(encoding="utf-8") as handle:
        for line in handle:
            rows += 1
            raw = json.loads(line)
            row = flatten(raw)
            key = enrich.barcode_key(row.get("code") or "")
            if key in by_barcode:
                enrich.enrich_product(by_barcode[key], row)
                matched += 1
            else:
                extra = enrich.new_product(row)
                if extra:
                    products.append(extra)
                    extra_key = enrich.barcode_key(extra.get("barcode") or extra.get("sourceIdentifier") or "")
                    if extra_key:
                        by_barcode[extra_key] = extra
                    added += 1
    enrich.save(products)
    report = enrich.write_report(
        products,
        {
            "jsonlRows": rows,
            "jsonlMatched": matched,
            "jsonlAdded": added,
            "harvestMethod": "off-csv-and-jsonl-complete-barcodes-photos-ingredients",
        },
    )
    print(json.dumps({"records": len(products), "matched": matched, "added": added, "analysis": report["analysisCoverage"]}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
