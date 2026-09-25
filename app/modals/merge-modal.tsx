import { toast } from 'sonner';
import { Modal } from '../ui';
import { units } from '../state/helpers';
import { useApp } from '../state/context';

/** Resolve an add that may duplicate an existing list line. */
export function MergeModal() {
  const { s, merge, setMerge } = useApp();
  return (
    <Modal
      open={!!merge}
      onClose={() => setMerge(null)}
      title="Already on your list."
      description={
        merge?.combinable
          ? 'This looks like the same item. Would you like to combine quantities?'
          : 'Something with this name is already on the list. Add it anyway?'
      }
    >
      <p>
        {merge?.existing.data.name} · {merge?.existing.data.quantity}{' '}
        {units[merge?.existing.data.unit as keyof typeof units] || merge?.existing.data.unit}
      </p>
      <div className="row wrap">
        {merge?.combinable && (
          <button
            className="btn primary"
            onClick={() => {
              // Combine with the latest version of the line, not the one captured when prompted.
              const latest =
                s.currentRecords().find((r) => r.id === merge.existing.id) || merge.existing;
              s.mutate(
                'item',
                {
                  ...latest.data,
                  quantity: (latest.data.quantity || 0) + Number(merge.data.quantity),
                },
                latest,
              );
              setMerge(null);
              toast.success('Quantities combined');
            }}
          >
            Combine quantities
          </button>
        )}
        <button
          className={merge?.combinable ? 'btn' : 'btn primary'}
          onClick={() => {
            s.mutate('item', merge.data);
            setMerge(null);
            toast.success('Added to your list');
          }}
        >
          {merge?.combinable ? 'Keep separate' : 'Add anyway'}
        </button>
        <button className="btn" onClick={() => setMerge(null)}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
