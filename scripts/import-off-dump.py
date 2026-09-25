#!/usr/bin/env python3
"""Rebuild the Swiss catalogue from the Open Food Facts nightly CSV export.

Usage:
  python3 scripts/import-off-dump.py [SOURCE]
  OFF_EXPORT_DATE=2026-09-25T11:59:42Z python3 scripts/import-off-dump.py local-copy.csv.gz

SOURCE is the official gzipped CSV export (default: the public S3 mirror of
https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz), a
local copy of it, or a pre-filtered gzipped TSV with the same header. The export
is streamed once; no per-product API requests are made, as OFF asks for bulk use.

Outputs (all ODbL 1.0, see public/catalogue/LICENCE.txt):
  public/catalogue/swiss-retailer-products.json  search index: products with Swiss
      retailer evidence (store tag or retailer own brand), compact fields
  public/catalogue/barcodes/NN.json.gz           full records for every named
      Switzerland-tagged product, sharded by the last two barcode digits
  lib/swiss-retailer-report.json                 scope, counts and provenance

Retailer evidence is community data, not a current assortment or stock claim.
"""
import csv
import gzip
import hashlib
import io
import json
import os
import re
import sys
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone

DEFAULT = "https://openfoodfacts-ds.s3.eu-west-3.amazonaws.com/en.openfoodfacts.org.products.csv.gz"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_INDEX = os.path.join(ROOT, "public/catalogue/swiss-retailer-products.json")
OUT_SHARDS = os.path.join(ROOT, "public/catalogue/barcodes")
OUT_REPORT = os.path.join(ROOT, "lib/swiss-retailer-report.json")

# Retailers present in Switzerland. `stores` patterns match the community store
# field; `brands` patterns match retailer own brands (evidence of the retailer's
# assortment even when nobody tagged the store).
RETAILERS = {
    "coop": {
        "label": "Coop",
        "stores": r"\bcoop\b",
        "brands": r"\b(?:coop|naturaplan|prix garantie|fine food|karma|betty bossi|qualit[ée] (?:&|et) prix|naturafarm|free from|halba|pro montagna|ünique|unique|oecoplan|jamadu|sapori d.italia)\b",
    },
    "migros": {
        "label": "Migros",
        "stores": r"\bmigros\b",
        "brands": r"\b(?:m-classic|m-budget|migros|anna'?s best|frey|s[ée]lection|migros bio|v-love|aproz|jowa|delica|léger|farmer|kania|yogos|heidi|agnesi|m-dessert|bischofszell|m-plus|daily|you|alnatura)\b",
    },
    "denner": {"label": "Denner", "stores": r"\bdenner\b", "brands": r"\bdenner\b"},
    "lidl": {"label": "Lidl", "stores": r"\blidl\b", "brands": None},
    "aldi": {"label": "Aldi", "stores": r"\baldi\b", "brands": None},
    "volg": {"label": "Volg", "stores": r"\bvolg\b", "brands": r"\bvolg\b"},
    "spar": {"label": "Spar", "stores": r"\bspar\b", "brands": None},
    "manor": {"label": "Manor", "stores": r"\bmanor\b", "brands": r"\bmanor food\b"},
    "globus": {"label": "Globus", "stores": r"\bglobus\b", "brands": None},
}
# The live search index is kept small enough for a Worker isolate; everything
# else is reachable by barcode through the shards.
INDEX_RETAILERS = set(RETAILERS)

# Nutrients as named in lib/nutrition.ts. CSV `_100g` values are in g except
# energy (kcal); convert to the unit the app stores.
NUTRIENTS = {
    "energy-kcal": 1,
    "proteins": 1,
    "carbohydrates": 1,
    "fat": 1,
    "saturated-fat": 1,
    "sugars": 1,
    "fiber": 1,
    "salt": 1,
    "calcium": 1000,
    "iron": 1000,
    "magnesium": 1000,
    "potassium": 1000,
    "sodium": 1000,
    "zinc": 1000,
    "phosphorus": 1000,
    "iodine": 1e6,
    "selenium": 1e6,
    "vitamin-a": 1e6,
    "vitamin-c": 1000,
    "vitamin-d": 1e6,
    "vitamin-e": 1000,
    "vitamin-k": 1e6,
    "vitamin-b1": 1000,
    "vitamin-b2": 1000,
    "vitamin-b6": 1000,
    "vitamin-b9": 1e6,
    "vitamin-b12": 1e6,
}
# Plausibility ceilings per 100 g (in the stored unit); larger values are data errors.
CEILING = {"energy-kcal": 900, "salt": 100, "sodium": 40000}
LIQUID = re.compile(r"(?<![a-z])(?:\d+(?:[.,]\d+)?\s*(?:ml|cl|dl|l|lt|litre|liter)s?)\b", re.I)


def tags(value, limit=60):
    return [t for t in (value or "").split(",") if t][:limit]


def number(value):
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n == n and n not in (float("inf"), float("-inf")) else None


def image_url(url):
    # Only the application's allowed image host; the 400 px front photo.
    if not url.startswith("https://images.openfoodfacts.org/images/products/"):
        return None
    return re.sub(r"\.(\d+)\.full\.jpg$", r".\1.400.jpg", url)


def clean_text(s, limit):
    s = re.sub(r"\s+", " ", (s or "").replace("\\n", " ")).strip()
    return s[:limit]


def retailer_evidence(stores, brands):
    found = []
    for key, r in RETAILERS.items():
        if re.search(r["stores"], stores, re.I) or (r["brands"] and re.search(r["brands"], brands, re.I)):
            found.append(key)
    return found


def build(row, ix, retrieved):
    g = lambda k: row[ix[k]] if k in ix else ""
    code = g("code").strip()
    name = clean_text(g("product_name") or g("generic_name"), 160)
    if not re.fullmatch(r"\d{8,14}", code) or not re.search(r"\w{2}", name):
        return None, []
    brand = clean_text(g("brands"), 200)
    stores_raw = g("stores")
    evidence = retailer_evidence(stores_raw, brand)
    stores = []
    for s in stores_raw.split(","):
        s = s.strip()
        if s and s.lower() not in [x.lower() for x in stores]:
            stores.append(s[:80])
    # The canonical retailer name is what retailer filters match ("Coop Pronto" or an
    # own brand alone would otherwise not count as Coop).
    for k in evidence:
        if RETAILERS[k]["label"].lower() not in [x.lower() for x in stores]:
            stores.append(RETAILERS[k]["label"])
    nutrition = {}
    for k, factor in NUTRIENTS.items():
        v = number(g(k + "_100g"))
        if v is None or v < 0:
            continue
        v = v * factor
        if v > CEILING.get(k, 100 if factor == 1 else 1e9):
            continue
        nutrition[k] = round(v, 4 if factor == 1 else 3)
    if "energy-kcal" not in nutrition:
        kj = number(g("energy-kj_100g")) or number(g("energy_100g"))
        if kj is not None and 0 <= kj <= 3800:
            nutrition["energy-kcal"] = round(kj / 4.184, 1)
    quantity = clean_text(g("quantity"), 60)
    categories = tags(g("categories_tags"))
    basis = "100ml" if (LIQUID.search(quantity) or "en:beverages" in categories) else "100g"
    p = {
        "id": "off:" + code,
        "barcode": code,
        "name": name,
        "brand": brand,
        "pack": quantity,
        "stores": stores[-12:],
        "additives": tags(g("additives_tags")),
        "categories": categories,
        "countries": tags(g("countries_tags"), 40),
        "source": "Open Food Facts",
        "sourceUrl": "https://world.openfoodfacts.org/product/" + code,
        "retrieved": retrieved,
    }
    img = image_url(g("image_url"))
    if img:
        p["image"] = img
    for key, col in (("labels", "labels_tags"), ("allergens", "allergens_tags"), ("traces", "traces_tags")):
        t = tags(g(col))
        if t:
            p[key] = t
    ingredients = clean_text(g("ingredients_text"), 3000)
    if ingredients:
        p["ingredients"] = ingredients
        it = tags(g("ingredients_tags"), 40)
        if it:
            p["ingredientTags"] = it
    if nutrition and g("no_nutrition_data") not in ("on", "1", "true"):
        p["nutrition"] = nutrition
        p["basis"] = basis
    else:
        p["nutrition"] = {}
    grade = g("nutriscore_grade").strip().lower()
    if grade in ("a", "b", "c", "d", "e"):
        ns = {"grade": grade, "source": "Open Food Facts"}
        score = number(g("nutriscore_score"))
        if score is not None:
            ns["score"] = int(score)
        p["nutriscore"] = ns
    nova = g("nova_group").strip()
    if nova in ("1", "2", "3", "4"):
        p["nova"] = int(nova)
    eco = g("environmental_score_grade").strip().lower()
    if eco in ("a-plus", "a", "b", "c", "d", "e", "f"):
        p["ecoscore"] = eco
    analysis = [t for t in tags(g("ingredients_analysis_tags")) if not t.endswith("-unknown")]
    if analysis:
        p["analysis"] = analysis
    updated = number(g("last_modified_t"))
    if updated:
        p["sourceUpdated"] = int(updated * 1000)
    p["detailsRetrieved"] = retrieved
    return p, evidence


def image_key(p):
    """The image file name under the product's folder: `front_de.3.400`."""
    m = re.search(r"/([^/]+)\.jpg$", p.get("image", ""))
    return m.group(1) if m else None


def index_record(p):
    """Compact search fields. Derivable fields (id, source URL, countries, retrieval
    date) are restored by lib/swiss-catalogue.ts; details come from the shards."""
    r = {"b": p["barcode"], "n": p["name"]}
    for short, key in (("r", "brand"), ("q", "pack")):
        if p.get(key):
            r[short] = p[key]
    if p["stores"]:
        r["s"] = p["stores"]
    r["c"] = p["categories"][-6:]
    key = image_key(p)
    if key:
        # Recorded paths use the canonical folder split; keep only the file name.
        folder = p["image"].rsplit("/", 1)[0]
        r["i"] = key if folder.endswith(image_folder(p["barcode"])) else p["image"]
    if p.get("labels"):
        r["l"] = p["labels"][:12]
    if p.get("additives"):
        r["a"] = p["additives"]
    if p.get("nutriscore"):
        r["g"] = p["nutriscore"]["grade"] + (str(p["nutriscore"]["score"]) if "score" in p["nutriscore"] else "")
    if p.get("nova"):
        r["v"] = p["nova"]
    return r


def image_folder(code):
    """OFF's image folder: 13-digit codes split 3/3/3/rest; shorter codes padded."""
    c = code.zfill(13) if len(code) < 13 else code
    return "/".join([c[0:3], c[3:6], c[6:9], c[9:]]) if len(c) == 13 else c


def open_source(src):
    if re.match(r"https?://", src):
        req = urllib.request.Request(src, headers={"User-Agent": "SameAgain-catalogue-import/1.0"})
        resp = urllib.request.urlopen(req, timeout=120)
        modified = resp.headers.get("Last-Modified")
        return gzip.GzipFile(fileobj=resp), modified
    return gzip.open(src, "rb"), None


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    raw, modified = open_source(src)
    digest = hashlib.sha256()

    class Hashing(io.RawIOBase):
        def readable(self):
            return True

        def readinto(self, b):
            data = raw.read(len(b))
            digest.update(data)
            b[: len(data)] = data
            return len(data)

    text = io.TextIOWrapper(io.BufferedReader(Hashing(), 1 << 20), encoding="utf-8", errors="replace")
    csv.field_size_limit(1 << 30)
    reader = csv.reader(text, delimiter="\t", quoting=csv.QUOTE_NONE, escapechar="\\" if not re.match(r"https?://", src) and src.endswith(".tsv.gz") else None)
    header = next(reader)
    ix = {k: i for i, k in enumerate(header)}
    if os.environ.get("OFF_EXPORT_DATE"):
        # A local copy: record the export's own date, not when it was copied.
        stamp = datetime.fromisoformat(os.environ["OFF_EXPORT_DATE"].replace("Z", "+00:00"))
    elif modified:
        stamp = datetime.strptime(modified, "%a, %d %b %Y %H:%M:%S %Z").replace(tzinfo=timezone.utc)
    else:
        stamp = datetime.fromtimestamp(os.path.getmtime(src), timezone.utc)
    retrieved = int(stamp.timestamp() * 1000)
    shards = defaultdict(dict)
    index = []
    counts = Counter()
    per_retailer = defaultdict(Counter)
    seen = set()
    for row in reader:
        counts["rows"] += 1
        if len(row) != len(header):
            counts["malformed"] += 1
            continue
        if "en:switzerland" not in row[ix["countries_tags"]]:
            continue
        p, evidence = build(row, ix, retrieved)
        if not p or p["barcode"] in seen:
            continue
        seen.add(p["barcode"])
        counts["records"] += 1
        counts["withPhoto"] += "image" in p
        counts["withNutrition"] += bool(p["nutrition"])
        counts["withIngredients"] += "ingredients" in p
        counts["withNutriScore"] += "nutriscore" in p
        counts["withNova"] += "nova" in p
        shards[p["barcode"][-2:]][p["barcode"]] = p
        for k in evidence:
            c = per_retailer[k]
            c["records"] += 1
            c["withPhoto"] += "image" in p
            c["withNutrition"] += bool(p["nutrition"])
            c["withNutriScore"] += "nutriscore" in p
            c["withIngredients"] += "ingredients" in p
        if INDEX_RETAILERS.intersection(evidence):
            index.append(index_record(p))
    os.makedirs(OUT_SHARDS, exist_ok=True)
    for name in os.listdir(OUT_SHARDS):
        if name.endswith((".json", ".json.gz")):
            os.remove(os.path.join(OUT_SHARDS, name))
    for key, records in sorted(shards.items()):
        data = json.dumps(records, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        # mtime=0 keeps the archive byte-identical for identical input.
        with open(os.path.join(OUT_SHARDS, key + ".json.gz"), "wb") as f:
            with gzip.GzipFile(fileobj=f, mode="wb", compresslevel=9, mtime=0) as z:
                z.write(data.encode("utf-8"))
    index.sort(key=lambda r: r["b"])
    with open(OUT_INDEX, "w", encoding="utf-8") as f:
        json.dump({"format": 2, "retrieved": retrieved, "products": index}, f, ensure_ascii=False, separators=(",", ":"))
    report = {
        "retrieved": stamp.isoformat().replace("+00:00", "Z"),
        "source": "Open Food Facts",
        "sourceExport": src if re.match(r"https?://", src) else os.path.basename(src),
        "sourceSha256": digest.hexdigest(),
        "method": "Nightly CSV export, streamed once; products tagged en:switzerland with a name and a valid numeric code.",
        "completeRetailerCatalogue": False,
        "records": counts["records"],
        "indexRecords": len(index),
        "coverage": {k: counts[k] for k in ("withPhoto", "withNutrition", "withIngredients", "withNutriScore", "withNova")},
        "coverageByRetailer": {k: dict(per_retailer[k]) for k in RETAILERS if per_retailer[k]},
        "retailerEvidence": "Community store tag or retailer own brand. Not a current assortment, price or branch stock claim.",
        "licence": "ODbL 1.0; contents DbCL 1.0; images CC BY-SA 3.0",
        "notice": "Community records tagged for Switzerland. Retailer coverage is partial; direct retailer feeds were not used.",
    }
    with open(OUT_REPORT, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
