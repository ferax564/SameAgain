import { toast } from 'sonner';
import { countries } from '@/lib/domain';
import { Choice, Modal } from '../ui';
import { useApp } from '../state/context';

/** Household settings or personal preferences, with requirements. */
export function PreferencesModal() {
  const { household, modal, setModal, draft, setDraft, busy, act } = useApp();
  return (
    <Modal
      open={modal === 'settings' || modal === 'profile'}
      onClose={() => setModal('')}
      title={modal === 'settings' ? 'For the household.' : 'Just your preferences.'}
      description="Optional and editable. Missing catalogue data never proves that a product meets a requirement."
    >
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const constraints = (draft.constraintsText || '')
            .split('\n')
            .filter((x: string) => x.trim())
            .map((line: string) => {
              const [kind, ...value] = line.split(':');
              return { kind: kind.trim(), value: value.join(':').trim() };
            });
          if (
            constraints.some(
              (c) =>
                !['preference', 'exclusion', 'allergy', 'certification'].includes(c.kind) ||
                !c.value,
            )
          )
            return toast.error('Use one requirement per line, such as allergy: milk');
          const { name, categoriesText, ...rest } = draft;
          delete rest.constraintsText;
          if (modal === 'settings' && categoriesText !== undefined)
            rest.categories = categoriesText
              .split(',')
              .map((v: string) => v.trim())
              .filter(Boolean);
          const r = await act(
            modal === 'settings' ? 'settings' : 'profile',
            modal === 'settings'
              ? { name, settings: { ...rest, constraints } }
              : { name, preferences: { ...rest, constraints } },
            'Preferences saved',
          );
          if (r) setModal('');
        }}
      >
        <label>
          {modal === 'settings' ? 'Household name' : 'Your display name'}
          <input
            required
            maxLength={80}
            value={draft.name || ''}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        {modal === 'settings' && (
          <label>
            Usual shopping country
            <Choice
              label="Usual country"
              options={countries}
              value={draft.country || 'IT'}
              onChange={(v) => setDraft({ ...draft, country: v })}
            />
          </label>
        )}
        {modal === 'settings' && (
          <label>
            Household categories · comma separated
            <textarea
              value={draft.categoriesText ?? (draft.categories || []).join(', ')}
              onChange={(e) => setDraft({ ...draft, categoriesText: e.target.value })}
            />
          </label>
        )}
        <label>
          Preferences and requirements
          <textarea
            rows={5}
            value={draft.constraintsText || ''}
            placeholder={
              'preference: organic\nexclusion: palm oil\nallergy: milk\ncertification: gluten-free'
            }
            onChange={(e) => setDraft({ ...draft, constraintsText: e.target.value })}
          />
        </label>
        <p className="fine">
          One per line: preference, exclusion, allergy or certification, followed by a colon and the
          ingredient or label. Use English catalogue terms. Free-text matching is conservative and
          cannot establish allergy safety. Always check the package.
        </p>
        <button
          disabled={
            busy || (modal === 'settings' && !['owner', 'admin'].includes(household?.role ?? ''))
          }
          className="btn primary"
        >
          Save preferences
        </button>
      </form>
    </Modal>
  );
}
