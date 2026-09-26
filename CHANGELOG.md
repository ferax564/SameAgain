# Changelog

Notable changes to Same Again, newest first. The September 2026 code review and its
open findings are in [`docs/REVIEW-2026-09.md`](docs/REVIEW-2026-09.md).

## Unreleased — 25 September 2026 review

Findings and measurements are in [`docs/REVIEW-2026-09-25.md`](docs/REVIEW-2026-09-25.md).

### Catalogue

- Rebuilt from the Open Food Facts nightly export (`scripts/import-off-dump.py`): 98,179
  Swiss products found by barcode (85,611 with nutrition), 33,759 searchable retailer
  products (Coop 12,986, Migros 16,831, plus Denner, Lidl, Aldi, Volg, Spar, Manor, Globus).
- Compact search index plus 100 gzipped barcode shards; scans use the export for 30 days
  before a live refresh. Live records now carry Nutri-Score, NOVA, Green-Score and ingredient
  analysis. `scripts/import-swiss-catalogue.mjs` is replaced.

### Health score

- 0–100 product score (Nutri-Score 60, additives 30, organic 10) with a visible breakdown,
  additive flags with sources, NOVA, and better-scoring alternatives at Coop or Migros.
- Nutri-Score 2023 estimate for products without a recorded grade (90.9% grade agreement
  with Open Food Facts on 40,857 products).

### Receipts

- Swiss layouts: one price per line is one article; weight and count lines above or below
  the article; Aktion/Cumulus/Mengenrabatt deducted from the article; multipacks; 5-Rappen
  rounding; Denner, Lidl, Aldi, Volg, Spar and Manor detected.
- Review rows can link a matching saved-catalogue product; nothing is linked automatically.

### Shops and guide

- Denner, Lidl and Aldi can be chosen as Swiss shops: store hub search, branches, offers,
  map matching, receipt suggestions and the alternatives filter.
- The in-app guide is rewritten as structured user help covering the health score, the
  catalogue and receipts.

### Fixes

- Items naming a former member no longer block ticking, editing, deleting or repeating.
- Newly typed prices survive currency checks; country currencies for DK, SE, NO, PL, CZ, HU,
  RO and IS.
- Invitations survive reloads; server deletions during a resync are no longer lost.
- Quantity inputs, search notices, abroad review count, local dates, invite links without a
  code, and quick-add multipacks, thousands and named numbers.

## Earlier unreleased: September 2026 review fixes

Fixes for every finding in [`docs/REVIEW-2026-09.md`](docs/REVIEW-2026-09.md); its final
section maps each finding to its resolution.

### Sync and reliability

- Finishing a trip sends item references only; the server rebuilds items in one query, so
  large trips no longer fail with "record too large" and block the queue.
- Malformed input returns 400 (never a retried 503). 401 shows "Sign in again" and keeps
  the queue. Requests time out after 15 s.
- Delta sync (`since` cursor, per-household revision, ETag/304); polling pauses in hidden
  tabs, allows one request at a time and backs off after failures.
- Queued changes are stored per operation, and only one tab sends at a time. Redundant
  offline edits collapse, so a net no-op is never sent. Server side effects (`affected`) are
  applied locally. The last household is remembered and every household's queue is flushed.

### Security and data

- Nonce-based CSP, `X-Frame-Options`, `Permissions-Policy`, HSTS; stricter CSRF checks;
  optional HMAC identity assertion (`IDENTITY_ASSERTION_SECRET`).
- Invitations are revoked when their creator loses admin rights; joining as an existing
  member no longer uses up the token.
- Indexes, bounded catalogue queries, per-user limits below shared upstream limits, and
  30-day clean-up of tombstones, receipts, cache and rate-limit rows.
- Account deletion scrubs invitations, receipts and rate-limit keys; ownership races
  return 409. Photos are stripped of metadata on the server and limited per household.

### Domain logic

- Receipt parsing: VAT columns, thousands separators, whole-unit currencies (HUF/ISK),
  `2 x 0.95` rows, purchase-date choice, deterministic fingerprints for pasted text.
- Quick-add parses quantity and unit (`2 kg apples`, `bread x3`), guesses a category and
  asks before adding a same-name duplicate.
- UPC-E support, corrected in-store barcode detection, multipack/centilitre pack sizes, and
  per-kg / per-litre price semantics.

### Interface and accessibility

- Contrast, minimum text size, 44 px touch targets and 16 px inputs; axe scans are clean.
- Error boundaries, lazy-loaded secondary views, memoised derived lists, no theme flash,
  toasts follow the app theme, and the invite token is removed from the address bar.
- The unused language picker is hidden; the signed-out page no longer loads third-party
  images.
- Record payloads are fully typed and lint is clean.

### Tooling and repository hygiene

- Added GitHub Actions CI (`.github/workflows/ci.yml`): Prettier check, typecheck, lint,
  `npm test`, Python retailer-import tests, build, and a Playwright E2E job.
- Added Playwright (`playwright.config.ts`, `npm run test:e2e`) with
  `scripts/e2e-setup.mjs`, which applies `drizzle/` migrations to local D1 before the dev
  server starts. The E2E suite covers onboarding, invitations, sync/offline/conflicts, a
  30-item trip, security headers, API error codes, the demo and axe scans.
- ESLint ignores build output and runtime state, uses `eslint-config-prettier`, and allows
  `any` only in `tests/`.
- Removed 46 unused `components/ui/*` files, `examples/d1`, unused starter SVGs, two
  orphaned starter tests and 13 unused dependencies (including `next-themes`; `Toaster`
  now takes a `theme` prop). `esbuild` is declared explicitly.
- Renamed the package to `same-again` and the local D1/R2 names to `same-again-*`.
- PWA: 192/512 PNG, maskable and Apple touch icons; manifest `id`, `lang`, categories and
  theme colour.
- `chickpea-salad.jpg` downscaled from 3.4 MB (4032×3024, with EXIF) to 1200×900 without
  metadata.
- `/ocr/*` static files are served with a one-year immutable `Cache-Control`.

## 2026-09-13 — Public repository handover

This snapshot was prepared on 13 September 2026 from application commit `54cff8707b1f46c888d21e734a312d2ec47656e3`. It contains the existing application, tests, migrations, provider adapters and attributed public catalogue assets. The usability improvements identified in the September 12 review have **not** been implemented in this snapshot.

It deliberately excludes Git history, account/household databases, private photo storage, runtime caches, environment files, receipts and deployment credentials. `.openai/hosting.json` retains binding names only. Original-source code has no newly selected open-source licence; public visibility alone does not grant an MIT/Apache licence. Third-party dataset, image, OCR and vendor licences remain applicable and are included or referenced beside those assets.

Export validation on 13 September 2026: `npm test` passed all 116 checks; `npm run typecheck` passed. This does not imply the usability review’s proposed improvements or physical-device release checks are complete.

## 2026-09-10 — Release review

- Fixed accent-insensitive and category searches in saved catalogue records, including when the live provider fails. A `search_text` migration supports consistent token matching; older cache rows are backfilled in small batches. Search remains explicitly submitted, bounded and cached.
- Fixed the static catalogue asset binding/origin used by the managed preview. Both Coop and Migros searches now work in the browser. A read-only demo endpoint exposes only shipped public catalogue snapshots, never household or private-photo data.
- Improved product photography, missing-image states, keyboard focus, mobile product actions and dark mode. Fixed mobile item-editor overflow from long dropdown labels and compacted shopping mode. Failed image URLs no longer prevent a later valid photo from displaying. Every shopping item can receive an optional private household photo; repeat purchases preserve it. A different destination substitute does not inherit the original product’s photo.
- Simplified store discovery: retailer/country, source choice, explicit search and coverage are visible together; individual-shop settings are collapsible. Choosing a product in a branch context retains that shop when adding the item.
- Refreshed six demo products from full live records and repaired four exact product photos. Migros oats `7610200011435` changed from a saved 1,000 g record to a current source record of 500 g. Product-detail hydration flags such discrepancies; the physical label remains authoritative.
- Kept 146 nonstandard source identifiers searchable without presenting them as validated EAN/UPC barcodes.
- Fixed receipt photo processing when native browser SHA-256 is unavailable. The small, lazy-loaded `@noble/hashes@1.8.0` fallback produces the same fingerprint and does not change authentication.
- Corrected the acesulfame K evidence link and rejected negative legacy nutrition values. Unknown or incompatible nutrition remains unknown.

This is suitable for continued private household evaluation. Physical iPhone camera/PWA reconnection and the outer hosting gate with actual invited accounts remain release checks before claiming broad device or family-access certification. There is no complete retailer assortment, live branch inventory or automatic offers feed.

### Verification performed on September 10, 2026

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
