import { ArrowRight } from 'lucide-react';
import { countries, countryCurrency } from '@/lib/domain';
import { Choice, Modal } from '../ui';
import { useApp } from '../state/context';

/** Create a household, create a list, or edit list settings. */
export function ListFormModal() {
  const {
    s,
    household,
    setSelected,
    modal,
    setModal,
    draft,
    setDraft,
    busy,
    active,
    currency,
    act,
  } = useApp();
  return (
    <Modal
      open={['create', 'list', 'listSettings'].includes(modal)}
      onClose={() => setModal('')}
      title={
        modal === 'create'
          ? 'A household starts here.'
          : modal === 'listSettings'
            ? 'List settings'
            : 'A new list, less to remember.'
      }
    >
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (modal === 'create') {
            const r = await act('createHousehold', draft, 'Your household is ready');
            if (r) {
              s.exitDemo();
              s.switchHousehold(r.household ?? '');
              setSelected('');
              setModal('');
            }
          } else if (modal === 'listSettings' && active) {
            const { categoryOrderText = '', ...fields } = draft;
            s.mutate(
              'list',
              {
                ...fields,
                categoryOrder: categoryOrderText
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean),
              },
              active,
            );
            setModal('');
          } else {
            const l = s.mutate('list', {
              ...draft,
              country: household?.settings.country,
              currency: draft.currency || currency,
            });
            if (l) setSelected(l.id);
            setModal('');
          }
        }}
      >
        <label>
          {modal === 'create' ? 'Household name' : 'List name'}
          <input
            autoFocus
            required
            maxLength={80}
            placeholder={modal === 'create' ? 'e.g. The Sunday household' : 'e.g. Weekend dinner'}
            value={draft.name || ''}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        {modal === 'create' && (
          <>
            <label>
              First list
              <input
                required
                value={draft.listName || ''}
                onChange={(e) => setDraft({ ...draft, listName: e.target.value })}
              />
            </label>
            <label>
              Usual shopping country · optional
              <Choice
                label="Usual shopping country"
                value={draft.country || 'IT'}
                onChange={(v) =>
                  setDraft({
                    ...draft,
                    country: v,
                    currency: countryCurrency(v),
                  })
                }
                options={countries}
              />
            </label>
          </>
        )}
        {modal !== 'create' && (
          <label>
            Preferred store · optional
            <input
              value={draft.store || ''}
              onChange={(e) => setDraft({ ...draft, store: e.target.value })}
            />
          </label>
        )}
        <label>
          Currency
          <Choice
            label="Currency"
            value={draft.currency || 'EUR'}
            onChange={(v) => setDraft({ ...draft, currency: v })}
            options={{
              EUR: 'EUR · Euro',
              USD: 'USD · US dollar',
              CHF: 'CHF · Swiss franc',
              GBP: 'GBP · Pound sterling',
              DKK: 'DKK · Danish krone',
              SEK: 'SEK · Swedish krona',
              NOK: 'NOK · Norwegian krone',
              PLN: 'PLN · Polish złoty',
              CZK: 'CZK · Czech koruna',
              HUF: 'HUF · Hungarian forint',
              RON: 'RON · Romanian leu',
              ISK: 'ISK · Icelandic króna',
            }}
          />
        </label>
        {modal === 'listSettings' && (
          <label>
            Category order, separated by commas
            <textarea
              value={draft.categoryOrderText || ''}
              onChange={(e) => setDraft({ ...draft, categoryOrderText: e.target.value })}
            />
            <span className="fine">Your own shopping order, not a verified store aisle map.</span>
          </label>
        )}
        <button className="btn primary" disabled={busy}>
          {modal === 'listSettings'
            ? 'Save settings'
            : 'Create ' + (modal === 'create' ? 'household' : 'list')}{' '}
          <ArrowRight size={18} />
        </button>
      </form>
    </Modal>
  );
}
