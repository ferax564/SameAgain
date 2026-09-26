import { lazy } from 'react';
import { Modal } from '../ui';
import { ErrorBoundary } from '../error-boundary';
import { useApp } from '../state/context';
// Secondary areas load on demand so the shopping list starts faster.
const ReceiptScanner = lazy(() => import('../receipt-scanner'));

/** Scan a receipt and add its reviewed lines to a list. */
export function ReceiptModal() {
  const { s, household, hid, modal, setModal, lists, active, currency, addReceipt } = useApp();
  return (
    <Modal
      open={modal === 'receipt'}
      onClose={() => setModal('')}
      title="Buy it again, from a receipt."
      description="Scan, review, then add selected items to your shared list."
      wide
    >
      {modal === 'receipt' && household && (
        <ErrorBoundary name="Receipt scanner">
          <ReceiptScanner
            key={hid}
            lists={lists}
            active={active?.id || ''}
            country={household.settings.country || ''}
            currency={currency}
            demo={s.demo}
            onAdd={addReceipt}
          />
        </ErrorBoundary>
      )}
    </Modal>
  );
}
