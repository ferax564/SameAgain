import { Choice, Modal } from '../ui';
import { substitutions } from '../state/helpers';
import { useApp } from '../state/context';

/** Edit or remove a household favourite. */
export function FavouriteModal() {
  const { s, modal, setModal, draft, setDraft, editing, remove } = useApp();
  return (
    <Modal open={modal === 'favourite'} onClose={() => setModal('')} title="Remember it your way.">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          s.mutate('favourite', draft, editing);
          setModal('');
        }}
      >
        <label>
          Usual quantity
          <input
            required
            type="number"
            min="0.01"
            step="any"
            value={draft.quantity === null ? '' : (draft.quantity ?? 1)}
            onChange={(e) =>
              // Keep an empty or partial entry (0, 0.) while typing; the form requires a value.
              setDraft({
                ...draft,
                quantity: e.target.value === '' ? null : Number(e.target.value),
              })
            }
          />
        </label>
        <label>
          Preferred variant & notes
          <textarea
            value={draft.notes || ''}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </label>
        <label>
          Substitution preference
          <Choice
            label="Favourite substitution preference"
            value={draft.substitution || 'similar'}
            options={substitutions}
            onChange={(v) => setDraft({ ...draft, substitution: v })}
          />
        </label>
        <div className="row between">
          <button
            className="btn"
            type="button"
            onClick={() => {
              if (editing) remove(editing);
            }}
          >
            Remove favourite
          </button>
          <button className="btn primary">Save favourite</button>
        </div>
      </form>
    </Modal>
  );
}
