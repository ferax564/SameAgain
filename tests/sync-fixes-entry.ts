import test from 'node:test';
import assert from 'node:assert/strict';
import type { RecordData } from '../lib/domain';
import { drainFrom, enqueue, sameJson, type QueuedOperation } from '../lib/outbox';
import {
  backoffDelay,
  chooseHousehold,
  classifyFailure,
  composeRows,
  expectedVersion,
  isFullSnapshot,
  mergeServerRows,
  syncStatus,
  timeoutSignal,
} from '../lib/sync-core';
import {
  isQuotaError,
  loadQueue,
  loadSnapshot,
  migrateLegacyQueue,
  pendingCounts,
  readJson,
  safeGet,
  safeSet,
  saveOp,
  storageKeys,
  type KeyValueStore,
} from '../lib/sync-storage';
import { HouseholdSync, emptyView, type EngineEnv, type EngineView } from '../lib/sync-engine';

const row = (id: string, version: number, data: RecordData['data'] = {}, deleted = 0) =>
  ({
    id,
    household: 'h',
    kind: 'item',
    data,
    version,
    deleted,
    createdBy: 'u',
    updatedBy: 'u',
    created: 1,
    updated: 1,
  }) satisfies RecordData;
const op = (id: string, record: string, version: number, data: RecordData['data'] = {}) =>
  ({ id, record, kind: 'item', data, version, seq: 0 }) as QueuedOperation;

class MemoryStorage implements KeyValueStore {
  map = new Map<string, string>();
  quota = Infinity;
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (v.length > this.quota)
      throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

// ---- queue collapse (M2) ----------------------------------------------------------------

await test('a later change collapses into the unsent operation for the same record', () => {
  const first = { ...op('a', 'item', 3, { name: 'Milk', done: true }), row: row('item', 4) };
  const other = op('b', 'other', 1);
  const second = { ...op('c', 'item', 4, { name: 'Milk 2', done: true }), row: row('item', 5) };
  const r = enqueue([first, other], second);
  assert.equal(r.queue.length, 2);
  assert.equal(r.queue[0].id, 'c', 'new id so a stored receipt cannot be replayed');
  assert.equal(r.queue[0].version, 3, 'keeps the first expected version');
  assert.equal(r.queue[0].row?.version, 4, 'optimistic row carries the next server version');
  assert.equal(r.queue[0].data.name, 'Milk 2');
  assert.deepEqual(
    r.removed.map((q) => q.id),
    ['a'],
  );
});
await test('an operation that cancels out against the server row is dropped', () => {
  const base = row('item', 3, { name: 'Milk', done: false, purchasedBy: null });
  const check = op('a', 'item', 3, { name: 'Milk', done: true, purchasedBy: 'bob' });
  const uncheck = op('b', 'item', 4, { name: 'Milk', done: false, purchasedAt: null });
  const r = enqueue([check], uncheck, base);
  assert.equal(r.queue.length, 0);
  assert.equal(r.added, null);
  assert.equal(enqueue([], op('c', 'item', 3, { name: 'Milk', done: false }), base).added, null);
});
await test('a sent operation is never rewritten; a delete after a queued create is appended', () => {
  const sent = { ...op('a', 'item', 3), attempted: true };
  assert.equal(enqueue([sent], op('b', 'item', 4)).queue.length, 2);
  const create = op('c', 'item', 0);
  const del = { ...op('d', 'item', 1), deleted: true };
  assert.equal(enqueue([create], del).queue.length, 2);
});
await test('JSON equality ignores key order and null versus missing', () => {
  assert(sameJson({ a: 1, b: { c: [1, 2] }, d: null }, { b: { c: [1, 2] }, a: 1 }));
  assert(!sameJson({ a: [1] }, { a: [1, 2] }));
  assert(!sameJson({ a: 0 }, { a: null }));
});

// ---- version derivation (M2 undo/merge) -------------------------------------------------

await test('the expected version comes from the latest known row, not the caller copy', () => {
  const rows = [row('x', 7)];
  assert.equal(expectedVersion('x', rows, { version: 5 }), 7);
  assert.equal(expectedVersion('y', rows, { version: 5 }), 5);
  assert.equal(expectedVersion('y', rows), 0);
});

// ---- delta merge (H3, M3) ---------------------------------------------------------------

await test('delta rows upsert, tombstones are removed and unchanged input keeps identity', () => {
  const a = row('a', 1),
    b = row('b', 1);
  const current = new Map([
    ['a', a],
    ['b', b],
  ]);
  const same = mergeServerRows(current, [row('a', 1)], {
    removeMissing: false,
    dropTombstones: true,
  });
  assert.equal(same.changed, false);
  assert.equal(same.rows, current);
  const next = mergeServerRows(current, [row('a', 2), row('b', 2, {}, 1), row('c', 1)], {
    removeMissing: false,
    dropTombstones: true,
  });
  assert(next.changed);
  assert.deepEqual([...next.rows.keys()].sort(), ['a', 'c']);
  assert.equal(next.rows.get('a')?.version, 2);
});
await test('a stale response never downgrades a row, and a full snapshot removes missing rows', () => {
  const current = new Map([
    ['a', row('a', 5)],
    ['b', row('b', 1)],
  ]);
  const r = mergeServerRows(current, [row('a', 4)], { removeMissing: true, dropTombstones: false });
  assert.equal(r.rows.get('a')?.version, 5);
  assert(!r.rows.has('b'));
  assert(isFullSnapshot({ records: [], members: [], invites: [] }));
  assert(!isFullSnapshot({ records: [], members: [], invites: [], cursor: 3, full: false }));
});
await test('records with pending operations keep their optimistic version', () => {
  const server = new Map([
    ['a', row('a', 2, { name: 'server' })],
    ['b', row('b', 3)],
  ]);
  const local = row('a', 3, { name: 'mine' });
  const rows = composeRows(server, [{ ...op('o', 'a', 2), row: local }]);
  assert.equal(rows.find((r) => r.id === 'a')?.data.name, 'mine');
  assert.equal(rows.find((r) => r.id === 'b')?.version, 3);
});

// ---- backoff, classification, status (H3, H6, M2, M4) ------------------------------------

await test('backoff grows exponentially, is capped and waits a minute after 429', () => {
  const mid = () => 0.5;
  assert.equal(backoffDelay(1, { base: 4000, random: mid }), 4000);
  assert.equal(backoffDelay(3, { base: 4000, random: mid }), 16000);
  assert.equal(backoffDelay(20, { base: 4000, random: mid }), 60000);
  assert(backoffDelay(1, { status: 429, random: mid }) >= 60000);
});
await test('401 is an expired session, 409 a conflict, 400 a rejection, 5xx and timeouts temporary', () => {
  assert.equal(classifyFailure(401), 'auth');
  assert.equal(classifyFailure(403), 'forbidden');
  assert.equal(classifyFailure(409), 'conflict');
  assert.equal(classifyFailure(400), 'rejected');
  for (const s of [undefined, 408, 429, 500, 503]) assert.equal(classifyFailure(s), 'temporary');
});
await test('an open conflict reads Needs review and an expired session is not a failure', () => {
  const base = {
    authExpired: false,
    conflict: false,
    rejected: false,
    online: true,
    failing: false as const,
    pending: 0,
  };
  assert.equal(syncStatus({ ...base, conflict: true, pending: 2 }), 'Needs review');
  assert.equal(syncStatus({ ...base, authExpired: true, pending: 2 }), 'Session expired');
  assert.equal(syncStatus({ ...base, failing: 'network' }), 'Offline');
  assert.equal(syncStatus({ ...base, failing: 'server' }), 'Sync failed');
  assert.equal(syncStatus({ ...base, pending: 1 }), 'Changes waiting to sync');
});
await test('timeout signal works without AbortSignal.timeout', async () => {
  const original = AbortSignal.timeout;
  try {
    Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true });
    const t = timeoutSignal(5);
    await new Promise((r) => setTimeout(r, 20));
    assert(t.signal.aborted);
    assert.equal((t.signal.reason as Error).name, 'TimeoutError');
  } finally {
    Object.defineProperty(AbortSignal, 'timeout', { value: original, configurable: true });
  }
});
await test('boot selects the remembered household only while still a member', () => {
  const hs = [{ id: 'a' }, { id: 'b' }];
  assert.equal(chooseHousehold(hs, '', 'b'), 'b');
  assert.equal(chooseHousehold(hs, '', 'gone'), 'a');
  assert.equal(chooseHousehold(hs, 'a', 'b'), 'a');
  assert.equal(chooseHousehold([], '', 'b'), '');
});

// ---- storage guards and per-operation queue (H4, M5, M6) ---------------------------------

await test('storage failures and corrupt JSON never throw', () => {
  const broken: KeyValueStore = {
    get length(): number {
      throw new Error('blocked');
    },
    key() {
      throw new Error('blocked');
    },
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    },
    removeItem() {
      throw new Error('blocked');
    },
  };
  assert.equal(safeGet(broken, 'k'), null);
  assert.equal(safeSet(broken, 'k', 'v'), 'quota');
  assert.equal(safeSet(null, 'k', 'v'), 'error');
  assert.deepEqual(loadQueue(broken, 'u', 'h'), []);
  assert(isQuotaError({ code: 22 }));
  const s = new MemoryStorage();
  s.setItem(storageKeys.account, '{not json');
  assert.equal(
    readJson(s, storageKeys.account, (v): v is object => typeof v === 'object'),
    null,
  );
  assert.equal(s.getItem(storageKeys.account), null, 'corrupt cache is discarded');
  s.setItem(storageKeys.snapshot('u', 'h'), '{"records":5}');
  assert.equal(loadSnapshot(s, 'u', 'h'), null);
});
await test('two tabs queue operations under separate keys without overwriting each other', () => {
  const s = new MemoryStorage();
  saveOp(s, 'u', 'h', { ...op('milk', 'r1', 0), seq: 2 });
  saveOp(s, 'u', 'h', { ...op('eggs', 'r2', 0), seq: 1 });
  saveOp(s, 'u', 'other', op('bread', 'r3', 0));
  s.setItem(storageKeys.op('u', 'h', 'junk'), 'garbage');
  assert.deepEqual(
    loadQueue(s, 'u', 'h').map((q) => q.id),
    ['eggs', 'milk'],
  );
  assert.deepEqual(pendingCounts(s, 'u'), { h: 2, other: 1 });
});
await test('a legacy single-key queue migrates into per-operation keys with its rows', () => {
  const s = new MemoryStorage();
  s.setItem(
    storageKeys.snapshot('u', 'h'),
    JSON.stringify({ records: [row('r1', 2, { name: 'Milk' })], queue: [op('a', 'r1', 1)] }),
  );
  assert.equal(migrateLegacyQueue(s, 'u', 'h'), 1);
  const q = loadQueue(s, 'u', 'h');
  assert.equal(q[0].row?.data.name, 'Milk');
  assert.equal(loadSnapshot(s, 'u', 'h')?.queue, undefined);
  assert.equal(migrateLegacyQueue(s, 'u', 'h'), 0);
});
await test('drainFrom re-reads the queue head before every send', async () => {
  const queue = [op('a', 'x', 0)];
  const seen: string[] = [];
  const sent = await drainFrom(
    () => queue[0],
    async (o) => {
      seen.push(o.id);
      if (o.id === 'a') queue.push(op('b', 'y', 0));
      return o.id;
    },
    (o) => queue.splice(queue.indexOf(o), 1),
    () => true,
  );
  assert.equal(sent, 2);
  assert.deepEqual(seen, ['a', 'b']);
});

// ---- engine against a fake server --------------------------------------------------------

type Body = Record<string, unknown>;
function fakeServer() {
  const rows = new Map<string, RecordData>();
  const changedAt = new Map<string, number>();
  const receipts = new Map<string, unknown>();
  const state = { cursor: 1, status: 200, delta: true, fail: '' as '' | 'network' | 'timeout' };
  const requests: { url: string; body?: Body; headers?: Record<string, string> }[] = [];
  const put = (r: RecordData) => {
    rows.set(r.id, r);
    changedAt.set(r.id, ++state.cursor);
  };
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Body) : undefined;
    requests.push({ url, body, headers: init?.headers as Record<string, string> });
    if (state.fail === 'network') throw new TypeError('Failed to fetch');
    if (state.fail === 'timeout') throw new DOMException('timed out', 'TimeoutError');
    if (state.status !== 200) return json({ error: 'Session expired' }, state.status);
    if (!body) {
      const since = Number(new URL(url, 'https://x').searchParams.get('since') || 0);
      const records = [...rows.values()].filter(
        (r) => !state.delta || !since || (changedAt.get(r.id) ?? 0) > since,
      );
      return json(
        state.delta
          ? { records, members: [], invites: [], cursor: state.cursor, full: !since }
          : { records, members: [], invites: [] },
      );
    }
    const o = body.op as QueuedOperation;
    if (receipts.has(o.id)) return json(receipts.get(o.id));
    const old = rows.get(o.record);
    if ((old && old.version !== o.version) || (!old && o.version !== 0))
      return json({ error: 'Another shopper updated this item.', conflict: old ?? null }, 409);
    const record = { ...row(o.record, o.version + 1, o.data, o.deleted ? 1 : 0), kind: o.kind };
    put(record);
    const result = { record };
    receipts.set(o.id, result);
    return json(result);
  }) as typeof fetch;
  return { rows, put, state, requests, fetcher };
}
function engineFor(server: ReturnType<typeof fakeServer>, storage = new MemoryStorage()) {
  const net = { online: true };
  const notes: string[] = [];
  let view: EngineView = emptyView;
  const env: EngineEnv = {
    storage,
    fetch: server.fetcher,
    online: () => net.online,
    hidden: () => true, // no polling timers in tests
    now: () => Date.now(),
    lock: null,
    channel: null,
    notify: (m) => notes.push(m),
  };
  const engine = new HouseholdSync('u', 'h', env, (p) => (view = { ...view, ...p }));
  return { engine, net, notes, storage, view: () => view };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

await test('checking then unchecking offline sends nothing even if someone else checked it', async () => {
  const server = fakeServer();
  server.put(row('milk', 1, { name: 'Milk', done: false, addedBy: 'u' }));
  const t = engineFor(server);
  t.engine.start();
  await t.engine.refresh({ force: true });
  t.net.online = false;
  const milk = t.engine.currentRows().find((r) => r.id === 'milk')!;
  const checked = t.engine.mutate('item', { ...milk.data, done: true }, milk)!;
  t.engine.mutate('item', { ...checked.data, done: false }, milk); // stale caller copy
  assert.equal(t.engine.pendingCount(), 0);
  server.put(row('milk', 2, { name: 'Milk', done: true }));
  t.net.online = true;
  await t.engine.flush(true);
  await t.engine.refresh({ force: true });
  assert.equal(t.view().conflict, null);
  assert.equal(t.engine.currentRows().find((r) => r.id === 'milk')?.data.done, true);
  t.engine.stop();
});
await test('refresh keeps fetching while changes are queued and uses the delta cursor', async () => {
  const server = fakeServer();
  server.put(row('a', 1, { name: 'A' }));
  const t = engineFor(server);
  t.engine.start();
  await t.engine.refresh({ force: true });
  t.net.online = false;
  t.engine.mutate('item', { name: 'mine' }, t.engine.currentRows()[0]);
  t.net.online = true;
  server.state.status = 503; // sends fail, but reads must not stop
  await t.engine.flush(true);
  server.state.status = 200;
  server.put(row('b', 1, { name: 'from Alice' }));
  const before = server.requests.length;
  await t.engine.refresh({ force: true });
  const get = server.requests.slice(before).find((r) => !r.body)!;
  assert.match(get.url, /since=\d+/);
  const rows = t.engine.currentRows();
  assert.equal(rows.find((r) => r.id === 'b')?.data.name, 'from Alice');
  assert.equal(rows.find((r) => r.id === 'a')?.data.name, 'mine');
  t.engine.stop();
});
await test('an unchanged poll does not emit new records', async () => {
  const server = fakeServer();
  server.put(row('a', 1));
  const t = engineFor(server);
  t.engine.start();
  await t.engine.refresh({ force: true });
  const first = t.view().records;
  await t.engine.refresh({ force: true });
  assert.equal(t.view().records, first);
  t.engine.stop();
});
await test('an old server without cursor still gets full snapshots', async () => {
  const server = fakeServer();
  server.state.delta = false;
  server.put(row('a', 1));
  const t = engineFor(server);
  t.engine.start();
  await t.engine.refresh({ force: true });
  server.rows.delete('a');
  await t.engine.refresh({ force: true });
  assert.equal(t.engine.currentRows().length, 0);
  assert(!server.requests.some((r) => r.url.includes('since=')));
  t.engine.stop();
});
await test('401 marks the session expired and keeps the queued change', async () => {
  const server = fakeServer();
  const t = engineFor(server);
  t.engine.start();
  await t.engine.refresh({ force: true });
  server.state.status = 401;
  t.engine.mutate('item', { name: 'Eggs' });
  await tick();
  await t.engine.flush(true);
  assert.equal(t.view().authExpired, true);
  assert.equal(t.view().rejected, null);
  assert.equal(t.view().sync, 'Session expired');
  assert.equal(t.engine.pendingCount(), 1);
  server.state.status = 200;
  await t.engine.refresh({ force: true });
  await tick();
  await t.engine.flush(true);
  assert.equal(t.view().authExpired, false);
  assert.equal(t.engine.pendingCount(), 0);
  t.engine.stop();
});
await test('network failures and timeouts are temporary and never wedge the flush', async () => {
  const server = fakeServer();
  const t = engineFor(server);
  t.engine.start();
  await t.engine.refresh({ force: true });
  server.state.fail = 'timeout';
  t.engine.mutate('item', { name: 'Eggs' });
  await tick();
  await t.engine.flush(true);
  assert.equal(t.view().sync, 'Offline');
  assert.equal(t.view().rejected, null);
  server.state.fail = '';
  await t.engine.flush(true);
  assert.equal(t.engine.pendingCount(), 0);
  assert.equal(t.view().sync, 'Synced');
  t.engine.stop();
});
await test('a conflict reads Needs review; resolving keeps edits made meanwhile and the record id', async () => {
  const server = fakeServer();
  server.put(row('milk', 1, { name: 'Milk' }));
  const t = engineFor(server);
  t.engine.start();
  await t.engine.refresh({ force: true });
  t.net.online = false;
  t.engine.mutate('item', { name: 'Milk x2' }, t.engine.currentRows()[0]);
  server.rows.delete('milk'); // removed by someone else (hard delete)
  t.net.online = true;
  await t.engine.flush(true);
  assert(t.view().conflict);
  assert.equal(t.view().sync, 'Needs review');
  t.engine.mutate('item', { name: 'Milk x3' }, t.engine.currentRows()[0]); // dialog open
  t.engine.resolve(true);
  await tick();
  await t.engine.flush(true);
  assert.equal(server.rows.get('milk')?.data.name, 'Milk x3');
  assert.equal(server.rows.size, 1);
  assert.equal(t.view().conflict, null);
  t.engine.stop();
});
await test('server side effects in affected rows are applied locally', async () => {
  const server = fakeServer();
  const original = server.fetcher;
  const t = engineFor({
    ...server,
    fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const r = await original(input, init);
      if (!init?.body || !r.ok) return r;
      const b = (await r.json()) as Body;
      return new Response(
        JSON.stringify({ ...b, affected: [row('item-1', 2, { name: 'Bread' }, 1)] }),
      );
    }) as typeof fetch,
  });
  server.put(row('item-1', 1, { name: 'Bread' }));
  t.engine.start();
  await t.engine.refresh({ force: true });
  t.engine.mutate('trip', { items: [{ originalItem: 'item-1', originalVersion: 1 }] });
  await tick();
  await t.engine.flush(true);
  assert(!t.engine.currentRows().some((r) => r.id === 'item-1'));
  t.engine.stop();
});
await test('a full device warns once and keeps the queue', async () => {
  const server = fakeServer();
  for (let i = 0; i < 20; i++) server.put(row('r' + i, 1, { name: 'x'.repeat(50) }));
  const storage = new MemoryStorage();
  storage.quota = 1000;
  const t = engineFor(server, storage);
  t.engine.start();
  await t.engine.refresh({ force: true });
  t.engine.persistNow();
  t.net.online = false;
  t.engine.mutate('item', { name: 'Eggs' });
  t.engine.persistNow();
  assert.equal(t.notes.length, 1);
  assert.equal(loadQueue(storage, 'u', 'h').length, 1);
  assert.equal(storage.getItem(storageKeys.snapshot('u', 'h')), null);
  t.engine.stop();
});
await test('another tab sees queued changes and does not lose them', async () => {
  const server = fakeServer();
  const storage = new MemoryStorage();
  const a = engineFor(server, storage),
    b = engineFor(server, storage);
  a.engine.start();
  b.engine.start();
  a.net.online = b.net.online = false;
  a.engine.mutate('item', { name: 'Milk' });
  b.engine.mutate('item', { name: 'Eggs' });
  a.engine.onStorage(storageKeys.op('u', 'h', 'x'));
  assert.equal(a.engine.pendingCount(), 2);
  assert.deepEqual(
    a.engine
      .currentRows()
      .map((r) => r.data.name)
      .sort(),
    ['Eggs', 'Milk'],
  );
  a.net.online = true;
  await a.engine.flush(true);
  assert.equal(server.rows.size, 2);
  a.engine.stop();
  b.engine.stop();
});
