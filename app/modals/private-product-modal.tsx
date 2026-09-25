import PhotoUpload from '../photo-upload';
import { toast } from 'sonner';
import { type Product, barcode, uid } from '@/lib/domain';
import { Choice, Modal } from '../ui';
import { NutritionFields } from '../nutrition-panel';
import { useApp } from '../state/context';

/** Create or edit a private, household-only product. */
export function PrivateProductModal() {
  const {
    s,
    hid,
    modal,
    setModal,
    draft,
    setDraft,
    privateEditing,
    busy,
    setBusy,
    add,
    setProduct,
  } = useApp();
  return (
    <Modal
      open={modal === 'private'}
      onClose={() => setModal('')}
      title="Not in the catalogue? Make it yours."
      description="Saved privately to this household. Nothing is published to Open Food Facts."
    >
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (draft.barcode && !barcode(draft.barcode).valid)
            return toast.error('Check the barcode digits.');
          const p: Product = {
            id: uid(),
            name: draft.name ?? '',
            brand: draft.brand || '',
            pack: draft.pack || '',
            barcode: draft.barcode ? barcode(draft.barcode).code : '',
            image: draft.image,
            ingredients: draft.ingredients || undefined,
            allergens: draft.allergensText
              ? draft.allergensText
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean)
              : undefined,
            traces: draft.tracesText
              ? draft.tracesText
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean)
              : undefined,
            nutrition: draft.nutrition || {},
            basis: draft.basis || '100g',
            categories: [],
            countries: [],
            source: 'User-entered · private household data',
            retrieved: Date.now(),
          };
          const saved = s.mutate('product', p, privateEditing);
          if (saved) {
            p.id = saved.id;
            if (!privateEditing)
              add({ product: p, name: p.name, pack: p.pack, notes: draft.notes || '' });
            else {
              setProduct(p);
              toast.success(
                'Private product updated. Existing recipes retain their saved version.',
              );
            }
            setModal(privateEditing ? 'product' : '');
          }
        }}
      >
        <label>
          Name
          <input
            required
            maxLength={160}
            value={draft.name || ''}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <div className="grid2">
          <label>
            Brand
            <input
              value={draft.brand || ''}
              onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
            />
          </label>
          <label>
            Pack size
            <input
              value={draft.pack || ''}
              onChange={(e) => setDraft({ ...draft, pack: e.target.value })}
            />
          </label>
        </div>
        <label>
          Barcode (optional)
          <input
            inputMode="numeric"
            value={draft.barcode || ''}
            onChange={(e) => setDraft({ ...draft, barcode: e.target.value })}
          />
        </label>
        <PhotoUpload
          household={hid ?? ''}
          demo={s.demo}
          onBusy={setBusy}
          value={draft.image}
          onChange={(image) => setDraft((d) => ({ ...d, image }))}
        />
        <label>
          Ingredients as printed on the label
          <textarea
            maxLength={6000}
            value={draft.ingredients || ''}
            onChange={(e) => setDraft({ ...draft, ingredients: e.target.value })}
          />
        </label>
        <div className="grid2">
          <label>
            Declared allergens · comma separated
            <input
              maxLength={500}
              value={draft.allergensText || ''}
              onChange={(e) => setDraft({ ...draft, allergensText: e.target.value })}
            />
          </label>
          <label>
            Declared traces · comma separated
            <input
              maxLength={500}
              value={draft.tracesText || ''}
              onChange={(e) => setDraft({ ...draft, tracesText: e.target.value })}
            />
          </label>
        </div>
        <Choice
          label="Label nutrition basis"
          value={draft.basis || '100g'}
          onChange={(basis) => setDraft({ ...draft, basis: basis === '100ml' ? '100ml' : '100g' })}
          options={{ '100g': 'Label values per 100 g', '100ml': 'Label values per 100 ml' }}
        />
        <NutritionFields
          value={draft.nutrition || {}}
          onChange={(nutrition) => setDraft({ ...draft, nutrition })}
        />
        <p className="fine">
          Copy explicit label values. Leave missing information blank; it does not confirm
          suitability.
        </p>
        <label>
          Note
          <input
            value={draft.notes || ''}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </label>
        <button disabled={busy} className="btn primary">
          {privateEditing ? 'Save private product' : 'Save private product & add to list'}
        </button>
      </form>
    </Modal>
  );
}
