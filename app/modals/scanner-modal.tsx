import Scanner from '../scanner';
import { Modal } from '../ui';
import { ErrorBoundary } from '../error-boundary';
import { useApp } from '../state/context';

/** Barcode scanner: look up a product or start a private one. */
export function ScannerModal() {
  const { modal, setModal, openPrivate, search } = useApp();
  return (
    <Modal
      open={modal === 'scanner'}
      onClose={() => setModal('')}
      title="Scan your usual."
      description="One scan. Exactly the right product."
    >
      <ErrorBoundary name="Scanner">
        <Scanner
          onCode={(code) => search(code)}
          onPrivate={(code) => openPrivate({ barcode: code, name: '', brand: '', pack: '' })}
        />
      </ErrorBoundary>
    </Modal>
  );
}
