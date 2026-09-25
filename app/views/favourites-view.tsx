import { Heart, Plus, ScanBarcode, Settings2 } from 'lucide-react';
import { countries } from '@/lib/domain';
import { Photo } from '../ui';
import { useApp } from '../state/context';

/** Household favourites and the substitutes approved for other countries. */
export function FavouritesView() {
  const { s, favourites, setModal, nav, openProduct, setDraft, setEditing, add } = useApp();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE ONES WORTH REMEMBERING</span>
          <h1>Your family favourites.</h1>
          <p className="muted">
            The right brand. The right variant. That note you don’t want to forget.
          </p>
        </div>
        <button className="btn primary" onClick={() => setModal('scanner')}>
          <ScanBarcode size={18} /> Scan a favourite
        </button>
      </div>
      {!favourites.length ? (
        <div className="empty card">
          <Heart size={38} />
          <h3>Start with something you love.</h3>
          <p>Scan or search for a product and save it here.</p>
          <button className="btn" onClick={() => nav('discover')}>
            Discover products
          </button>
        </div>
      ) : (
        <div className="product-grid">
          {favourites.map((f) => (
            <article className="product-card favourite-card" key={f.id}>
              <button
                className="product-open"
                onClick={() => {
                  if (f.data.product) void openProduct(f.data.product);
                }}
              >
                <Photo
                  product={{
                    ...f.data.product,
                    image: f.data.image || f.data.product?.image,
                  }}
                  large
                />
                <span className="eyebrow">
                  {f.data.product?.brand?.split(',')[0] || 'YOUR HOUSEHOLD'}
                </span>
                <h3>{f.data.name}</h3>
              </button>
              <p className="muted">
                Usually {f.data.quantity || 1} {f.data.unit || 'pack'} ·{' '}
                {f.data.pack || 'Pack not recorded'}
              </p>
              {f.data.notes && <p className="favourite-note">“{f.data.notes}”</p>}
              <div className="row between">
                <button
                  className="iconbtn"
                  aria-label={'Edit favourite ' + f.data.name}
                  onClick={() => {
                    setDraft(f.data);
                    setEditing(f);
                    setModal('favourite');
                  }}
                >
                  <Settings2 size={18} />
                </button>
                <button className="btn primary" onClick={() => add(f.data, undefined, true)}>
                  <Plus size={17} /> Same again
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <section className="section-title">
        <h2>Remembered abroad</h2>
        <p className="muted">Substitutes your household approved for a specific country.</p>
      </section>
      <div className="grid2">
        {s.records
          .filter((r) => r.kind === 'substitution')
          .map((r) => (
            <article className="card row" key={r.id}>
              <Photo product={r.data.product} />
              <div>
                <strong>{r.data.product?.name}</strong>
                <p className="muted">
                  {countries[r.data.country ?? '']} · {r.data.reason}
                </p>
              </div>
              <button
                className="iconbtn"
                aria-label="Add accepted alternative"
                onClick={() =>
                  add({
                    product: r.data.product,
                    name: r.data.product?.name,
                    pack: r.data.product?.pack,
                  })
                }
              >
                <Plus />
              </button>
            </article>
          ))}
      </div>
    </>
  );
}
