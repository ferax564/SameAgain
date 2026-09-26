import { toast } from 'sonner';
import { Users } from 'lucide-react';
import { Modal } from '../ui';
import { useApp } from '../state/context';

/** Join a household with an invitation link or code. */
export function JoinModal() {
  const { s, modal, setModal, draft, setDraft, busy, act } = useApp();
  return (
    <Modal
      open={modal === 'join'}
      onClose={() => setModal('')}
      title="There's room for you."
      description="Join with a secure invitation from a household administrator."
    >
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          let token: string | null | undefined = draft.token?.trim();
          try {
            if (token?.startsWith('http')) token = new URL(token).searchParams.get('invite');
          } catch {}
          if (!token) {
            toast.error('This link has no invitation code. Paste the full invitation link.');
            return;
          }
          const r = await act('join', { token }, 'Welcome to the household');
          if (r) {
            s.exitDemo();
            s.switchHousehold(r.household ?? '');
            setModal('');
            history.replaceState({}, '', window.location.pathname);
          }
        }}
      >
        <p className="fine">
          If another person cannot open Same Again, its owner needs to grant them Site access first.
          This household link cannot change that permission.
        </p>
        <label>
          Invitation link or code
          <textarea
            required
            value={draft.token || ''}
            onChange={(e) => setDraft({ ...draft, token: e.target.value })}
          />
        </label>
        {s.realUser ? (
          <button className="btn primary" disabled={busy}>
            Join household <Users size={18} />
          </button>
        ) : (
          <a
            className="btn primary"
            href={
              '/signin-with-chatgpt?return_to=' +
              encodeURIComponent('/?invite=' + encodeURIComponent(draft.token || ''))
            }
            target="_top"
          >
            Sign in to join
          </a>
        )}
      </form>
    </Modal>
  );
}
