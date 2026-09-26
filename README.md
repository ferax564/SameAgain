# Same Again

Your family’s favourites. One shared list. Find them—or a suitable alternative—wherever you are.

A TypeScript/React application on Vinext and Cloudflare Workers, with D1 shared persistence, authenticated R2 photos and platform-managed Sign in with ChatGPT. This source snapshot omits the original deployment project ID. Configure a new hosting project when deploying your own instance; do not reuse another household’s infrastructure.

Release history is in [CHANGELOG.md](CHANGELOG.md). The September 2026 reviews are in [docs/REVIEW-2026-09.md](docs/REVIEW-2026-09.md) and [docs/REVIEW-2026-09-25.md](docs/REVIEW-2026-09-25.md).

## Start using it

1. Sign in, create or join a household, and create a list. Country, currency and language preferences are optional and editable.
2. Add generic groceries immediately. Search or scan packaged products, save favourites, or create a private household product with a photo and label information.
3. Grant family members **Site access through the Site’s sharing controls first**. Then create their household invitations. Each person needs a separate ChatGPT account.
4. New invitations are bound to the recipient’s sign-in email, single-use, expiring after seven days and revocable. The server stores a token digest. Older unbound invitations retain their previous behavior until expiry/revocation. Creating a household invitation neither changes Site access nor sends an email.
5. **Explore the demo** is a separate browser-local example household. Shopping activity and recipe examples are fictional. Product records and catalogue photos are attributed source snapshots. Demo changes never become real household records automatically.

Publishing this repository does not publish household records or grant access to the hosted application. A new deployment must retain authenticated, server-authorised household access.

## Setup and deployment

Requirements: Node 22.13 or newer (the test harness uses `node:sqlite`, which needs no flag from 22.13), npm, Python 3 for the retailer-import tests, and a Sites environment supporting Cloudflare Workers, D1 and R2 for deployment. CI runs on Node 22.

```sh
git clone https://github.com/ferax564/SameAgain.git
cd SameAgain
npm ci
npm run dev      # Vite dev server with the Worker runtime and local D1/R2
```

See [Development](#development) for the checks to run before pushing.

After a schema change, run `npm run db:generate` and commit the generated migration. The checked-in lockfile is authoritative. Sites applies packaged `drizzle/` migrations before deployment. Application routes never create tables at runtime. For local testing, `npm run e2e:setup` applies the migrations to the local D1 database used by `npm run dev`. Managed preview has no real sign-in identity by itself; use the isolated demo or the deterministic route harness.

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

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (vinext + `@cloudflare/vite-plugin`) with local D1/R2 bindings named `same-again-*` |
| `npm run format` / `npm run format:check` | Prettier (`.prettierrc.json`, `.prettierignore`); formatting-only commits are listed in `.git-blame-ignore-revs` |
| `npm run lint` | ESLint (`eslint.config.mjs`: Next core-web-vitals + TypeScript rules, `eslint-config-prettier`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Domain tests, production API routes against an in-memory `node:sqlite` D1 harness (bundled with esbuild), and service-worker tests |
| `python3 tests/retailer-import.test.py` | Retailer page import tests |
| `npm run test:e2e` | Playwright. `scripts/e2e-setup.mjs` applies `drizzle/` migrations to `.wrangler/state`, then the dev server starts. Tests live in `e2e/` (none yet). Install a browser first with `npx playwright install chromium` |
| `npm run build` | `scripts/build-verified.sh`: prepares the OCR runtime and runs a time-bounded `vinext build` into `dist/` |

To make `git blame` skip the formatting commit, run `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

### Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and on every pull request:

- **check** job: `npm ci`, the Prettier check, typecheck, lint, `npm test`, the Python tests and the build.
- **e2e** job: `npx playwright install --with-deps chromium`, then `npm run test:e2e`: onboarding, invitations, multi-member sync, offline replay and conflicts, a 30-item trip, security headers, API error codes, the demo and axe accessibility scans, on desktop and mobile viewports.

All checks, including lint with no warnings, are expected to pass on every commit.

### Review

[`docs/REVIEW-2026-09.md`](docs/REVIEW-2026-09.md) is the September 2026 review of the whole application: security, data integrity, UX, accessibility and tooling. Its final section records how each finding was resolved.

## Architecture and security

- `lib/use-household.ts`: user/household-keyed cache, ordered optimistic outbox, polling, retries and conflict review.
- `app/api/data/route.ts`, `lib/server.ts`: actual identity, origin, membership, role, validation and rate checks for shared operations.
- `db/schema.ts`: users, households, memberships, invitations, typed records, operation receipts, catalogue cache and throttles.
- `lib/catalogue.ts`: provider interface and Open Food Facts adapter. `lib/catalogue-cache-search.ts`, `lib/swiss-catalogue.ts` and `lib/retailer-catalogue.ts` handle separate cached/source records.
- `lib/domain.ts`: barcode validation, quantities, duplicate rules, totals, substitutions and deterministic ranking.
- `app/api/photo`, `app/api/export`: authenticated private uploads/reads and account/shared-data export.

Typed records cover lists/items, private products, favourites, personal feedback, accepted substitutions, trips, templates, branches, observations, offers, recipes and meals. User notes and requirements remain separate from source product data. Household membership is required for every shared read/write; a list ID is not an access grant. Owners/administrators manage settings and membership; only owners transfer ownership or change roles. Members manage shopping, favourite and meal records. Personal feedback remains attributable.

Account deletion requires transferring ownership or deleting owned households. Retained shared history is anonymised; personal profile, feedback, memberships and operation receipts are removed. Household deletion removes its R2 prefix. JSON export includes authenticated photo URLs, not a bundled photo archive. Sign-out clears household caches on that device.

## Security hardening

**Optional signed identity.** If the Worker has the secret `IDENTITY_ASSERTION_SECRET` (`wrangler secret put IDENTITY_ASSERTION_SECRET`), every request must also carry `oai-authenticated-assertion-ts` (Unix seconds, within ±300 s) and `oai-authenticated-assertion` = lowercase hex HMAC-SHA256(secret, `<user-id>\n<email>\n<ts>`), computed by the trusted dispatcher over the exact `oai-authenticated-user-id` and `oai-authenticated-user-email` values. Requests without a valid assertion are treated as signed out (401). Without the secret the identity headers are trusted as before; in that case make sure the Worker is reachable only through the dispatcher (disable `workers_dev` and preview routes).

**Headers.** Every response carries a nonce-based Content-Security-Policy (`frame-ancestors 'none'`, `connect-src 'self'`, images from the app and Open Food Facts only), `X-Frame-Options: DENY`, `Permissions-Policy: camera=(self), geolocation=(self), microphone=()`, HSTS, `nosniff` and a strict referrer policy. State-changing requests require a same-origin `Origin` or `Sec-Fetch-Site`, and `POST /api/data` requires `application/json`.

**Input.** Malformed input returns 400 and is never retried by the client; only genuine infrastructure failures return 503. Country, retailer and language values are checked against own-property allow-lists.

**Limits.** Photos: JPEG/PNG up to 3 MB and 8000 px; EXIF/XMP/text metadata is stripped on the server; 200 MB per household. Per-account rate limits and daily caps stay below the shared Photon (12/min, 300/day) and Open Food Facts (12 product / 8 search per minute) limits.

**Retention.** Deleted records, operation receipts, expired cache and rate-limit rows are purged after 30 days by a bounded, opportunistic clean-up. Account deletion scrubs invitations, receipts that mention the account and rate-limit keys.

## Sync and offline behavior

D1 is authoritative. While the tab is visible the app polls every four seconds for changes since its last cursor (`GET /api/data?household=H&since=<cursor>`, with ETag/304); polling pauses in hidden tabs and backs off after failures. Requests time out after 15 seconds. Queued changes are stored one per key so several open tabs cannot overwrite each other, and only one tab sends at a time. Offline add/edit/check operations update the local view and replay in order when the app reconnects. Stable operation IDs make retries idempotent. Each update checks an expected record version; an old client never replaces an entire list snapshot. Mutation and operation receipt commit atomically.

Different-item edits proceed independently. Same-item conflicts preserve the latest local draft and show it beside shared values for review. Undo checks the post-change version and cannot silently reverse another member’s later edit. Definitively rejected edits show a reason with retry/discard choices. Household switching is blocked while changes are pending. Finishing a trip atomically records purchase snapshots and removes matching completed items; stale snapshots are rejected.

The PWA caches the shell/static assets, not authenticated API responses. First visit, authentication, invitations, uploads and live searches require a connection. Queued operations sync while the app is open; background sync and a cold offline OCR start are not guaranteed. Private photos are not required for essential offline shopping. Revoked access cannot erase a lost device’s already cached copy remotely.

## Catalogue coverage and photographs

The Swiss catalogue is rebuilt from the Open Food Facts nightly CSV export of **25 September 2026** (one streamed download, no per-product API calls). Every named product tagged for Switzerland is kept; products with retailer evidence (a community store tag or a retailer own brand such as Naturaplan, Prix Garantie, M-Classic or M-Budget) also go into the search index.

| Retailer evidence | Records | With nutrition | With Nutri-Score | With ingredients | With photo |
| --- | ---: | ---: | ---: | ---: | ---: |
| Migros | 16,831 | 15,743 | 8,614 | 7,551 | 14,815 |
| Coop | 12,986 | 12,076 | 6,529 | 5,795 | 10,794 |
| Denner | 1,672 | 1,538 | 868 | 526 | 1,467 |
| Lidl | 1,157 | 1,115 | 929 | 904 | 1,151 |
| Aldi | 685 | 643 | 561 | 537 | 679 |
| Volg, Spar, Manor, Globus | 715 | 658 | 437 | 326 | 663 |
| **Search index (any retailer)** | **33,759** | | | | |
| **All Swiss-tagged products (barcode lookup)** | **98,179** | 85,611 | 41,132 | 33,024 | 85,558 |

The previous snapshot had 13,249 records (Coop 3,534, Migros 9,759) and nutrition for only six of them. `lib/swiss-retailer-report.json` records the export hash, date and these counts. Retailer evidence is community data, not a current assortment, price or branch stock claim, and no complete retailer catalogue is available to compare against: coop.ch and migros.ch were not reachable from the review environment, and their APIs need client keys.

- `public/catalogue/swiss-retailer-products.json` (7.5 MB): compact search records; derivable fields (id, source URL, country, retrieval date, image folder) are restored by `lib/swiss-catalogue.ts`, and search text is computed once per Worker isolate.
- `public/catalogue/barcodes/NN.json.gz` (100 shards, 18 MB): full records keyed by barcode, sharded by the last two digits (unchanged by zero-padding), decompressed on the server; a few shards stay cached per isolate.
- Barcode scans are answered from the export for up to 30 days before a live Open Food Facts refresh, which keeps the shared 15-reads-per-minute quota for products the export lacks.

Photograph URLs are recorded coverage, not proof that every remote image always loads. The UI shows an honest fallback and lets households add their own pictures. Direct retailer images are not copied without a reuse licence. At most 48 local results are shown; refine the query.

`python3 scripts/import-off-dump.py` rebuilds all three outputs from the export (about 2 minutes of download and 15 seconds of processing; pass a local copy and `OFF_EXPORT_DATE` to reuse a download). `scripts/import-retailer-pages.py INPUT_DIRECTORY lib/retailer-products.json` extracts factual fields from saved public pages/index results. No unattended scraping or refresh job runs.

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

The [FSVO Swiss Food Composition Database v7.1, 1 July 2026](https://valeursnutritives.ch/en/downloads/) permits dataset integration/commercial reuse with acknowledgement. `python3 scripts/import-swiss-foods.py workbook.xlsx` rebuilds the bounded per-100-g edible-portion index (openpyxl required). `public/catalogue/swiss-provenance.json` records workbook hash, units, version and derivations. This licence does not authorize unrelated website imagery.

Ingredient evidence covers four sweeteners, not a comprehensive hazard score: aspartame, acesulfame K, sucralose and steviol glycosides. It links source assessments and distinguishes them from dislikes, allergies and certifications. Missing concentrations prevent exposure estimates. No “allergy-safe” or personalized risk label is issued; the product health score below is a documented comparison aid. The corrected [EFSA acesulfame K assessment](https://efsa.onlinelibrary.wiley.com/doi/10.2903/j.efsa.2025.9317) is distinct from its aspartame assessment. Evidence is a versioned snapshot requiring periodic review; meal totals do not establish medical suitability.

## Product health score

Every product page shows a 0–100 **health score** with its breakdown, in the spirit of Yuka but with each input visible (`lib/health-score.ts`, `app/health-panel.tsx`):

| Part | Points | Source |
| --- | ---: | --- |
| Nutrition | 60 | Nutri-Score grade A 60, B 48, C 33, D 18, E 5 |
| Additives | 30 | minus 15 / 8 / 3 per additive with a high / moderate / limited flag |
| Organic | 10 | a recorded organic certification (EU organic, Bio Suisse, Demeter …) |

- The Nutri-Score computed by Open Food Facts is used when recorded. Otherwise it is estimated from declared per-100 g/ml values with the 2023 algorithm (general foods, beverages, cheese, fats/oils/nut butters, red meat, water) and labelled as an estimate. Against 40,857 Swiss products that have an Open Food Facts grade, the estimate gives the same grade for 90.9% and is within one grade for 97.3%; most differences come from fruit/vegetable content, which labels do not declare.
- Additive flags summarise regulatory evidence reviewed on 25 September 2026: EU withdrawal (E171), EFSA nitrosamine concern (nitrites), the EU children’s-attention warning for six colours, IARC 2B classifications (aspartame, BHA), sulphite sensitivity, and EFSA intake or data-gap notes (glutamates, phosphates, carrageenan, caramel colours, some emulsifiers, non-sugar sweeteners). Each flag links its source. An additive without a flag is listed as such; that is not a safety finding. When a product has no ingredient list, its additives are unknown and earn no points, so incomplete records never outrank complete ones.
- A high flag caps the score at 49. NOVA processing is shown but not scored. Products without energy, sugars, saturated fat and salt are **not scored** rather than guessed, and alcohol and baby foods are out of scope even when a source record carries a grade.
- **Better-scoring alternatives** come from the same specific category in the saved Swiss index, at least 10 points higher, optionally at one retailer (Coop, Migros, Denner, Lidl or Aldi). Allergens, taste and stock are not compared.
- Search results show the score as a badge. The score is a comparison aid, not medical or allergy advice.

## Individual shops, observations and offers

Store discovery distinguishes exact catalogue identity, country alternatives and nearby shops. Coop, Migros, Denner, Lidl and Aldi (Switzerland), Tesco GB, Carrefour France and Walmart US have provider configurations; Denner, Lidl and Aldi offer links open the retailer home page because no offers page was verified; country support does not imply equal catalogue coverage. Save an address-specific branch manually or choose a matching mapped place. Server checks reject another household’s branch or a mismatched retailer. A list remembers the branch, and selecting a catalogue product there retains its shop context. Branch edit/deletion is not included.

Nearby places use [Photon](https://photon.komoot.io/) / [OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright), with manual city/postcode or a one-time location request. Coordinates are rounded to three decimals before transmission; no background location tracking or durable location history is stored. The provider receives the selected area. Up to 12 relevant stores within roughly 3 km have approximate straight-line distances. Global limits are 12/minute and 300/day, plus 8/minute/account, with a bounded one-hour cache. Maps/web links remain useful when the provider is unavailable.

**Recorded for Switzerland is not current availability. Nearby supermarket is not product stock.** A dated household purchase report is not verified inventory. Offers are member-entered amounts, currencies, dates, conditions and source links; no live promotions feed exists. Expired/upcoming entries remain labelled. No unverified offer price becomes a basket estimate automatically. Estimated priced items, missing prices and actual recorded purchases are separate; changing currency does not perform FX conversion.

## Receipt scanning

Open **Lists → Scan receipt**. Take/upload a photo or paste text; adjust the suggested crop, rotate and choose German, English, French, Italian, Spanish, Portuguese or Dutch. Correct names, quantities, units and pack sizes, deselect unwanted rows, add missed rows and confirm review before adding.

Receipt abbreviations become **generic groceries** unless the reviewer links a product. When every word of a line matches a product in the saved Swiss index (at the receipt’s retailer when it is Coop or Migros), the row offers “Link this product”; nothing is linked automatically, and abbreviations usually match nothing. The parser handles the common Swiss layouts: Coop tables with Menge/Preis/Aktion/Total and tax-code columns; Migros, Lidl, Aldi and Denner lines with one price per article, count (`2 x 4.95`) and weight (`0.785 kg x 2.99 CHF/kg`) lines above or below the article; Aktion, Cumulus and Mengenrabatt lines, which are deducted from the article above; multipacks such as `6x1.5l`; and 5-Rappen rounding. Rows with one price and no quantity column are one article. Unclear quantities start deselected and fractional units carry review warnings. Only reviewed metadata is shared through the normal authenticated operation queue. Past receipt totals do not become prices for the next shop. The same image fingerprint/row already outstanding on the target list is skipped; a different photo of the same receipt is not necessarily detected. Operation retries remain idempotent.

OCR runs locally in a browser worker. Receipt photos and full text are not uploaded or saved in household records; temporary data is discarded on close. Only reviewed item metadata, optional store/date/currency and past line totals persist. Personal receipt photos and raw OCR output are excluded from this source distribution.

The first scan needs connectivity to load self-hosted Tesseract.js 7 resources/language models. JPEG/PNG/WebP are supported; HEIC depends on browser decoding and has JPEG/text fallbacks. PDFs, handwriting, every receipt format and cold offline OCR are not certified. Print quality, folds, abbreviations and unusual columns require human correction.

Tesseract.js/core use Apache-2.0. Pinned `@tesseract.js-data/*@1.0.0` packages supply `4.0.0_best_int` models (npm packaging MIT, upstream trained data Apache-2.0). Source URLs, licence and SHA-256 values are under `public/ocr/v7/lang/`. `scripts/download-receipt-languages.py` deliberately refreshes pinned models; `scripts/prepare-receipt-ocr.mjs` copies locked worker/core assets before builds. The SHA-256 compatibility fallback uses MIT-licensed noble-hashes. No OCR API key is required.

## Remaining release and operating limits

- Physical iPhone camera/autofocus, OS permissions/photo picker, PWA install and secure-context airplane-mode reconnection still need device testing. `/device-check` provides capability readouts and a concrete two-device checklist; it never marks these passed automatically.
- Hosted sign-in, Site access and sharing with actual invited accounts need those users’ participation. Deterministic identities are not real ChatGPT accounts. No household permissions or Site audience were weakened for preview tests.
- Catalogue/ingredients/nutrition/photographs, translations, certification data and retailer coverage are incomplete. There is no live inventory, automatic offers, comprehensive ingredient safety database or automatic source-refresh service; the catalogue is refreshed by running `scripts/import-off-dump.py`.
- UI is English. Saved language preference and OCR language selection do not imply a translated interface.
- Upload UI re-encodes supported images to metadata-free JPEG, maximum 1,600-pixel edge. The API accepts signature-checked JPEG/PNG up to 3 MB; direct API uploads do not receive server-side EXIF stripping or malware scanning. Orphan uploads persist until household deletion. Existing list/recipe/history snapshots retain earlier product data when a private master product changes.
- Larger rollout needs cache/rate/operation cleanup, orphan-image retention, database pagination/push sync, monitoring, backup/recovery and load testing. These are not simulated by the current small-household release.

## Source and licensing

This repository was published on 13 September 2026 (see [CHANGELOG.md](CHANGELOG.md)). It contains the application, tests, migrations, provider adapters and attributed public catalogue assets. It deliberately excludes account/household databases, private photo storage, runtime caches, environment files, receipts and deployment credentials. `.openai/hosting.json` retains binding names only.

The original source code has no open-source licence yet. Public visibility alone does not grant an MIT or Apache licence. Third-party dataset, image, OCR and vendor licences still apply; they are included or referenced beside those assets.

Do not enable the deployment’s trusted identity headers on an unprotected public origin.
