import type { RecordData } from './domain';

/** Record payload. `RecordData.data` is untyped JSON until domain records become a typed union. */
export type OperationData = RecordData['data'];

export type QueuedOperation = {
  /** Stable operation id: the server stores a receipt under it, so a retry is idempotent. */
  id: string;
  record: string;
  kind: string;
  data: OperationData;
  /** Version the server must still hold for this change to apply (0 = create). */
  version: number;
  deleted?: boolean;
  /** Client-only ordering key (queue order across tabs). Never sent to the server. */
  seq?: number;
  /**
   * Client-only: the operation has been sent at least once, so the server may already have
   * applied it. Such an operation is never rewritten, only acknowledged, corrected after a
   * definitive rejection, or discarded.
   */
  attempted?: boolean;
  /** Client-only: the optimistic row this operation produces locally (lets other tabs show it). */
  row?: RecordData;
};

/** The fields the server accepts for an operation; client bookkeeping is stripped. */
export type WireOperation = Pick<
  QueuedOperation,
  'id' | 'record' | 'kind' | 'data' | 'version' | 'deleted'
>;
export function wireOperation(op: QueuedOperation): WireOperation {
  const wire: WireOperation = {
    id: op.id,
    record: op.record,
    kind: op.kind,
    data: op.data,
    version: op.version,
  };
  if (op.deleted) wire.deleted = true;
  return wire;
}

// Only acknowledgement removes an operation. A transport failure keeps exactly the same ID.
export async function drain<R>(
  queue: QueuedOperation[],
  send: (op: QueuedOperation) => Promise<R>,
  ack: (op: QueuedOperation, result: R) => void,
  online: () => boolean,
) {
  while (queue.length && online()) {
    const op = queue[0];
    const result = await send(op);
    if (queue[0]?.id !== op.id) throw new Error('Shopping context changed during sync');
    queue.shift();
    ack(op, result);
  }
}

/**
 * Like `drain`, but the queue lives outside this function (for example in storage shared by
 * several tabs): `head()` is asked for the next operation before every send, so operations
 * added or collapsed meanwhile are picked up. `ack` must remove the operation it is given.
 * Stops when the queue is empty, the device is offline, or `head()` keeps returning an
 * operation that was already acknowledged (a storage failure), and rethrows send failures.
 */
export async function drainFrom<R>(
  head: () => QueuedOperation | undefined,
  send: (op: QueuedOperation) => Promise<R>,
  ack: (op: QueuedOperation, result: R) => void,
  online: () => boolean,
) {
  const done = new Set<string>();
  let sent = 0;
  for (let op = head(); op && online(); op = head()) {
    if (done.has(op.id)) break;
    const result = await send(op);
    done.add(op.id);
    ack(op, result);
    sent++;
  }
  return sent;
}

export function conflictDraft(queue: QueuedOperation[], op: QueuedOperation) {
  return [...queue].reverse().find((q) => q.record === op.record) || op;
}
// A refresh begun before a local edit must not replace that edit after its acknowledgement.
export function currentRefresh(
  start: { household: string; revision: number },
  household: string,
  revision: number,
  pending: number,
) {
  return start.household === household && start.revision === revision && pending === 0;
}
// A definitive rejection can be corrected without replaying obsolete versions of that record.
export function correctedQueue(
  queue: QueuedOperation[],
  record: string,
  data: OperationData,
  deleted = false,
  row?: RecordData,
) {
  const first = queue.find((q) => q.record === record);
  if (!first) return queue;
  return queue.flatMap((q) =>
    q.id === first.id
      ? [
          {
            ...q,
            id: crypto.randomUUID(),
            data,
            deleted,
            attempted: false,
            ...(row ? { row } : {}),
          },
        ]
      : q.record === record
        ? []
        : [q],
  );
}

/**
 * JSON equality that ignores key order and treats a missing key, `undefined` and `null` alike
 * (the server and client do not always spell an empty field the same way).
 */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)]))
    if (!sameJson(x[k], y[k])) return false;
  return true;
}

export type EnqueueResult = {
  queue: QueuedOperation[];
  /** Operations that left the queue (replaced or cancelled). */
  removed: QueuedOperation[];
  /** The operation that entered the queue, or null when the change cancelled out. */
  added: QueuedOperation | null;
};

/**
 * Queue a change, collapsing it into the latest unsent operation for the same record.
 *
 * - The merged operation keeps the earlier operation's position and expected version but gets
 *   the new operation's id, so a previously stored server receipt can never be replayed for
 *   different data.
 * - An operation already sent (`attempted`) is never rewritten, since the server may have
 *   applied it; the change is appended instead.
 * - A delete of a record whose create is still queued is appended rather than merged, so
 *   later queued operations that reference the record still find it.
 * - When `base` (the last server-acknowledged row) is given and the net change equals it, the
 *   operation is dropped entirely: checking then unchecking an item offline sends nothing.
 */
export function enqueue(
  queue: QueuedOperation[],
  op: QueuedOperation,
  base?: Pick<RecordData, 'kind' | 'data' | 'version' | 'deleted'> | null,
): EnqueueResult {
  let index = -1;
  for (let i = queue.length - 1; i >= 0; i--)
    if (queue[i].record === op.record) {
      index = i;
      break;
    }
  const prev = index >= 0 ? queue[index] : undefined;
  const collapsible =
    prev &&
    !prev.attempted &&
    prev.kind === op.kind &&
    !(prev.version === 0 && op.deleted && !prev.deleted);
  if (!prev || !collapsible) {
    const unchanged =
      !prev &&
      base &&
      base.version === op.version &&
      base.kind === op.kind &&
      !!base.deleted === !!op.deleted &&
      sameJson(base.data, op.data);
    if (unchanged) return { queue, removed: [], added: null };
    return { queue: [...queue, op], removed: [], added: op };
  }
  const merged: QueuedOperation = {
    ...op,
    version: prev.version,
    seq: prev.seq,
    attempted: false,
    // The optimistic row must carry the version the server will assign, so a later change
    // chained after this one expects the right version.
    ...(op.row ? { row: { ...op.row, version: prev.version + 1 } } : {}),
  };
  if (
    base &&
    base.version === merged.version &&
    base.kind === merged.kind &&
    !!base.deleted === !!merged.deleted &&
    sameJson(base.data, merged.data)
  )
    return { queue: queue.filter((_, i) => i !== index), removed: [prev], added: null };
  return {
    queue: queue.map((q, i) => (i === index ? merged : q)),
    removed: [prev],
    added: merged,
  };
}

/** Records that have at least one queued operation. */
export function pendingRecords(queue: QueuedOperation[]) {
  return new Set(queue.map((q) => q.record));
}
