// Explicit live source checks, excluded from deterministic npm test.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { GET as catalogue } from '../app/api/catalogue/route';
import { asUser, one } from './server-shim';
import { off } from '../lib/catalogue';
const records = [];
for (const [q, country] of [
  ['nutella', ''],
  ['barilla', ''],
  ['haferflocken', 'CH'],
]) {
  const params = new URLSearchParams({ q, ...(country ? { country } : {}) });
  const r = await asUser('LiveSearchCheck', () =>
    catalogue(new Request('https://same.test/api/catalogue?' + params)),
  );
  const d = await r.json();
  assert.equal(r.status, 200);
  assert(d.products.length);
  if (q === 'nutella' && d.products.length < 2)
    console.log(JSON.stringify({ failure: d.notice, matches: d.products.length }));
  if (q === 'nutella')
    assert(d.products.length > 1, 'Local Nutella snapshot must not suppress other variants');
  if (country) assert(d.products.every((p: any) => p.countries.includes('en:switzerland')));
  console.log(
    JSON.stringify({
      query: q,
      country: country || 'All countries',
      matches: d.products.length,
      notice: d.notice,
      first: d.products
        .slice(0, 3)
        .map((p: any) => ({ name: p.name, code: p.barcode, pack: p.pack })),
    }),
  );
}
for (const code of [
  '8000500082379',
  '3017620422003',
  '5411188112709',
  '8076800195057',
  '8000500310427',
  '0737628064502',
]) {
  const live = await off.lookup(code);
  assert(live?.detailsRetrieved, 'Live provider must return a full product');
  const r = await asUser('LiveSearchCheck', () =>
    catalogue(new Request('https://same.test/api/catalogue?barcode=' + code + '&details=1')),
  );
  const d = await r.json();
  assert.equal(r.status, 200);
  if (!d.product?.detailsRetrieved)
    console.log(JSON.stringify({ detailFailure: code, notice: d.notice, status: r.status }));
  assert(d.product?.detailsRetrieved);
  const p = d.product;
  assert.equal(p.barcode, code);
  assert(p.name);
  const stored = JSON.parse((await one('SELECT data FROM catalogue WHERE id=?', p.id)).data);
  assert.equal(stored.detailsRetrieved, p.detailsRetrieved);
  records.push(p);
  console.log(
    JSON.stringify({
      code,
      name: p.name,
      pack: p.pack,
      ingredients: !!p.ingredients,
      basis: p.basis,
      nutrients: Object.keys(p.nutrition || {}).length,
      image: !!p.image,
    }),
  );
  if (code === '8000500082379') {
    assert(p.ingredients);
    assert.equal(p.basis, '100g');
    assert.equal(p.nutrition['energy-kcal'], 539);
  }
}
writeFileSync('.sites-runtime/verified-search-products.json', JSON.stringify(records, null, 2));
