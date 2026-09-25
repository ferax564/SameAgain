import { lazy } from 'react';
import { Heart, Loader2, MapPin, Plus, ScanBarcode, Search } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { countries, countryTag } from '@/lib/domain';
import { demoProducts } from '@/lib/demo';
import { Choice, Photo } from '../ui';
import { useApp } from '../state/context';
// Secondary areas load on demand so the shopping list starts faster.
const StoreHub = lazy(() => import('../store-hub'));

/** Catalogue search, stores & offers and household purchase reports. */
export function DiscoverView() {
  const {
    s,
    active,
    busy,
    setModal,
    openItem,
    openPrivate,
    add,
    memberName,
    query,
    setSearch,
    searchCountry,
    changeSearchCountry,
    dietFilter,
    changeDietFilter,
    results,
    setResults,
    searched,
    setSearched,
    searchError,
    search,
    openProduct,
  } = useApp();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">FAMILIAR FINDS, WHEREVER YOU ARE</span>
          <h1>Find your next usual.</h1>
          <p className="muted">
            Discover exact products, compare alternatives and find places to look.
          </p>
        </div>
        <button className="btn primary" onClick={() => setModal('scanner')}>
          <ScanBarcode size={18} /> Scan a product
        </button>
      </div>
      <Tabs defaultValue="products">
        <TabsList className="view-tabs">
          <TabsTrigger value="products">Product catalogue</TabsTrigger>
          <TabsTrigger value="stores">Stores & offers</TabsTrigger>
        </TabsList>
        <TabsContent value="products">
          <form
            className="catalogue-search"
            onSubmit={(e) => {
              e.preventDefault();
              if (s.demo) {
                setResults(
                  demoProducts.filter(
                    (p) =>
                      (p.name + ' ' + p.brand + ' ' + p.barcode + ' ' + p.categories.join(' '))
                        .toLowerCase()
                        .includes(query.toLowerCase()) &&
                      (!searchCountry || p.countries.includes(countryTag(searchCountry))) &&
                      (!dietFilter || p.labels?.includes('en:' + dietFilter)),
                  ),
                );
                setSearched(true);
              } else void search();
            }}
          >
            <div className="search-input">
              <Search size={20} />
              <input
                aria-label="Search product names, brands or barcodes"
                placeholder="Product, brand or barcode"
                value={query}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Choice
              label="Catalogue country"
              value={searchCountry}
              onChange={changeSearchCountry}
              options={{ '': 'All countries', ...countries }}
            />
            <button className="btn primary" disabled={busy}>
              {busy ? <Loader2 className="spin" size={18} /> : 'Search'}
            </button>
          </form>
          <p className="fine">
            Search runs when you press Search. Results are cached to respect Open Food Facts’ public
            service.
          </p>
          <div style={{ maxWidth: 280, marginTop: 12 }}>
            <Choice
              label="Declared dietary label"
              value={dietFilter}
              onChange={changeDietFilter}
              options={{
                '': 'Any declared dietary label',
                vegan: 'Vegan label',
                vegetarian: 'Vegetarian label',
                'gluten-free': 'Gluten-free label',
                organic: 'Organic label',
              }}
            />
          </div>
          {searchError && (
            <p className="notice" role="alert">
              {searchError}
            </p>
          )}
          <div className="row wrap" style={{ marginTop: 16 }}>
            <button className="link" onClick={() => openItem({ name: query })}>
              Add a generic item
            </button>
            <button className="link" onClick={() => openPrivate({ name: query })}>
              Create a private product
            </button>
          </div>
          <div className="row between section-title">
            <h2>{searched ? 'Search results' : 'A few familiar faces'}</h2>
            <span className="pill">{s.demo ? 'Demo catalogue' : 'Source-labelled catalogue'}</span>
          </div>
          {searched && !results.length && !busy ? (
            <div className="empty card">
              <Search size={36} />
              <h3>{searchError ? 'No cached matches available.' : 'No products found.'}</h3>
              <p>Try a brand or barcode. Household essentials can always be added manually.</p>
              <button className="btn" onClick={() => openItem({ name: query })}>
                Add a generic item
              </button>
              <button className="btn" onClick={() => openPrivate({ name: query })}>
                Create private product
              </button>
            </div>
          ) : (
            <div className="product-grid">
              {(searched ? results : demoProducts).map((p) => (
                <article className="product-card" key={p.id}>
                  <button className="product-open" onClick={() => void openProduct(p)}>
                    <Photo product={p} large />
                    <span className="eyebrow">{p.brand?.split(',')[0]}</span>
                    <h3>{p.name}</h3>
                    <p className="muted">{p.pack || 'Pack size not recorded'}</p>
                  </button>
                  <div className="row between">
                    <button
                      className="iconbtn"
                      aria-label={'Review ' + p.name + ' to save as favourite'}
                      onClick={() => void openProduct(p)}
                    >
                      <Heart size={20} />
                    </button>
                    <button className="btn" onClick={() => void openProduct(p)}>
                      <Plus size={16} /> Review & add
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className="source-note">
            Community product data:{' '}
            <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">
              Open Food Facts
            </a>{' '}
            · ODbL 1.0. Its product images: CC BY-SA 3.0. Retailer imports have separate page
            sources; they are not licensed under ODbL.{' '}
            <button className="link" onClick={() => setModal('about')}>
              Sources & limitations
            </button>
          </p>
        </TabsContent>
        <TabsContent value="stores">
          <StoreHub
            s={s}
            active={active}
            onProduct={(p) => void openProduct(p)}
            onAdd={(d) =>
              d.product?.source === 'Open Food Facts'
                ? void openProduct(d.product, d.store)
                : add(d)
            }
          />
          <div className="section-title">
            <h2>Spotted by your household</h2>
            <p className="muted">Dated member reports, not verified stock or current prices.</p>
          </div>
          {s.records.filter((r) => r.kind === 'observation').length === 0 ? (
            <div className="empty card">Record where you bought an item from its list menu.</div>
          ) : (
            s.records
              .filter((r) => r.kind === 'observation')
              .map((r) => (
                <article className="card observation" key={r.id}>
                  <MapPin size={20} />
                  <div>
                    <h3>{r.data.name}</h3>
                    <p>
                      {r.data.store} · {r.data.date}
                    </p>
                    <small className="muted">
                      Reported by {memberName(r.createdBy)}
                      {typeof r.data.price === 'number'
                        ? ' · ' + r.data.price + ' ' + r.data.currency
                        : ''}
                      . Stock may have changed.
                    </small>
                  </div>
                </article>
              ))
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
