import { AboutModal } from './about-modal';
import { ArchivesModal } from './archives-modal';
import { ConfirmDialog } from './confirm-dialog';
import { ConflictModal } from './conflict-modal';
import { FavouriteModal } from './favourite-modal';
import { FeedbackModal } from './feedback-modal';
import { HistoryModal } from './history-modal';
import { InviteLinkModal } from './invite-link-modal';
import { InvitePersonModal } from './invite-person-modal';
import { ItemEditorModal } from './item-editor-modal';
import { JoinModal } from './join-modal';
import { ListFormModal } from './list-form-modal';
import { MergeModal } from './merge-modal';
import { ObservationModal } from './observation-modal';
import { PreferencesModal } from './preferences-modal';
import { PrivateProductModal } from './private-product-modal';
import { ProductModal } from './product-modal';
import { ReceiptModal } from './receipt-modal';
import { ScannerModal } from './scanner-modal';
import { TranslateModal } from './translate-modal';

/** Every dialog of the app. Each one opens when the shared `modal` state names it. */
export function ModalHost() {
  return (
    <>
      <ItemEditorModal />
      <ReceiptModal />
      <ScannerModal />
      <ProductModal />
      <PrivateProductModal />
      <TranslateModal />
      <ListFormModal />
      <JoinModal />
      <InvitePersonModal />
      <InviteLinkModal />
      <ArchivesModal />
      <HistoryModal />
      <FavouriteModal />
      <FeedbackModal />
      <ObservationModal />
      <PreferencesModal />
      <AboutModal />
      <MergeModal />
      <ConflictModal />
      <ConfirmDialog />
    </>
  );
}
