import { ExternalLink, Heart, Loader2, MapPin, Plus } from 'lucide-react';
import { countries, barcode } from '@/lib/domain';
import { productRef } from '@/lib/record-types';
import { Modal, Photo } from '../ui';
import { ProductNutrition, IngredientReview } from '../nutrition-panel';
import { HealthPanel } from '../health-panel';
import { useApp } from '../state/context';

/** Product details, household feedback and add/save actions. */
export function ProductModal() {
  const {
    s,
    household,
    modal,
    setModal,
    setDraft,
    setPrivateEditing,
    active,
    memberName,
    openItem,
    add,
    saveFavourite,
    product,
    productLoading,
    productNotice,
    productStore,
    openProduct,
    closeProduct,
    destination,
  } = useApp();
  return (
    <Modal
      open={modal === 'product'}
      onClose={closeProduct}
      title={product?.name || 'Product details'}
      description={product?.source || 'Product information'}
      wide
    >
      {product && (
        <div className="stack">
          <div className="product-detail-heading">
            <Photo product={product} large />
            <div>
              <span className="eyebrow">
                {product.brand
                  ?.split(',')
                  .map((v) => v.trim())
                  .filter(Boolean)
                  .slice(0, 2)
                  .join(' · ')}
              </span>
              <p>{product.pack || 'Pack size not recorded'}</p>
              <span className="pill">
                {product.barcode ||
                  (product.source === 'Open Food Facts' || product.retailer
                    ? 'Source record · standard barcode unknown'
                    : 'Private product')}
              </span>
              {productStore && (
                <p className="selected-product-store">
                  <MapPin size={15} />
                  {productStore}
                </p>
              )}
            </div>
          </div>
          {productLoading && (
            <p className="notice row" role="status">
              <Loader2 className="spin" size={18} /> Checking full product details…
            </p>
          )}
          {productNotice && (
            <p className="notice" role="status">
              {productNotice}
            </p>
          )}
          {product.source === 'Open Food Facts' && product.barcode && !s.demo && (
            <button
              className="link"
              disabled={productLoading}
              onClick={() => void openProduct(product, productStore)}
            >
              Refresh product details
            </button>
          )}
          {product.barcode && barcode(product.barcode).local && (
            <p className="notice">
              This may be a retailer-specific or variable-weight code. Confirm the product and store
              context.
            </p>
          )}
          <div className="row wrap product-actions">
            <button
              className="btn primary"
              disabled={productLoading}
              onClick={() => {
                add({
                  product,
                  name: product.name,
                  pack: product.pack,
                  store: productStore || active?.data.store,
                });
                setModal('');
              }}
            >
              <Plus size={18} /> Add to {active?.data.name || 'list'}
            </button>
            <button
              className="btn"
              disabled={productLoading}
              onClick={() =>
                saveFavourite({
                  product,
                  name: product.name,
                  pack: product.pack,
                  quantity: 1,
                  unit: 'pack',
                })
              }
            >
              <Heart size={18} /> Save favourite
            </button>
            <button
              className="btn"
              disabled={productLoading}
              onClick={() =>
                openItem({
                  product,
                  name: product.name,
                  pack: product.pack,
                  store: productStore || active?.data.store,
                })
              }
            >
              Add with a note
            </button>
          </div>
          {s.records.some((r) => r.kind === 'product' && r.id === product.id) && (
            <button
              className="btn"
              onClick={() => {
                const r = s.records.find((r) => r.kind === 'product' && r.id === product.id)!;
                setPrivateEditing(r);
                setDraft({
                  ...r.data,
                  allergensText: r.data.allergens?.join(', ') || '',
                  tracesText: r.data.traces?.join(', ') || '',
                });
                setModal('private');
              }}
            >
              Edit private product
            </button>
          )}
          {product.evidence && (
            <p className="notice">
              {product.evidence === 'indexed-link'
                ? 'This entry comes from an indexed retailer page title. The product details and current assortment have not been verified. Open the retailer page to check.'
                : 'Details were extracted from a public retailer product page on the date shown below. Current branch stock is unknown.'}
            </p>
          )}
          {product.nutritionNote && <p className="fine">{product.nutritionNote}</p>}
          <HealthPanel
            product={product}
            demo={s.demo}
            household={household?.id}
            onOpen={(p) => void openProduct(p)}
          />
          <section>
            <h3>Ingredients</h3>
            <p className="muted">
              {product.ingredients || 'Ingredients are not recorded. Check the package.'}
            </p>
            <div className="grid2">
              <div>
                <strong>Declared allergens</strong>
                <p>
                  {product.allergens
                    ? product.allergens.length
                      ? product.allergens.map((a) => a.replace(/^en:/, '')).join(', ')
                      : 'None in the catalogue declaration'
                    : 'Not recorded'}
                </p>
              </div>
              <div>
                <strong>Declared traces</strong>
                <p>
                  {product.traces
                    ? product.traces.length
                      ? product.traces.map((a) => a.replace(/^en:/, '')).join(', ')
                      : 'None in the catalogue declaration'
                    : 'Not recorded'}
                </p>
              </div>
            </div>
            <p className="notice">
              Missing information is not confirmation of suitability. Check the current package
              label, especially for allergies.
            </p>
          </section>
          <ProductNutrition product={product} />
          <IngredientReview
            product={product}
            constraints={[
              ...(household?.settings.constraints || []),
              ...(s.user?.preferences?.constraints || []),
            ]}
          />
          <p className="fine">
            Applying household requirements and {s.user?.name}’s personal preferences.
          </p>
          <section>
            <h3>Retailer evidence</h3>
            <p className="muted">
              {product.stores?.length
                ? product.stores.join(', ')
                : 'Retailer tags are not recorded'}
              . Community catalogue tags do not establish current branch stock.
            </p>
          </section>
          <section>
            <h3>Country records</h3>
            <p className="muted">
              {product.countries.length
                ? product.countries
                    .map((c) => c.replace(/^en:/, '').replaceAll('-', ' '))
                    .join(', ')
                : 'No countries recorded'}
              . These records do not establish current availability.
            </p>
          </section>
          <section>
            <h3>What does your family think?</h3>
            <div className="row wrap">
              {['Like', 'Dislike', 'Would buy again', 'Not a suitable substitute'].map((v) => (
                <button
                  key={v}
                  className="btn"
                  onClick={() => {
                    setDraft({ productId: product.id, feedback: v, reason: '' });
                    setModal('feedback');
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
            {s.records
              .filter((r) => r.kind === 'feedback' && productRef(r.data) === product.id)
              .map((r) => (
                <p className="fine" key={r.id}>
                  {memberName(r.data.user)}: {r.data.feedback}
                  {r.data.reason ? ' — ' + r.data.reason : ''}
                </p>
              ))}
          </section>
          <p className="source-note">
            {product.sourceUrl ? (
              <a href={product.sourceUrl} target="_blank" rel="noreferrer">
                View nutrition & product source
              </a>
            ) : (
              product.source
            )}{' '}
            · Retrieved {new Date(product.retrieved).toLocaleDateString()}.
            {product.sourceUpdated && (
              <> Source updated {new Date(product.sourceUpdated).toLocaleDateString()}.</>
            )}
            {product.indexedAt && (
              <>
                {' '}
                Search index dated {product.indexedAt.slice(0, 10)}; check the package for current
                details.
              </>
            )}{' '}
            <button className="link" onClick={() => setModal('about')}>
              Licensing
            </button>
          </p>
          <a
            className="btn"
            href={
              'https://www.google.com/search?q=' +
              encodeURIComponent(product.name + ' ' + (countries[destination] || ''))
            }
            target="_blank"
            rel="noreferrer"
          >
            Search the web for this product <ExternalLink size={16} />
          </a>
        </div>
      )}
    </Modal>
  );
}
