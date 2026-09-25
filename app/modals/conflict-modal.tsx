import { Modal } from '../ui';
import { useApp } from '../state/context';

/** Review a sync conflict between a pending change and the shared version. */
export function ConflictModal() {
  const { s } = useApp();
  return (
    <Modal
      open={!!s.conflict}
      onClose={() => {}}
      dismissible={false}
      title="Two shoppers, one change."
      description="Someone updated this item while your change was waiting. Review both versions before deciding."
    >
      <div className="grid2">
        <div>
          <h3>Your pending change</h3>
          <p>{s.conflict?.op.data.name}</p>
          <p>
            {s.conflict?.op.data.quantity} {s.conflict?.op.data.unit} ·{' '}
            {s.conflict?.op.data.done ? 'Purchased' : 'Outstanding'}
          </p>
          <p>{s.conflict?.op.data.notes}</p>
          {s.conflict?.op.kind !== 'item' && (
            <pre className="conflict-data">{JSON.stringify(s.conflict?.op.data, null, 2)}</pre>
          )}
        </div>
        <div>
          <h3>Latest shared version</h3>
          <p>{s.conflict?.latest?.data.name}</p>
          <p>
            {s.conflict?.latest?.data.quantity} {s.conflict?.latest?.data.unit} ·{' '}
            {s.conflict?.latest?.data.done ? 'Purchased' : 'Outstanding'}
          </p>
          <p>{s.conflict?.latest?.data.notes}</p>
          {s.conflict?.op.kind !== 'item' && (
            <pre className="conflict-data">{JSON.stringify(s.conflict?.latest?.data, null, 2)}</pre>
          )}
        </div>
      </div>
      <div className="row wrap">
        <button className="btn primary" onClick={() => s.resolve(false)}>
          Use shared version
        </button>
        <button className="btn" onClick={() => s.resolve(true)}>
          Apply my change after review
        </button>
      </div>
    </Modal>
  );
}
