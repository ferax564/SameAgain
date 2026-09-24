'use client';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { drain, conflictDraft, currentRefresh, correctedQueue } from './outbox';
import { demoHousehold, demoMembers, demoRecords } from './demo';
import { RecordData, uid } from './domain';
export async function api(action: string, data: any = {}) {
  const r = await fetch('/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...data }),
  });
  const b = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(b.error || 'Unable to save'), { status: r.status, body: b });
  return b;
}
export function useHousehold() {
  const [user, setUser] = useState<any>(null),
    [households, setHouseholds] = useState<any[]>([]),
    [household, setHousehold] = useState(''),
    [records, setRecords] = useState<RecordData[]>([]),
    [members, setMembers] = useState<any[]>([]),
    [invites, setInvites] = useState<any[]>([]),
    [demo, setDemo] = useState(false),
    [loading, setLoading] = useState(true),
    [sync, setSync] = useState('Synced'),
    [conflict, setConflict] = useState<any>(null),
    [error, setError] = useState(''),
    [rejected, setRejected] = useState<any>(null);
  const queue = useRef<any[]>([]),
    working = useRef(false),
    ctx = useRef<any>({}),
    rows = useRef<RecordData[]>([]),
    blocked = useRef(false),
    retryAt = useRef(0),
    failures = useRef(0),
    revision = useRef(0),
    rejection = useRef<any>(null),
    refreshSerial = useRef(0);
  ctx.current = { household, user, demo };
  rows.current = records;
  const key = () => `same-again:${ctx.current.user?.id}:${ctx.current.household}`;
  function persist(rs = rows.current) {
    try {
      localStorage.setItem(key(), JSON.stringify({ records: rs, queue: queue.current }));
    } catch {
      toast.error('Device storage is full. Keep this page open until changes sync.');
    }
  }
  async function boot() {
    try {
      const r = await fetch('/api/data');
      if (r.status === 401) {
        setUser(null);
        setLoading(false);
        return;
      }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setUser(data.user);
      setHouseholds(data.households);
      if (!data.households.some((h: any) => h.id === household))
        setHousehold(data.households[0]?.id || '');
      localStorage.setItem('same-again:account', JSON.stringify(data));
      setError('');
    } catch (e: any) {
      const cached = localStorage.getItem('same-again:account');
      if (cached && !navigator.onLine) {
        const d = JSON.parse(cached);
        setUser(d.user);
        setHouseholds(d.households);
        setHousehold(d.households[0]?.id || '');
        setSync('Offline');
      } else setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  async function refresh() {
    const c = ctx.current;
    if (!c.household || c.demo || queue.current.length) return;
    try {
      const serial = ++refreshSerial.current,
        start = { household: c.household, revision: revision.current };
      const r = await fetch('/api/data?household=' + encodeURIComponent(c.household));
      const d = await r.json();
      if (
        c.household !== ctx.current.household ||
        ctx.current.demo ||
        serial !== refreshSerial.current
      )
        return;
      if (!r.ok) {
        if (r.status === 403) {
          localStorage.removeItem(key());
          setRecords([]);
          rows.current = [];
          setError(d.error);
        }
        throw new Error(d.error);
      }
      if (currentRefresh(start, ctx.current.household, revision.current, queue.current.length)) {
        setRecords(d.records);
        rows.current = d.records;
        persist(d.records);
      }
      setMembers(d.members);
      setInvites(d.invites);
      try {
        localStorage.setItem(key() + ':members', JSON.stringify(d.members));
      } catch {}
      if (currentRefresh(start, ctx.current.household, revision.current, queue.current.length))
        setSync('Synced');
    } catch {
      setSync(navigator.onLine ? 'Sync failed' : 'Offline');
    }
  }
  async function flush(force = false) {
    if (
      working.current ||
      blocked.current ||
      ctx.current.demo ||
      !ctx.current.household ||
      (!force && Date.now() < retryAt.current)
    )
      return;
    if (!navigator.onLine) {
      setSync('Offline');
      return;
    }
    working.current = true;
    const h = ctx.current.household;
    try {
      setSync(queue.current.length ? 'Changes waiting to sync' : 'Synced');
      await drain(
        queue.current,
        (op) => api('op', { household: h, op }),
        (op, d) => {
          const more = queue.current.some((x) => x.record === op.record);
          const next = more
            ? rows.current
            : rows.current.map((x) => (x.id === op.record ? d.record : x));
          rows.current = next;
          setRecords(next);
          persist(next);
        },
        () => navigator.onLine,
      );
      failures.current = 0;
      retryAt.current = 0;
    } catch (e: any) {
      setSync(navigator.onLine ? 'Sync failed' : 'Offline');
      const op = queue.current[0];
      if (e.status === 409 && op) {
        blocked.current = true;
        setConflict({ op: conflictDraft(queue.current, op), latest: e.body.conflict });
      } else {
        failures.current++;
        retryAt.current =
          Date.now() + (e.status === 429 ? 60000 : Math.min(30000, 2000 * 2 ** failures.current));
        if (e.status && e.status < 500 && e.status !== 429) {
          blocked.current = true;
          rejection.current = { op, message: e.message };
          setRejected(rejection.current);
          setError(e.message);
        }
      }
    } finally {
      working.current = false;
      if (!queue.current.length) {
        setSync(navigator.onLine ? 'Synced' : 'Offline');
        void refresh();
      }
    }
  }
  useEffect(() => {
    void boot();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  useEffect(() => {
    queue.current = [];
    revision.current++;
    blocked.current = false;
    rejection.current = null;
    setRejected(null);
    retryAt.current = 0;
    setConflict(null);
    if (demo) {
      const stored = localStorage.getItem('same-again:demo-v3');
      setRecords(stored ? JSON.parse(stored) : structuredClone(demoRecords));
      setMembers(demoMembers);
      setInvites([]);
      return;
    }
    if (!household || !user) return;
    const cached = localStorage.getItem(`same-again:${user.id}:${household}`);
    if (cached) {
      const d = JSON.parse(cached);
      setRecords(d.records);
      rows.current = d.records;
      queue.current = d.queue || [];
    } else {
      setRecords([]);
      rows.current = [];
    }
    setMembers(JSON.parse(localStorage.getItem(key() + ':members') || '[]'));
    setInvites([]);
    if (queue.current.length) void flush();
    else void refresh();
    const timer = setInterval(() => (queue.current.length ? void flush() : void refresh()), 4000);
    const reconnect = () => {
      void flush(true);
      void refresh();
    };
    const offline = () => setSync('Offline');
    window.addEventListener('online', reconnect);
    window.addEventListener('offline', offline);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', reconnect);
      window.removeEventListener('offline', offline);
    };
  }, [household, demo, user?.id]);
  function mutate(kind: string, data: any, old?: RecordData, deleted = false) {
    const id = old?.id || uid(),
      failed =
        rejection.current?.op?.record === id ? queue.current.find((q) => q.record === id) : null,
      version = failed?.version ?? old?.version ?? 0,
      now = Date.now(),
      u = demo ? 'demo-alex' : user?.id;
    if (!u) {
      toast.error('Sign in first.');
      return undefined;
    }
    if (kind === 'item') {
      data = { ...data, addedBy: old?.data.addedBy || u };
      if (data.done && !old?.data.done) {
        data.purchasedBy = u;
        data.purchasedAt = now;
      } else if (!data.done) {
        data.purchasedBy = null;
        data.purchasedAt = null;
      }
    }
    const record = {
      id,
      household: demo ? 'demo' : household,
      kind,
      data,
      version: version + 1,
      deleted: deleted ? 1 : 0,
      createdBy: old?.createdBy || u,
      updatedBy: u,
      created: old?.created || now,
      updated: now,
    };
    revision.current++;
    const next = [...rows.current.filter((x) => x.id !== id), record];
    rows.current = next;
    setRecords(next);
    if (demo) {
      localStorage.setItem('same-again:demo-v3', JSON.stringify(next));
      return record;
    }
    if (failed) {
      queue.current = correctedQueue(queue.current, id, data, deleted);
      rejection.current = null;
      setRejected(null);
      blocked.current = false;
      retryAt.current = 0;
      setError('');
    } else queue.current.push({ id: uid(), record: id, kind, data, version, deleted });
    persist(next);
    setSync(navigator.onLine ? 'Changes waiting to sync' : 'Offline');
    void flush();
    return record;
  }
  function resolve(keepMine: boolean) {
    if (!conflict) return;
    const { op, latest } = conflict;
    queue.current = queue.current.filter((x) => x.record !== op.record);
    let next = rows.current.filter((x) => x.id !== op.record);
    if (latest) next.push(latest);
    rows.current = next;
    setRecords(next);
    persist(next);
    setConflict(null);
    blocked.current = false;
    if (keepMine) mutate(op.kind, op.data, latest || undefined, op.deleted);
    else void flush();
  }
  async function discardRejected() {
    const failed = rejection.current?.op;
    if (!failed) return;
    try {
      const h = ctx.current.household;
      const r = await fetch('/api/data?household=' + encodeURIComponent(h));
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (h !== ctx.current.household) return;
      const ids = new Set([failed.record]);
      for (const op of queue.current)
        if (ids.has(op.data.list) || ids.has(op.data.recipe)) ids.add(op.record);
      queue.current = queue.current.filter((op) => !ids.has(op.record));
      const next = [
        ...rows.current.filter((r) => !ids.has(r.id)),
        ...data.records.filter((r: any) => ids.has(r.id)),
      ];
      revision.current++;
      rows.current = next;
      setRecords(next);
      persist(next);
      rejection.current = null;
      setRejected(null);
      setError('');
      blocked.current = false;
      retryAt.current = 0;
      void flush(true);
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  function switchHousehold(h: string) {
    if (queue.current.length) {
      toast.error('Sync your pending changes before switching households.');
      return;
    }
    setDemo(false);
    setHousehold(h);
  }
  function enterDemo() {
    if (queue.current.length) return toast.error('Sync pending changes before opening the demo.');
    setDemo(true);
  }
  return {
    user: demo ? { id: 'demo-alex', name: 'Alex', preferences: {} } : user,
    realUser: user,
    households,
    household: demo ? demoHousehold : households.find((h) => h.id === household),
    records: records.filter((r) => !r.deleted),
    allRecords: records,
    members,
    invites,
    demo,
    loading,
    sync,
    error,
    setError,
    conflict,
    resolve,
    mutate,
    refresh,
    boot,
    flush: () => flush(true),
    switchHousehold,
    enterDemo,
    exitDemo: () => setDemo(false),
    rejected,
    discardRejected,
    currentRecords: () => rows.current.filter((r) => !r.deleted),
    pending: queue.current.length,
  };
}
