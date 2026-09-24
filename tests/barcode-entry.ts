import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodePixels } from '../lib/barcode-reader';
import { barcode } from '../lib/domain';
import { normalise } from '../lib/catalogue';
import { GET as catalogue } from '../app/api/catalogue/route';
import { asUser, run, one } from './server-shim';
import { swissBarcode } from '../lib/swiss-catalogue';
const fixtures = JSON.parse(readFileSync('tests/fixtures/barcodes/index.json', 'utf8'));
for (const f of fixtures)
  await test('actual image decoding ' + f.file, () => {
    const raw = gunzipSync(readFileSync('tests/fixtures/barcodes/' + f.file));
    assert.equal(barcode(decodePixels(new Uint8ClampedArray(raw), f.width, f.height)).code, f.code);
  });
await test('unreadable image fails rather than inventing a code', () =>
  assert.throws(
    () => decodePixels(new Uint8ClampedArray(80 * 80 * 4).fill(255), 80, 80),
    /No readable/,
  ));
await test('v3.6 nutrition reads explicit basis and converts micronutrient units', () => {
  const p = normalise({
    code: '1',
    nutrition: {
      aggregated_set: {
        per: '100ml',
        preparation: 'as_sold',
        nutrients: {
          fat: { value: 2, unit: 'g' },
          calcium: { value: 0.12, unit: 'g' },
          'vitamin-d': { value: 0.0000025, unit: 'g' },
          salt: { value: 0.1, unit: 'g', modifier: '<' },
        },
      },
    },
  });
  assert.equal(p.basis, '100ml');
  assert.equal(p.nutrition?.fat, 2);
  assert.equal(p.nutrition?.calcium, 120);
  assert.equal(p.nutrition?.['vitamin-d'], 2.5000000000000004);
  assert.equal(p.nutrition?.salt, undefined);
  const serving = normalise({
    code: '1',
    nutrition: {
      aggregated_set: {
        per: 'serving',
        preparation: 'as_sold',
        nutrients: { fat: { value: 10, unit: 'g' } },
      },
    },
  });
  assert.equal(serving.basis, undefined);
  assert.deepEqual(serving.nutrition, {});
});
// Freeze catalogue freshness so fixtures remain deterministic as the calendar advances.
const realNow = Date.now;
Date.now = () => 1788618000000;
const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async () => {
  calls++;
  throw new Error('simulated provider outage');
};
await test('Coop barcode reads actual imported record and persists it to database during outage', async () => {
  const code = '7610097171076';
  assert(await swissBarcode(code));
  const r = await asUser('BarcodeTester', () =>
    catalogue(new Request('https://same.test/api/catalogue?barcode=' + code)),
  );
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.product.barcode, code);
  assert.equal(
    JSON.parse((await one('SELECT data FROM catalogue WHERE id=?', d.product.id)).data).barcode,
    code,
  );
  assert.equal(calls, 0);
});
await test('zero-padded GTIN-14 resolves the same exact product', async () => {
  const r = await asUser('BarcodeTester', () =>
    catalogue(new Request('https://same.test/api/catalogue?barcode=07610097171076')),
  );
  assert.equal(r.status, 200);
  assert.equal((await r.json()).product.barcode, '7610097171076');
});
await test('private barcode lookup checks membership before public lookup', async () => {
  const r = await asUser('Outsider', () =>
    catalogue(
      new Request('https://same.test/api/catalogue?barcode=7610097171076&household=private-family'),
    ),
  );
  assert.equal(r.status, 403);
});
await test('invalid check digit cannot read a cached barcode or call the provider', async () => {
  const n = calls;
  const r = await asUser('BarcodeTester', () =>
    catalogue(new Request('https://same.test/api/catalogue?barcode=7610097171075')),
  );
  assert.equal(r.status, 400);
  assert.equal(calls, n);
});
globalThis.fetch = originalFetch;
await test('Migros barcode uses the imported local catalogue and database', async () => {
  const r = await asUser('BarcodeTester', () =>
    catalogue(new Request('https://same.test/api/catalogue?barcode=7617027869157')),
  );
  const d = await r.json();
  assert.equal(r.status, 200);
  assert(d.product.stores.some((s: string) => s.toLowerCase() === 'migros'));
  assert(await one('SELECT data FROM catalogue WHERE id=?', d.product.id));
});
await test('legacy private UPC alias resolves for a member and remains private', async () => {
  await run(
    "INSERT INTO households(id,name,settings,created) VALUES('barcode-family','Test','{}',?)",
    Date.now(),
  );
  await run(
    "INSERT INTO memberships(household,user,role) VALUES('barcode-family','BarcodeTester','owner')",
  );
  await run(
    "INSERT INTO records(id,household,kind,data,version,deleted,created_by,updated_by,created,updated) VALUES('private-upc','barcode-family','product',?,1,0,'BarcodeTester','BarcodeTester',?,?)",
    JSON.stringify({ id: 'private-upc', name: 'Private fixture', barcode: '049000006346' }),
    Date.now(),
    Date.now(),
  );
  const r = await asUser('BarcodeTester', () =>
    catalogue(
      new Request('https://same.test/api/catalogue?barcode=0049000006346&household=barcode-family'),
    ),
  );
  assert.equal((await r.json()).product.id, 'private-upc');
  const denied = await asUser('Outsider', () =>
    catalogue(
      new Request('https://same.test/api/catalogue?barcode=0049000006346&household=barcode-family'),
    ),
  );
  assert.equal(denied.status, 403);
});
await test('unknown barcode is a missing product, distinct from an upstream failure', async () => {
  globalThis.fetch = async () => new Response('', { status: 404 });
  const r = await asUser('BarcodeTester', () =>
    catalogue(new Request('https://same.test/api/catalogue?barcode=0000000000000')),
  );
  assert.equal(r.status, 200);
  assert.equal((await r.json()).product, null);
  globalThis.fetch = originalFetch;
});

Date.now = realNow;
