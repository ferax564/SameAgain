import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from 'cloudflare:workers';
import { GET, POST } from '../app/api/data/route';
import { GET as catalogue } from '../app/api/catalogue/route';
import { POST as uploadPhoto } from '../app/api/photo/route';
import { GET as foods } from '../app/api/foods/route';
import { runCleanup, syncUser, RETENTION } from '../lib/server';
import { savedCatalogueCandidates } from '../lib/catalogue-cache-search';
import { off } from '../lib/catalogue';
import { cleanJpeg, cleanPng } from '../lib/photo-files';
import { signIdentityAssertion, verifyIdentityAssertion } from '../lib/identity-assertion';
import { asUser, one, run } from './server-shim';

type Json = Record<string, unknown> & {
  status: number;
  // Responses are inspected loosely in tests.
  [key: string]: any;
};
const origin = 'https://same.test';
const post = (user: string, body: unknown, headers: Record<string, string> = {}) =>
  asUser(user, () =>
    POST(
      new Request(origin + '/api/data', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin, ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    ),
  );
const call = async (user: string, body: unknown): Promise<Json> => {
  const r = await post(user, body);
  return { status: r.status, ...(await r.json()) };
};
const read = async (user: string, query: string, headers: Record<string, string> = {}) =>
  asUser(user, () => GET(new Request(origin + '/api/data?' + query, { headers })));
const uid = () => crypto.randomUUID();
const apply = (user: string, o: unknown) => call(user, { action: 'op', household: h, op: o });
const op = (
  kind: string,
  data: Record<string, unknown>,
  old?: { id: string; version: number },
) => ({
  id: uid(),
  record: old?.id || uid(),
  kind,
  version: old?.version || 0,
  data,
});
// A realistic, bulky catalogue product (about 1.6 KB of JSON).
const product = (n: number) => ({
  id: 'off:76100000' + String(n).padStart(5, '0'),
  name: 'Organic oat drink ' + n,
  brand: 'Example brand',
  pack: '1 l',
  barcode: '7610000000000',
  image: 'https://images.openfoodfacts.org/images/products/761/000/000/0000/front_en.3.400.jpg',
  ingredients:
    'Water, oats (10%), sunflower oil, calcium carbonate, sea salt, vitamins (D2, B12). '.repeat(8),
  categories: ['en:beverages', 'en:plant-based-foods', 'en:plant-milks', 'en:oat-milks'],
  countries: ['en:switzerland', 'en:germany', 'en:france'],
  labels: ['en:organic', 'en:eu-organic', 'en:vegan'],
  nutrition: { 'energy-kcal': 46, fat: 1.5, carbohydrates: 6.7, sugars: 3.3, proteins: 1 },
  basis: '100ml',
  source: 'Open Food Facts',
  sourceUrl: 'https://world.openfoodfacts.org/product/7610000000000',
  retrieved: 1,
});

let h = '',
  list = '';
await test('setup household', async () => {
  const created = await call('Owner', { action: 'createHousehold', name: 'Fixes family' });
  assert.equal(created.status, 200);
  h = created.household;
  const d = await (await read('Owner', 'household=' + h)).json();
  list = d.records[0].id;
  assert.equal(d.full, true);
  assert.equal(typeof d.cursor, 'number');
});

await test('H1: a 30-item trip sent as references is accepted and rebuilt by the server', async () => {
  const items = [];
  for (let i = 0; i < 30; i++) {
    const saved = await apply(
      'Owner',
      op('item', {
        name: 'Oat drink ' + i,
        list,
        quantity: 1,
        unit: 'pack',
        product: product(i),
        done: true,
      }),
    );
    assert.equal(saved.status, 200);
    items.push(saved.record);
  }
  const trip = await apply(
    'Owner',
    op('trip', {
      name: 'Big shop',
      list,
      date: Date.now(),
      currency: 'EUR',
      items: items.map((i) => ({ originalItem: i.id, originalVersion: i.version })),
    }),
  );
  assert.equal(trip.status, 200);
  assert.equal(trip.record.data.items.length, 30);
  assert.equal(trip.record.data.items[0].product.name, 'Organic oat drink 0');
  assert(JSON.stringify(trip.record.data).length > 40000);
  assert.equal(trip.affected.length, 30);
  assert(trip.affected.every((r: Json) => r.deleted === 1 && r.kind === 'item'));
  // Deleting the finished trip later resends the server-built items; still accepted.
  const removed = await apply('Owner', {
    ...op('trip', trip.record.data, trip.record),
    deleted: true,
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.record.data.items.length, 30);
});

await test('H1: legacy full-copy trip items from old queued operations are still accepted', async () => {
  const saved = await apply(
    'Owner',
    op('item', { name: 'Legacy bread', list, quantity: 1, unit: 'pack', done: true }),
  );
  const trip = await call('Owner', {
    action: 'op',
    household: h,
    op: op('trip', {
      name: 'Legacy trip',
      list,
      items: [{ ...saved.record.data, originalItem: saved.record.id, originalVersion: 1 }],
    }),
  });
  assert.equal(trip.status, 200);
  assert.equal(trip.record.data.items[0].name, 'Legacy bread');
});

await test('H1: a 50-item template with product snapshots fits', async () => {
  const items = Array.from({ length: 50 }, (_, i) => ({
    name: 'Template item ' + i,
    quantity: 1,
    unit: 'pack',
    product: product(i),
  }));
  const r = await call('Owner', {
    action: 'op',
    household: h,
    op: op('template', { name: 'Weekly', items }),
  });
  assert.equal(r.status, 200);
});

await test('H2: malformed input is a final 400, never 503', async () => {
  assert.equal((await post('Owner', '{not json')).status, 400);
  assert.equal((await post('Owner', '[1,2]')).status, 400);
  assert.equal((await call('Owner', { action: 'settings', household: h, name: 'X' })).status, 400);
  assert.equal(
    (await call('Owner', { action: 'settings', household: h, name: 'X', settings: 'text' })).status,
    400,
  );
  assert.equal((await call('Owner', { action: 'op', household: h, op: { id: 'x' } })).status, 400);
});

await test('M8: prototype keys are not countries or retailers', async () => {
  assert.equal(
    (await call('Owner', { action: 'createHousehold', name: 'Proto', country: 'constructor' }))
      .status,
    400,
  );
  assert.equal(
    (
      await call('Owner', {
        action: 'settings',
        household: h,
        name: 'Fixes family',
        settings: { country: 'constructor' },
      })
    ).status,
    400,
  );
  const r = await asUser('Owner', () =>
    catalogue(new Request(origin + '/api/catalogue?q=milk&country=constructor')),
  );
  assert.equal(r.status, 400);
  const s = await asUser('Owner', () =>
    catalogue(new Request(origin + '/api/catalogue?q=milk&country=CH&retailer=__proto__')),
  );
  assert.equal(s.status, 400);
});

await test('settings validate language and reject whitespace-only names', async () => {
  const base = { action: 'settings', household: h };
  assert.equal(
    (await call('Owner', { ...base, name: '   ', settings: { language: 'en' } })).status,
    400,
  );
  assert.equal(
    (await call('Owner', { ...base, name: 'Fixes', settings: { language: 'xx' } })).status,
    400,
  );
  assert.equal(
    (await call('Owner', { ...base, name: '  Fixes family  ', settings: { language: 'it' } }))
      .status,
    200,
  );
  assert.equal(
    (await call('Owner', { action: 'createHousehold', name: 'Lang', language: 'klingon' })).status,
    400,
  );
});

await test('H5: signed identity assertion', async () => {
  const secret = 'test-secret';
  const now = Date.now();
  const ts = Math.floor(now / 1000);
  const sig = await signIdentityAssertion(secret, 'u1', 'u1@example.test', ts);
  const headers = (extra: Record<string, string>) =>
    new Headers({
      'oai-authenticated-user-id': 'u1',
      'oai-authenticated-user-email': 'u1@example.test',
      ...extra,
    });
  assert(await verifyIdentityAssertion(headers({}), undefined, now));
  assert(
    await verifyIdentityAssertion(
      headers({ 'oai-authenticated-assertion': sig, 'oai-authenticated-assertion-ts': String(ts) }),
      secret,
      now,
    ),
  );
  assert(!(await verifyIdentityAssertion(headers({}), secret, now)));
  assert(
    !(await verifyIdentityAssertion(
      headers({
        'oai-authenticated-assertion': sig,
        'oai-authenticated-assertion-ts': String(ts - 301),
      }),
      secret,
      now,
    )),
  );
  const forged = new Headers({
    'oai-authenticated-user-id': 'u2',
    'oai-authenticated-user-email': 'u1@example.test',
    'oai-authenticated-assertion': sig,
    'oai-authenticated-assertion-ts': String(ts),
  });
  assert(!(await verifyIdentityAssertion(forged, secret, now)));
  // With the secret configured, requests without an assertion are refused.
  const bindings = env as unknown as Record<string, unknown>;
  bindings.IDENTITY_ASSERTION_SECRET = secret;
  try {
    assert.equal((await read('Owner', 'household=' + h)).status, 401);
  } finally {
    delete bindings.IDENTITY_ASSERTION_SECRET;
  }
  assert.equal((await read('Owner', 'household=' + h)).status, 200);
});

await test('M1: retrying an applied update returns its receipt instead of a conflict', async () => {
  const created = await apply(
    'Owner',
    op('item', { name: 'Eggs', list, quantity: 6, unit: 'piece' }),
  );
  const update = {
    action: 'op',
    household: h,
    op: op('item', { ...created.record.data, notes: 'free range' }, created.record),
  };
  const first = await call('Owner', update);
  assert.equal(first.status, 200);
  const retry = await call('Owner', update);
  assert.equal(retry.status, 200);
  assert.equal(retry.record.version, first.record.version);
});

await test('op responses list side-effect records (list currency change)', async () => {
  const l = await apply('Owner', op('list', { name: 'Currency list', currency: 'EUR' }));
  const item = await apply(
    'Owner',
    op('item', { name: 'Butter', list: l.record.id, quantity: 1, unit: 'pack' }),
  );
  // Clear the pinned currency to mimic an item created before currencies were stored.
  await run(
    "UPDATE records SET data=json_remove(data,'$.priceCurrency') WHERE id=?",
    item.record.id,
  );
  const changed = await apply('Owner', op('list', { ...l.record.data, currency: 'CHF' }, l.record));
  assert.equal(changed.status, 200);
  assert.equal(changed.affected.length, 1);
  assert.equal(changed.affected[0].id, item.record.id);
  assert.equal(changed.affected[0].data.priceCurrency, 'EUR');
  assert.equal(changed.affected[0].version, 2);
});

await test('H3: delta sync returns only changes and tombstones; ETag gives 304', async () => {
  const first = await read('Owner', 'household=' + h + '&since=0');
  const full = await first.json();
  const cursor = full.cursor;
  const etag = first.headers.get('etag')!;
  assert.match(etag, /^W\//);
  assert.equal(
    (await read('Owner', 'household=' + h + '&since=0', { 'if-none-match': etag })).status,
    304,
  );
  const empty = await (await read('Owner', 'household=' + h + '&since=' + cursor)).json();
  assert.equal(empty.full, false);
  assert.equal(empty.records.length, 0);
  const added = await apply(
    'Owner',
    op('item', { name: 'Delta', list, quantity: 1, unit: 'pack' }),
  );
  assert.equal(
    (await read('Owner', 'household=' + h + '&since=0', { 'if-none-match': etag })).status,
    200,
  );
  const delta = await (await read('Owner', 'household=' + h + '&since=' + cursor)).json();
  assert.deepEqual(
    delta.records.map((r: Json) => r.id),
    [added.record.id],
  );
  assert(delta.cursor > cursor);
  await call('Owner', {
    action: 'op',
    household: h,
    op: { ...op('item', added.record.data, added.record), deleted: true },
  });
  const tomb = await (await read('Owner', 'household=' + h + '&since=' + delta.cursor)).json();
  assert.equal(tomb.records[0].deleted, 1);
  // Clients that do not send `since` still receive every live record.
  const legacy = await (await read('Owner', 'household=' + h)).json();
  assert(legacy.records.every((r: Json) => r.deleted === 0));
  assert.equal((await read('Owner', 'household=' + h + '&since=abc')).status, 400);
});

await test('M14: clean-up purges old rows and forces a full resync past the horizon', async () => {
  const old = Date.now() - RETENTION - 1000;
  await run("INSERT INTO limits(key,count,expires) VALUES('stale:x:1',1,1)");
  await run("INSERT INTO cache(key,data,expires) VALUES('stale-cache','{}',1)");
  await run(
    "INSERT INTO operations(id,user,household,result,created) VALUES('old-op','Owner',?,'{}',?)",
    h,
    old,
  );
  const gone = await apply('Owner', op('item', { name: 'Old', list, quantity: 1, unit: 'pack' }));
  await call('Owner', {
    action: 'op',
    household: h,
    op: { ...op('item', gone.record.data, gone.record), deleted: true },
  });
  await run('UPDATE records SET updated=? WHERE id=?', old, gone.record.id);
  const cursorBefore = (await (await read('Owner', 'household=' + h + '&since=0')).json()).cursor;
  await runCleanup();
  assert.equal(await one("SELECT key FROM limits WHERE key='stale:x:1'"), undefined);
  assert.equal(await one("SELECT key FROM cache WHERE key='stale-cache'"), undefined);
  assert.equal(await one("SELECT id FROM operations WHERE id='old-op'"), undefined);
  assert.equal(await one('SELECT id FROM records WHERE id=?', gone.record.id), undefined);
  const house = await one('SELECT purged_revision FROM households WHERE id=?', h);
  assert(house.purged_revision > 0);
  const resync = await (await read('Owner', 'household=' + h + '&since=0')).json();
  assert.equal(resync.full, true);
  assert.equal(resync.cursor, cursorBefore);
});

let admin = '';
await test('M10: invitations stop working when their creator loses authority', async () => {
  const inv = await call('Owner', { action: 'invite', household: h });
  assert.equal((await call('Admin', { action: 'join', token: inv.token })).status, 200);
  admin = 'Admin';
  assert.equal(
    (await call('Owner', { action: 'role', household: h, user: admin, role: 'admin' })).status,
    200,
  );
  const byAdmin = await call(admin, { action: 'invite', household: h });
  const byAdmin2 = await call(admin, { action: 'invite', household: h });
  assert.equal(byAdmin.status, 200);
  // Demotion revokes outstanding invitations.
  assert.equal(
    (await call('Owner', { action: 'role', household: h, user: admin, role: 'member' })).status,
    200,
  );
  assert.equal((await call('Guest', { action: 'join', token: byAdmin.token })).status, 410);
  // join also checks the creator directly.
  await run('UPDATE invitations SET revoked=0 WHERE id=?', byAdmin2.id);
  assert.equal((await call('Guest', { action: 'join', token: byAdmin2.token })).status, 410);
  // Removal revokes too.
  await call('Owner', { action: 'role', household: h, user: admin, role: 'admin' });
  const third = await call(admin, { action: 'invite', household: h });
  assert.equal((await call('Owner', { action: 'remove', household: h, user: admin })).status, 200);
  assert.equal((await one('SELECT revoked FROM invitations WHERE id=?', third.id)).revoked, 1);
  assert.equal((await call(admin, { action: 'join', token: third.token })).status, 410);
});

await test('existing members do not consume an invitation', async () => {
  const inv = await call('Owner', { action: 'invite', household: h });
  const again = await call('Owner', { action: 'join', token: inv.token });
  assert.equal(again.status, 200);
  assert.equal(again.alreadyMember, true);
  assert.equal((await call('Newcomer', { action: 'join', token: inv.token })).status, 200);
});

await test('M16: owner row cannot be changed through role/remove', async () => {
  assert.equal(
    (await call('Owner', { action: 'role', household: h, user: 'Owner', role: 'member' })).status,
    400,
  );
  assert.equal(
    (await call('Newcomer', { action: 'remove', household: h, user: 'Owner' })).status,
    400,
  );
});

await test('record ids from another household look like any id in use', async () => {
  const other = await call('Outsider', { action: 'createHousehold', name: 'Elsewhere' });
  const theirs = (await (await read('Outsider', 'household=' + other.household)).json()).records[0];
  const probe = await call('Owner', {
    action: 'op',
    household: h,
    op: { ...op('list', { name: 'Probe' }), record: theirs.id },
  });
  assert.equal(probe.status, 409);
  assert.equal(probe.conflict, undefined);
  assert(!JSON.stringify(probe).includes(other.household));
});

await test('attribution fields cannot be forged', async () => {
  const fav = await apply(
    'Owner',
    op('favourite', {
      name: 'Fav',
      quantity: 1,
      unit: 'pack',
      addedBy: 'Newcomer',
      purchasedBy: 'Newcomer',
    }),
  );
  assert.equal(fav.record.data.addedBy, 'Owner');
  assert.equal(fav.record.data.purchasedBy, null);
  const obs = await apply(
    'Owner',
    op('observation', { name: 'Seen', store: 'Coop', date: '2026-09-01', user: 'Newcomer' }),
  );
  assert.equal(obs.record.data.user, 'Owner');
  assert.equal(
    (await apply('Owner', op('list', { name: 'Forged', addedBy: 'Mallory' }))).status,
    400,
  );
  const tpl = await apply(
    'Owner',
    op('template', {
      name: 'T',
      items: [{ name: 'A', quantity: 1, unit: 'pack', addedBy: 'Mallory', purchasedBy: 'Owner' }],
    }),
  );
  assert.equal(tpl.record.data.items[0].addedBy, undefined);
  assert.equal(tpl.record.data.items[0].purchasedBy, 'Owner');
});

await test('undeclared record fields are capped', async () => {
  const r = await apply('Owner', op('list', { name: 'Padded', junk: 'x'.repeat(5000) }));
  assert.equal(r.status, 400);
});

await test('writes need Origin or Sec-Fetch-Site and a JSON content type', async () => {
  const body = JSON.stringify({ action: 'profile', name: 'Owner' });
  const send = (headers: Record<string, string>) =>
    asUser('Owner', () =>
      POST(new Request(origin + '/api/data', { method: 'POST', headers, body })),
    );
  assert.equal((await send({ 'content-type': 'application/json' })).status, 403);
  assert.equal(
    (await send({ 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' })).status,
    200,
  );
  assert.equal((await send({ 'content-type': 'text/plain', origin })).status, 415);
  assert.equal(
    (await send({ 'content-type': 'application/json', origin: 'https://evil.test' })).status,
    403,
  );
});

await test('M17: provider names refresh unless the person chose one', async () => {
  await syncUser('Renamed', 'renamed@example.test', 'renamed@example.test', true);
  await syncUser('Renamed', 'Rena Med', 'renamed@example.test', true);
  assert.equal((await one('SELECT name FROM users WHERE id=?', 'Renamed')).name, 'Rena Med');
  await run('UPDATE users SET custom_name=1,name=? WHERE id=?', 'Chosen', 'Renamed');
  await syncUser('Renamed', 'Provider Name', 'new@example.test', true);
  const u = await one('SELECT name,email FROM users WHERE id=?', 'Renamed');
  assert.equal(u.name, 'Chosen');
  assert.equal(u.email, 'new@example.test');
});

await test('M13: indexes and the catalogue barcode column exist', async () => {
  for (const name of [
    'memberships_user',
    'invitations_household',
    'operations_household',
    'operations_user',
    'records_household_seq',
    'records_created_by',
    'records_updated_by',
    'catalogue_barcode',
  ])
    assert(await one("SELECT name FROM sqlite_master WHERE type='index' AND name=?", name), name);
});

await test('M11: saved catalogue search needs a real term and is bounded', async () => {
  assert.deepEqual(await savedCatalogueCandidates(''), []);
  assert.deepEqual(await savedCatalogueCandidates('a'), []);
});

await test('M12: the shared OFF cool-down starts only on upstream outages', async () => {
  const originalFetch = globalThis.fetch;
  try {
    await run("DELETE FROM cache WHERE key LIKE 'off:cooldown:%'");
    globalThis.fetch = async () => new Response('bad request', { status: 400 });
    await assert.rejects(off.search('zzz first', 'CH'));
    assert.equal(await one("SELECT key FROM cache WHERE key='off:cooldown:search'"), undefined);
    globalThis.fetch = async () => new Response('down', { status: 503 });
    await assert.rejects(off.search('zzz second', 'CH'));
    assert(await one("SELECT key FROM cache WHERE key='off:cooldown:search'"));
  } finally {
    globalThis.fetch = originalFetch;
    await run("DELETE FROM cache WHERE key LIKE 'off:cooldown:%'");
  }
});

// Minimal baseline JPEG structure: SOI, APP1 (EXIF), SOF0, SOS, data, EOI.
function jpeg(width: number, height: number) {
  const exif = [0xff, 0xe1, 0x00, 0x10, ...Buffer.from('Exif\0\0GPSDATA!')];
  const sof = [
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    0x01,
    0x01,
    0x11,
    0x00,
  ];
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
  return new Uint8Array([0xff, 0xd8, ...exif, ...sof, ...sos, 0x12, 0x34, 0x56, 0xff, 0xd9]);
}
await test('photos: EXIF stripped, oversized dimensions rejected, quota enforced', async () => {
  const clean = cleanJpeg(jpeg(640, 480));
  assert.equal(clean.width, 640);
  assert(!Buffer.from(clean.bytes).includes(Buffer.from('GPSDATA')));
  assert.throws(() => cleanJpeg(jpeg(9000, 10)), /8000/);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=',
    'base64',
  );
  assert.equal(cleanPng(new Uint8Array(png)).width, 1);
  const huge = Buffer.from(png);
  huge.writeUInt32BE(9000, 16);
  assert.throws(() => cleanPng(new Uint8Array(huge)), /8000/);
  const upload = (bytes: Uint8Array<ArrayBuffer>) => {
    const f = new FormData();
    f.set('household', h);
    f.set('file', new Blob([bytes], { type: 'image/jpeg' }), 'p.jpg');
    return asUser('Owner', () =>
      uploadPhoto(
        new Request(origin + '/api/photo', { method: 'POST', headers: { origin }, body: f }),
      ),
    );
  };
  const ok = await upload(jpeg(640, 480));
  assert.equal(ok.status, 200);
  const { url } = await ok.json();
  const key = decodeURIComponent(url.split('key=')[1]);
  const stored = await (
    env as unknown as { BUCKET: { get(k: string): Promise<{ body: Uint8Array }> } }
  ).BUCKET.get(key);
  assert(!Buffer.from(stored.body).includes(Buffer.from('GPSDATA')));
  await run(
    'INSERT INTO photos(key,household,bytes,created) VALUES(?,?,?,?)',
    h + '/filler',
    h,
    200 * 1024 * 1024,
    Date.now(),
  );
  assert.equal((await upload(jpeg(640, 480))).status, 413);
  await run('DELETE FROM photos WHERE key=?', h + '/filler');
  await run('UPDATE households SET deleting=1 WHERE id=?', h);
  assert.equal((await upload(jpeg(640, 480))).status, 410);
  await run('UPDATE households SET deleting=0 WHERE id=?', h);
});

await test('generic foods load provenance from the static asset', async () => {
  const r = await asUser('Owner', () => foods(new Request(origin + '/api/foods?q=chickpea')));
  assert.equal(r.status, 200);
  assert((await r.json()).version);
});

await test('M15: account deletion scrubs invitations, receipts and limit keys', async () => {
  const inv = await call('Owner', { action: 'invite', household: h, email: 'leaver@example.test' });
  assert.equal((await call('leaver', { action: 'join', token: inv.token })).status, 200);
  await call('Owner', { action: 'role', household: h, user: 'leaver', role: 'admin' });
  const pending = await call('leaver', {
    action: 'invite',
    household: h,
    email: 'friend@example.test',
  });
  const item = await apply(
    'leaver',
    op('item', { name: 'Leaver milk', list, quantity: 1, unit: 'pack' }),
  );
  // Another member's receipt that mentions the leaver.
  await apply('Owner', op('item', { ...item.record.data, notes: 'edited' }, item.record));
  assert.equal((await call('leaver', { action: 'deleteAccount' })).status, 200);
  const invitations = await one(
    "SELECT count(*) AS n FROM invitations WHERE created_by='leaver' OR used_by='leaver' OR recipient_email='leaver@example.test'",
  );
  assert.equal(invitations.n, 0);
  assert.equal((await one('SELECT revoked FROM invitations WHERE id=?', pending.id)).revoked, 1);
  assert.equal(
    (await one('SELECT count(*) AS n FROM operations WHERE instr(result,\'"leaver"\')>0')).n,
    0,
  );
  assert.equal((await one("SELECT count(*) AS n FROM limits WHERE key LIKE '%:leaver:%'")).n, 0);
  const kept = JSON.parse((await one('SELECT data FROM records WHERE id=?', item.record.id)).data);
  assert.equal(kept.addedBy, 'Deleted member');
});

await test('M15: account deletion also scrubs households the person already left', async () => {
  const inv = await call('Owner', { action: 'invite', household: h, email: 'former@example.test' });
  assert.equal((await call('former', { action: 'join', token: inv.token })).status, 200);
  const item = await apply(
    'Owner',
    op('item', { name: 'For former', list, quantity: 1, unit: 'pack', assigned: 'former' }),
  );
  assert.equal(item.status, 200);
  assert.equal((await call('former', { action: 'leave', household: h })).status, 200);
  assert.equal((await call('former', { action: 'deleteAccount' })).status, 200);
  const data = (await one('SELECT data FROM records WHERE id=?', item.record.id)).data as string;
  assert(!data.includes('"former"'), data);
});

await test('list currency side effects report only rows that were actually updated', async () => {
  const l = await apply('Owner', op('list', { name: 'Race list', currency: 'EUR' }));
  const item = await apply(
    'Owner',
    op('item', { name: 'Race butter', list: l.record.id, quantity: 1, unit: 'pack' }),
  );
  await run(
    "UPDATE records SET data=json_remove(data,'$.priceCurrency') WHERE id=?",
    item.record.id,
  );
  // Another shopper edits the item between the server's read and its batch: the trigger
  // fires on the receipt insert, which runs inside the batch before the currency pin.
  await run(
    `CREATE TRIGGER race_edit AFTER INSERT ON operations BEGIN UPDATE records SET version=version+1 WHERE id='${item.record.id}'; END`,
  );
  try {
    const changed = await apply(
      'Owner',
      op('list', { ...l.record.data, currency: 'CHF' }, l.record),
    );
    assert.equal(changed.status, 200);
    const reported = changed.affected.find((r: { id: string }) => r.id === item.record.id);
    const actual = await one('SELECT version,data FROM records WHERE id=?', item.record.id);
    assert.equal(reported.version, actual.version);
    assert.equal(reported.data.priceCurrency, JSON.parse(actual.data).priceCurrency);
    assert.equal(JSON.parse(actual.data).priceCurrency, undefined);
  } finally {
    await run('DROP TRIGGER IF EXISTS race_edit');
  }
});

await test('photo quota is reserved atomically across concurrent uploads', async () => {
  const bytes = jpeg(640, 480);
  const size = cleanJpeg(bytes).bytes.length;
  const used = Number(
    (await one('SELECT COALESCE(SUM(bytes),0) AS total FROM photos WHERE household=?', h)).total,
  );
  // Room for exactly one more photo.
  await run(
    'INSERT INTO photos(key,household,bytes,created) VALUES(?,?,?,?)',
    h + '/race-filler',
    h,
    200 * 1024 * 1024 - used - Math.floor(size * 1.5),
    Date.now(),
  );
  const upload = () => {
    const f = new FormData();
    f.set('household', h);
    f.set('file', new Blob([jpeg(640, 480)], { type: 'image/jpeg' }), 'p.jpg');
    return asUser('Owner', () =>
      uploadPhoto(
        new Request(origin + '/api/photo', { method: 'POST', headers: { origin }, body: f }),
      ),
    );
  };
  try {
    const statuses = (await Promise.all([upload(), upload()])).map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 413]);
  } finally {
    await run('DELETE FROM photos WHERE key=?', h + '/race-filler');
  }
});
