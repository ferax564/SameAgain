import { Modal } from '../ui';
import { useApp } from '../state/context';

/** Restore archived lists. */
export function ArchivesModal() {
  const { s, setSelected, modal, setModal, nav } = useApp();
  return (
    <Modal open={modal === 'archives'} onClose={() => setModal('')} title="Archived lists">
      <div className="stack">
        {s.records
          .filter((r) => r.kind === 'list' && r.data.archived)
          .map((r) => (
            <div className="row between" key={r.id}>
              <strong>{r.data.name}</strong>
              <button
                className="btn"
                onClick={() => {
                  s.mutate('list', { ...r.data, archived: false }, r);
                  setSelected(r.id);
                  setModal('');
                  nav('lists');
                }}
              >
                Restore list
              </button>
            </div>
          ))}
        {!s.records.some((r) => r.kind === 'list' && r.data.archived) && <p>No archived lists.</p>}
      </div>
    </Modal>
  );
}
