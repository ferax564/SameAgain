import {
  ArrowRight,
  CheckCheck,
  Globe2,
  ListChecks,
  MoreHorizontal,
  Plus,
  ReceiptText,
  ScanBarcode,
  ShoppingBasket,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { countries } from '@/lib/domain';
import { guessCategory, parseQuickAdd } from '@/lib/quick-add';
import { Choice, Photo } from '../ui';
import { useApp } from '../state/context';
import { ItemRow } from './item-row';

/** The active shopping list with quick add, categories, basket and the context column. */
export function ListsView() {
  const {
    s,
    active,
    lists,
    items,
    outstanding,
    done,
    favourites,
    categories,
    listCats,
    currency,
    money,
    fmt,
    shopping,
    setShopping,
    awake,
    keepAwake,
    quick,
    setQuick,
    add,
    setSelected,
    setModal,
    openForm,
    setConfirm,
    completeTrip,
    nav,
    destination,
    setDestination,
    openTranslate,
  } = useApp();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE EVERYDAY, TAKEN CARE OF</span>
          <h1>{active?.data.name || 'Your shopping lists'}</h1>
          <p className="muted">
            {active ? (
              <>
                <strong>{outstanding.length} items</strong> to pick up
                {active.data.store && active.data.store !== 'Any store'
                  ? ' · ' + active.data.store
                  : ' · A little teamwork goes a long way.'}
              </>
            ) : (
              'Create your first list and add whatever comes to mind.'
            )}
          </p>
        </div>
        <div className="row wrap heading-actions">
          <button className="btn" onClick={() => setModal('receipt')} disabled={!active}>
            <ReceiptText size={18} /> Scan receipt
          </button>
          <button
            className={'btn ' + (shopping ? 'primary' : '')}
            onClick={() => setShopping(!shopping)}
          >
            <ShoppingBasket size={18} />
            {shopping ? 'Exit shopping' : 'Shopping mode'}
          </button>
          <button className="btn primary" onClick={() => setModal('scanner')}>
            <ScanBarcode size={19} /> Scan a product
          </button>
        </div>
      </div>
      <div className="mobile-list-picker">
        <Choice
          label="Shopping list"
          value={active?.id || ''}
          onChange={setSelected}
          options={Object.fromEntries(lists.map((l) => [l.id, l.data.name ?? '']))}
        />
        <button
          className="iconbtn"
          aria-label="New list"
          onClick={() => openForm('list', { name: '', currency })}
        >
          <Plus />
        </button>
      </div>
      {shopping && (
        <div className="shopping-banner row between">
          <span>
            <ShoppingBasket size={22} />
            <strong>{outstanding.length} left to find</strong>
          </span>
          <label className="row">
            <Switch checked={awake} onCheckedChange={keepAwake} /> Keep awake
          </label>
        </div>
      )}
      <div className="lists-layout">
        <section className="list-surface">
          {active && (
            <>
              <form
                className="quick-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (quick.trim()) {
                    const parsed = parseQuickAdd(quick);
                    add({
                      ...parsed,
                      category: guessCategory(parsed.name, listCats),
                    });
                    setQuick('');
                  }
                }}
              >
                <Plus size={22} />
                <input
                  aria-label="Add an item"
                  maxLength={160}
                  value={quick}
                  onChange={(e) => setQuick(e.target.value)}
                  placeholder="What do we need?"
                />
                <button type="submit" className="btn primary">
                  Add
                </button>
              </form>
              <div className="list-toolbar">
                <div className="row">
                  <span className="pill">
                    {done.length} of {items.length} in basket
                  </span>
                  <div className="avatar-group">
                    {s.members.slice(0, 3).map((m) => (
                      <span className="avatar small" key={m.user} title={m.name ?? undefined}>
                        {m.name?.[0]}
                      </span>
                    ))}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="iconbtn" aria-label="List options">
                      <MoreHorizontal size={20} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() =>
                        openForm('listSettings', {
                          ...active.data,
                          categoryOrderText: (active.data.categoryOrder || categories).join(', '),
                        })
                      }
                    >
                      List settings & category order
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        s.mutate('template', {
                          name: active.data.name,
                          items: outstanding.map((i) => i.data),
                        });
                        toast.success('Reusable template saved');
                      }}
                    >
                      Save as template
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setModal('templates')}>
                      Add from template
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setModal('history')}>
                      Repeat a previous shop
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={openTranslate}>
                      Shop in another country
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        setConfirm({
                          title: 'Archive this list?',
                          description:
                            'Items remain in your household export. Active shopping lists will no longer show this list.',
                          run: () => s.mutate('list', { ...active.data, archived: true }, active),
                        })
                      }
                    >
                      Archive list
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {outstanding.length === 0 ? (
                <div className="empty">
                  <CheckCheck size={38} />
                  <h3>
                    {done.length
                      ? 'Everything is in the basket.'
                      : 'A fresh list, ready for anything.'}
                  </h3>
                  <p>
                    {done.length
                      ? 'Save this trip to make the next shop easier.'
                      : 'Add your first item above, or scan a family favourite.'}
                  </p>
                </div>
              ) : (
                [
                  ...new Set([...listCats, ...outstanding.map((i) => i.data.category || 'Other')]),
                ].map((category) => {
                  const group = outstanding.filter(
                    (i) => (i.data.category || 'Other') === category,
                  );
                  return group.length ? (
                    <div className="category" key={category}>
                      <div className="category-label">
                        {category}
                        <span>{group.length}</span>
                      </div>
                      {group.map((item) => (
                        <ItemRow key={item.id} item={item} />
                      ))}
                    </div>
                  ) : null;
                })
              )}
              {done.length > 0 && (
                <div className="completed-section">
                  <div className="row between">
                    <h3>
                      <CheckCheck size={18} /> In the basket <span>{done.length}</span>
                    </h3>
                    <button className="link" onClick={completeTrip}>
                      Finish trip
                    </button>
                  </div>
                  {done.map((item) => (
                    <ItemRow key={item.id} item={item} />
                  ))}
                </div>
              )}
              <div className="list-footer">
                <span>
                  <Users size={15} /> Added-by and purchase details are saved with each item.
                </span>
              </div>
            </>
          )}
          {!active && (
            <div className="empty">
              <ListChecks size={40} />
              <h3>One list. Less back and forth.</h3>
              <button
                className="btn primary"
                onClick={() => openForm('list', { name: 'Weekly groceries', currency })}
              >
                Create a list
              </button>
            </div>
          )}
        </section>
        <aside className="context-column">
          <section className="travel-card">
            <div className="row between">
              <span className="eyebrow">SAME FAVOURITES. NEW PLACE.</span>
              <Globe2 size={25} strokeWidth={1.5} />
            </div>
            <h2>
              Feels like home.
              <br />
              Shops like local.
            </h2>
            <p>Find your usual products—or a thoughtful alternative—in another country.</p>
            <Choice
              label="Destination country"
              value={destination}
              onChange={setDestination}
              options={countries}
            />
            <button className="btn primary" onClick={openTranslate}>
              Take this list abroad <ArrowRight size={17} />
            </button>
            <small>Catalogue matches, with every swap in your hands.</small>
          </section>
          <section className="favourite-teaser">
            <div className="row between">
              <h3>Your usuals</h3>
              <button className="link" onClick={() => nav('favourites')}>
                View all
              </button>
            </div>
            {favourites.slice(0, 3).map((f) => (
              <div className="usual" key={f.id}>
                <Photo
                  product={{
                    ...f.data.product,
                    image: f.data.image || f.data.product?.image,
                  }}
                />
                <div>
                  <strong>{f.data.product?.brand?.split(',')[0] || f.data.name}</strong>
                  <small className="muted">{f.data.product?.pack || 'Household favourite'}</small>
                </div>
                <button
                  className="iconbtn"
                  aria-label={'Add favourite ' + f.data.name}
                  onClick={() => add(f.data, undefined, true)}
                >
                  <Plus size={20} />
                </button>
              </div>
            ))}
            {!favourites.length && (
              <p className="muted">
                Save the exact products everyone asks for. They’ll be one tap away.
              </p>
            )}
          </section>
          <section className="cost-card">
            <span className="eyebrow">BASKET NOTES</span>
            <div className="row between">
              <span>Estimated priced items</span>
              <strong>{fmt(money.estimated)}</strong>
            </div>
            <p className="muted">
              {money.missing} outstanding {money.missing === 1 ? 'item has' : 'items have'} no
              price. This is a partial estimate.
            </p>
            {done.length > 0 && (
              <p className="fine">
                {money.actualMissing} purchased items have no comparable actual price.
              </p>
            )}
            {money.actual > 0 && (
              <div className="row between">
                <span>Recorded purchases</span>
                <strong>{fmt(money.actual)}</strong>
              </div>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
