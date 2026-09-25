import { Modal } from '../ui';
import { useApp } from '../state/context';

/** Create a single-use invitation for a sign-in email. */
export function InvitePersonModal() {
  const { modal, setModal, draft, setDraft, busy, setInviteUrl, act } = useApp();
  return (
    <Modal
      open={modal === 'invitePerson'}
      onClose={() => setModal('')}
      title="Invite a family member"
      description="Their Site access and household membership are separate. Both are needed."
    >
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act('invite', { email: draft.email }, 'Invitation created');
          if (r) {
            setInviteUrl(window.location.origin + '/?invite=' + r.token);
            setModal('invite');
          }
        }}
      >
        <label>
          Their ChatGPT sign-in email
          <input
            type="email"
            required
            maxLength={254}
            value={draft.email || ''}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          />
        </label>
        <ol>
          <li>
            The Site owner adds this email as a viewer in the Site’s sharing controls in ChatGPT.
          </li>
          <li>
            Create and send the household link below. Only this signed-in email can accept it.
          </li>
        </ol>
        <p className="fine">
          Creating this link does not send an email or grant Site access. Existing household data
          stays restricted to household members.
        </p>
        <button disabled={busy} className="btn primary">
          Create private household invitation
        </button>
      </form>
    </Modal>
  );
}
