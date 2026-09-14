# Same Again

Your family’s favourites. One shared list. Find them—or a suitable alternative—wherever you are.

A TypeScript/React application on Vinext and Cloudflare Workers, with D1 shared persistence, authenticated R2 photos and platform-managed Sign in with ChatGPT. This source snapshot omits the original deployment project ID. Configure a new hosting project when deploying your own instance; do not reuse another household’s infrastructure.

## Start using it

1. Sign in, create or join a household, and create a list. Country, currency and language preferences are optional and editable.
2. Add generic groceries immediately. Search or scan packaged products, save favourites, or create a private household product with a photo and label information.
3. Grant family members **Site access through the Site’s sharing controls first**. Then create their household invitations. Each person needs a separate ChatGPT account.
4. New invitations are bound to the recipient’s sign-in email, single-use, expiring after seven days and revocable. The server stores a token digest. Older unbound invitations retain their previous behavior until expiry/revocation. Creating a household invitation neither changes Site access nor sends an email.
5. **Explore the demo** is a separate browser-local example household. Shopping activity and recipe examples are fictional. Product records and catalogue photos are attributed source snapshots. Demo changes never become real household records automatically.

Publishing this repository does not publish household records or grant access to the hosted application. A new deployment must retain authenticated, server-authorised household access.

## September 10 release review

- Fixed accent-insensitive and category searches in saved catalogue records, including when the live provider fails. A `search_text` migration supports consistent token matching; older cache rows are backfilled in small batches. Search remains explicitly submitted, bounded and cached.
- Fixed the static catalogue asset binding/origin used by the managed preview. Both Coop and Migros searches now work in the browser. A read-only demo endpoint exposes only shipped public catalogue snapshots, never household or private-photo data.
- Improved product photography, missing-image states, keyboard focus, mobile product actions and dark mode. Fixed mobile item-editor overflow from long dropdown labels and compacted shopping mode. Failed image URLs no longer prevent a later valid photo from displaying. Every shopping item can receive an optional private household photo; repeat purchases preserve it. A different destination substitute does not inherit the original product’s photo.
- Simplified store discovery: retailer/country, source choice, explicit search and coverage are visible together; individual-shop settings are collapsible. Choosing a product in a branch context retains that shop when adding the item.
- Refreshed six demo products from full live records and repaired four exact product photos. Migros oats `7610200011435` changed from a saved 1,000 g record to a current source record of 500 g. Product-detail hydration flags such discrepancies; the physical label remains authoritative.
- Kept 146 nonstandard source identifiers searchable without presenting them as validated EAN/UPC barcodes.
- Fixed receipt photo processing when native browser SHA-256 is unavailable. The small, lazy-loaded `@noble/hashes@1.8.0` fallback produces the same fingerprint and does not change authentication.
- Corrected the acesulfame K evidence link and rejected negative legacy nutrition values. Unknown or incompatible nutrition remains unknown.

This is suitable for continued private household evaluation. Physical iPhone camera/PWA reconnection and the outer hosting gate with actual invited accounts remain release checks before claiming broad device or family-access certification. There is no complete retailer assortment, live branch inventory or automatic offers feed.

## Setup and deployment

Requirements: Node 22.13+ (Node 24 for the supplied SQLite test adapter), npm and a Sites environment supporting Cloudflare Workers, D1 and R2.

```sh
npm ci
npm run typecheck
npm test
python3 tests/retailer-import.test.py
npm run build
```

After a schema change, run `npm run db:generate` and commit the generated migration. The checked-in lockfile is authoritative. Sites applies packaged `drizzle/` migrations before deployment. Application routes never create tables at runtime. For local authenticated testing, apply the migrations to the local D1 binding with the environment’s migration tooling. Managed preview has no real sign-in identity by itself; use the isolated demo or the deterministic route harness.

Use the Sites build helper, commit and push the exact source, package the built Worker/client assets/migrations, validate the archive, save the matching version and deploy it to the authorized audience. Do not expose the raw Worker behind a proxy that accepts spoofable identity headers. A non-Sites deployment requires a verified authentication integration.

### Bindings and environment

| Name | Purpose |
| --- | --- |
| `DB` | Sites D1 binding: accounts, memberships, shared records, catalogue caches and operation receipts |
| `BUCKET` | Sites R2 binding: private household product/recipe/item photos |
| `oai-authenticated-user-id` | Stable identity supplied only by the trusted Sites dispatcher |
| `oai-authenticated-user-email` | Dispatcher-supplied account and invitation email |
| `oai-authenticated-user-full-name` | Optional dispatcher-supplied display name |
| `PHOTON_BASE_URL` | Optional server-only HTTPS base URL for a contracted/self-hosted Photon provider; defaults to `https://photon.komoot.io/` |

No required `.env` values, client secrets, external OCR account, paid service, retailer keys or email provider are needed. `/signin-with-chatgpt` and `/signout-with-chatgpt` belong to the hosting dispatcher. Future contracted retailer feeds require their own server-only configuration; none is secretly connected.

## Architecture and security

- `lib/use-household.ts`: user/household-keyed cache, ordered optimistic outbox, polling, retries and conflict review.
- `app/api/data/route.ts`, `lib/server.ts`: actual identity, origin, membership, role, validation and rate checks for shared operations.
- `db/schema.ts`: users, households, memberships, invitations, typed records, operation receipts, catalogue cache and throttles.
- `lib/catalogue.ts`: provider interface and Open Food Facts adapter. `lib/catalogue-cache-search.ts`, `lib/swiss-catalogue.ts` and `lib/retailer-catalogue.ts` handle separate cached/source records.
- `lib/domain.ts`: barcode validation, quantities, duplicate rules, totals, substitutions and deterministic ranking.
- `app/api/photo`, `app/api/export`: authenticated private uploads/reads and account/shared-data export.

Typed records cover lists/items, private products, favourites, personal feedback, accepted substitutions, trips, templates, branches, observations, offers, recipes and meals. User notes and requirements remain separate from source product data. Household membership is required for every shared read/write; a list ID is not an access grant. Owners/administrators manage settings and membership; only owners transfer ownership or change roles. Members manage shopping, favourite and meal records. Personal feedback remains attributable.

Account deletion requires transferring ownership or deleting owned households. Retained shared history is anonymised; personal profile, feedback, memberships and operation receipts are removed. Household deletion removes its R2 prefix. JSON export includes authenticated photo URLs, not a bundled photo archive. Sign-out clears household caches on that device.

## Sync and offline behavior

D1 is authoritative. Active data polls every four seconds. Offline add/edit/check operations update the local view and replay in order when the app reconnects. Stable operation IDs make retries idempotent. Each update checks an expected record version; an old client never replaces an entire list snapshot. Mutation and operation receipt commit atomically.

Different-item edits proceed independently. Same-item conflicts preserve the latest local draft and show it beside shared values for review. Undo checks the post-change version and cannot silently reverse another member’s later edit. Definitively rejected edits show a reason with retry/discard choices. Household switching is blocked while changes are pending. Finishing a trip atomically records purchase snapshots and removes matching completed items; stale snapshots are rejected.

The PWA caches the shell/static assets, not authenticated API responses. First visit, authentication, invitations, uploads and live searches require a connection. Queued operations sync while the app is open; background sync and a cold offline OCR start are not guaranteed. Private photos are not required for essential offline shopping. Revoked access cannot erase a lost device’s already cached copy remotely.

## Catalogue coverage and photographs

| Source snapshot | Records | Records with a front-photo URL | Scope |
| --- | ---: | ---: | --- |
| OFF, Switzerland, Coop tag | 4,306 | 4,297 | Swiss Coop community snapshot, dump-enriched |
| OFF, Switzerland, Migros tag | 14,112 | 13,604 | Swiss Migros snapshot (search harvest + CSV + JSONL) |
| Unique Swiss OFF records | 18,333 | 17,816 | Barcode or pack code on every record |
| With ingredient lists | 9,455 | — | Typed lists from the OFF dump; still not every pack |
| With additive tags | 4,927 | — | E-numbers when Open Food Facts recorded them |
| With Nutri-Score grade | 10,574 | — | Official OFF grade when present |
| Direct Coop pages/links | 31 | 0 imported | One page with verified factual details and nutrition |
| Direct Migros pages/links | 182 | 0 imported | 28 detail records; six explicit nutrition tables |

**517 Swiss source records still have no photo** because Open Food Facts has none uploaded. **8,878 records still have no typed ingredient list.** Where an ingredients pack photo exists, product details show that photo. The UI does not invent a list. Direct retailer images are not copied without a reuse licence.

The licensed Swiss index is `public/catalogue/swiss-retailer-products.json`; its licence is adjacent. Barcode/search matches persist in D1 on use. Discover and store browse load **48 records per page** with **Load more** until the full indexed retailer snapshot is shown. Opening a product shows a **0–100 profile** (Nutri-Score 60 / additives 30 / organic 10), the ingredient list with matched E-numbers, and labelled nutrition. Unnamed/nonmatching records were excluded. No official Coop or Migros assortment or branch-stock claim follows from these counts. The profile uses Yuka’s published weights and Open Food Facts plus EFSA/IARC/WHO/ANSES citations; it is not Yuka’s score and not medical advice.

`node scripts/import-swiss-catalogue.mjs` resumes ignored import checkpoints with a minimum eight-second interval. Coop uses the exact Switzerland + store query (already an exact OFF count). Migros is harvested by barcode prefix (`code:0*` … `code:9*`) so it is not limited to one public 10,000-hit search. `python3 scripts/enrich-swiss-catalogue.py` streams the public Open Food Facts products CSV dump to attach every available barcode, photo and ingredient list. `python3 scripts/harvest-off-jsonl.py` then `python3 scripts/merge-off-jsonl.py` add language-specific ingredients and selected images from the JSONL dump. Remaining ingredient photos can be read with `python3 scripts/ocr-catalogue-ingredients.py`; leftover gaps can be filled with `python3 scripts/hydrate-catalogue-api.py`. Discover cards show the barcode, photo and ingredient preview. This is still not an official Coop or Migros assortment. `scripts/import-retailer-pages.py INPUT_DIRECTORY lib/retailer-products.json` extracts factual fields from saved public pages/index results. No unattended scraping or refresh job runs. Reports record scope, provenance, dates and hashes.

Direct Migros API documentation describes products/offers/stores, but the unauthenticated API returned HTTP 401 for a missing client key. Earlier basic Coop retrieval failed; one bounded official bread page was accessible during this review and its facts were added. Neither result establishes an authorized full feed. No credentials, browser-session keys, robots exclusions or access controls were bypassed.

Search combines the local index, saved records and provider responses, verifies filters, deduplicates identities and ranks exact barcode/name matches ahead of incidental mentions. Flavours, pack sizes and incompatible units stay distinct. Full detail hydration is separately cached; a partial search record cannot overwrite richer details. Retailer article numbers are never manufactured into barcodes. EAN-8, EAN-13, UPC-A and compatible zero-padded GTIN-14 strings preserve leading zeros and validate check digits. Retailer-local/variable-weight codes can need additional context.

## Data licences and provider limits

Open Food Facts documentation and licences checked **10 September 2026**:

- [API documentation and limits](https://openfoodfacts.github.io/openfoodfacts-server/api/)
- [Licence and attribution guidance](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side/)
- [Search-a-licious query documentation](https://openfoodfacts.github.io/search-a-licious/users/explain-query-language/)
- [Image retrieval guidance](https://openfoodfacts.github.io/openfoodfacts-server/api/how-to-download-images/)

OFF database: **ODbL 1.0**; individual contents: **DbCL 1.0**; photos: **CC BY-SA 3.0**, with possible packaging/trademark rights. Catalogue screens, source links and exports include attribution. Public redistribution of derived catalogue data must satisfy applicable share-alike obligations. Private photos/notes are never published to OFF. Retailer page facts and private records remain separate; no open licence is asserted for retailer content. [Coop terms](https://www.coop.ch/de/agb.html) reserve content/image rights.

Documented limits are 15 product reads and 10 searches/minute/IP. This app caps uncached calls at 12 and 8 across its D1 counters; shared egress can still be throttled. Product responses cache for 24 hours, searches for six hours, and search outages trigger a one-minute cooldown. Search is submitted explicitly rather than per keystroke. Search requests allow 15 seconds; full product reads 20 seconds and the client 25 seconds. Cached/private fallbacks report their source and retrieval age. Provider uptime is not guaranteed. For larger rollout, register OFF usage and supply an operational contact in the identifying User-Agent; no unsolicited registration message was sent.

## Alternatives and destination lists

1. Retrieve up to 24 candidates from a specific recorded category and require destination-country evidence.
2. Apply household constraints and the intended member’s requirements. Unknown required ingredients/certifications fail eligibility. Allergy constraints additionally require an explicit matching absence label, conservatively rejecting ambiguous records. English terms/taxonomy tags are not a medical allergen validator.
3. Require a specific shared category. Category and ingredient overlap earn two points, or three when prioritized. Compatible nutritional similarity earns two, or three when prioritized. Same brand earns one, or three when prioritized/preferred. Similar pack size earns one, or two when prioritized. Three points is the candidate threshold; six gives the stronger band. These internal scores are never shown as percentages of identicalness.
4. Explain matching evidence, important differences, completeness and unknown taste. Sweetened/unsweetened, powdered and concentrate distinctions are screened conservatively using available terms; multilingual omissions remain a limitation.

Only compatible per-100-g or per-100-ml nutrition is compared. No serving-to-mass, mass-to-volume or density conversion is invented. Category-based functional suitability is an inference, not a cooking test. Ingredient overlap does not establish taste equivalence. Exact-product requirements disable automatic suggestions, and unknown requirements are never silently approved.

Whole-basket translation requires review of each current item, creates a new list, and preserves links and reasons. A changed original invalidates its prior approval. Pack conversions show the requested amount and require the user’s quantity choice. Accepted substitutes can be remembered per country. A bounded candidate sample can correctly return no credible match.

## Recipes, meals and nutrition

Meals supports shared recipes with private photos, weighed ingredients, steps and serving counts. Ingredients may use exact products, household label records, manual entries or **1,215 generic Swiss composition records**. These are average food-composition data, not retailer products. Demo recipe images are illustrative and credited in `public/recipes/ATTRIBUTION.txt` (Shisma, CC BY 4.0; FitTasteTic, CC BY-SA 2.0).

Plan portions for each member/date/meal, record eaten status and undo it. Saved meal entries retain server-derived recipe snapshots if the source recipe changes. Review selected ingredients before adding a recipe or planned portions to a shopping list. Compatible quantities combine before rounding to whole packs; mass, volume, notes and variants stay distinct. No pantry deduction, cooking yield or tracking of previous ingredient additions is assumed.

Daily totals distinguish planned from eaten portions for the selected member. Nutrient units and bases are explicit (g, mg, µg, kcal). Partial sums show ≥ and coverage; percentages appear only with complete data. Missing, prepared-only, serving-only, below-detection and nonnumeric source values are not converted into measured amounts. OFF v3.6 imports compatible declared macro/micronutrients from its current schema; legacy search-index data may contain only macros. The app does not calculate nutrition from photographs.

The [FSVO Swiss Food Composition Database v7.1, 1 July 2026](https://valeursnutritives.ch/en/downloads/) permits dataset integration/commercial reuse with acknowledgement. `python3 scripts/import-swiss-foods.py workbook.xlsx` rebuilds the bounded per-100-g edible-portion index (openpyxl required). `lib/swiss-provenance.json` records workbook hash, units, version and derivations. This licence does not authorize unrelated website imagery.

Ingredient evidence covers four sweeteners, not a comprehensive hazard score: aspartame, acesulfame K, sucralose and steviol glycosides. It links source assessments and distinguishes them from dislikes, allergies and certifications. Missing concentrations prevent exposure estimates. No “allergy-safe”, personalized risk or universal “good/bad” label is issued. The corrected [EFSA acesulfame K assessment](https://efsa.onlinelibrary.wiley.com/doi/10.2903/j.efsa.2025.9317) is distinct from its aspartame assessment. Evidence is a versioned snapshot requiring periodic review; meal totals do not establish medical suitability.

## Individual shops, observations and offers

Store discovery distinguishes exact catalogue identity, country alternatives and nearby shops. Coop, Migros, Tesco GB, Carrefour France and Walmart US have provider configurations; country support does not imply equal catalogue coverage. Save an address-specific branch manually or choose a matching mapped place. Server checks reject another household’s branch or a mismatched retailer. A list remembers the branch, and selecting a catalogue product there retains its shop context. Branch edit/deletion is not included.

Nearby places use [Photon](https://photon.komoot.io/) / [OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright), with manual city/postcode or a one-time location request. Coordinates are rounded to three decimals before transmission; no background location tracking or durable location history is stored. The provider receives the selected area. Up to 12 relevant stores within roughly 3 km have approximate straight-line distances. Global limits are 12/minute and 300/day, plus 8/minute/account, with a bounded one-hour cache. Maps/web links remain useful when the provider is unavailable.

**Recorded for Switzerland is not current availability. Nearby supermarket is not product stock.** A dated household purchase report is not verified inventory. Offers are member-entered amounts, currencies, dates, conditions and source links; no live promotions feed exists. Expired/upcoming entries remain labelled. No unverified offer price becomes a basket estimate automatically. Estimated priced items, missing prices and actual recorded purchases are separate; changing currency does not perform FX conversion.

## Receipt scanning

Open **Lists → Scan receipt**. Take/upload a photo or paste text; adjust the suggested crop, rotate and choose German, English, French, Italian, Spanish, Portuguese or Dutch. Correct names, quantities, units and pack sizes, deselect unwanted rows, add missed rows and confirm review before adding.

Receipt abbreviations become **generic groceries**. They do not establish an exact barcode, photo, ingredients, nutrition or stock. Unclear quantities start deselected and fractional units carry review warnings. Only reviewed metadata is shared through the normal authenticated operation queue. Past receipt totals do not become prices for the next shop. The same image fingerprint/row already outstanding on the target list is skipped; a different photo of the same receipt is not necessarily detected. Operation retries remain idempotent.

OCR runs locally in a browser worker. Receipt photos and full text are not uploaded or saved in household records; temporary data is discarded on close. Only reviewed item metadata, optional store/date/currency and past line totals persist. Personal receipt photos and raw OCR output are excluded from this source distribution.

The first scan needs connectivity to load self-hosted Tesseract.js 7 resources/language models. JPEG/PNG/WebP are supported; HEIC depends on browser decoding and has JPEG/text fallbacks. PDFs, handwriting, every receipt format and cold offline OCR are not certified. Print quality, folds, abbreviations and unusual columns require human correction.

Tesseract.js/core use Apache-2.0. Pinned `@tesseract.js-data/*@1.0.0` packages supply `4.0.0_best_int` models (npm packaging MIT, upstream trained data Apache-2.0). Source URLs, licence and SHA-256 values are under `public/ocr/v7/lang/`. `scripts/download-receipt-languages.py` deliberately refreshes pinned models; `scripts/prepare-receipt-ocr.mjs` copies locked worker/core assets before builds. The SHA-256 compatibility fallback uses MIT-licensed noble-hashes. No OCR API key is required.

## Verification performed on September 10, 2026

**118 automated checks passed:** 116 TypeScript/Node tests (`npm test`: 11 domain + 101 route/feature + 4 service-worker cases), plus two Python retailer-import tests. TypeScript validation is required before publication.

The API suite executes production routes and membership, identity, role, rate, origin and database helpers. Only trusted platform identity headers, D1 adapter and R2 runtime are substituted. Coverage includes two-member collaboration; outsider denial; expired/revoked/reused and wrong-recipient invitations; role/ownership rules; offline replay/idempotence; stale undo and same-item conflicts; scoped exports/photos; exact account anonymisation; atomic trip completion; recipes/meal quantities; missing and incompatible nutrition; unknown required attributes; no matches; original-list preservation; branch scope; partial totals; provider outages and cache isolation.

Scanner tests decode actual EAN-13, EAN-8 and UPC-A images at four orientations and cover permission rejection, duplicate events, interrupted camera startup, unknown products and leading-zero lookup. Receipt tests cover multilingual columns, discounts, fractional units, missing prices, payment/footer exclusion, corruption, crop suggestions, private provenance and shared persistence. New regressions cover accented/category cache searches, public demo isolation, photo identity/authorization/repeat/substitution behavior, invalid catalogue identifiers and native/fallback SHA-256 test vectors.

Live provider checks are separate from fixtures and use production adapter/routes with a local SQLite D1 harness:

| Barcode | Retailer tag | Live record | Pack | Nutrition basis | Front image |
| --- | --- | --- | --- | --- | --- |
| `7610097171076` | Coop | Take it easy | 500 ml | 100 ml | HTTP 200 |
| `7624841290944` | Coop | Haferflocken | 500 g | 100 g | HTTP 200 |
| `7617027869157` | Migros | Hagelzucker | 250 g | 100 g | HTTP 200 |
| `7610200011435` | Migros | Vollkorn Haferflocken (Grob) | 500 g | 100 g | HTTP 200 |

All four were retrieved and persisted/read back successfully on September 10. Take it easy still has no ingredient declaration. A repeat run later timed out after its first success; it is not another complete pass. General search returned 24 Nutella results with live success; Barilla (21) and Swiss oats (5) used saved fallback after a provider failure. Six separate full-product barcode lookups succeeded with photos, ingredients and declared bases, including `0737628064502`. These checks do not establish retailer ownership of OFF records or inventory. Opt-in scripts: `node scripts/verify-live-search.mjs`, `node scripts/verify-live-retailers.mjs`; provider outages deliberately cause live assertions to fail.

Historical interactive checks used a separate demo. Raw receipt photos, OCR output and household screenshots are not distributed. These checks do not certify physical iPhone behaviour or hosted multi-account access.

## Remaining release and operating limits

- Physical iPhone camera/autofocus, OS permissions/photo picker, PWA install and secure-context airplane-mode reconnection still need device testing. `/device-check` provides capability readouts and a concrete two-device checklist; it never marks these passed automatically.
- Hosted sign-in, Site access and sharing with actual invited accounts need those users’ participation. Deterministic identities are not real ChatGPT accounts. No household permissions or Site audience were weakened for preview tests.
- Catalogue/ingredients/nutrition/photographs, translations, certification data and retailer coverage are incomplete. There is no live inventory, automatic offers, comprehensive ingredient safety database or automatic source-refresh service.
- UI is English. Saved language preference and OCR language selection do not imply a translated interface.
- Upload UI re-encodes supported images to metadata-free JPEG, maximum 1,600-pixel edge. The API accepts signature-checked JPEG/PNG up to 3 MB; direct API uploads do not receive server-side EXIF stripping or malware scanning. Orphan uploads persist until household deletion. Existing list/recipe/history snapshots retain earlier product data when a private master product changes.
- Larger rollout needs cache/rate/operation cleanup, orphan-image retention, database pagination/push sync, monitoring, backup/recovery and load testing. These are not simulated by the current small-household release.

## September 13 readiness review

Implemented the remaining household-usability work and re-reviewed the Coop and Migros catalogues:

- Discover search always uses the saved Swiss index, including in the isolated demo. Coop Switzerland and Migros shortcuts browse that index with an honest coverage card. Demo search no longer silently limits itself to six sample products.
- Shared lists can be filtered by Everyone, Assigned to me, Unclaimed, or another member. Claiming an item cannot silently take someone else’s assignment. Household switcher is available when you belong to more than one household.
- Retailer page search is accent-insensitive and uses the same `search_text` tokens as community search. Indexed Coop/Migros titles can show a pack size read from the title, labelled as such. Household goods such as drain cleaner are marked separately from groceries.
- Store matching accepts both `coop` and `en:coop` tags, so community and live records do not drop out of a retailer browse.

### Coop and Migros catalogue review

| Source | Records | Photos / facts | What this is |
| --- | ---: | --- | --- |
| Open Food Facts · Switzerland · Coop tag | 4,306 | Barcode on every record; 4,297 photo URLs | Swiss Coop community snapshot + dump ingredients/photos |
| Open Food Facts · Switzerland · Migros tag | 14,112 | Barcode on every record; 13,604 photo URLs | Swiss Migros snapshot via barcode-prefix search, CSV and JSONL |
| Direct Coop pages/links | 31 | 1 page with verified facts and nutrition | Indexed titles plus Prix Garantie rye bread |
| Direct Migros pages/links | 182 | 28 page details; 6 nutrition tables | Mostly discovery links; 149 earlier detail fetches failed |

The Swiss search index currently includes **18,333 community records**, **a barcode or pack code on every record**, **17,816 photo URLs**, **9,455 typed ingredient lists**, plus additive tags and Nutri-Score grades. Discover cards show the photo, barcode and ingredient preview. Direct retailer images are not copied. Neither feed is live stock, offers or branch inventory. Products still missing a photo or typed ingredients do not have those fields in Open Food Facts.

## September 14 ingredient and additive review

Discover product cards can show a 0–100 profile. Product details list ingredients (with matched E-numbers), Nutri-Score/NOVA when recorded, additive evidence cards, and per-100 g/ml nutrition. Additive notes cite EFSA, IARC, WHO or ANSES and never invent a dose. Missing ingredient lists stay incomplete rather than scoring as “clean”.

## Merge this work to main

Publish the catalogue, household-readiness and ingredient-analysis work with a fast-forward merge after review:

```sh
git fetch origin
git checkout main
git merge --ff-only origin/cursor/ingredient-analysis-a5b0
git push origin main
```

If `main` has moved, merge the pull request from `cursor/ingredient-analysis-a5b0` into `main` instead of forcing a fast-forward.

## Public repository handover

This snapshot was prepared on 13 September 2026 from application commit `54cff8707b1f46c888d21e734a312d2ec47656e3`, then updated with the September 13 readiness work.

It deliberately excludes Git history, account/household databases, private photo storage, runtime caches, environment files, receipts and deployment credentials. `.openai/hosting.json` retains binding names only. Original-source code has no newly selected open-source licence; public visibility alone does not grant an MIT/Apache licence. Third-party dataset, image, OCR and vendor licences remain applicable and are included or referenced beside those assets.

### Get the source

```sh
git clone https://github.com/ferax564/SameAgain.git
cd SameAgain
npm ci
npm test
npm run typecheck
```

Follow the setup and deployment instructions above. Do not enable the deployment’s trusted identity headers on an unprotected public origin.

Export validation after this readiness pass: `npm test`, `python3 tests/retailer-import.test.py` and `npm run typecheck`. Physical iPhone camera/PWA checks and hosted multi-account sign-in still need real devices and invited accounts.
