import { toast } from 'sonner';
import { localDate } from '@/lib/nutrition';
import { withProductRef } from '@/lib/record-types';
import { Modal } from '../ui';
import { useApp } from '../state/context';

/** Record where and when an item was bought. */
export function ObservationModal() {
  const { s, modal, setModal, draft, setDraft, currency } = useApp();
  return (
    <Modal
      open={modal === 'observation'}
      onClose={() => setModal('')}
      title="Where did you find it?"
      description="A dated household report. This does not claim current stock."
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const { productId, price, ...fields } = draft;
          s.mutate(
            'observation',
            withProductRef(
              // An empty price is left out rather than sent as null (which would read as 0).
              { ...fields, ...(price != null && { price }), currency, user: s.user?.id },
              productId,
            ),
          );
          setModal('');
          toast.success('Purchase observation saved');
        }}
      >
        <label>
          Store name and place
          <input
            required
            value={draft.store || ''}
            onChange={(e) => setDraft({ ...draft, store: e.target.value })}
          />
        </label>
        <label>
          Purchase date
          <input
            required
            type="date"
            max={localDate()}
            value={draft.date || ''}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          />
        </label>
        <label>
          Observed price ({currency}) · optional
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.price ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, price: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
        </label>
        <button className="btn primary">Save observation</button>
      </form>
    </Modal>
  );
}
