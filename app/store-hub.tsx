'use client';
import { useRef, useState } from 'react';
import { MapPin, Search, Plus, ExternalLink, Tag, ShoppingBasket } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useHousehold } from '@/lib/use-household';
import { retailers, recordedAt, retailerSearch, offerState, inferRetailer } from '@/lib/retailers';
import { countries, type Product, type RecordData, type RecordFields } from '@/lib/domain';
import { offerSchema } from '@/lib/meal-schema';
import { localDate } from '@/lib/nutrition';
import { isOfferRecord, productRef, type Offer } from '@/lib/record-types';
import { errorMessage } from '@/lib/utils';
import { Modal, Choice, Photo } from './ui';
import StoreFinder from './store-finder';
/** Current time for event handlers (kept out of render). */
const timestamp = () => Date.now();
/** The offer form: every field may still be blank, and the price is the raw input value. */
type OfferDraft = Partial<Omit<Offer, 'price'>> & { price?: number | string };
/** A shop to save: typed in by a member or chosen from a map listing. */
type ShopDraft = {
  name: string;
  address: string;
  sourceUrl?: string;
  placeId?: string;
  evidence?: 'map-listing' | 'household-entered';
};
/** Catalogue coverage summary returned with retailer searches. */
type Coverage = {
  coverageByRetailer?: Record<string, { records: number; withPhoto: number }>;
  records?: number;
  imported?: number;
  pageDetails?: number;
};
export default function StoreHub({
  s,
  active,
  onProduct,
  onAdd,
}: {
  s: ReturnType<typeof useHousehold>;
  active?: RecordData;
  onProduct: (p: Product) => void;
  onAdd: (d: RecordFields) => void;
}) {
  const initial =
    Object.keys(retailers).find((k) => retailers[k].country === s.household?.settings.country) ||
    'coop-ch';
  const [selected, setSelected] = useState(active?.data.retailer || initial),
    [query, setQuery] = useState(''),
    [results, setResults] = useState<Product[]>([]),
    [notice, setNotice] = useState(''),
    [searched, setSearched] = useState(false),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [offer, setOffer] = useState<OfferDraft>(),
    [editing, setEditing] = useState<RecordData>(),
    [shopDraft, setShopDraft] = useState<ShopDraft>(),
    [source, setSource] = useState('community'),
    [page, setPage] = useState(1),
    [hasMore, setHasMore] = useState(false),
    [coverage, setCoverage] = useState<Coverage>();
  const searchSerial = useRef(0);
  const retailer = retailers[selected] || retailers[initial];
  const shops = s.records.filter((r) => r.kind === 'shop' && r.data.retailer === selected),
    chosenShop = shops.find((r) => r.id === active?.data.shopId);
  const observations = s.records.filter((r) => r.kind === 'observation'),
    offers = s.records
      .filter(isOfferRecord)
      .filter((r) => r.data.retailer === selected)
      .sort((a, b) => b.updated - a.updated),
    items = s.records.filter(
      (r) => r.kind === 'item' && r.data.list === active?.id && !r.data.done,
    );
  async function search(nextPage = 1) {
    const attempt = ++searchSerial.current;
    setBusy(true);
    setFailed(false);
    setNotice('');
    setSearched(true);
    if (nextPage === 1) setResults([]);
    try {
      const imported = source === 'retailer' && ['coop-ch', 'migros-ch'].includes(selected);
      const r = await fetch(
        (s.demo
          ? '/api/demo-catalogue?'
          : imported
            ? '/api/retailer-catalogue?'
            : '/api/catalogue?') +
          new URLSearchParams({
            q: query,
            country: retailer.country,
            retailer: selected,
            household: s.household?.id ?? '',
            page: String(nextPage),
            source: imported ? 'retailer' : 'community',
          }),
        { signal: AbortSignal.timeout(25000) },
      );
      const d = await r.json();
      if (attempt !== searchSerial.current) return;
      if (!r.ok) throw new Error(d.error);
      setResults((old) =>
        nextPage === 1
          ? d.products
          : [...old, ...d.products.filter((p: Product) => !old.some((x) => x.id === p.id))],
      );
      setPage(nextPage);
      setHasMore(!!d.hasMore);
      setCoverage(d.coverage);
      setNotice(d.notice || '');
    } catch (e) {
      if (attempt === searchSerial.current) {
        setNotice(
          e instanceof Error && e.name === 'TimeoutError'
            ? 'The catalogue took too long. Retry your search.'
            : errorMessage(e),
        );
        setFailed(true);
      }
    } finally {
      if (attempt === searchSerial.current) setBusy(false);
    }
  }
  function chooseStore(name: string, sourceUrl?: string, shop?: RecordData) {
    if (!active) {
      toast.error('Create or select an active shopping list first.');
      return;
    }
    s.mutate(
      'list',
      {
        ...active.data,
        store: name,
        retailer: selected,
        shopId: shop?.id,
        storeEvidence: sourceUrl
          ? { sourceUrl, chosenAt: timestamp(), inventory: 'Unknown' }
          : undefined,
      },
      active,
    );
    toast.success('Preferred shop saved for ' + active.data.name);
  }
  function saveShop(d: ShopDraft) {
    const existing = s
      .currentRecords()
      .find(
        (r) =>
          r.kind === 'shop' &&
          r.data.retailer === selected &&
          (d.placeId
            ? r.data.placeId === d.placeId
            : r.data.name === d.name && r.data.address === d.address),
      );
    const shop =
      existing || s.mutate('shop', { ...d, retailer: selected, country: retailer.country });
    if (shop) chooseStore(d.name + ', ' + d.address, d.sourceUrl, shop);
    setShopDraft(undefined);
  }
  return (
    <div className="store-hub stack">
      <div className="store-selector row wrap">
        <label>
          Retailer & country
          <Choice
            label="Retailer and country"
            value={selected}
            onChange={(v) => {
              searchSerial.current++;
              setBusy(false);
              setSelected(v);
              setResults([]);
              setSearched(false);
              setNotice('');
              setCoverage(undefined);
              setHasMore(false);
            }}
            options={Object.fromEntries(
              Object.entries(retailers).map(([id, r]) => [
                id,
                r.name + ' · ' + countries[r.country],
              ]),
            )}
          />
        </label>
        <button
          className="btn"
          disabled={!active}
          onClick={() =>
            chosenShop
              ? chooseStore(
                  chosenShop.data.name + ', ' + chosenShop.data.address,
                  chosenShop.data.sourceUrl,
                  chosenShop,
                )
              : chooseStore(retailer.name)
          }
        >
          <ShoppingBasket size={18} /> Use for {active?.data.name || 'active list'}
        </button>
      </div>
      <details className="branch-settings">
        <summary>
          <MapPin size={17} />{' '}
          {chosenShop
            ? chosenShop.data.name + ' · ' + chosenShop.data.address
            : 'Choose an individual shop'}
        </summary>
        <div className="stack">
          <label>
            Individual shop
            <Choice
              label="Saved household shop"
              value={chosenShop?.id || 'any'}
              onChange={(id) => {
                const shop = shops.find((r) => r.id === id);
                if (shop)
                  chooseStore(shop.data.name + ', ' + shop.data.address, shop.data.sourceUrl, shop);
                else chooseStore(retailer.name);
              }}
              options={{
                any: 'No specific branch',
                ...Object.fromEntries(
                  shops.map((r) => [r.id, r.data.name + ' · ' + r.data.address]),
                ),
              }}
            />
          </label>
          <div className="row wrap">
            <button
              className="btn"
              onClick={() => setShopDraft({ name: retailer.name, address: '' })}
            >
              Save a branch by address
            </button>
            {chosenShop && (
              <a
                className="link"
                href={
                  'https://www.google.com/maps/search/?api=1&query=' +
                  encodeURIComponent(chosenShop.data.name + ' ' + chosenShop.data.address)
                }
                target="_blank"
                rel="noreferrer"
              >
                Directions ↗
              </a>
            )}
          </div>
          <p className="fine">
            Saved shops are shared with this household. The chosen branch belongs to the active
            list.
          </p>
        </div>
      </details>
      <p className="stock-note">
        <strong>Catalogue evidence, branch stock unknown.</strong> Check the shop before travelling.
      </p>
      <Tabs defaultValue="catalogue">
        <TabsList className="view-tabs">
          <TabsTrigger value="catalogue">Retailer catalogue</TabsTrigger>
          <TabsTrigger value="basket">My list here</TabsTrigger>
          <TabsTrigger value="offers">Offers</TabsTrigger>
          <TabsTrigger value="nearby">Branches</TabsTrigger>
        </TabsList>
        <TabsContent value="catalogue">
          <div className="retailer-search-tools">
            {['coop-ch', 'migros-ch'].includes(selected) && (
              <label>
                Catalogue source
                <Choice
                  label="Catalogue source"
                  value={source}
                  onChange={(value) => {
                    searchSerial.current++;
                    setBusy(false);
                    setSource(value);
                    setResults([]);
                    setSearched(false);
                    setCoverage(undefined);
                    setHasMore(false);
                  }}
                  options={{
                    community: 'Open Food Facts catalogue',
                    retailer: 'Retailer pages & links',
                  }}
                />
              </label>
            )}
            <form
              className="catalogue-search"
              onSubmit={(e) => {
                e.preventDefault();
                void search();
              }}
            >
              <div className="search-input">
                <Search size={19} />
                <input
                  aria-label="Search selected retailer catalogue"
                  placeholder={'Search ' + retailer.name + ' products'}
                  value={query}
                  maxLength={100}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <button className="btn primary" disabled={busy}>
                {busy ? 'Searching…' : 'Search'}
              </button>
            </form>
          </div>
          <p className="fine">
            Search by product or brand. Leave it empty to browse. Press Search to update results.
          </p>
          {coverage && (
            <p className="fine catalogue-coverage">
              {coverage.coverageByRetailer?.[retailer.tag]
                ? `${coverage.coverageByRetailer[retailer.tag].records.toLocaleString()} ${retailer.name} records · ${coverage.coverageByRetailer[retailer.tag].withPhoto.toLocaleString()} photo links · partial coverage`
                : coverage.records
                  ? `${coverage.records.toLocaleString()} Swiss records · partial coverage`
                  : `${coverage.imported} imported links · ${coverage.pageDetails} with scraped page details · partial coverage`}
            </p>
          )}
          {notice && (
            <p className={failed ? 'notice' : 'fine catalogue-notice'} role="status">
              {notice}
              {failed && (
                <button className="link" onClick={() => void search()}>
                  {' '}
                  Retry search
                </button>
              )}
            </p>
          )}
          <div className="product-grid">
            {results.map((p) => (
              <article className="product-card" key={p.id}>
                <button className="product-open" onClick={() => onProduct(p)}>
                  <Photo product={p} large />
                  <span className="eyebrow">{p.brand || retailer.name}</span>
                  <h3>{p.name}</h3>
                  <p className="muted">{p.pack || 'Pack size unknown'}</p>
                  <span className="evidence-tag">
                    {p.evidence === 'retailer-page'
                      ? 'RETAILER PAGE'
                      : p.evidence === 'indexed-link'
                        ? 'INDEXED LINK'
                        : 'COMMUNITY RECORD'}
                  </span>
                </button>
                <p className="fine">
                  {p.source} · retrieved {new Date(p.retrieved).toLocaleDateString()}. Branch stock
                  unknown.
                </p>
                <button
                  className="btn"
                  onClick={() =>
                    onAdd({
                      name: p.name,
                      product: p,
                      pack: p.pack,
                      store: chosenShop
                        ? chosenShop.data.name + ', ' + chosenShop.data.address
                        : retailer.name,
                    })
                  }
                >
                  <Plus size={16} /> Add to list
                </button>
              </article>
            ))}
          </div>
          {hasMore && (
            <button className="btn" disabled={busy} onClick={() => void search(page + 1)}>
              Load more products
            </button>
          )}
          {searched && !results.length && !busy && !failed && (
            <div className="empty card">
              <Search size={32} />
              <h3>No matching retailer records.</h3>
              <p>
                This does not mean the shop doesn’t carry it. Try the retailer’s own site, a barcode
                or a private household entry.
              </p>
            </div>
          )}
          <div className="row wrap section-title">
            <a
              className="btn"
              href={retailerSearch(selected, query)}
              target="_blank"
              rel="noreferrer"
            >
              Web search {retailer.name} <ExternalLink size={16} />
            </a>
            <a className="link" href={retailer.home} target="_blank" rel="noreferrer">
              Open official retailer site ↗
            </a>
          </div>
        </TabsContent>
        <TabsContent value="basket">
          <div className="section-title">
            <h3>
              {active?.data.name || 'Choose a list'} at {retailer.name}
            </h3>
            <p className="muted">
              Saved product evidence and dated household observations. Follow the retailer link to
              check current availability.
            </p>
          </div>
          {!items.length && <div className="empty card">Add items to an active list first.</div>}
          {items.map((item) => {
            const p = item.data.product ?? undefined;
            const reports = observations.filter(
              (o) =>
                p &&
                productRef(o.data) === p.id &&
                (chosenShop
                  ? o.data.store === chosenShop.data.name + ', ' + chosenShop.data.address
                  : o.data.store?.toLowerCase().includes(retailer.tag)),
            );
            const recorded =
              p?.evidence !== 'indexed-link' &&
              p?.countries.includes(
                'en:' + countries[retailer.country].toLowerCase().replaceAll(' ', '-'),
              ) &&
              recordedAt(p?.stores, selected);
            return (
              <article className="basket-evidence card" key={item.id}>
                <Photo product={p} />
                <div>
                  <h3>{item.data.name}</h3>
                  <p>
                    {item.data.quantity} {item.data.unit} · {item.data.pack}
                  </p>
                  <span className="pill">
                    {recorded ? 'Retailer & country recorded' : 'No matching retailer evidence'}
                  </span>
                  <p className="fine">
                    {recorded
                      ? 'Source retailer evidence; current branch stock unknown.'
                      : 'An absent catalogue tag is not proof of unavailability.'}
                  </p>
                  {reports.map((o) => (
                    <p className="fine" key={o.id}>
                      Household report: {o.data.store} · bought {o.data.date}.{' '}
                      {o.data.price ? o.data.price + ' ' + o.data.currency : ''}
                    </p>
                  ))}
                </div>
                <a
                  className="btn"
                  href={retailerSearch(selected, p?.barcode || item.data.name || '')}
                  target="_blank"
                  rel="noreferrer"
                >
                  Check retailer ↗
                </a>
              </article>
            );
          })}
        </TabsContent>
        <TabsContent value="offers">
          <div className="row wrap between section-title">
            <div>
              <h3>Offers worth remembering.</h3>
              <p className="muted">
                Keep a dated offer for the household. Prices and conditions are entered by a member.
              </p>
            </div>
            <button
              className="btn"
              onClick={() => {
                setEditing(undefined);
                setOffer({
                  name: '',
                  retailer: selected,
                  store: active?.data.retailer === selected ? active?.data.store : retailer.name,
                  country: retailer.country,
                  currency:
                    retailer.country === 'CH'
                      ? 'CHF'
                      : retailer.country === 'US'
                        ? 'USD'
                        : retailer.country === 'GB'
                          ? 'GBP'
                          : 'EUR',
                  price: '',
                  pack: '',
                  start: localDate(),
                  end: localDate(),
                  sourceUrl: retailer.offers,
                  conditions: '',
                });
              }}
            >
              <Plus size={17} /> Record an offer
            </button>
          </div>
          <a className="btn primary" href={retailer.offers} target="_blank" rel="noreferrer">
            Current offers on {retailer.name} ↗
          </a>
          <p className="fine">
            External retailer page. Offers may depend on dates, branch, loyalty membership and pack
            size. We do not scrape or verify these prices.
          </p>
          <div className="offer-grid">
            {offers.map((r) => (
              <article className="card offer-card" key={r.id}>
                <span className="pill">{offerState(r.data, localDate())}</span>
                <h3>{r.data.name}</h3>
                <strong className="offer-price">
                  {new Intl.NumberFormat(undefined, {
                    style: 'currency',
                    currency: r.data.currency,
                  }).format(r.data.price)}
                </strong>
                <p>
                  {r.data.pack || 'Pack size not entered'} · {r.data.store}
                </p>
                <p className="fine">
                  {r.data.start} – {r.data.end}
                  <br />
                  {r.data.conditions || 'No conditions entered; check source.'}
                </p>
                <p className="fine">
                  Household-entered ·{' '}
                  {s.members.find((m) => m.user === r.updatedBy)?.name || 'Former member'} · updated{' '}
                  {new Date(r.updated).toLocaleDateString()}. Not verified inventory.
                </p>
                <div className="row wrap">
                  <a className="link" href={r.data.sourceUrl} target="_blank" rel="noreferrer">
                    Check source ↗
                  </a>
                  <button
                    className="link"
                    onClick={() => {
                      setEditing(r);
                      setOffer({ ...r.data });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="link danger"
                    onClick={() => {
                      s.mutate('offer', r.data, r, true);
                      toast('Offer removed');
                    }}
                  >
                    Remove
                  </button>
                </div>
                <button
                  className="btn"
                  onClick={() =>
                    onAdd({
                      name: r.data.name,
                      pack: r.data.pack,
                      store: r.data.store,
                      notes: `Household offer: ${r.data.price} ${r.data.currency}, ${r.data.start}–${r.data.end}. Verify conditions: ${r.data.conditions || r.data.sourceUrl}`,
                    })
                  }
                >
                  Add with offer note
                </button>
              </article>
            ))}
          </div>
          {!offers.length && (
            <div className="empty card">
              <Tag size={30} />
              <p>No household offers recorded for this retailer.</p>
            </div>
          )}
        </TabsContent>
        <TabsContent value="nearby">
          <StoreFinder
            demo={s.demo}
            retailer={selected}
            onChoose={(p) => {
              if (
                p.countryCode
                  ? p.countryCode !== retailer.country
                  : p.country.toLowerCase() !== countries[retailer.country].toLowerCase()
              ) {
                toast(
                  'Choose a branch in ' +
                    countries[retailer.country] +
                    '. This place has a different or unknown country.',
                );
                return;
              }
              const inferred = inferRetailer(p.name, retailer.country);
              if (inferred && inferred !== selected) {
                toast('Select ' + retailers[inferred].name + ' above before saving this branch.');
                return;
              }
              if (!p.name.toLowerCase().includes(retailer.tag)) {
                toast(
                  'This place does not match the selected retailer. Select the correct retailer first.',
                );
                return;
              }
              saveShop({
                name: p.name,
                address: [p.address, p.country].filter(Boolean).join(', '),
                sourceUrl: p.sourceUrl,
                placeId: p.id,
                evidence: 'map-listing',
              });
            }}
          />
          <p className="fine">
            Choosing a branch saves its public map listing on this shopping list. Device coordinates
            are not retained. A mapped branch is not evidence that it stocks your products.
          </p>
        </TabsContent>
      </Tabs>
      <Modal
        open={!!shopDraft}
        onClose={() => setShopDraft(undefined)}
        title="Save an individual shop"
        description="Use a full address to distinguish branches. This is a household-entered place; it does not verify stock."
      >
        {shopDraft && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              saveShop({ ...shopDraft, evidence: 'household-entered' });
            }}
          >
            <label>
              Shop name
              <input
                required
                maxLength={160}
                value={shopDraft.name}
                onChange={(e) => setShopDraft({ ...shopDraft, name: e.target.value })}
              />
            </label>
            <label>
              Street, postcode and town
              <input
                required
                maxLength={300}
                value={shopDraft.address}
                onChange={(e) => setShopDraft({ ...shopDraft, address: e.target.value })}
              />
            </label>
            <p className="fine">
              {retailer.name} · {countries[retailer.country]}
            </p>
            <button className="btn primary" disabled={!active}>
              Save & select this shop
            </button>
          </form>
        )}
      </Modal>
      <Modal
        open={!!offer}
        onClose={() => setOffer(undefined)}
        title={editing ? 'Edit the offer report' : 'Spotted a useful offer?'}
        description="Record what the retailer says, including the dates and conditions. This is a household report, not a verified feed."
      >
        {offer && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = offerSchema.safeParse({ ...offer, price: Number(offer.price) });
              if (!parsed.success)
                return toast.error(parsed.error.issues[0]?.message || 'Check offer details');
              s.mutate('offer', parsed.data, editing);
              setOffer(undefined);
              toast.success('Dated offer saved');
            }}
          >
            <label>
              Product name
              <input
                required
                maxLength={160}
                value={offer.name}
                onChange={(e) => setOffer({ ...offer, name: e.target.value })}
              />
            </label>
            <div className="grid2">
              <label>
                Observed price ({offer.currency})
                <input
                  required
                  type="number"
                  min="0"
                  max="100000"
                  step="0.01"
                  value={offer.price}
                  onChange={(e) => setOffer({ ...offer, price: e.target.value })}
                />
              </label>
              <label>
                Pack size
                <input
                  maxLength={100}
                  value={offer.pack}
                  onChange={(e) => setOffer({ ...offer, pack: e.target.value })}
                />
              </label>
              <label>
                Starts
                <input
                  required
                  type="date"
                  value={offer.start}
                  onChange={(e) => setOffer({ ...offer, start: e.target.value })}
                />
              </label>
              <label>
                Ends
                <input
                  required
                  type="date"
                  min={offer.start}
                  value={offer.end}
                  onChange={(e) => setOffer({ ...offer, end: e.target.value })}
                />
              </label>
            </div>
            <label>
              Branch or online store
              <input
                required
                maxLength={160}
                value={offer.store}
                onChange={(e) => setOffer({ ...offer, store: e.target.value })}
              />
            </label>
            <label>
              Source link
              <input
                required
                type="url"
                maxLength={600}
                pattern="https://.*"
                value={offer.sourceUrl}
                onChange={(e) => setOffer({ ...offer, sourceUrl: e.target.value })}
              />
            </label>
            <label>
              Conditions
              <textarea
                maxLength={600}
                placeholder="e.g. loyalty card required, selected varieties only"
                value={offer.conditions}
                onChange={(e) => setOffer({ ...offer, conditions: e.target.value })}
              />
            </label>
            <button className="btn primary">Save dated offer</button>
          </form>
        )}
      </Modal>
    </div>
  );
}
