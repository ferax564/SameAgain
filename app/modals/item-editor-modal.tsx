import PhotoUpload from '../photo-upload';
import { Check, Plus, Trash2 } from 'lucide-react';
import { Choice, Modal } from '../ui';
import { priceLabel, substitutions, units } from '../state/helpers';
import { useApp } from '../state/context';

/** Add or edit a shopping-list item. */
export function ItemEditorModal() {
  const {
    s,
    hid,
    modal,
    setModal,
    draft,
    setDraft,
    editing,
    photoBusy,
    setPhotoBusy,
    lists,
    active,
    categories,
    currency,
    memberName,
    saveItem,
    remove,
  } = useApp();
  return (
    <Modal
      open={modal === 'item'}
      onClose={() => setModal('')}
      title={editing ? 'Make it just right' : 'Add something to the list'}
      wide
    >
      <form className="formgrid" onSubmit={saveItem}>
        <label className="full">
          Item name
          <input
            required
            maxLength={160}
            value={draft.name || ''}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label>
          Quantity
          <input
            required
            type="number"
            min="0.01"
            max="10000"
            step="any"
            value={draft.quantity || 1}
            onChange={(e) => setDraft({ ...draft, quantity: Number(e.target.value) })}
          />
        </label>
        <label>
          Unit
          <Choice
            label="Unit"
            value={draft.unit || 'pack'}
            onChange={(v) => setDraft({ ...draft, unit: v })}
            options={units}
          />
        </label>
        <label>
          Pack size
          <input
            placeholder="e.g. 500 g"
            value={draft.pack || ''}
            onChange={(e) => setDraft({ ...draft, pack: e.target.value })}
          />
        </label>
        <label>
          Category
          <input
            list="categories"
            value={draft.category || ''}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          />
          <datalist id="categories">
            {categories.map((c: string) => (
              <option key={c}>{c}</option>
            ))}
          </datalist>
        </label>
        <details className="item-photo-editor full">
          <summary>
            <Plus size={16} /> {draft.image ? 'Change household photo' : 'Add a household photo'}
          </summary>
          <PhotoUpload
            household={hid ?? ''}
            demo={s.demo}
            value={draft.image}
            onChange={(image) => setDraft((d) => ({ ...d, image }))}
            onBusy={setPhotoBusy}
          />
          <p className="fine">
            Your photo stays with this item and repeat purchases. Catalogue photos and facts stay
            separate.
          </p>
        </details>
        <label className="full">
          A note for your shopper
          <textarea
            rows={2}
            maxLength={800}
            placeholder="The unsweetened one…"
            value={draft.notes || ''}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </label>
        <label>
          Shopping list
          <Choice
            label="Shopping list"
            value={draft.list || active?.id || ''}
            onChange={(v) => setDraft({ ...draft, list: v })}
            options={Object.fromEntries(lists.map((l) => [l.id, l.data.name ?? '']))}
          />
        </label>
        <label>
          Assigned shopper
          <Choice
            label="Assigned shopper"
            value={draft.assigned || ''}
            onChange={(v) => setDraft({ ...draft, assigned: v })}
            options={{
              '': 'Anyone',
              ...Object.fromEntries(s.members.map((m) => [m.user, m.name])),
            }}
          />
        </label>
        <label>
          Substitution preference
          <Choice
            label="Substitution preference"
            value={draft.substitution || 'similar'}
            onChange={(v) => setDraft({ ...draft, substitution: v })}
            options={substitutions}
          />
        </label>
        <label>
          Intended for
          <Choice
            label="Intended for"
            value={draft.intendedFor || ''}
            onChange={(v) => setDraft({ ...draft, intendedFor: v })}
            options={{
              '': 'Household + my preferences',
              ...Object.fromEntries(s.members.map((m) => [m.user, m.name])),
            }}
          />
        </label>
        <label>
          Preferred store
          <input
            value={draft.store || ''}
            onChange={(e) => setDraft({ ...draft, store: e.target.value })}
          />
        </label>
        <label>
          Priority
          <Choice
            label="Priority"
            value={draft.priority || 'normal'}
            onChange={(v) => setDraft({ ...draft, priority: v })}
            options={{ normal: 'Normal', high: 'Important' }}
          />
        </label>
        <label>
          Estimated price {priceLabel(draft.unit)} ({currency})
          <input
            type="number"
            step="0.01"
            min="0"
            value={draft.price ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, price: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
        </label>
        <label>
          Actual price {priceLabel(draft.unit)} ({currency})
          <input
            type="number"
            step="0.01"
            min="0"
            value={draft.actualPrice ?? ''}
            onChange={(e) =>
              setDraft({
                ...draft,
                actualPrice: e.target.value === '' ? null : Number(e.target.value),
              })
            }
          />
        </label>
        {draft.receipt && (
          <p className="notice full">
            From a reviewed receipt · {draft.receipt.store || 'Store not recorded'}
            {draft.receipt.date ? ' · ' + draft.receipt.date : ''}.{' '}
            {draft.receipt.lineTotal != null
              ? 'Past line total: ' +
                draft.receipt.lineTotal.toFixed(2) +
                ' ' +
                draft.receipt.currency +
                '. '
              : ''}
            Receipt descriptions are not verified product identities or current prices.
          </p>
        )}
        {editing && (
          <p className="fine full">
            Added by {memberName(editing.createdBy)} · {new Date(editing.created).toLocaleString()}.
            Last updated {new Date(editing.updated).toLocaleString()}.
          </p>
        )}
        <div className="full row between">
          {editing ? (
            <button
              type="button"
              className="iconbtn danger"
              aria-label="Delete item"
              onClick={() => remove(editing)}
            >
              <Trash2 size={20} />
            </button>
          ) : (
            <span />
          )}
          <button className="btn primary" type="submit" disabled={photoBusy}>
            {editing ? 'Save changes' : 'Add to list'} <Check size={18} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
