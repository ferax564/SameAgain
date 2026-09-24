export type QueuedOperation = {
  id: string;
  record: string;
  kind: string;
  data: any;
  version: number;
  deleted?: boolean;
};
// Only acknowledgement removes an operation. A transport failure keeps exactly the same ID.
export async function drain(
  queue: QueuedOperation[],
  send: (op: QueuedOperation) => Promise<any>,
  ack: (op: QueuedOperation, result: any) => void,
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
  data: any,
  deleted = false,
) {
  const first = queue.find((q) => q.record === record);
  if (!first) return queue;
  return queue.flatMap((q) =>
    q.id === first.id
      ? [{ ...q, id: crypto.randomUUID(), data, deleted }]
      : q.record === record
        ? []
        : [q],
  );
}
