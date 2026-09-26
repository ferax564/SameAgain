import test from 'node:test';
import assert from 'node:assert/strict';
import {
  barcode,
  barcodeAlternatives,
  expandUpcE,
  pack,
  totals,
  lineCost,
  priceBasis,
  isCountryCode,
  countryTag,
  findDuplicateItem,
  itemNameKey,
} from '../lib/domain';
import { parseQuickAdd, guessCategory } from '../lib/quick-add';
import { parseReceipt, detectCurrency, normaliseAmounts, purchaseDate } from '../lib/receipt';
import { receiptTextFingerprint, normaliseReceiptText } from '../lib/receipt-fingerprint';
import { groceryHints } from '../lib/barcode-reader';
import { cameraError } from '../lib/scan-session';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

// ---------- M18: receipt amounts ----------
await test('a price-shaped token is never taken as the quantity', () => {
  for (const line of ['Olive oil 12.00 12.00', 'Olive oil     12.00     12.00']) {
    const i = parseReceipt(`Shop\n${line}\nTOTAL EUR 12.00`).items[0];
    assert.equal(i.name, 'Olive oil');
    assert.equal(i.quantity, 1);
    assert.equal(i.lineTotal, 12);
    assert.equal(i.unitPrice, 12);
  }
  const col = parseReceipt('Shop\nOLIO EVO     10,00 A\nTOTALE EUR 10,00').items[0];
  assert.equal(col.name, 'OLIO EVO');
  // Without a quantity column, one price per line is one article (counts get their own line).
  assert.equal(col.quantity, 1);
  assert.equal(col.selected, true);
  assert.equal(col.lineTotal, 10);
});
await test('Italian and German VAT letters, codes and percentages after or before the price', () => {
  const d = parseReceipt(
    'SUPERMERCATO\nOLIO EVO 10,00 A\nPANE     2,50 B\nLATTE 22% 1,20\nUOVA 2,00 10%\nTOTALE EURO 15,70',
  );
  assert.deepEqual(
    d.items.map((i) => [i.name, i.lineTotal]),
    [
      ['OLIO EVO', 10],
      ['PANE', 2.5],
      ['LATTE', 1.2],
      ['UOVA', 2],
    ],
  );
  assert(d.items.every((i) => i.quantity === 1));
  assert.equal(d.total, 15.7);
  assert.equal(d.currency, 'EUR');
  assert(!d.warnings.some((w) => w.includes('do not match')));
  const de = parseReceipt('Laden\nMilch 1,29 1\nButter 1,99 2\nBrot 2,49 A *\nSUMME EUR 5,77');
  assert.deepEqual(
    de.items.map((i) => [i.name, i.lineTotal, i.quantity]),
    [
      ['Milch', 1.29, 1],
      ['Butter', 1.99, 1],
      ['Brot', 2.49, 1],
    ],
  );
  assert.equal(de.total, 5.77);
  // A fat percentage that is not a VAT rate stays in the name.
  assert.equal(parseReceipt('Laden\nMILCH 3,5% 1,29\nSUMME 1,29').items[0].name, 'MILCH 3,5%');
});
await test('thousands separators in prices and totals', () => {
  for (const [line, total] of [
    ['TV 1.234,56 A\nTOTAL EUR 1.234,56', 1234.56],
    ['TV 1,234.56\nTOTAL USD 1,234.56', 1234.56],
    ["Kaffeemaschine 1'234.50\nTOTAL CHF 1'234.50", 1234.5],
    ['TV 1 234,56\nTOTAL EUR 1 234,56', 1234.56],
  ] as const) {
    const d = parseReceipt('Shop\n' + line);
    assert.equal(d.total, total, line);
    assert.equal(d.items[0].lineTotal, total, line);
  }
  assert.equal(parseReceipt('TOTAL EUR 1.234,56').total, 1234.56);
  assert.equal(normaliseAmounts('Apples 0.750 22.80'), 'Apples 0.750 22.80');
  assert.equal(normaliseAmounts('Tej 1 299', true), 'Tej 1299');
  assert.equal(normaliseAmounts('Paprika 1.500 kg 2 250', true), 'Paprika 1.500 kg 2250');
});
await test('zero-decimal currencies (HUF, ISK) produce items and totals', () => {
  const hu = parseReceipt('ABC Bolt\nTej 1 299\nKenyér 459\nÖSSZESEN 1 758 HUF');
  assert.equal(hu.currency, 'HUF');
  assert.deepEqual(
    hu.items.map((i) => [i.name, i.lineTotal]),
    [
      ['Tej', 1299],
      ['Kenyér', 459],
    ],
  );
  assert.equal(hu.total, 1758);
  assert(!hu.warnings.some((w) => w.includes('do not match')));
  const is = parseReceipt('Bónus\nMjólk 259\nBrauð 1 000\nSamtals 1 259 kr');
  assert.equal(is.currency, 'ISK');
  assert.equal(is.total, 1259);
  assert.equal(is.items.length, 2);
  // "kr" alone is ambiguous: the list currency resolves it.
  const kr = parseReceipt('Store\nMjolk 259\nBraud 1 000\nTotal 1 259 kr', { currency: 'ISK' });
  assert.equal(kr.currency, 'ISK');
  assert.equal(kr.total, 1259);
  assert.equal(kr.items[1].lineTotal, 1000);
  // Whole-unit rows with count, unit price and total.
  const counted = parseReceipt('Bolt\nKenyér 2 450 900\nÖSSZESEN 900 Ft').items[0];
  assert.equal(counted.quantity, 2);
  assert.equal(counted.unitPrice, 450);
  assert.equal(counted.lineTotal, 900);
  assert.equal(parseReceipt('Bolt\nTej 2 x 299 598\nÖSSZESEN 598 HUF').items[0].quantity, 2);
});
await test('the list currency is used when the receipt does not print one', () => {
  const d = parseReceipt('Shop\nMilk 1 3.00 3.00\nTOTAL 3.00', { currency: 'CHF' });
  assert.equal(d.currency, 'CHF');
  assert(d.warnings.some((w) => w.includes('CHF from the list')));
  assert.equal(parseReceipt('Shop\nMilk 1 3.00 3.00\nTOTAL 3.00').currency, '');
});
await test('currency detection recognises EURO, EUR, € and local symbols', () => {
  assert.equal(detectCurrency('TOTALE EURO 3,00'), 'EUR');
  assert.equal(detectCurrency('TOTAL EUR 3,00'), 'EUR');
  assert.equal(detectCurrency('Total 3,00 €'), 'EUR');
  assert.equal(detectCurrency('Europa Markt 3,00'), '');
  assert.equal(detectCurrency('Összesen 900 Ft'), 'HUF');
  assert.equal(detectCurrency('Razem 9,99 zł'), 'PLN');
  assert.equal(detectCurrency('Celkem 99,00 Kč'), 'CZK');
  assert.equal(detectCurrency('Total 99,00 kr'), '');
  assert.equal(detectCurrency('Total 99,00 kr', 'SEK'), 'SEK');
  const d = parseReceipt('Shop\nMilk 3,00 €\nTOTALE EURO 3,00');
  assert.equal(d.items[0].name, 'Milk');
  assert.equal(d.total, 3);
});

// ---------- other receipt cases ----------
await test('quantity × unit price rows, inline and on the line after the name', () => {
  const inline = parseReceipt('Store\nGurke 2 x 0.95 1.90\nTOTAL EUR 1.90').items;
  assert.equal(inline.length, 1);
  assert.equal(inline[0].name, 'Gurke');
  assert.equal(inline[0].quantity, 2);
  assert.equal(inline[0].unitPrice, 0.95);
  assert.equal(inline[0].lineTotal, 1.9);
  assert.equal(inline[0].selected, true);
  const below = parseReceipt('Store\nGurke\n2 x 0.95\nTOTAL EUR 1.90').items;
  assert.equal(below.length, 1);
  assert.equal(below[0].name, 'Gurke');
  assert.equal(below[0].quantity, 2);
  assert.equal(below[0].unitPrice, 0.95);
  assert.equal(below[0].lineTotal, 1.9);
  const st = parseReceipt('Store\nGurke\n2 St x 0.95 1.90\nTOTAL EUR 1.90').items[0];
  assert.deepEqual([st.name, st.quantity, st.unitPrice, st.lineTotal], ['Gurke', 2, 0.95, 1.9]);
  const mismatch = parseReceipt('Store\nGurke 2 x 0.95 2.90\nTOTAL EUR 2.90').items[0];
  assert(mismatch.warnings.some((w) => w.includes('does not match')));
  const kg = parseReceipt('Store\nBananen\n0.750 kg x 2.99 2.24\nTOTAL CHF 2.24').items[0];
  assert.deepEqual([kg.name, kg.quantity, kg.unit, kg.lineTotal], ['Bananen', 0.75, 'kg', 2.24]);
});
await test('weight rows join only an immediately preceding item-like line', () => {
  // Address/header lines never become product names.
  const addr = parseReceipt('Store\nHauptstrasse 12\n8000 Zurich\n0.750 kg 2.24\nTOTAL CHF 2.24');
  assert.equal(addr.items.length, 0);
  // Leftover text separated by another row is not joined.
  const gap = parseReceipt(
    'Store\nFree parking for customers\nMilk 1 3.00 3.00\n0.750 kg 2.24\nTOTAL CHF 5.24',
  );
  assert.deepEqual(
    gap.items.map((i) => i.name),
    ['Milk'],
  );
  const ok = parseReceipt('Store\nMilk 1 3.00 3.00\nBananen\n0.750 kg 2.24\nTOTAL CHF 5.24');
  assert.deepEqual(
    ok.items.map((i) => [i.name, i.quantity, i.unit]),
    [
      ['Milk', 1, 'piece'],
      ['Bananen', 0.75, 'kg'],
    ],
  );
  // A name that merely starts with a pack size is its own item.
  const own = parseReceipt('Store\nBananen\n1,5 l Wasser 0,89\nTOTAL EUR 0,89').items;
  assert.equal(own.length, 1);
  assert.equal(own[0].name, '1,5 l Wasser');
});
await test('purchase date skips validity dates and prefers the dated time stamp', () => {
  assert.equal(
    parseReceipt('Coupon gültig bis 31.12.2026\nStore\n05.03.2026\nMilk 1 3.00 3.00').date,
    '2026-03-05',
  );
  assert.equal(
    parseReceipt('Store\nValid until 31.12.2026\nMilk 1 3.00 3.00\n04.03.2026 10:15').date,
    '2026-03-04',
  );
  assert.equal(purchaseDate('Promo 01.02.2026\nKasse 3 12.03.2026 18:22'), '2026-03-12');
  assert.equal(purchaseDate('Scadenza 30/06/2027\n12/03/2026'), '2026-03-12');
  assert.equal(purchaseDate('03/12/2026 10:00', 'USD'), '2026-03-12');
  assert.equal(purchaseDate('2026-01-02'), '2026-01-02');
  assert.equal(purchaseDate('no date'), '');
});
await test('pasted receipt text gets a deterministic fingerprint', async () => {
  const a = await receiptTextFingerprint('Coop\r\nMilk   1 3.00 3.00\n\nTOTAL CHF 3.00\n');
  const b = await receiptTextFingerprint('  coop\nMilk 1 3.00 3.00\nTOTAL CHF 3.00');
  const c = await receiptTextFingerprint('Coop\nMilk 2 3.00 6.00\nTOTAL CHF 6.00');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(await receiptTextFingerprint('x', null), await receiptTextFingerprint('X'));
  assert.equal(normaliseReceiptText(' A  b \r\n\r\nC'), 'a b\nc');
});

// ---------- M19: quick add ----------
await test('quick-add parses quantity and unit without mangling names', () => {
  const cases: [string, string, number, string][] = [
    ['2 kg apples', 'apples', 2, 'kg'],
    ['apples 2kg', 'apples', 2, 'kg'],
    ['500g pasta', 'pasta', 500, 'g'],
    ['bread x3', 'bread', 3, 'piece'],
    ['3x bread', 'bread', 3, 'piece'],
    ['3 x bread', 'bread', 3, 'piece'],
    ['eggs 12', 'eggs', 12, 'piece'],
    ['12 eggs', 'eggs', 12, 'piece'],
    ['1.5 l milk', 'milk', 1.5, 'l'],
    ['1,5 l milk', 'milk', 1.5, 'l'],
    ['milk', 'milk', 1, 'piece'],
    ['7up', '7up', 1, 'piece'],
    ['2 %  milk', '2 % milk', 1, 'piece'],
    ['2% milk', '2% milk', 1, 'piece'],
    ['3 tins tomatoes', 'tomatoes', 3, 'pack'],
    ['2 packs of rice', 'rice', 2, 'pack'],
    ['75 cl wine', 'wine', 750, 'ml'],
    ['  Milk  ', 'Milk', 1, 'piece'],
    ['1.5 bread', '1.5 bread', 1, 'piece'],
    ['0 kg apples', '0 kg apples', 1, 'piece'],
    ['2 kg', '2 kg', 1, 'piece'],
  ];
  for (const [text, name, quantity, unit] of cases)
    assert.deepEqual(parseQuickAdd(text), { name, quantity, unit }, text);
});
await test('category guess uses a multilingual keyword map onto household categories', () => {
  const cases: [string, string][] = [
    ['apples', 'Fruit & vegetables'],
    ['Pomodori', 'Fruit & vegetables'],
    ['Gurke', 'Fruit & vegetables'],
    ['milk', 'Dairy & alternatives'],
    ['Vollmilch', 'Dairy & alternatives'],
    ['œufs', 'Dairy & alternatives'],
    ['oat drink', 'Dairy & alternatives'],
    ['bread', 'Bakery'],
    ['Brötchen', 'Bakery'],
    ['pasta', 'Pantry'],
    ['apple juice', 'Pantry'],
    ['peanut butter', 'Pantry'],
    ['arroz', 'Pantry'],
    ['frozen peas', 'Frozen'],
    ['surgelati', 'Frozen'],
    ['Toilettenpapier', 'Household'],
    ['detersivo', 'Household'],
    ['toilet paper', 'Household'],
    ['7up', 'Other'],
    ['xyz', 'Other'],
    ['', 'Other'],
  ];
  for (const [name, category] of cases) assert.equal(guessCategory(name), category, name);
  assert.equal(guessCategory('milk', ['Bakery', 'Other']), 'Other');
});
await test('duplicate detection ignores case, accents and whitespace, and matches barcodes', () => {
  const records = [
    { kind: 'item', deleted: 0, data: { name: 'Milk', list: 'a', done: false } },
    { kind: 'item', deleted: 0, data: { name: 'Crème  fraîche ', list: 'a', done: false } },
    { kind: 'item', deleted: 0, data: { name: 'Bread', list: 'a', done: true } },
    { kind: 'item', deleted: 0, data: { name: 'Eggs', list: 'b', done: false } },
    {
      kind: 'item',
      deleted: 0,
      data: { name: 'Cola', list: 'a', product: { id: 'off:1', barcode: '036000291452' } },
    },
    { kind: 'favourite', deleted: 0, data: { name: 'Tea' } },
  ];
  assert.equal(findDuplicateItem(records, 'milk', null, 'a'), records[0]);
  assert.equal(findDuplicateItem(records, ' MILK ', null, 'a'), records[0]);
  assert.equal(findDuplicateItem(records, 'creme fraiche', null, 'a'), records[1]);
  assert.equal(findDuplicateItem(records, 'bread', null, 'a'), undefined);
  assert.equal(findDuplicateItem(records, 'eggs', null, 'a'), undefined);
  assert.equal(findDuplicateItem(records, 'tea', null, 'a'), undefined);
  assert.equal(findDuplicateItem(records, 'Coke', { barcode: '0036000291452' }, 'a'), records[4]);
  assert.equal(findDuplicateItem(records, 'Coke', { id: 'off:1' }, 'a'), records[4]);
  // Bare item data works too.
  const data = [{ name: 'Äpfel', done: false }];
  assert.equal(findDuplicateItem(data, 'apfel'), data[0]);
  assert.equal(itemNameKey('  Äpfel  Bio '), 'apfel bio');
});

// ---------- barcodes ----------
await test('local/in-store flag tests the normalised EAN-13', () => {
  assert.equal(barcode('025000044786').local, false);
  assert.equal(barcode('025000044786').code, '0025000044786');
  assert.equal(barcode('201234567899').local, true); // UPC number system 2 → 02…
  assert.equal(barcode('0412345678903').local, true);
  assert.equal(barcode('2123456789010').local, true);
  assert.equal(barcode('21234567890122').valid, true);
  assert.equal(barcode('21234567890122').local, false);
  assert.equal(barcode('4006381333931').local, false);
  assert.equal(barcode('96385074').local, false);
});
await test('UPC-E codes expand to UPC-A; ambiguous codes expose an alternative', () => {
  assert.equal(expandUpcE('04252614'), '042100005264');
  assert.equal(expandUpcE('12345601'), '123000004561');
  assert.equal(expandUpcE('92345601'), '');
  const e = barcode('04252614');
  assert.equal(e.valid, true);
  assert.equal(e.format, 'UPC-E');
  assert.equal(e.code, '0042100005264');
  assert.equal(barcode('042100005264').code, e.code);
  assert.deepEqual(barcodeAlternatives('04252614'), ['0042100005264']);
  const amb = barcode('12345601');
  assert.equal(amb.format, 'EAN-8');
  assert.equal(amb.code, '12345601');
  assert.deepEqual(barcodeAlternatives('12345601'), ['12345601', '0123000004561']);
  assert.deepEqual(barcodeAlternatives('96385074'), ['96385074']);
  assert.deepEqual(barcodeAlternatives('04252615'), []);
  assert.equal(barcode('04252615').valid, false);
  const hints = groceryHints().get(DecodeHintType.POSSIBLE_FORMATS) as BarcodeFormat[];
  assert(hints.includes(BarcodeFormat.UPC_E));
});

// ---------- pack sizes ----------
await test('pack sizes: thousands, decimals, centilitres and multipacks', () => {
  const cases: [string, number, 'g' | 'ml', number][] = [
    ['1.000 g', 1000, 'g', 1],
    ['1,000 g', 1000, 'g', 1],
    ['1,5 kg', 1500, 'g', 1],
    ['1.500 kg', 1500, 'g', 1],
    ['0,750 kg', 750, 'g', 1],
    ['75 cl', 750, 'ml', 1],
    ['33cl', 330, 'ml', 1],
    ['1 L', 1000, 'ml', 1],
    ['0.5l', 500, 'ml', 1],
    ['500 ml', 500, 'ml', 1],
    ['6 x 330 ml', 1980, 'ml', 6],
    ['6x330ml', 1980, 'ml', 6],
    ['6 × 330 ml', 1980, 'ml', 6],
    ['2 x 125 g', 250, 'g', 2],
    ['330 ml x 6', 1980, 'ml', 6],
    ['1.000,5 g', 1000.5, 'g', 1],
  ];
  for (const [text, amount, basis, count] of cases) {
    const p = pack(text);
    assert(p, text);
    assert.equal(p.amount, amount, text);
    assert.equal(p.basis, basis, text);
    assert.equal(p.count, count, text);
  }
  assert.equal(pack('6 x 330 ml')?.each, 330);
  for (const bad of ['', 'one jar', '0 g', '12', 'x ml', undefined, null])
    assert.equal(pack(bad), null, String(bad));
});

// ---------- totals ----------
await test('totals: weight prices are per kg / per l, counted prices per item', () => {
  assert.equal(totals([{ quantity: 500, unit: 'g', price: 2.5 }]).estimated, 1.25);
  assert.equal(totals([{ quantity: 2, unit: 'kg', price: 2.5 }]).estimated, 5);
  assert.equal(totals([{ quantity: 750, unit: 'ml', price: 2 }]).estimated, 1.5);
  assert.equal(totals([{ quantity: 1.5, unit: 'l', price: 2 }]).estimated, 3);
  assert.equal(totals([{ quantity: 3, unit: 'pack', price: 2 }]).estimated, 6);
  assert.equal(totals([{ quantity: 250, unit: 'g', done: true, actualPrice: 20 }]).actual, 5);
  assert.equal(lineCost(500, 'g', null), NaN);
  assert.equal(priceBasis('g'), 'kg');
  assert.equal(priceBasis('ml'), 'l');
  assert.equal(priceBasis('pack'), 'item');
});

// ---------- country guards ----------
await test('country codes reject prototype keys', () => {
  assert.equal(isCountryCode('IT'), true);
  assert.equal(isCountryCode('constructor'), false);
  assert.equal(isCountryCode('__proto__'), false);
  assert.equal(isCountryCode(undefined), false);
  assert.equal(countryTag('IT'), 'en:italy');
  assert.equal(countryTag('GB'), 'en:united-kingdom');
  assert.equal(countryTag('constructor'), 'en:constructor');
  assert.equal(countryTag('toString'), 'en:tostring');
  assert.equal(countryTag(undefined as unknown as string), 'en:');
});
await test('camera errors accept unknown values', () => {
  assert.match(cameraError({ name: 'NotAllowedError' }), /permission/);
  assert.match(cameraError(null), /Could not start/);
});
await test('quick-add keeps multipacks, thousands and named numbers intact', async () => {
  const { parseQuickAdd, guessCategory } = await import('../lib/quick-add');
  assert.deepEqual(parseQuickAdd('2 x 1.5 l water'), {
    name: '1.5 l water',
    quantity: 2,
    unit: 'pack',
  });
  assert.deepEqual(parseQuickAdd('1.000 g Mehl'), { name: 'Mehl', quantity: 1000, unit: 'g' });
  assert.deepEqual(parseQuickAdd('1,5 kg Äpfel'), { name: 'Äpfel', quantity: 1.5, unit: 'kg' });
  for (const name of ['Omega 3', 'Vitamin B 12', '7 up'])
    assert.deepEqual(parseQuickAdd(name), { name, quantity: 1, unit: 'piece' });
  assert.equal(parseQuickAdd('eggs 12').quantity, 12);
  assert.equal(guessCategory('Butternut squash'), 'Fruit & vegetables');
  assert.equal(guessCategory('Pearl barley'), 'Pantry');
  assert.equal(guessCategory('Eiscreme'), 'Frozen');
  assert.equal(guessCategory('Vollmilch'), 'Dairy & alternatives');
});
