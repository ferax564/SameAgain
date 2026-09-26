// Household sync engine: optimistic outbox, polling and multi-tab coordination for one
// (user, household) session. Framework-free so it can be tested without React; the
// `useHousehold` hook owns one instance per active household.
import { uid, type RecordData } from './domain';
import {
  conflictDraft,
  correctedQueue,
  drainFrom,
  enqueue,
  wireOperation,
  type OperationData,
  type QueuedOperation,
} from './outbox';
import {
  backoffDelay,
  classifyFailure,
  composeRows,
  expectedVersion,
  isFullSnapshot,
  isActionResult,
  isHouseholdPayload,
  isOpResult,
  isRecordRow,
  isTimeout,
  jsonKey,
  mergeServerRows,
  sameRows,
  syncStatus,
  timeoutSignal,
  type Invite,
  type ActionResult,
  type Member,
  type OpResult,
  type ServerRows,
  type SyncStatus,
} from './sync-core';
import {
  isArrayOf,
  isStringKeyed,
  loadQueue,
  loadSnapshot,
  migrateLegacyQueue,
  nextSeq,
  readJson,
  removeOp,
  safeRemove,
  safeSet,
  saveOp,
  saveSnapshot,
  sortQueue,
  storageKeys,
  type KeyValueStore,
} from './sync-storage';

export const REQUEST_TIMEOUT = 15000;
export const POLL_INTERVAL = 4000;
const PERSIST_DELAY = 2000;

/** Error from the data API. `status` is undefined for network failures and timeouts. */
export class ApiError extends Error {
  status?: number;
  body?: unknown;
  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}
function errorMessage(body: unknown, fallback: string) {
  return isStringKeyed(body) && typeof body.error === 'string' && body.error
    ? body.error
    : fallback;
}

export type JsonResponse = { status: number; ok: boolean; body: unknown; headers: Headers };
/**
 * fetch + JSON with a timeout (default 15 s). Network failures and timeouts throw an
 * ApiError without a status (a temporary failure); HTTP errors are returned, not thrown.
 */
export async function requestJson(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit = {},
  timeout = REQUEST_TIMEOUT,
): Promise<JsonResponse> {
  const t = timeoutSignal(timeout);
  try {
    const r = await fetcher(url, { ...init, signal: t.signal });
    let body: unknown = null;
    if (r.status !== 304 && r.status !== 204) {
      try {
        body = await r.json();
      } catch (e) {
        if (isTimeout(e)) throw e;
      }
    }
    return { status: r.status, ok: r.ok, body, headers: r.headers };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(
      isTimeout(e) ? 'The connection timed out.' : 'The connection is unavailable.',
      undefined,
      null,
    );
  } finally {
    t.clear();
  }
}

/** Whether `ref` (a record link such as an item's `list` or a meal's `recipe`) is in `ids`. */
const linksTo = (ids: ReadonlySet<string>, ref: unknown) => typeof ref === 'string' && ids.has(ref);

/** POST an action to /api/data; throws ApiError on any failure. */
export async function postAction(
  fetcher: typeof fetch,
  action: string,
  data: Record<string, unknown> = {},
): Promise<ActionResult> {
  const r = await requestJson(fetcher, '/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...data }),
  });
  if (!r.ok) throw new ApiError(errorMessage(r.body, 'Unable to save'), r.status, r.body);
  if (!isActionResult(r.body)) throw new ApiError('Unexpected server response.', 502, r.body);
  return r.body;
}

export type Conflict = { op: QueuedOperation; latest: RecordData | null };
export type Rejection = { op: QueuedOperation; message: string };
export type EngineView = {
  records: RecordData[];
  members: Member[];
  invites: Invite[];
  sync: SyncStatus;
  conflict: Conflict | null;
  rejected: Rejection | null;
  pending: number;
  authExpired: boolean;
  error: string;
};
export const emptyView: EngineView = {
  records: [],
  members: [],
  invites: [],
  sync: 'Synced',
  conflict: null,
  rejected: null,
  pending: 0,
  authExpired: false,
  error: '',
};

type LockRequest = (
  name: string,
  options: { ifAvailable: boolean },
  callback: (lock: unknown) => Promise<unknown>,
) => Promise<unknown>;
export type ChannelLike = { postMessage(message: unknown): void };
export type EngineEnv = {
  storage: KeyValueStore | null;
  fetch: typeof fetch;
  online(): boolean;
  hidden(): boolean;
  now(): number;
  /** Web Locks `request`, or null: without it every tab may flush (the server dedupes ops). */
  lock: LockRequest | null;
  /** BroadcastChannel used to share acknowledged rows with other tabs, or null. */
  channel: ChannelLike | null;
  /** Show an error toast. */
  notify(message: string): void;
  /** The household's queue changed (for pending counts across households). */
  onQueueChange?(): void;
};
export type SyncMessage = {
  type: 'rows';
  user: string;
  household: string;
  rows: RecordData[];
};
export function isSyncMessage(v: unknown): v is SyncMessage {
  return (
    isStringKeyed(v) &&
    v.type === 'rows' &&
    typeof v.user === 'string' &&
    typeof v.household === 'string' &&
    Array.isArray(v.rows) &&
    v.rows.every(isRecordRow)
  );
}

/** Run `fn` holding the flush lock for this queue, or not at all if another tab holds it. */
async function withQueueLock(
  env: EngineEnv,
  user: string,
  household: string,
  fn: () => Promise<void>,
) {
  if (!env.lock) return fn();
  let ran = false;
  await env.lock(`same-again-sync:${user}:${household}`, { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    ran = true;
    await fn();
  });
  return ran ? undefined : 'busy';
}

function isMember(v: unknown): v is Member {
  return isStringKeyed(v) && typeof v.user === 'string';
}
const isMembers = isArrayOf(isMember);

export type MutationBase = Pick<RecordData, 'id' | 'version'> & Partial<RecordData>;

export class HouseholdSync {
  private server: ServerRows = new Map();
  private queue: QueuedOperation[] = [];
  /** Operations that could not be written to storage (kept in memory until acknowledged). */
  private memOnly = new Map<string, QueuedOperation>();
  private legacyRows: RecordData[] = [];
  private rows: RecordData[] = [];
  private cursor?: number;
  private etag?: string;
  /** Skip If-None-Match once after start: invitations are not part of the saved snapshot. */
  private revalidate = false;
  private view: EngineView = emptyView;
  private membersKey = '';
  private invitesKey = '';
  private flushing = false;
  private refreshing: Promise<void> | null = null;
  private followUp: Promise<void> | null = null;
  private flushFailures = 0;
  private pollFailures = 0;
  private pollStatus?: number;
  private retryAt = 0;
  private flushFailing: false | 'network' | 'server' = false;
  private pollFailing: false | 'network' | 'server' = false;
  private conflict: Conflict | null = null;
  private rejection: Rejection | null = null;
  private authExpired = false;
  private ackSerial = 0;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private soonTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private snapshotDisabled = false;
  private quotaWarned = false;
  private lastResume = 0;

  constructor(
    readonly user: string,
    readonly household: string,
    private env: EngineEnv,
    private emit: (patch: Partial<EngineView>) => void,
  ) {}

  // ---- lifecycle -------------------------------------------------------------------------

  start() {
    const { storage } = this.env;
    migrateLegacyQueue(storage, this.user, this.household, this.env.now());
    const snapshot = loadSnapshot(storage, this.user, this.household);
    if (snapshot) {
      this.server = new Map(snapshot.records.map((r) => [r.id, r]));
      this.legacyRows = snapshot.records;
      this.cursor = typeof snapshot.cursor === 'number' ? snapshot.cursor : undefined;
      this.etag = typeof snapshot.etag === 'string' ? snapshot.etag : undefined;
    }
    const members = readJson(storage, storageKeys.members(this.user, this.household), isMembers);
    this.membersKey = jsonKey(members ?? []);
    this.invitesKey = jsonKey([]);
    // Invitations are not cached, so the first poll must not be answered with a 304.
    this.revalidate = true;
    this.reloadQueue();
    this.rows = composeRows(this.server, this.queue, this.legacyRows);
    // Emit the whole view: the consumer may still hold another household's state.
    this.view = { ...emptyView, records: this.rows, members: members ?? [], invites: [] };
    this.emit({ ...this.view });
    this.updateStatus();
    if (this.queue.length) void this.flush();
    void this.refresh();
    this.schedule(POLL_INTERVAL);
  }

  stop() {
    this.persistNow();
    this.stopped = true;
    for (const t of [this.timer, this.persistTimer, this.soonTimer]) if (t) clearTimeout(t);
    this.timer = this.persistTimer = this.soonTimer = null;
  }

  /** Tab hidden: stop polling and write pending state now. */
  pause() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.persistNow();
  }

  /** Tab visible, focused or back online: refresh immediately and resume polling. */
  resume(force = false) {
    if (this.stopped || this.env.hidden()) return;
    const now = this.env.now();
    if (!force && now - this.lastResume < 2000) return;
    this.lastResume = now;
    if (this.queue.length && !this.authExpired) void this.flush(true);
    void this.refresh({ force: true }).finally(() => this.schedule(this.pollDelay()));
  }

  wentOffline() {
    this.updateStatus();
  }

  // ---- view ------------------------------------------------------------------------------

  private set(patch: Partial<EngineView>) {
    if (this.stopped) return;
    const changed: Partial<EngineView> = {};
    let any = false;
    for (const k of Object.keys(patch) as (keyof EngineView)[])
      if (this.view[k] !== patch[k]) {
        (changed as Record<string, unknown>)[k] = patch[k];
        any = true;
      }
    if (!any) return;
    this.view = { ...this.view, ...changed };
    this.emit(changed);
  }

  private updateStatus() {
    this.set({
      pending: this.queue.length,
      sync: syncStatus({
        authExpired: this.authExpired,
        conflict: !!this.conflict,
        rejected: !!this.rejection,
        online: this.env.online(),
        failing: this.flushFailing || this.pollFailing,
        pending: this.queue.length,
      }),
    });
  }

  private setAuthExpired(value: boolean) {
    this.authExpired = value;
    this.set({ authExpired: value });
    if (value && this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private recompose() {
    const next = composeRows(this.server, this.queue, this.legacyRows);
    if (!sameRows(next, this.rows)) {
      this.rows = next;
      this.set({ records: next });
    }
    this.updateStatus();
  }

  /** The rows currently shown (server rows overlaid by queued changes). */
  currentRows() {
    return this.rows;
  }
  pendingCount() {
    return this.queue.length;
  }

  // ---- queue storage ---------------------------------------------------------------------

  private reloadQueue() {
    const before = this.queue.length;
    const stored = loadQueue(this.env.storage, this.user, this.household);
    const ids = new Set(stored.map((o) => o.id));
    const extra = [...this.memOnly.values()].filter((o) => !ids.has(o.id));
    this.queue = extra.length ? sortQueue([...stored, ...extra]) : stored;
    if (this.queue.length !== before) this.env.onQueueChange?.();
    return this.queue;
  }

  private storeOp(op: QueuedOperation) {
    let result = saveOp(this.env.storage, this.user, this.household, op);
    if (result === 'quota') {
      // Free space by dropping the snapshot (server rows can be fetched again), then retry.
      this.disableSnapshot();
      result = saveOp(this.env.storage, this.user, this.household, op);
    }
    if (result === 'ok') this.memOnly.delete(op.id);
    else {
      this.memOnly.set(op.id, op);
      this.warnStorage();
    }
  }

  private dropOp(id: string) {
    removeOp(this.env.storage, this.user, this.household, id);
    this.memOnly.delete(id);
  }

  private warnStorage() {
    if (this.quotaWarned) return;
    this.quotaWarned = true;
    this.env.notify('Device storage is full. Keep this page open until changes sync.');
  }

  private disableSnapshot() {
    this.snapshotDisabled = true;
    this.dirty = false;
    safeRemove(this.env.storage, storageKeys.snapshot(this.user, this.household));
  }

  private schedulePersist() {
    if (this.snapshotDisabled) return;
    this.dirty = true;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => this.persistNow(), PERSIST_DELAY);
  }

  /** Write the server snapshot if it changed. Quota errors fall back to storing the queue only. */
  persistNow() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    if (!this.dirty || this.snapshotDisabled || this.stopped) return;
    this.dirty = false;
    const snapshot: { records: RecordData[]; cursor?: number; etag?: string } = {
      records: [...this.server.values()],
    };
    if (this.cursor !== undefined) snapshot.cursor = this.cursor;
    if (this.etag !== undefined) snapshot.etag = this.etag;
    const result = saveSnapshot(this.env.storage, this.user, this.household, snapshot);
    if (result === 'quota') {
      this.disableSnapshot();
      this.warnStorage();
    }
  }

  // ---- polling ---------------------------------------------------------------------------

  private pollDelay() {
    return this.pollFailures
      ? backoffDelay(this.pollFailures, {
          base: POLL_INTERVAL,
          max: 60000,
          status: this.pollStatus,
        })
      : POLL_INTERVAL;
  }

  private schedule(delay: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.stopped || this.authExpired || this.env.hidden()) return;
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  private async tick() {
    this.timer = null;
    try {
      this.reloadQueue();
      if (this.queue.length) await this.flush();
      await this.refresh();
    } finally {
      this.schedule(this.pollDelay());
    }
  }

  private refreshSoon() {
    if (this.soonTimer || this.stopped) return;
    this.soonTimer = setTimeout(() => {
      this.soonTimer = null;
      if (!this.env.hidden()) void this.refresh();
    }, 300);
  }

  /**
   * Fetch server changes (delta when the server supports a cursor). Runs even while changes
   * are queued: records with queued operations keep their local version. One request at a
   * time; a forced call during a request runs once more after it.
   */
  refresh({ force = false }: { force?: boolean } = {}): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.refreshing) {
      if (!force) return this.refreshing;
      // A forced refresh must reflect the server after this call: queue one more fetch.
      this.followUp ??= this.refreshing.then(() => {
        this.followUp = null;
        return this.refresh();
      });
      return this.followUp;
    }
    if (this.authExpired && !force) return Promise.resolve();
    this.refreshing = this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh() {
    const startSerial = this.ackSerial;
    let url = '/api/data?household=' + encodeURIComponent(this.household);
    if (this.cursor !== undefined) url += '&since=' + encodeURIComponent(String(this.cursor));
    const headers: Record<string, string> = {};
    if (this.etag && !this.revalidate) headers['If-None-Match'] = this.etag;
    try {
      const r = await requestJson(this.env.fetch, url, { headers });
      if (this.stopped) return;
      if (r.status === 304) return this.refreshSucceeded();
      if (r.status === 401) {
        this.pollFailed(401, 'server');
        this.setAuthExpired(true);
        return;
      }
      if (r.status === 403) {
        // No longer a member: forget the cached copy (queued changes stay for review).
        safeRemove(this.env.storage, storageKeys.snapshot(this.user, this.household));
        this.server = new Map();
        this.cursor = this.etag = undefined;
        this.recompose();
        this.set({ error: errorMessage(r.body, 'You no longer have access to this household.') });
        this.pollFailed(403, 'server');
        return;
      }
      if (!r.ok || !isHouseholdPayload(r.body)) {
        this.pollFailed(r.status, 'server');
        return;
      }
      const d = r.body;
      const full = isFullSnapshot(d);
      const merged = mergeServerRows(this.server, d.records, {
        removeMissing: full && startSerial === this.ackSerial,
        dropTombstones: !full,
      });
      this.revalidate = false;
      // A full snapshot that could not prune missing rows (an operation was acknowledged
      // meanwhile) must not advance the cursor, or server deletions would never arrive.
      const adopt = !full || startSerial === this.ackSerial;
      const cursor = adopt && typeof d.cursor === 'number' ? d.cursor : undefined;
      const etag = adopt ? (r.headers.get('ETag') ?? undefined) : undefined;
      if (merged.changed || cursor !== this.cursor || etag !== this.etag) {
        this.server = merged.rows;
        this.cursor = cursor;
        this.etag = etag;
        this.schedulePersist();
      }
      if (merged.changed) {
        this.reloadQueue();
        this.recompose();
      }
      const members = Array.isArray(d.members) ? d.members : [];
      const membersKey = jsonKey(members);
      if (membersKey !== this.membersKey) {
        this.membersKey = membersKey;
        this.set({ members });
        safeSet(this.env.storage, storageKeys.members(this.user, this.household), membersKey);
      }
      const invites = Array.isArray(d.invites) ? d.invites : [];
      const invitesKey = jsonKey(invites);
      if (invitesKey !== this.invitesKey) {
        this.invitesKey = invitesKey;
        this.set({ invites });
      }
      this.refreshSucceeded();
    } catch (e) {
      if (this.stopped) return;
      this.pollFailed(e instanceof ApiError ? e.status : undefined, 'network');
    }
  }

  private refreshSucceeded() {
    this.pollFailures = 0;
    this.pollStatus = undefined;
    this.pollFailing = false;
    if (this.authExpired) {
      this.setAuthExpired(false);
      this.schedule(POLL_INTERVAL);
      if (this.queue.length) void this.flush(true);
    }
    this.updateStatus();
  }

  private pollFailed(status: number | undefined, kind: 'network' | 'server') {
    this.pollFailures++;
    this.pollStatus = status;
    this.pollFailing = status === 401 || status === 403 ? false : kind;
    this.updateStatus();
  }

  // ---- outbox ----------------------------------------------------------------------------

  private applyServerRows(rows: RecordData[]) {
    const merged = mergeServerRows(this.server, rows, {
      removeMissing: false,
      dropTombstones: true,
    });
    if (!merged.changed) return false;
    this.server = merged.rows;
    this.schedulePersist();
    return true;
  }

  /** Send queued operations in order. Only one tab sends at a time (Web Locks). */
  async flush(force = false): Promise<void> {
    if (
      this.stopped ||
      this.flushing ||
      this.conflict ||
      this.rejection ||
      (this.authExpired && !force) ||
      (!force && this.env.now() < this.retryAt)
    )
      return;
    if (!this.env.online()) return this.updateStatus();
    if (!this.reloadQueue().length) return this.updateStatus();
    this.flushing = true;
    let drained = false;
    try {
      const busy = await withQueueLock(this.env, this.user, this.household, async () => {
        await drainFrom<OpResult>(
          () => (this.stopped ? undefined : this.reloadQueue()[0]),
          (op) => this.send(op),
          (op, result) => this.acknowledge(op, result),
          () => this.env.online() && !this.stopped,
        );
      });
      drained = busy !== 'busy';
      this.flushFailures = 0;
      this.retryAt = 0;
      this.flushFailing = false;
    } catch (e) {
      this.flushFailed(e);
    } finally {
      this.flushing = false;
      this.reloadQueue();
      this.updateStatus();
      if (drained && !this.queue.length && !this.stopped) void this.refresh();
    }
  }

  private async send(op: QueuedOperation): Promise<OpResult> {
    if (!op.attempted) {
      op = { ...op, attempted: true };
      this.storeOp(op);
    }
    const r = await requestJson(this.env.fetch, '/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'op', household: this.household, op: wireOperation(op) }),
    });
    if (!r.ok) throw new ApiError(errorMessage(r.body, 'Unable to save'), r.status, r.body);
    if (!isOpResult(r.body)) throw new ApiError('Unexpected server response.', 502, r.body);
    return r.body;
  }

  private acknowledge(op: QueuedOperation, result: OpResult) {
    this.dropOp(op.id);
    this.ackSerial++;
    const rows = [result.record, ...(result.affected ?? [])];
    this.applyServerRows(rows);
    this.reloadQueue();
    this.recompose();
    try {
      this.env.channel?.postMessage({
        type: 'rows',
        user: this.user,
        household: this.household,
        rows,
      } satisfies SyncMessage);
    } catch {}
  }

  private flushFailed(e: unknown) {
    const status = e instanceof ApiError ? e.status : undefined;
    const body = e instanceof ApiError ? e.body : undefined;
    const message = e instanceof Error ? e.message : 'Unable to save';
    const op = this.reloadQueue()[0];
    const kind = classifyFailure(status);
    if (kind === 'conflict' && op) {
      const latest =
        isStringKeyed(body) && isRecordRow(body.conflict) ? (body.conflict as RecordData) : null;
      if (latest) this.server = new Map(this.server).set(latest.id, latest);
      this.conflict = { op: conflictDraft(this.queue, op), latest };
      this.set({ conflict: this.conflict });
      return;
    }
    if (kind === 'auth') {
      this.setAuthExpired(true);
      this.flushFailures++;
      this.retryAt = this.env.now() + backoffDelay(this.flushFailures);
      return;
    }
    if ((kind === 'rejected' || kind === 'forbidden') && op) {
      this.rejection = { op, message };
      this.set({ rejected: this.rejection, error: message });
      return;
    }
    this.flushFailures++;
    this.retryAt = this.env.now() + backoffDelay(this.flushFailures, { status });
    this.flushFailing = status === undefined ? 'network' : 'server';
  }

  /**
   * Record a local change and queue it. The expected version comes from the latest row the
   * client knows for `old.id` (not from `old.version`, which may be stale in undo/merge flows).
   */
  mutate(
    kind: string,
    data: OperationData,
    old?: MutationBase,
    deleted = false,
  ): RecordData | undefined {
    if (this.stopped) return undefined;
    this.reloadQueue();
    const u = this.user,
      now = this.env.now(),
      id = old?.id || uid();
    const failed =
      this.rejection?.op.record === id ? this.queue.find((q) => q.record === id) : undefined;
    const latest = this.rows.find((r) => r.id === id);
    const prev: Partial<RecordData> | undefined = latest ?? old;
    const version = failed ? failed.version : expectedVersion(id, this.rows, old);
    if (kind === 'item') {
      data = { ...data, addedBy: prev?.data?.addedBy || u };
      if (data.done && !prev?.data?.done) {
        data.purchasedBy = u;
        data.purchasedAt = now;
      } else if (!data.done) {
        data.purchasedBy = null;
        data.purchasedAt = null;
      }
    }
    const row: RecordData = {
      id,
      household: this.household,
      kind,
      data,
      version: version + 1,
      deleted: deleted ? 1 : 0,
      createdBy: prev?.createdBy || u,
      updatedBy: u,
      created: prev?.created || now,
      updated: now,
    };
    let shown: RecordData | undefined = row;
    if (failed) {
      const next = correctedQueue(this.queue, id, data, deleted, row);
      const keep = new Set(next.map((q) => q.id));
      for (const q of this.queue) if (!keep.has(q.id)) this.dropOp(q.id);
      const had = new Set(this.queue.map((q) => q.id));
      for (const q of next) if (!had.has(q.id)) this.storeOp(q);
      this.rejection = null;
      this.retryAt = 0;
      this.set({ rejected: null, error: '' });
    } else {
      const op: QueuedOperation = {
        id: uid(),
        record: id,
        kind,
        data,
        version,
        deleted,
        seq: nextSeq(now),
        row,
      };
      const base = this.server.get(id);
      const res = enqueue(this.queue, op, base);
      for (const q of res.removed) this.dropOp(q.id);
      if (res.added) this.storeOp(res.added);
      shown = res.added ? (res.added.row ?? row) : (base ?? row);
    }
    this.reloadQueue();
    this.env.onQueueChange?.();
    this.recompose();
    void this.flush();
    return shown;
  }

  /**
   * Close the conflict dialog. Uses the latest queued draft for the record (edits made while
   * the dialog was open are kept) and, when the record no longer exists, recreates it under
   * its original id.
   */
  resolve(keepMine: boolean) {
    const c = this.conflict;
    if (!c) return;
    this.reloadQueue();
    const draft = conflictDraft(this.queue, c.op);
    for (const q of this.queue) if (q.record === draft.record) this.dropOp(q.id);
    const server = new Map(this.server);
    if (c.latest) server.set(c.latest.id, c.latest);
    else server.delete(draft.record);
    this.server = server;
    this.schedulePersist();
    this.conflict = null;
    this.set({ conflict: null });
    this.reloadQueue();
    this.env.onQueueChange?.();
    this.recompose();
    if (keepMine)
      this.mutate(
        draft.kind,
        draft.data,
        c.latest ?? { id: draft.record, version: 0 },
        !!draft.deleted,
      );
    else void this.flush(true);
  }

  /** Drop a definitively rejected change (and queued changes that depend on it). */
  async discardRejected() {
    const failed = this.rejection?.op;
    if (!failed) return;
    try {
      const r = await requestJson(
        this.env.fetch,
        '/api/data?household=' + encodeURIComponent(this.household),
      );
      if (r.status === 401) this.setAuthExpired(true);
      if (!r.ok || !isHouseholdPayload(r.body))
        throw new ApiError(errorMessage(r.body, 'Unable to reach the server.'), r.status);
      if (this.stopped) return;
      this.reloadQueue();
      const ids = new Set([failed.record]);
      for (const op of this.queue)
        if (linksTo(ids, op.data?.list) || linksTo(ids, op.data?.recipe)) ids.add(op.record);
      for (const op of this.queue) if (ids.has(op.record)) this.dropOp(op.id);
      const server = new Map(this.server);
      for (const id of ids) server.delete(id);
      for (const row of r.body.records) if (ids.has(row.id)) server.set(row.id, row);
      this.server = server;
      this.schedulePersist();
      this.rejection = null;
      this.retryAt = 0;
      this.set({ rejected: null, error: '' });
      this.reloadQueue();
      this.env.onQueueChange?.();
      this.recompose();
      void this.flush(true);
    } catch (e) {
      this.env.notify(e instanceof Error ? e.message : 'Unable to discard this change.');
    }
  }

  /** Clear the error banner. */
  clearError() {
    this.set({ error: '' });
  }
  setError(message: string) {
    this.set({ error: message });
  }

  // ---- other tabs ------------------------------------------------------------------------

  /** A `storage` event from another tab. */
  onStorage(key: string | null) {
    if (this.stopped || key === null) return;
    if (!key.startsWith(storageKeys.opPrefix(this.user, this.household))) return;
    const before = this.queue.length;
    this.reloadQueue();
    this.recompose();
    // Another tab acknowledged an operation: fetch its result unless it is broadcast.
    if (this.queue.length < before) this.refreshSoon();
    else if (this.queue.length && !this.conflict && !this.rejection) void this.flush();
  }

  /** Rows acknowledged by another tab. */
  onMessage(message: unknown) {
    if (this.stopped || !isSyncMessage(message)) return;
    if (message.user !== this.user || message.household !== this.household) return;
    if (this.soonTimer) {
      clearTimeout(this.soonTimer);
      this.soonTimer = null;
    }
    this.reloadQueue();
    this.applyServerRows(message.rows);
    this.recompose();
  }
}

/**
 * Send another household's stored queue in the background (changes queued before switching
 * households or in another tab). Stops quietly at the first failure; the queue stays for when
 * that household is opened. Returns the number of acknowledged operations.
 */
export async function flushStoredQueue(env: EngineEnv, user: string, household: string) {
  let sent = 0;
  if (!env.online()) return sent;
  try {
    await withQueueLock(env, user, household, async () => {
      sent = await drainFrom<OpResult>(
        () => loadQueue(env.storage, user, household)[0],
        async (op) => {
          const r = await requestJson(env.fetch, '/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'op', household, op: wireOperation(op) }),
          });
          if (!r.ok || !isOpResult(r.body))
            throw new ApiError(errorMessage(r.body, 'Unable to save'), r.status, r.body);
          return r.body;
        },
        (op, result) => {
          removeOp(env.storage, user, household, op.id);
          const snapshot = loadSnapshot(env.storage, user, household);
          if (!snapshot) return;
          const merged = mergeServerRows(
            new Map(snapshot.records.map((r) => [r.id, r])),
            [result.record, ...(result.affected ?? [])],
            { removeMissing: false, dropTombstones: true },
          );
          if (merged.changed)
            saveSnapshot(env.storage, user, household, {
              records: [...merged.rows.values()],
              ...(snapshot.cursor !== undefined ? { cursor: snapshot.cursor } : {}),
            });
        },
        () => env.online(),
      );
    });
  } catch {}
  if (sent) env.onQueueChange?.();
  return sent;
}
