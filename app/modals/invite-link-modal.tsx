import { Copy, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '../ui';
import { useApp } from '../state/context';

/** Copy or share a newly created invitation link. */
export function InviteLinkModal() {
  const { modal, setModal, inviteUrl } = useApp();
  return (
    <Modal
      open={modal === 'invite'}
      onClose={() => setModal('')}
      title="Good things are shared."
      description="Give this single-use link to one person. They need Site access and must sign in with ChatGPT. It expires in 7 days."
    >
      <div className="notice">
        <strong>First, give your family member Site access.</strong>
        <p>
          The Site owner must add them using this Site’s sharing controls in ChatGPT. A household
          invitation does not grant Site access. Ask them to open the Site before sending this
          household link.
        </p>
        <p>
          If they see “Access denied” before Same Again opens, contact the Site owner. An expired
          household link can be replaced here.
        </p>
      </div>
      <label>
        Private invitation
        <input readOnly value={inviteUrl} />
      </label>
      <div className="row">
        <button
          className="btn primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(inviteUrl);
              toast.success('Invitation copied');
            } catch {
              toast('Select and copy the invitation link above.');
            }
          }}
        >
          <Copy size={17} /> Copy link
        </button>
        {typeof navigator !== 'undefined' && !!navigator.share && (
          <button
            className="btn"
            onClick={() =>
              navigator
                .share({ title: 'Join our Same Again household', url: inviteUrl })
                .catch(() => {})
            }
          >
            <Share2 size={17} /> Share
          </button>
        )}
      </div>
    </Modal>
  );
}
