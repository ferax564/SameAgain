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


def barcode_image_path(code: str) -> str:
    digits = enrich.digits_only(code)
    if len(digits) <= 8:
        return digits
    if len(digits) < 13:
        digits = digits.zfill(13)
    if len(digits) == 14 and digits.startswith("0"):
        digits = digits[1:]
    return f"{digits[:3]}/{digits[3:6]}/{digits[6:9]}/{digits[9:]}"


def uploaded_image_url(code: str, uploaded: dict | None) -> str | None:
    if not isinstance(uploaded, dict) or not uploaded:
        return None
    keys = sorted(uploaded, key=lambda k: int(k) if str(k).isdigit() else 10_000)
    for key in keys:
        url = _size_url(code, key, uploaded.get(key) or {})
        if url:
            return url
    return None


def numeric_uploaded_url(code: str, images: dict | None) -> str | None:
    if not isinstance(images, dict):
        return None
    keys = sorted((k for k in images if str(k).isdigit()), key=lambda k: int(str(k)))
    for key in keys:
        url = _size_url(code, key, images.get(key) or {})
        if url:
            return url
    return None


def named_image_url(code: str, images: dict | None, kind: str) -> str | None:
    if not isinstance(images, dict):
        return None
    langs = ("en", "de", "fr", "it", "es")
    for lang in langs:
        url = _rev_url(code, f"{kind}_{lang}", images.get(f"{kind}_{lang}"))
        if url:
            return url
    return _rev_url(code, kind, images.get(kind))


def _size_url(code: str, key: str, meta: dict) -> str | None:
    if not isinstance(meta, dict):
        return None
    sizes = meta.get("sizes") or {}
    if "400" not in sizes and "full" not in sizes:
        return None
    size = "400" if "400" in sizes else "full"
    url = f"https://images.openfoodfacts.org/images/products/{barcode_image_path(code)}/{key}.{size}.jpg"
    return url if url.startswith("https://images.openfoodfacts.org/") else None


def _rev_url(code: str, stem: str, meta: dict | None) -> str | None:
    if not isinstance(meta, dict) or meta.get("rev") in (None, ""):
        return None
    url = f"https://images.openfoodfacts.org/images/products/{barcode_image_path(code)}/{stem}.{meta['rev']}.400.jpg"
    return url if url.startswith("https://images.openfoodfacts.org/") else None


def selected_image_url(code: str, selected: dict | None, kind: str) -> str | None:
    block = (selected or {}).get(kind) or {}
    if not isinstance(block, dict):
        return None
    langs = ("en", "de", "fr", "it", "es") + tuple(block)
    seen = set()
    for lang in langs:
        if lang in seen:
            continue
        seen.add(lang)
        meta = block.get(lang)
        if not isinstance(meta, dict) or meta.get("rev") in (None, ""):
            continue
        url = f"https://images.openfoodfacts.org/images/products/{barcode_image_path(code)}/{kind}_{lang}.{meta['rev']}.400.jpg"
        if url.startswith("https://images.openfoodfacts.org/"):
            return url
    return None


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
    selected = ((product.get("images") or {}).get("selected")) or product.get("selected_images") or {}
    uploaded = ((product.get("images") or {}).get("uploaded")) or {}
    # Legacy selected_images.front.display.lang vs images.selected.front.lang.rev
    front_display = (selected.get("front") or {}).get("display") or {}
    ingredients_display = (selected.get("ingredients") or {}).get("display") or {}
    nutrition_display = (selected.get("nutrition") or {}).get("display") or {}
    langs = ("en", "de", "fr", "it", "es")
    code = str(product.get("code") or "")
    images = product.get("images") or {}
    image = enrich.off_image(
        product.get("image_front_url"),
        product.get("image_url"),
        selected_image_url(code, selected, "front"),
        *(front_display.get(lang) for lang in langs if isinstance(front_display, dict)),
        named_image_url(code, images, "front"),
        uploaded_image_url(code, uploaded),
        numeric_uploaded_url(code, images),
        selected_image_url(code, selected, "ingredients"),
        *(ingredients_display.get(lang) for lang in langs if isinstance(ingredients_display, dict)),
        named_image_url(code, images, "ingredients"),
        selected_image_url(code, selected, "nutrition"),
        *(nutrition_display.get(lang) for lang in langs if isinstance(nutrition_display, dict)),
        named_image_url(code, images, "nutrition"),
    )
    ingredients_image = enrich.off_image(
        product.get("image_ingredients_url"),
        selected_image_url(code, selected, "ingredients"),
        *(ingredients_display.get(lang) for lang in langs if isinstance(ingredients_display, dict)),
        named_image_url(code, images, "ingredients"),
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
