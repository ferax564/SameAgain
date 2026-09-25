import { toast } from 'sonner';
import { withProductRef } from '@/lib/record-types';
import { Modal } from '../ui';
import { useApp } from '../state/context';

/** A member's personal feedback on a product. */
export function FeedbackModal() {
  const { s, modal, setModal, draft, setDraft } = useApp();
  return (
    <Modal
      open={modal === 'feedback'}
      onClose={() => setModal('')}
      title={draft.feedback || 'Your feedback'}
      description="This is your personal opinion. It won't become a restriction for everyone."
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const { productId, ...fields } = draft;
          s.mutate('feedback', withProductRef({ ...fields, user: s.user?.id }, productId));
          setModal('product');
          toast.success('Your feedback is saved');
        }}
      >
        <label>
          A short reason (optional)
          <textarea
            maxLength={500}
            value={draft.reason || ''}
            onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
          />
        </label>
        <button className="btn primary">Save my feedback</button>
      </form>
    </Modal>
  );
}
