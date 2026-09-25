import test from 'node:test';
import assert from 'node:assert/strict';
import {
  additiveFlag,
  betterAlternatives,
  estimateNutriScore,
  healthScore,
  nutriKind,
} from '../lib/health-score';
import { expandCompact, imageFolder, swissBarcode, swissBetter } from '../lib/swiss-catalogue';
import { GET as catalogue } from '../app/api/catalogue/route';
import { GET as demo } from '../app/api/demo-catalogue/route';
import { normalise } from '../lib/catalogue';
import type { Product } from '../lib/domain';
import { asUser } from './server-shim';
const base = (over: Partial<Product>): Product => ({
  id: 'x',
  name: 'Test',
  categories: ['en:snacks'],
  countries: ['en:switzerland'],
  source: 'Test',
  retrieved: 0,
  ...over,
});
await test('Nutri-Score 2023 estimate matches reference products', () => {
  // Hazelnut spread: 539 kcal, 57 g sugar, 10.6 g saturated fat, 0.107 g salt → E.
  const spread = base({
    nutrition: {
      'energy-kcal': 539,
      sugars: 56.3,
      'saturated-fat': 10.6,
      salt: 0.107,
      proteins: 6.3,
      fiber: 3.4,
    },
  });
  assert.equal(estimateNutriScore(spread)?.grade, 'e');
  // Plain oats are A.
  const oats = base({
    nutrition: {
      'energy-kcal': 372,
      sugars: 1,
      'saturated-fat': 1.3,
      salt: 0.01,
      proteins: 13,
      fiber: 10,
    },
  });
  assert.equal(estimateNutriScore(oats)?.grade, 'a');
  // Extra virgin olive oil is B under the 2023 fats rules.
  const oil = base({
    categories: ['en:vegetable-oils', 'en:olive-oils'],
    nutrition: { 'energy-kcal': 828, fat: 92, 'saturated-fat': 18, sugars: 0, salt: 0 },
  });
  assert.equal(nutriKind(oil), 'fat');
  assert.equal(estimateNutriScore(oil)?.grade, 'b');
  // A sugary soda with sweeteners scores worse than without.
  const soda = base({
    categories: ['en:beverages', 'en:sodas'],
    nutrition: { 'energy-kcal': 42, sugars: 10.6, 'saturated-fat': 0, salt: 0 },
  });
  assert.equal(estimateNutriScore(soda)?.grade, 'e');
  const zero = base({
    categories: ['en:beverages', 'en:sodas'],
    additives: ['en:e951'],
    nutrition: { 'energy-kcal': 0.3, sugars: 0, 'saturated-fat': 0, salt: 0.02 },
  });
  assert.equal(estimateNutriScore(zero)?.grade, 'c');
  assert.equal(estimateNutriScore(base({ categories: ['en:waters'] }))?.grade, 'a');
  // Missing core values are never guessed.
  assert.equal(estimateNutriScore(base({ nutrition: { 'energy-kcal': 100 } })), undefined);
  assert.equal(
    nutriKind(base({ categories: ['en:beverages', 'en:alcoholic-beverages'] })),
    undefined,
  );
});
await test('the source Nutri-Score is preferred and labelled', () => {
  const h = healthScore(base({ nutriscore: { grade: 'b', score: 1 }, additives: [] }));
  assert.equal(h.nutrition?.origin, 'source');
  assert.equal(h.value, 48 + 30);
  assert.equal(h.band, 'excellent');
});
await test('additive flags, organic points and the high-flag cap are explicit', () => {
  assert.equal(additiveFlag('en:e150d')?.risk, 'limited');
  assert.equal(additiveFlag('E 171')?.risk, 'high');
  assert.equal(additiveFlag('en:e330'), undefined);
  assert.equal(additiveFlag('en:e452i')?.name, 'Phosphate (E452)');
  const organic = healthScore(
    base({ nutriscore: { grade: 'a' }, labels: ['en:organic'], additives: ['en:e330'] }),
  );
  assert.equal(organic.value, 100);
  const nitrite = healthScore(
    base({ nutriscore: { grade: 'a' }, labels: ['en:organic'], additives: ['en:e250'] }),
  );
  assert.equal(nitrite.value, 49);
  assert(nitrite.notes.some((n) => n.includes('Capped')));
  const unknown = healthScore(base({ nutrition: {} }));
  assert.equal(unknown.value, undefined);
  assert(unknown.notes[0].startsWith('Not scored'));
});
await test('better alternatives share the specific category and score clearly higher', () => {
  const original = base({
    id: 'o',
    categories: ['en:snacks', 'en:chips'],
    nutriscore: { grade: 'e' },
  });
  const better = base({ id: 'b', categories: ['en:chips'], nutriscore: { grade: 'c' } });
  const slightly = base({
    id: 's',
    categories: ['en:chips'],
    nutriscore: { grade: 'e' },
    labels: ['en:organic'],
  });
  const other = base({ id: 'c', categories: ['en:cookies'], nutriscore: { grade: 'a' } });
  const unscored = base({ id: 'u', categories: ['en:chips'] });
  assert.deepEqual(
    betterAlternatives(original, [better, slightly, other, unscored, original]).map(
      (a) => a.product.id,
    ),
    ['b', 's'],
  );
  assert.deepEqual(betterAlternatives(base({ id: 'n', categories: ['en:chips'] }), [better]), []);
});
await test('live OFF records carry Nutri-Score, NOVA and analysis', () => {
  const p = normalise({
    code: '1',
    product_name: 'X',
    nutriscore_grade: 'C',
    nutriscore_score: 5,
    nova_group: 4,
    ingredients_analysis_tags: ['en:vegan', 'en:palm-oil-content-unknown'],
  });
  assert.deepEqual(p.nutriscore, { grade: 'c', score: 5, source: 'Open Food Facts' });
  assert.equal(p.nova, 4);
  assert.deepEqual(p.analysis, ['en:vegan']);
  assert.equal(
    normalise({ code: '1', product_name: 'X', nutriscore_grade: 'unknown' }).nutriscore,
    undefined,
  );
});
await test('compact index records expand with canonical image paths', () => {
  assert.equal(imageFolder('02425801'), '000/000/242/5801');
  assert.equal(imageFolder('7610200337310'), '761/020/033/7310');
  const p = expandCompact(
    { b: '7610200337310', n: 'Milk', c: ['en:milks'], i: 'front_de.3.400', g: 'a-2', v: 1 },
    5,
  );
  assert.equal(
    p.image,
    'https://images.openfoodfacts.org/images/products/761/020/033/7310/front_de.3.400.jpg',
  );
  assert.deepEqual(p.nutriscore, { grade: 'a', score: -2, source: 'Open Food Facts' });
  assert.equal(p.id, 'off:7610200337310');
  assert.equal(p.retrieved, 5);
});
await test('barcode shards return full export records, including padded spellings', async () => {
  const p = (await swissBarcode('7640115251176'))!;
  assert.equal(p.barcode, '7640115251176');
  assert(p.detailsRetrieved);
  assert(Object.keys(p.nutrition || {}).length > 3);
  assert.equal(await swissBarcode('9990000000005'), undefined);
});
await test('alternatives endpoints return better-scoring retailer products', async () => {
  const original = (await swissBarcode('7640115251176'))!;
  const direct = await swissBetter(original, 'coop');
  for (const a of direct) {
    assert(a.product.categories.includes(original.categories.at(-1)!));
    assert(a.product.stores?.some((s) => s.toLowerCase() === 'coop'));
    assert(a.score.value! >= healthScore(original).value! + 10);
  }
  const r = await demo(
    new Request(
      'https://same.test/api/demo-catalogue?better=7640115251176&country=CH&retailer=coop-ch',
    ),
  );
  assert.equal(r.status, 200);
  assert.equal((await r.json()).alternatives.length, direct.length);
  const bad = await demo(new Request('https://same.test/api/demo-catalogue?better=123'));
  assert.equal(bad.status, 400);
  const signed = await asUser('HealthTester', () =>
    catalogue(
      new Request('https://same.test/api/catalogue?better=7640115251176&retailer=migros-ch'),
    ),
  );
  assert.equal(signed.status, 200);
  assert(Array.isArray((await signed.json()).alternatives));
});
await test('receipt labels match saved catalogue products only when every word matches', async () => {
  const { swissMatch } = await import('../lib/swiss-catalogue');
  const [chips, abbreviation, short] = await swissMatch(
    ['Chili-Chips M-Budget', 'MCL VLM', 'Brot'],
    'migros',
  );
  assert.match(chips!.name, /chili/i);
  assert.match(chips!.brand!, /m-budget/i);
  assert(chips!.stores?.includes('Migros'));
  assert.equal(abbreviation, null);
  assert.equal(short, null);
  const r = await demo(
    new Request(
      'https://same.test/api/demo-catalogue?match=Chili-Chips+M-Budget&match=xyz+qqq&country=CH&retailer=migros-ch',
    ),
  );
  const d = await r.json();
  assert.equal(d.matches.length, 2);
  assert.equal(d.matches[1], null);
});
await test('a reviewer-linked receipt product is kept on the list item', async () => {
  const { receiptListItem, parseReceipt } = await import('../lib/receipt');
  const { validateRecord } = await import('../lib/record-validation');
  const item = parseReceipt('Migros\nChili-Chips M-Budget 1.95\nTotal CHF 1.95').items[0];
  const product = expandCompact({ b: '16137127', n: 'Chili-Chips', c: ['en:crisps'], g: 'd12' }, 1);
  const row = receiptListItem(
    { ...item, product },
    { fingerprint: 'f'.repeat(64), store: 'Migros', date: '', currency: 'CHF' },
    'list',
  );
  assert.equal(row.product?.barcode, '16137127');
  assert.doesNotThrow(() => validateRecord('item', row, 'h1'));
});
