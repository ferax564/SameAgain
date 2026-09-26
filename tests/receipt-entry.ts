import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt, receiptListItem, validDate } from '../lib/receipt';
import { suggestPaperCrop } from '../lib/receipt-image';
import { POST, GET } from '../app/api/data/route';
import { asUser, one, run } from './server-shim';
import { validateRecord } from '../lib/record-validation';
const fixture = `Coop
Example branch
Artikel Menge Preis Aktion Total
Beans 175G      1 4.50 4.05 4.05 0 A
Example Yogurt     2 3.80 7.60 0
Apples     0.750 22.80 11.20 11.20 0 A
Tofu nature     1 3.95 3.95 0
TOTAL CHF 26.80
TWINT 26.80
01.01.2026 12:00
VAT 0 2.60 26.80
Coupon 1.00
Card reference 1234567890123456`;
const meta = { fingerprint: 'a'.repeat(64), store: 'Coop', date: '2026-01-01', currency: 'CHF' };
await test('receipt columns preserve promotion totals, packs and multiple units', () => {
  const d = parseReceipt(fixture);
  assert.equal(d.items.length, 4);
  assert.equal(d.items[0].name, 'Beans 175G');
  assert.equal(d.items[0].quantity, 1);
  assert.equal(d.items[0].pack, '175G');
  assert.equal(d.items[0].lineTotal, 4.05);
  assert.equal(d.items[1].quantity, 2);
  assert.equal(d.items[1].lineTotal, 7.6);
  assert.equal(d.total, 26.8);
  assert.equal(d.date, '2026-01-01');
  assert(!d.warnings.some((w) => w.includes('do not match')));
});
await test('weighted quantities are explicit and an inferred unit is flagged', () => {
  const i = parseReceipt(fixture).items[2];
  assert.equal(i.quantity, 0.75);
  assert.equal(i.unit, 'kg');
  assert(i.warnings.some((w) => w.includes('Confirm the unit')));
  assert.equal(i.lineTotal, 11.2);
});
await test('US style quantity prefix and comma-decimal European rows work', () => {
  const us = parseReceipt('Market\n2 x Milk 1.50 3.00\nBread 1 2.00 2.00\nTOTAL USD 5.00');
  assert.equal(us.items[0].quantity, 2);
  assert.equal(us.items[0].name, 'Milk');
  const eu = parseReceipt('Migros\nPasta 500g 2 1,95 3,90\nTOTAL CHF 3,90');
  assert.equal(eu.items[0].quantity, 2);
  assert.equal(eu.items[0].pack, '500g');
  assert.equal(eu.items[0].lineTotal, 3.9);
});
await test('payment, tax, totals and footer numbers never become shopping products', () => {
  const d = parseReceipt(fixture);
  assert(!d.items.some((i) => /TWINT|reference|Coupon|VAT/.test(i.name)));
  assert.equal(parseReceipt('TOTAL CHF 6.00\nVisa 6.00\nReference 12345').items.length, 0);
});
await test('corrupted receipt quantities are not silently turned into bulk purchases', () => {
  const d = parseReceipt(
    'Artikel Menge Preis Total\nTofu nature      125220    2.20 0\nTOTAL CHF 2.20',
  );
  assert.equal(d.items[0].quantity, 1);
  assert.equal(d.items[0].selected, false);
  assert(d.items[0].warnings.some((w) => w.includes('unclear')));
  const merged = parseReceipt(
    'Artikel Menge Preis Total\nLentils      111.965    1.95 0\nTOTAL CHF 1.95',
  );
  assert.equal(merged.items[0].quantity, 1);
  assert.equal(merged.items[0].selected, false);
});
await test('uncertain price rows remain editable without invented amounts', () => {
  const d = parseReceipt(
    'Artikel Menge Preis Total\nTofu nature      ]    ] 95      } 95 0\nTOTAL CHF 3.95',
  );
  assert.equal(d.items.length, 1);
  assert.equal(d.items[0].lineTotal, undefined);
  assert(d.warnings.some((w) => w.includes('do not match')));
});
await test('refunds and discounts are excluded with a reconciliation warning', () => {
  const d = parseReceipt('Milk 1 3.00 3.00\nReturned Bread 1 -2.00 -2.00\nTOTAL EUR 1.00');
  assert.equal(d.items.length, 1);
  assert(d.warnings.some((w) => w.includes('refund')));
  assert(d.warnings.some((w) => w.includes('do not match')));
});
await test('receipt provenance never implies catalogue identity or a new purchase price', () => {
  const d = receiptListItem(parseReceipt(fixture).items[1], meta, 'list');
  assert.equal(d.product, null);
  assert.equal(d.price, null);
  assert.equal(d.actualPrice, null);
  assert.equal(d.done, false);
  assert.equal(d.receipt.lineTotal, 7.6);
  assert.equal(d.quantity, 2);
  assert.equal(d.substitution, 'ask');
  assert(!JSON.stringify(d).includes('Card reference'));
});
await test('review rejects invalid quantities, units, dates and prices before queuing', () => {
  const i = parseReceipt(fixture).items[0];
  assert.throws(() => receiptListItem({ ...i, quantity: 0 }, meta, 'list'));
  assert.throws(() => receiptListItem({ ...i, lineTotal: -1 }, meta, 'list'));
  assert.throws(() => receiptListItem(i, { ...meta, date: '2026-02-30' }, 'list'));
  assert.equal(validDate('2026-02-30'), '');
  assert.equal(validDate('2024-02-29'), '2024-02-29');
  assert.throws(() =>
    validateRecord(
      'item',
      {
        ...receiptListItem(i, meta, 'list'),
        receipt: { ...meta, line: '0', label: 'Milk', lineTotal: NaN },
      },
      'h',
    ),
  );
});
await test('paper crop falls back safely and isolates a tall receipt', () => {
  assert.deepEqual(suggestPaperCrop(new Uint8ClampedArray(100 * 100 * 4), 100, 100), {
    left: 0,
    top: 0,
    right: 100,
    bottom: 100,
  });
  const rgba = new Uint8ClampedArray(100 * 200 * 4);
  for (let y = 10; y < 190; y++)
    for (let x = 30; x < 65; x++) rgba.fill(230, (y * 100 + x) * 4, (y * 100 + x) * 4 + 4);
  const c = suggestPaperCrop(rgba, 100, 200);
  assert(c.left < 30 && c.right > 64);
  assert(c.top < 5 && c.bottom > 94);
});
const post = (user: string, b: unknown) =>
  asUser(user, () =>
    POST(
      new Request('https://same.test/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: 'https://same.test' },
        body: JSON.stringify(b),
      }),
    ),
  );
await test('reviewed receipt persists to a shared list, attributes the member and replays safely', async () => {
  const created = await post('ReceiptOwner', {
    action: 'createHousehold',
    name: 'Receipt family',
    country: 'CH',
    currency: 'CHF',
  });
  const { household: h } = await created.json();
  const r = await asUser('ReceiptOwner', () =>
    GET(new Request('https://same.test/api/data?household=' + h)),
  );
  const list = (await r.json()).records.find((r: { kind: string }) => r.kind === 'list');
  await run(
    'INSERT INTO memberships(household,user,role) VALUES(?,?,?)',
    h,
    'ReceiptMember',
    'member',
  );
  const item = receiptListItem(parseReceipt(fixture).items[1], meta, list.id);
  const request = {
    action: 'op',
    household: h,
    op: { id: 'receipt-operation', record: 'receipt-item', kind: 'item', version: 0, data: item },
  };
  const added = await post('ReceiptMember', request);
  assert.equal(added.status, 200);
  assert.equal((await added.json()).record.data.addedBy, 'ReceiptMember');
  assert.equal((await post('ReceiptMember', request)).status, 200);
  const stored = JSON.parse(
    (await one('SELECT data FROM records WHERE id=?', 'receipt-item')).data,
  );
  assert.equal(stored.quantity, 2);
  assert.equal(stored.receipt.currency, 'CHF');
  assert.equal(stored.receipt.lineTotal, 7.6);
  const visible = await asUser('ReceiptOwner', () =>
    GET(new Request('https://same.test/api/data?household=' + h)),
  );
  assert((await visible.json()).records.some((r: { id: string }) => r.id === 'receipt-item'));
  assert.equal(
    (await post('ReceiptOutsider', { ...request, op: { ...request.op, id: 'receipt-attack' } }))
      .status,
    403,
  );
});
await test('receipt interface exposes camera, photo and text fallbacks', async () => {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: Scanner } = await import('../app/receipt-scanner');
  const html = renderToStaticMarkup(
    React.createElement(Scanner, {
      lists: [],
      active: '',
      country: 'CH',
      currency: 'CHF',
      onAdd: () => 0,
    }),
  );
  assert.match(html, /Take a photo/);
  assert.match(html, /Choose photo/);
  assert.match(html, /Paste or type receipt text/);
  assert.match(html, /capture="environment"/);
  assert.match(html, /stay on this device/);
});

// Layouts modelled on current Swiss till receipts (synthetic content).
const sw_migros = `MIGROS
Genossenschaft Migros Zürich
MM Limmatplatz
Limmatstrasse 152
8005 Zürich
CHF
M-Classic Vollmilch 1l        1.60 1
Bio Bananen                   2.35 1
  0.785 kg x 2.99 CHF/kg
Rüebli 1kg                    1.00 1
Zweifel Chips Paprika 175g
  2 x 4.95                    9.90 1
Aproz Classic 6x1.5l          5.40 1
Aktion Aproz                 -1.35
M-Budget Toastbrot            1.40 1
Cumulus-Rabatt               -0.50
Total CHF                    19.80
TWINT                        19.80
MWST  Satz  Brutto   MWST  Netto
1     2.6%  17.80    0.45  17.35
Cumulus-Nummer 2099 1234 5678
25.09.2026 17:43  Kasse 12  Bon 4567`;
const sw_coop = `coop
Coop Supermarkt Zürich Bahnhofbrücke
Bahnhofquai 5, 8001 Zürich
Artikel                 Menge   Preis  Aktion   Total Z
Naturaplan Bio Vollmilch  1      1.95           1.95 1
Rüebli 1kg                1      2.20           2.20 1
Bananen Fairtrade       0.824    2.95           2.43 1
Karma Tofu nature         2      3.95   3.16    6.32 1
Prix Garantie Spaghetti   1      0.95           0.95 1
Coca-Cola Zero 6x0.5l     1      8.95   6.70    6.70 1
Tragtasche                1      0.05           0.05 2
Total CHF                                      20.60
TWINT                                          20.60
Superpunkte                                       20
MWST  Total   MWST
1  2.60%  20.55  0.52
2  8.10%   0.05  0.00
25.09.26 17:43  0123/004/045/1234`;
const sw_coopRound = `Coop
Artikel Menge Preis Aktion Total Z
Brot 1 3.23 3.23 1
Käse 0.212 21.50 4.56 1
Total CHF 7.80
Rundung 0.01
25.09.2026 10:00`;
const sw_denner = `DENNER AG
Denner Satellit Zürich
Artikel         Anzahl Preis    Betrag
Rivella rot 6x1.5l  1  9.95     9.95 A
Chips Nature        2  1.95     3.90 A
Mengenrabatt              -0.40
Total CHF                  13.45
Bar                        20.00
Rückgeld                    6.55
24.09.2026 18:01`;
const sw_lidl = `Lidl Schweiz
Milbona Joghurt Nature  0.65 A
Bananen
0,812 kg x 2,49 CHF/kg  2,02 A
Butter 250g            3.29 A
Summe                  5.96
25.09.2026 09:12`;
await test('Migros layout: one price per line, weight and count lines, discounts', () => {
  const d = parseReceipt(sw_migros, { currency: 'CHF' });
  assert.equal(d.store, 'Migros');
  assert.deepEqual(d.warnings, []);
  assert.equal(d.total, 19.8);
  const byName = Object.fromEntries(d.items.map((i) => [i.name, i]));
  assert.equal(byName['M-Classic Vollmilch 1l'].quantity, 1);
  assert(byName['M-Classic Vollmilch 1l'].selected);
  assert.equal(byName['Bio Bananen'].quantity, 0.785);
  assert.equal(byName['Bio Bananen'].unit, 'kg');
  assert.equal(byName['Bio Bananen'].unitPrice, 2.99);
  assert.equal(byName['Zweifel Chips Paprika 175g'].quantity, 2);
  assert.equal(byName['Aproz Classic 6x1.5l'].pack, '6x1.5l');
  assert.equal(byName['Aproz Classic 6x1.5l'].lineTotal, 4.05);
  assert.equal(byName['Aproz Classic 6x1.5l'].discount, 1.35);
  assert.equal(byName['M-Budget Toastbrot'].lineTotal, 0.9);
  assert(!d.items.some((i) => /Aktion|Cumulus|MWST|TWINT/.test(i.name)));
});
await test('Coop table layout with Aktion column and tax-code column', () => {
  const d = parseReceipt(sw_coop, { currency: 'CHF' });
  assert.equal(d.store, 'Coop');
  assert.deepEqual(d.warnings, []);
  assert.equal(d.items.length, 7);
  assert.equal(d.items[3].name, 'Karma Tofu nature');
  assert.equal(d.items[3].quantity, 2);
  assert.equal(d.items[3].lineTotal, 6.32);
  assert.equal(d.items[5].pack, '6x0.5l');
  assert.equal(d.date, '2026-09-25');
});
await test('5-Rappen rounding, Denner quantity discounts and Lidl weight rows reconcile', () => {
  assert.deepEqual(parseReceipt(sw_coopRound, { currency: 'CHF' }).warnings, []);
  const denner = parseReceipt(sw_denner, { currency: 'CHF' });
  assert.equal(denner.store, 'Denner');
  assert.deepEqual(denner.warnings, []);
  assert.equal(denner.items[1].lineTotal, 3.5);
  const lidl = parseReceipt(sw_lidl, { currency: 'CHF' });
  assert.equal(lidl.store, 'Lidl');
  assert.deepEqual(lidl.warnings, []);
  assert.equal(lidl.items[1].quantity, 0.812);
});
await test('a discount that fits no item is reported, never silently applied', () => {
  const d = parseReceipt('Migros\nBrot 1.20\nRabatt -2.00\nTotal CHF -0.80', {
    currency: 'CHF',
  });
  assert.equal(d.items[0].lineTotal, 1.2);
  assert(d.warnings.some((w) => w.includes('could not be matched')));
});
