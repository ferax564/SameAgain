import { History, Repeat2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Modal, Photo } from '../ui';
import { useApp } from '../state/context';

/** Repeat items from a past trip or a saved template. */
export function HistoryModal() {
  const { modal, setModal, trips, templates, active, add, remove } = useApp();
  return (
    <Modal
      open={modal === 'history' || modal === 'templates'}
      onClose={() => setModal('')}
      title={modal === 'history' ? 'The good ones, again.' : 'A head start on your next list.'}
      description="Choose items to add to your active shopping list. Notes, exact products and quantities are preserved."
      wide
    >
      <div className="stack">
        {(modal === 'history' ? trips : templates).length === 0 ? (
          <div className="empty">
            <History size={36} />
            <p>
              {modal === 'history'
                ? 'Finish a shopping trip to find it here.'
                : 'Save a list as a template from its options menu.'}
            </p>
          </div>
        ) : (
          (modal === 'history' ? trips : templates).map((t) => (
            <form
              className="card stack"
              key={t.id}
              onSubmit={(e) => {
                e.preventDefault();
                const selectedItems = new FormData(e.currentTarget).getAll('repeat').map(Number);
                for (const i of selectedItems) {
                  const item = t.data.items?.[i];
                  if (item) add(item, undefined, true);
                }
                if (selectedItems.length) setModal('');
                else toast('Select at least one item.');
              }}
            >
              <div className="row between">
                <h3>{t.data.name}</h3>
                <span className="fine">
                  {new Date(t.data.date || t.created).toLocaleDateString()}
                </span>
              </div>
              {t.data.items?.map((item, i) => (
                <label className="row history-item" key={i}>
                  <Checkbox
                    name="repeat"
                    value={String(i)}
                    defaultChecked
                    className="history-check"
                  />
                  <Photo
                    product={{
                      ...item.product,
                      name: item.name,
                      image: item.image || item.product?.image,
                    }}
                  />
                  <span>
                    {item.name}
                    <small className="muted">
                      {item.quantity} {item.unit} · {item.notes || item.pack}
                    </small>
                  </span>
                </label>
              ))}
              {modal === 'templates' && (
                <button type="button" className="link danger" onClick={() => remove(t)}>
                  Delete template
                </button>
              )}
              <button className="btn primary">
                Add selected to {active?.data.name || 'active list'} <Repeat2 size={18} />
              </button>
            </form>
          ))
        )}
      </div>
    </Modal>
  );
}
