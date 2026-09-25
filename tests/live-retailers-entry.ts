// Opt-in live checks. These use production routes with a local D1/auth harness,
// not a hosted two-account session, and never claim inventory.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { GET as catalogue } from '../app/api/catalogue/route';
import { asUser, one } from './server-shim';
const checks = [];
const products = [];
for (const [retailer, code] of [
  ['coop-ch', '7610097171076'],
  ['coop-ch', '7624841290944'],
  ['migros-ch', '7617027869157'],
  ['migros-ch', '7610200011435'],
]) {
  const response = await asUser('RetailerReleaseCheck', () =>
    catalogue(
      new Request(
        'https://same.test/api/catalogue?' + new URLSearchParams({ barcode: code, details: '1' }),
      ),
    ),
  );
  assert.equal(response.status, 200);
  const d = await response.json();
  const p = d.product;
  assert.equal(p?.barcode, code);
  assert(p.detailsRetrieved, 'Live details required for this check');
  assert(p.countries.includes('en:switzerland'));
  assert(p.stores?.some((s: string) => s.toLowerCase() === retailer.split('-')[0]));
  assert(p.image);
  const photo = await fetch(p.image, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
  assert(photo.ok);
  assert(photo.headers.get('content-type')?.startsWith('image/'));
  assert(await one('SELECT id FROM catalogue WHERE id=?', p.id));
  products.push(p);
  checks.push({
    retailer,
    barcode: code,
    name: p.name,
    pack: p.pack,
    sourceUrl: p.sourceUrl,
    retrieved: new Date(p.detailsRetrieved).toISOString(),
    image: p.image,
    imageStatus: photo.status,
    ingredients: !!p.ingredients,
    basis: p.basis,
    nutrients: Object.keys(p.nutrition || {}).length,
    inventory: 'unknown',
  });
  console.log(JSON.stringify(checks.at(-1)));
}
writeFileSync(
  '.sites-runtime/live-retailer-verification.json',
  JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2),
);
writeFileSync('.sites-runtime/verified-retailer-products.json', JSON.stringify(products, null, 2));
