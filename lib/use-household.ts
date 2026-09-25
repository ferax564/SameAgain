'use client';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { demoHousehold, demoMembers, demoRecords } from './demo';
import { RecordData, uid } from './domain';
import type { OperationData } from './outbox';
import {
  chooseHousehold,
  classifyFailure,
  isAccountPayload,
  isRecordRow,
  type Household,
  type ActionResult,
  type SessionUser,
  type SyncStatus,
} from './sync-core';
import {
  ApiError,
  HouseholdSync,
  emptyView,
  flushStoredQueue,
  postAction,
  requestJson,
  type EngineEnv,
  type EngineView,
  type MutationBase,
} from './sync-engine';
import {
  deviceStorage,
  isArrayOf,
  migrateAllLegacyQueues,
  pendingCounts,
  readJson,
  safeGet,
  safeSet,
  storageKeys,
} from './sync-storage';

export { ApiError };
export type { Conflict, Rejection } from './sync-engine';
export type { SyncStatus } from './sync-core';

/**
 * POST an action to /api/data (15 s timeout). Throws `ApiError` (`message`, `status`, `body`);
 * `status` is undefined for network failures and timeouts.
 */
export function api(action: string, data: Record<string, unknown> = {}): Promise<ActionResult> {
  return postAction((...a) => fetch(...a), action, data);
}

const isRecords = isArrayOf(isRecordRow);
const demoUser: SessionUser = { id: 'demo-alex', name: 'Alex', preferences: {} };

function browserEnv(onQueueChange: () => void): {
  env: EngineEnv;
  channel: BroadcastChannel | null;
} {
  let channel: BroadcastChannel | null = null;
  try {
    channel =
      typeof BroadcastChannel === 'function' ? new BroadcastChannel('same-again-sync') : null;
  } catch {
    channel = null;
  }
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return {
    channel,
    env: {
      storage: deviceStorage(),
      fetch: (...a) => fetch(...a),
      online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
      hidden: () => typeof document !== 'undefined' && document.hidden,
      now: () => Date.now(),
      lock:
        locks && typeof locks.request === 'function'
          ? (name, options, callback) => locks.request(name, options, callback)
          : null,
      channel,
      notify: (message) => toast.error(message),
      onQueueChange,
    },
  };
}

export type HouseholdState = ReturnType<typeof useHousehold>;
/** The hook's state while a household is open (signed in or demo): user and household are set. */
export type OpenHouseholdState = HouseholdState & { user: SessionUser; household: Household };
export function householdOpen(s: HouseholdState): s is OpenHouseholdState {
  return !!s.user && !!s.household;
}

/**
 * Household data, optimistic outbox and sync state.
 *
 * Return value (fields marked NEW were added in the September 2026 sync fixes):
 * - `records` / `allRecords` / `currentRecords()`: visible rows (queued changes overlaid).
 * - `sync`: SyncStatus — 'Synced' | 'Changes waiting to sync' | 'Offline' | 'Sync failed' |
 *   'Needs review' (NEW: a conflict dialog is open) | 'Session expired' (NEW: 401).
 * - `pending`: queued changes for the current household.
 * - NEW `pendingByHousehold`: queued changes per household id on this device (all tabs).
 * - NEW `pendingAnywhere`: total queued changes across every household of this user; check
 *   it (not `pending`) before signing out and clearing device storage.
 * - NEW `authExpired`: the session expired (a request returned 401). Queued changes are kept
 *   and polling stops; show a "Sign in again" prompt. Cleared automatically once a request
 *   succeeds again (the tab regains visibility/focus or `refresh()` is called).
 * - `conflict` {op, latest}: `op` is the latest queued draft; `resolve(keepMine)`.
 * - `rejected` {op, message} + `discardRejected()`: a definitive (4xx) rejection.
 * - `refresh()`: forces a fetch now (resolves when done). `flush()`: retry sending now.
 * - `boot()`: reload the account. Boots into the last used household when still a member,
 *   and falls back to the cached account on network errors, timeouts and 5xx.
 */
export function useHousehold() {
  const [user, setUser] = useState<SessionUser | null>(null),
    [households, setHouseholds] = useState<Household[]>([]),
    [household, setHousehold] = useState(''),
    [demo, setDemo] = useState(false),
    [demoRows, setDemoRows] = useState<RecordData[]>([]),
    [loading, setLoading] = useState(true),
    [bootOffline, setBootOffline] = useState(false),
    [bootError, setBootError] = useState(''),
    [view, setView] = useState<EngineView>(emptyView),
    [storedPending, setStoredPending] = useState<Record<string, number>>({});
  const engine = useRef<HouseholdSync | null>(null),
    demoRef = useRef<RecordData[]>([]);
  const userId = user?.id;

  async function boot() {
    const storage = deviceStorage();
    try {
      const r = await requestJson((...a) => fetch(...a), '/api/data');
      if (r.status === 401) {
        setUser(null);
        return;
      }
      if (!r.ok) {
        const message =
          r.body &&
          typeof r.body === 'object' &&
          'error' in r.body &&
          typeof r.body.error === 'string'
            ? r.body.error
            : 'Unable to load your account.';
        throw new ApiError(message, r.status, r.body);
      }
      if (!isAccountPayload(r.body)) throw new ApiError('Unexpected server response.', 502);
      const d = r.body;
      const remembered = safeGet(storage, storageKeys.lastHousehold(d.user.id));
      setUser(d.user);
      setHouseholds(d.households);
      setHousehold((h) => chooseHousehold(d.households, h, remembered));
      safeSet(storage, storageKeys.account, JSON.stringify(d));
      setBootOffline(false);
      setBootError('');
    } catch (e) {
      const status = e instanceof ApiError ? e.status : undefined;
      const temporary = classifyFailure(status) === 'temporary';
      const cached = temporary ? readJson(storage, storageKeys.account, isAccountPayload) : null;
      if (cached) {
        const remembered = safeGet(storage, storageKeys.lastHousehold(cached.user.id));
        setUser(cached.user);
        setHouseholds(cached.households);
        setHousehold((h) => chooseHousehold(cached.households, h, remembered));
        setBootOffline(true);
      } else setBootError(e instanceof Error ? e.message : 'Unable to load your account.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // boot only sets state after its request settles (asynchronously); it runs once per mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void boot();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  // One sync engine per (user, household); none in demo mode.
  useEffect(() => {
    if (demo || !household || !userId) return;
    const storage = deviceStorage();
    safeSet(storage, storageKeys.lastHousehold(userId), household);
    const scan = () => setStoredPending(pendingCounts(deviceStorage(), userId));
    const { env, channel } = browserEnv(scan);
    const sync = new HouseholdSync(userId, household, env, (patch) =>
      setView((v) => ({ ...v, ...patch })),
    );
    engine.current = sync;
    sync.start();
    scan();
    const onMessage = (e: MessageEvent) => sync.onMessage(e.data);
    channel?.addEventListener('message', onMessage);
    const onStorage = (e: StorageEvent) => {
      sync.onStorage(e.key);
      if (e.key === null || e.key.includes(':op:')) scan();
    };
    const onVisibility = () => (document.hidden ? sync.pause() : sync.resume(true));
    const onFocus = () => sync.resume();
    const onOnline = () => sync.resume(true);
    const onOffline = () => sync.wentOffline();
    const onPageHide = () => sync.persistNow();
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      sync.stop();
      if (engine.current === sync) engine.current = null;
      channel?.removeEventListener('message', onMessage);
      try {
        channel?.close();
      } catch {}
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [demo, household, userId]);

  // Send changes queued for other households (M5), at start-up and when back online.
  useEffect(() => {
    if (!userId || demo) return;
    let cancelled = false;
    const run = async () => {
      const storage = deviceStorage();
      const member = new Set(households.map((h) => h.id));
      migrateAllLegacyQueues(storage, userId);
      const counts = pendingCounts(storage, userId);
      const current = engine.current?.household;
      const { env, channel } = browserEnv(() => {});
      try {
        for (const h of Object.keys(counts))
          if (!cancelled && h !== current && member.has(h)) await flushStoredQueue(env, userId, h);
      } finally {
        try {
          channel?.close();
        } catch {}
      }
      if (!cancelled) setStoredPending(pendingCounts(deviceStorage(), userId));
    };
    void run();
    const onOnline = () => void run();
    window.addEventListener('online', onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
    };
  }, [userId, demo, households]);

  const active = !demo && !!household && !!userId;
  const shown: EngineView = demo
    ? {
        ...emptyView,
        records: demoRows,
        members: demoMembers,
        sync: 'Synced',
        error: bootError,
      }
    : active
      ? { ...view, error: view.error || bootError }
      : { ...emptyView, sync: bootOffline ? 'Offline' : 'Synced', error: bootError };

  const pendingByHousehold: Record<string, number> = { ...storedPending };
  if (active) {
    if (view.pending) pendingByHousehold[household] = view.pending;
    else delete pendingByHousehold[household];
  }
  const pendingAnywhere = Object.values(pendingByHousehold).reduce((a, b) => a + b, 0);

  function setError(message: string) {
    setBootError(message);
    engine.current?.setError(message);
  }

  function mutate(kind: string, data: OperationData, old?: MutationBase, deleted = false) {
    if (demo) {
      const now = Date.now(),
        id = old?.id || uid(),
        u = demoUser.id,
        latest = demoRef.current.find((r) => r.id === id);
      const prev: Partial<RecordData> | undefined = latest ?? old;
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
      const record: RecordData = {
        id,
        household: 'demo',
        kind,
        data,
        version: (latest?.version ?? old?.version ?? 0) + 1,
        deleted: deleted ? 1 : 0,
        createdBy: prev?.createdBy || u,
        updatedBy: u,
        created: prev?.created || now,
        updated: now,
      };
      const next = [...demoRef.current.filter((x) => x.id !== id), record];
      demoRef.current = next;
      setDemoRows(next);
      safeSet(deviceStorage(), storageKeys.demo, JSON.stringify(next));
      return record;
    }
    if (!user) {
      toast.error('Sign in first.');
      return undefined;
    }
    const e = engine.current;
    if (!e) {
      toast.error('Choose a household first.');
      return undefined;
    }
    return e.mutate(kind, data, old, deleted);
  }

  function switchHousehold(h: string) {
    if (engine.current?.pendingCount()) {
      toast.error('Sync your pending changes before switching households.');
      return;
    }
    setDemo(false);
    setHousehold(h);
  }
  function enterDemo() {
    if (engine.current?.pendingCount())
      return toast.error('Sync pending changes before opening the demo.');
    const stored = readJson(deviceStorage(), storageKeys.demo, isRecords);
    const rows = stored ?? structuredClone(demoRecords);
    demoRef.current = rows;
    setDemoRows(rows);
    setDemo(true);
  }

  return {
    user: demo ? demoUser : user,
    realUser: user,
    households,
    household: demo ? demoHousehold : households.find((h) => h.id === household),
    records: shown.records.filter((r) => !r.deleted),
    allRecords: shown.records,
    members: shown.members,
    invites: shown.invites,
    demo,
    loading,
    sync: shown.sync as SyncStatus,
    error: shown.error,
    setError,
    conflict: demo ? null : shown.conflict,
    resolve: (keepMine: boolean) => engine.current?.resolve(keepMine),
    mutate,
    refresh: () => engine.current?.refresh({ force: true }) ?? Promise.resolve(),
    boot,
    flush: () => engine.current?.flush(true) ?? Promise.resolve(),
    switchHousehold,
    enterDemo,
    exitDemo: () => setDemo(false),
    rejected: demo ? null : shown.rejected,
    discardRejected: () => engine.current?.discardRejected() ?? Promise.resolve(),
    currentRecords: () =>
      (demo ? demoRef.current : (engine.current?.currentRows() ?? [])).filter((r) => !r.deleted),
    pending: demo ? 0 : shown.pending,
    /** NEW: queued changes per household on this device. */
    pendingByHousehold,
    /** NEW: queued changes across all of this user's households. */
    pendingAnywhere,
    /** NEW: the session expired; show "Sign in again". Queued changes are kept. */
    authExpired: !demo && shown.authExpired,
  };
}
