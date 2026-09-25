// Guarded device storage for the household sync engine.
//
// Layout (all keys start with `same-again:` so sign-out can clear them):
//   same-again:account                      last account payload (offline boot)
//   same-again:<user>:last-household        last selected household
//   same-again:<user>:<household>           server snapshot {records, cursor?, etag?}
//                                           (legacy snapshots also held `queue`; migrated)
//   same-again:<user>:<household>:members   member list
//   same-again:<user>:<household>:op:<id>   one queued operation per key
//
// One key per operation means tabs never overwrite each other's queue: each tab only adds,
// replaces or removes the operation keys it touches. Every call is guarded: storage can be
// missing, blocked, full or corrupt, and none of that may crash the app.
import type { RecordData } from './domain';
import type { QueuedOperation } from './outbox';
import { isQueuedOperation, isRecordRow } from './sync-core';

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
};
export type WriteResult = 'ok' | 'quota' | 'error';

/** `window.localStorage`, or null when unavailable (SSR, blocked site data, sandbox). */
export function deviceStorage(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
export function isQuotaError(e: unknown) {
  if (typeof e !== 'object' || e === null) return false;
  const { name, code } = e as { name?: unknown; code?: unknown };
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  );
}
export function safeGet(s: KeyValueStore | null, key: string): string | null {
  try {
    return s ? s.getItem(key) : null;
  } catch {
    return null;
  }
}
export function safeSet(s: KeyValueStore | null, key: string, value: string): WriteResult {
  if (!s) return 'error';
  try {
    s.setItem(key, value);
    return 'ok';
  } catch (e) {
    return isQuotaError(e) ? 'quota' : 'error';
  }
}
export function safeRemove(s: KeyValueStore | null, key: string) {
  try {
    s?.removeItem(key);
  } catch {}
}
/** Parse JSON and validate its shape; anything corrupt yields null. */
export function safeParse<T>(text: string | null, guard: (v: unknown) => v is T): T | null {
  if (text == null) return null;
  try {
    const v: unknown = JSON.parse(text);
    return guard(v) ? v : null;
  } catch {
    return null;
  }
}
/** Read and validate a key; a corrupt value is removed so it cannot fail again. */
export function readJson<T>(s: KeyValueStore | null, key: string, guard: (v: unknown) => v is T) {
  const text = safeGet(s, key);
  const value = safeParse(text, guard);
  if (text != null && value == null) safeRemove(s, key);
  return value;
}
export function keysWithPrefix(s: KeyValueStore | null, prefix: string): string[] {
  const out: string[] = [];
  try {
    if (!s) return out;
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
  } catch {}
  return out;
}

export const storageKeys = {
  account: 'same-again:account',
  demo: 'same-again:demo-v3',
  lastHousehold: (user: string) => `same-again:${user}:last-household`,
  snapshot: (user: string, household: string) => `same-again:${user}:${household}`,
  members: (user: string, household: string) => `same-again:${user}:${household}:members`,
  opPrefix: (user: string, household: string) => `same-again:${user}:${household}:op:`,
  op: (user: string, household: string, id: string) => `same-again:${user}:${household}:op:${id}`,
};

export type Snapshot = {
  records: RecordData[];
  cursor?: number;
  etag?: string;
  /** Legacy (single-key) queue; migrated to per-operation keys on load. */
  queue?: QueuedOperation[];
};
export function isSnapshot(v: unknown): v is Snapshot {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    Array.isArray(s.records) &&
    s.records.every(isRecordRow) &&
    (s.queue === undefined || (Array.isArray(s.queue) && s.queue.every(isQueuedOperation)))
  );
}
export function isArrayOf<T>(guard: (v: unknown) => v is T) {
  return (v: unknown): v is T[] => Array.isArray(v) && v.every(guard);
}
export function isStringKeyed(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function loadSnapshot(s: KeyValueStore | null, user: string, household: string) {
  return readJson(s, storageKeys.snapshot(user, household), isSnapshot);
}
export function saveSnapshot(
  s: KeyValueStore | null,
  user: string,
  household: string,
  snapshot: Omit<Snapshot, 'queue'>,
): WriteResult {
  return safeSet(s, storageKeys.snapshot(user, household), JSON.stringify(snapshot));
}

let lastSeq = 0;
/** Monotonic ordering key; ties across tabs are broken by operation id. */
export function nextSeq(now = Date.now()) {
  lastSeq = Math.max(lastSeq + 1, now * 1000);
  return lastSeq;
}
function byQueueOrder(a: QueuedOperation, b: QueuedOperation) {
  return (a.seq ?? 0) - (b.seq ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export function sortQueue(queue: QueuedOperation[]) {
  return [...queue].sort(byQueueOrder);
}

/** The household's queued operations in replay order. Corrupt entries are dropped. */
export function loadQueue(
  s: KeyValueStore | null,
  user: string,
  household: string,
): QueuedOperation[] {
  const ops: QueuedOperation[] = [];
  for (const key of keysWithPrefix(s, storageKeys.opPrefix(user, household))) {
    const op = readJson(s, key, isQueuedOperation);
    if (op) ops.push(op);
  }
  return sortQueue(ops);
}
export function saveOp(
  s: KeyValueStore | null,
  user: string,
  household: string,
  op: QueuedOperation,
): WriteResult {
  return safeSet(s, storageKeys.op(user, household, op.id), JSON.stringify(op));
}
export function removeOp(s: KeyValueStore | null, user: string, household: string, id: string) {
  safeRemove(s, storageKeys.op(user, household, id));
}

/**
 * Move a legacy `{records, queue}` snapshot's queue into per-operation keys, attaching each
 * record's cached optimistic row. The legacy queue is only removed once every operation is
 * stored, so a full device never loses a change. Returns the number of migrated operations.
 */
export function migrateLegacyQueue(
  s: KeyValueStore | null,
  user: string,
  household: string,
  now = Date.now(),
) {
  const key = storageKeys.snapshot(user, household);
  const text = safeGet(s, key);
  if (!text || !text.includes('"queue":[{')) return 0;
  const snapshot = safeParse(text, isSnapshot);
  if (!snapshot?.queue?.length) return 0;
  const rows = new Map(snapshot.records.map((r) => [r.id, r]));
  let ok = true;
  snapshot.queue.forEach((op, i) => {
    const stored: QueuedOperation = {
      ...op,
      seq: op.seq ?? now * 1000 + i,
      row: op.row ?? rows.get(op.record),
    };
    if (saveOp(s, user, household, stored) !== 'ok') ok = false;
  });
  if (!ok) return 0;
  const rest: Snapshot = { records: snapshot.records };
  if (snapshot.cursor !== undefined) rest.cursor = snapshot.cursor;
  safeSet(s, key, JSON.stringify(rest));
  return snapshot.queue.length;
}

/** The household id inside `same-again:<user>:<household>[:…]`, or null. */
function householdOf(key: string, user: string) {
  const prefix = `same-again:${user}:`;
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  const op = rest.indexOf(':op:');
  if (op > 0) return { household: rest.slice(0, op), op: true };
  return rest.includes(':') ? null : { household: rest, op: false };
}

/** Households with a stored snapshot or queued operations for this user. */
export function storedHouseholds(s: KeyValueStore | null, user: string) {
  const out = new Set<string>();
  for (const key of keysWithPrefix(s, `same-again:${user}:`)) {
    const h = householdOf(key, user);
    if (h && h.household !== 'last-household') out.add(h.household);
  }
  return [...out];
}

/** Move every legacy single-key queue of this user into per-operation keys (once at boot). */
export function migrateAllLegacyQueues(s: KeyValueStore | null, user: string) {
  let moved = 0;
  for (const h of storedHouseholds(s, user)) moved += migrateLegacyQueue(s, user, h);
  return moved;
}

/**
 * Queued operation counts per household for this user (households without pending changes
 * are omitted). Only key names are read, so this is cheap enough to run after every change.
 */
export function pendingCounts(s: KeyValueStore | null, user: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of keysWithPrefix(s, `same-again:${user}:`)) {
    const h = householdOf(key, user);
    if (h?.op) counts[h.household] = (counts[h.household] ?? 0) + 1;
  }
  return counts;
}
