// Pure sync logic shared by the household sync engine and its tests. No React, no DOM globals
// beyond feature-detected ones.
import type { Constraint, RecordData } from './domain';
import type { QueuedOperation } from './outbox';

/** A member's personal preferences (`users.preferences`). Unknown keys are kept as-is. */
export type UserPreferences = {
  constraints?: Constraint[];
  /** Daily nutrient targets keyed by nutrient id (see lib/nutrition.ts). */
  nutritionTargets?: Record<string, number>;
  [key: string]: unknown;
};
/** Household-wide settings (`households.settings`). Unknown keys are kept as-is. */
export type HouseholdSettings = {
  country?: string;
  currency?: string;
  language?: string;
  categories?: string[];
  constraints?: Constraint[];
  [key: string]: unknown;
};
/** Body of a successful `POST /api/data` action; which fields are present depends on the action. */
export type ActionResult = {
  /** `createHousehold` / `join`: the household to switch to. */
  household?: string;
  /** `invite`: the single-use invitation token. */
  token?: string;
  [key: string]: unknown;
};

export type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  preferences: UserPreferences;
};
export type Household = {
  id: string;
  name: string;
  role?: string;
  settings: HouseholdSettings;
  created?: number;
};
export type Member = { user: string; role: string; name?: string | null };
export type Invite = {
  id: string;
  expires: number;
  revoked?: number | null;
  used_by?: string | null;
  recipient_email?: string | null;
};
/** `GET /api/data` without a household. */
export type AccountPayload = { user: SessionUser; households: Household[] };
/**
 * `GET /api/data?household=H[&since=N]`. Servers without delta support omit `cursor` and
 * `full`; such a response is always a complete snapshot.
 */
export type HouseholdPayload = {
  records: RecordData[];
  members: Member[];
  invites: Invite[];
  cursor?: number;
  full?: boolean;
};
/** `POST /api/data {action:'op'}`: the stored row plus rows the server changed as a side effect. */
export type OpResult = { record: RecordData; affected?: RecordData[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export function isActionResult(v: unknown): v is ActionResult {
  return (
    isObject(v) &&
    (v.household === undefined || typeof v.household === 'string') &&
    (v.token === undefined || typeof v.token === 'string')
  );
}
export function isRecordRow(v: unknown): v is RecordData {
  return (
    isObject(v) &&
    typeof v.id === 'string' &&
    typeof v.kind === 'string' &&
    typeof v.version === 'number'
  );
}
export function isAccountPayload(v: unknown): v is AccountPayload {
  return (
    isObject(v) &&
    isObject(v.user) &&
    typeof v.user.id === 'string' &&
    Array.isArray(v.households) &&
    v.households.every((h) => isObject(h) && typeof h.id === 'string')
  );
}
export function isHouseholdPayload(v: unknown): v is HouseholdPayload {
  return isObject(v) && Array.isArray(v.records) && v.records.every(isRecordRow);
}
export function isOpResult(v: unknown): v is OpResult {
  return (
    isObject(v) &&
    isRecordRow(v.record) &&
    (v.affected === undefined || (Array.isArray(v.affected) && v.affected.every(isRecordRow)))
  );
}
export function isQueuedOperation(v: unknown): v is QueuedOperation {
  return (
    isObject(v) &&
    typeof v.id === 'string' &&
    typeof v.record === 'string' &&
    typeof v.kind === 'string' &&
    typeof v.version === 'number'
  );
}

/** Whether a household response replaces local server state (old servers: always). */
export function isFullSnapshot(payload: HouseholdPayload) {
  return typeof payload.cursor !== 'number' || payload.full !== false;
}

export type ServerRows = Map<string, RecordData>;

/**
 * Merge server rows into the known server state. Returns the same map when nothing changed so
 * callers can skip re-rendering and persisting.
 *
 * - `removeMissing` (complete snapshot): rows absent from `incoming` are dropped.
 * - `dropTombstones` (delta): rows with `deleted=1` are removed rather than kept.
 * - A row never goes back to an older version: a response started before an acknowledgement
 *   cannot undo it.
 */
export function mergeServerRows(
  current: ServerRows,
  incoming: RecordData[],
  { removeMissing, dropTombstones }: { removeMissing: boolean; dropTombstones: boolean },
): { rows: ServerRows; changed: boolean } {
  const next: ServerRows = new Map(removeMissing ? [] : current);
  let changed = false;
  const seen = new Set<string>();
  for (const row of incoming) {
    seen.add(row.id);
    const known = current.get(row.id);
    if (known && known.version > row.version) {
      next.set(row.id, known);
      continue;
    }
    if (dropTombstones && row.deleted) {
      if (next.delete(row.id) || known) changed = true;
      continue;
    }
    if (known && known.version === row.version && known.deleted === row.deleted) {
      next.set(row.id, known);
      continue;
    }
    next.set(row.id, row);
    changed = true;
  }
  if (removeMissing) for (const id of current.keys()) if (!seen.has(id)) changed = true;
  return changed ? { rows: next, changed } : { rows: current, changed };
}

/**
 * The rows the UI shows: server rows, overlaid by the optimistic row of the latest queued
 * operation for each record (records with pending operations keep their local version).
 * `local` supplies optimistic rows for legacy queued operations stored without one.
 */
export function composeRows(
  server: ServerRows,
  queue: QueuedOperation[],
  local: RecordData[] = [],
): RecordData[] {
  const pending = new Map<string, RecordData | undefined>();
  const localById = new Map(local.map((r) => [r.id, r]));
  for (const op of queue) pending.set(op.record, op.row ?? localById.get(op.record));
  const out: RecordData[] = [];
  for (const row of server.values()) if (!pending.has(row.id)) out.push(row);
  for (const [id, row] of pending) {
    const shown = row ?? server.get(id);
    if (shown) out.push(shown);
  }
  return out;
}

/** Shallow identity comparison: unchanged rows keep their object identity through merges. */
export function sameRows(a: readonly RecordData[], b: readonly RecordData[]) {
  return a.length === b.length && a.every((r, i) => r === b[i]);
}

/**
 * The version a new change must expect: the latest row the client knows (the optimistic row
 * when changes are queued, otherwise the server row), never the possibly stale row captured
 * by the caller (an undo toast, a merge dialog). Falls back to the caller's row, then 0.
 */
export function expectedVersion(
  id: string,
  rows: readonly RecordData[],
  fallback?: { version: number } | null,
) {
  return rows.find((r) => r.id === id)?.version ?? fallback?.version ?? 0;
}

export type FailureKind = 'auth' | 'forbidden' | 'conflict' | 'rejected' | 'temporary';
/**
 * 401 = session expired (not a verdict on the change), 403 = no access, 409 = conflict,
 * other 4xx = definitive rejection, 408/425/429/5xx/network/timeout = temporary.
 */
export function classifyFailure(status?: number): FailureKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (status === 408 || status === 425 || status === 429) return 'temporary';
  if (status && status >= 400 && status < 500) return 'rejected';
  return 'temporary';
}

/**
 * Exponential backoff with jitter. `failures` counts consecutive failures (1 = first).
 * 429 waits at least a minute.
 */
export function backoffDelay(
  failures: number,
  {
    base = 2000,
    max = 60000,
    status,
    random = Math.random,
  }: { base?: number; max?: number; status?: number; random?: () => number } = {},
) {
  const exp = Math.min(max, base * 2 ** Math.max(0, failures - 1));
  const jittered = Math.round(exp * (0.8 + 0.4 * random()));
  return status === 429 ? Math.max(60000, jittered) : Math.min(max, jittered);
}

export type SyncStatus =
  | 'Synced'
  | 'Changes waiting to sync'
  | 'Offline'
  | 'Sync failed'
  | 'Needs review'
  | 'Session expired';
export function syncStatus(s: {
  authExpired: boolean;
  conflict: boolean;
  rejected: boolean;
  online: boolean;
  /** Last request failed temporarily: 'network' (no answer, timeout) or 'server' (5xx/429). */
  failing: false | 'network' | 'server';
  pending: number;
}): SyncStatus {
  if (s.authExpired) return 'Session expired';
  if (s.conflict) return 'Needs review';
  if (s.rejected) return 'Sync failed';
  if (!s.online || s.failing === 'network') return 'Offline';
  if (s.failing === 'server') return 'Sync failed';
  return s.pending ? 'Changes waiting to sync' : 'Synced';
}

/** An AbortSignal that fires after `ms`, using AbortSignal.timeout when available. */
export function timeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function')
    return { signal: AbortSignal.timeout(ms), clear: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const reason =
      typeof DOMException === 'function'
        ? new DOMException('The request timed out.', 'TimeoutError')
        : Object.assign(new Error('The request timed out.'), { name: 'TimeoutError' });
    controller.abort(reason);
  }, ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}
export function isTimeout(e: unknown) {
  return (
    typeof e === 'object' &&
    e !== null &&
    'name' in e &&
    (e.name === 'TimeoutError' || e.name === 'AbortError')
  );
}

/** Boot household: keep the current one, else the remembered one, else the first. */
export function chooseHousehold(
  households: readonly Pick<Household, 'id'>[],
  current: string,
  remembered: string | null,
) {
  if (current && households.some((h) => h.id === current)) return current;
  if (remembered && households.some((h) => h.id === remembered)) return remembered;
  return households[0]?.id || '';
}

/** Cheap change check for small server lists (members, invites). */
export function jsonKey(value: unknown) {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}
