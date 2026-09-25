import { ArrowLeft, ArrowRight, Check, Loader2, Package, X } from 'lucide-react';
import { countries, countryTag, conversion } from '@/lib/domain';
import { Choice, Modal, Photo } from '../ui';
import { useApp } from '../state/context';

/** "Shop in another country": review each item, then create a destination copy. */
export function TranslateModal() {
  const {
    s,
    modal,
    setModal,
    busy,
    outstanding,
    memberName,
    nav,
    setQuery,
    setSearchCountry,
    destination,
    changeDestination,
    priority,
    changePriority,
    compareItem,
    setCompareItem,
    matches,
    matchReason,
    decisions,
    closeTranslate,
    findMatches,
    choose,
    clearDecision,
    translate,
  } = useApp();
  return (
    <Modal
      open={modal === 'translate'}
      onClose={closeTranslate}
      title="Same list. Somewhere new."
      description="Approve each choice, then create a destination copy. Your original stays as it is."
      wide
    >
      <div className="stack">
        <div className="grid2">
          <label>
            Where are you shopping?
            <Choice
              label="Destination country"
              value={destination}
              onChange={changeDestination}
              options={countries}
            />
          </label>
          <label>
            What matters most?
            <Choice
              label="Matching priority"
              value={priority}
              onChange={changePriority}
              options={{
                ingredients: 'Similar ingredients',
                nutrition: 'Similar nutritional profile',
                use: 'Same intended use',
                pack: 'Similar pack size',
                brand: 'Same brand',
              }}
            />
          </label>
        </div>
        {compareItem ? (
          <>
            <button className="link row" onClick={() => setCompareItem(undefined)}>
              <ArrowLeft size={17} /> Back to your basket
            </button>
            <div className="original-card row">
              <Photo product={compareItem.data.product} />
              <div>
                <span className="eyebrow">YOUR USUAL</span>
                <h3>{compareItem.data.name}</h3>
                <p className="muted">
                  {compareItem.data.quantity} × {compareItem.data.pack || compareItem.data.unit}
                </p>
              </div>
            </div>
            <p className="fine">
              Applying household constraints and{' '}
              {compareItem.data.intendedFor
                ? memberName(compareItem.data.intendedFor)
                : s.user?.name}
              ’s personal requirements. Intended use is inferred from catalogue category; taste is
              not inferred.
            </p>
            {busy ? (
              <div className="empty">
                <Loader2 className="spin" />
                <p>Comparing the available evidence…</p>
              </div>
            ) : matches.length ? (
              matches.map((m) => (
                <article className="candidate card" key={m.product.id}>
                  <span className="pill">{m.band}</span>
                  <div className="row">
                    <Photo product={m.product} large />
                    <div>
                      <h3>{m.product.name}</h3>
                      <p>{m.product.pack || 'Pack size unknown'}</p>
                      <small className="muted">
                        Recorded for {countries[destination]} · Open Food Facts
                      </small>
                    </div>
                  </div>
                  <div className="grid2">
                    <div>
                      <strong>Why it is a candidate</strong>
                      <ul>
                        {m.reasons.map((r: string) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <strong>What to check</strong>
                      <ul>
                        {[...m.differences, ...m.unknown, m.taste].map((r: string) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <p className="fine">
                    {(() => {
                      const c =
                        compareItem.data.unit === 'pack'
                          ? conversion(
                              compareItem.data.pack,
                              m.product.pack,
                              Number(compareItem.data.quantity),
                            )
                          : null;
                      return c
                        ? `Your original is ${c.original} ${c.unit}. This works out to ${Number(c.exact.toFixed(2))} of these packs. Choose how many you want.`
                        : 'Pack quantities cannot be reliably converted. Choose a quantity after checking the package.';
                    })()}
                  </p>
                  <form
                    className="row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const n = Number(new FormData(e.currentTarget).get('quantity'));
                      choose(compareItem, m.product, m.reasons.join('; '), n);
                    }}
                  >
                    <label>
                      New quantity
                      <input
                        name="quantity"
                        type="number"
                        min="0.01"
                        max="10000"
                        step="any"
                        required
                        defaultValue={compareItem.data.quantity ?? undefined}
                      />
                    </label>
                    <button className="btn primary">Approve this alternative</button>
                  </form>
                  <a className="fine" href={m.product.sourceUrl} target="_blank" rel="noreferrer">
                    Source · retrieved {new Date(m.product.retrieved).toLocaleDateString()}
                  </a>
                </article>
              ))
            ) : (
              <div className="empty card">
                <Package size={34} />
                <h3>No confident match.</h3>
                <p>
                  There isn’t enough compatible catalogue evidence to suggest a credible
                  alternative.
                </p>
              </div>
            )}
            <p className="fine">{matchReason}</p>
            <div className="row wrap">
              <button
                className="btn"
                onClick={() =>
                  choose(compareItem, compareItem.data.product ?? null, 'Kept the original product')
                }
              >
                Keep original
              </button>
              {compareItem.data.substitution !== 'exact' && (
                <button
                  className="btn"
                  onClick={() => choose(compareItem, null, 'User chose a generic item')}
                >
                  Keep generic
                </button>
              )}
              <button
                className="btn"
                onClick={() => {
                  setModal('');
                  nav('discover');
                  setSearchCountry(destination);
                  setQuery(compareItem.data.product?.brand || compareItem.data.name || '');
                }}
              >
                Search catalogue again
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="translation-items">
              {outstanding.map((item) => {
                const p = item.data.product,
                  decision = decisions[item.id],
                  recorded = p?.countries?.includes(countryTag(destination));
                return (
                  <article key={item.id} className="translation-row">
                    <div className="row">
                      <Photo product={p} />
                      <div>
                        <h3>{item.data.name}</h3>
                        <small className="muted">
                          {item.data.quantity} × {item.data.pack || item.data.unit}
                        </small>
                      </div>
                    </div>
                    <div>
                      <span className="country-evidence">
                        {p
                          ? recorded
                            ? 'Recorded for ' + countries[destination]
                            : 'No country record for ' + countries[destination]
                          : 'Generic item'}
                      </span>
                      {decision ? (
                        <div className="approved">
                          <Check size={16} />
                          <span>
                            {decision.product?.name || 'Keep generic'} · {decision.quantity}
                          </span>
                          <button
                            className="iconbtn"
                            aria-label="Clear decision"
                            onClick={() => clearDecision(item.id)}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <div className="row wrap">
                          {p && (
                            <button className="btn" onClick={() => findMatches(item)}>
                              Compare <ArrowRight size={15} />
                            </button>
                          )}
                          <button
                            className="link"
                            onClick={() =>
                              choose(
                                item,
                                p || null,
                                p ? 'Kept original product' : 'Kept generic item',
                              )
                            }
                          >
                            {p ? 'Keep original' : 'Keep generic'}
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            {!outstanding.length && (
              <p className="empty">Add some outstanding items to your list first.</p>
            )}
            <div className="row between">
              <span className="muted">
                {outstanding.filter((i) => decisions[i.id]).length} of {outstanding.length} reviewed
              </span>
              <button
                className="btn primary"
                disabled={!outstanding.length || outstanding.some((i) => !decisions[i.id])}
                onClick={translate}
              >
                Create destination list <ArrowRight size={18} />
              </button>
            </div>
          </>
        )}
        <p className="notice">
          Catalogue country records are not stock information. Check current labels. No
          substitutions happen without your approval.
        </p>
      </div>
    </Modal>
  );
}
