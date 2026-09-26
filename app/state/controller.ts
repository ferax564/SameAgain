import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useHousehold, api } from '@/lib/use-household';
import {
  type RecordData,
  type RecordFields,
  canMerge,
  findDuplicateItem,
  totals,
  repeatItem,
} from '@/lib/domain';
import { errorMessage } from '@/lib/utils';
import type { ReceiptListItem } from '@/lib/receipt';
import { compactProduct, timestamp, useNow } from './helpers';
import type { ConfirmRequest, FormDraft, PendingMerge } from './types';
import { useProductSearch } from './use-product-search';
import { useAbroad } from './use-abroad';

const defaultCategories = [
  'Fruit & vegetables',
  'Dairy & alternatives',
  'Bakery',
  'Pantry',
  'Frozen',
  'Household',
  'Other',
];

/**
 * All state and handlers behind the Same Again shell: the household hook, navigation, the modal
 * form draft, list/item actions, catalogue search and the "abroad" flow. Views and modals read
 * it through `useApp()`.
 */
export function useSameAgainController() {
  const s = useHousehold();
  const now = useNow();
  const [view, setView] = useState('lists'),
    [selected, setSelected] = useState(''),
    [modal, setModal] = useState(''),
    [draft, setDraft] = useState<FormDraft>({}),
    [editing, setEditing] = useState<RecordData>(),
    [privateEditing, setPrivateEditing] = useState<RecordData>(),
    [quick, setQuick] = useState(''),
    [shopping, setShopping] = useState(false),
    [dark, setDark] = useState(false),
    [busy, setBusy] = useState(false),
    [photoBusy, setPhotoBusy] = useState(false),
    [inviteUrl, setInviteUrl] = useState(''),
    [confirm, setConfirm] = useState<ConfirmRequest | null>(null),
    [mergeQueue, setMergeQueue] = useState<PendingMerge[]>([]),
    [awake, setAwake] = useState(false);
  const wake = useRef<WakeLockSentinel | null>(null);
  const household = s.household,
    hid = household?.id;
  const merge = mergeQueue[0];
  function setMerge(v: PendingMerge | null) {
    setMergeQueue((q) => (v ? [...q, v] : q.slice(1)));
  }
  // Derived views are recomputed only when the record set (or selected list) changes.
  const records = s.records;
  const derived = useMemo(() => {
    const lists: RecordData[] = [],
      allItems: RecordData[] = [],
      favourites: RecordData[] = [],
      trips: RecordData[] = [],
      templates: RecordData[] = [];
    for (const r of records) {
      if (r.kind === 'list' && !r.data.archived) lists.push(r);
      else if (r.kind === 'item') allItems.push(r);
      else if (r.kind === 'favourite') favourites.push(r);
      else if (r.kind === 'trip') trips.push(r);
      else if (r.kind === 'template') templates.push(r);
    }
    trips.sort((a, b) => b.created - a.created);
    const active = lists.find((l) => l.id === selected) || lists[0];
    const items = allItems
      .filter((r) => r.data.list === active?.id)
      .sort((a, b) => (a.data.order || 0) - (b.data.order || 0) || a.created - b.created);
    return {
      lists,
      favourites,
      trips,
      templates,
      active,
      items,
      outstanding: items.filter((r) => !r.data.done),
      done: items.filter((r) => r.data.done),
    };
  }, [records, selected]);
  const { lists, favourites, active, items, done } = derived;
  const categories = household?.settings?.categories || defaultCategories;
  const listCats = active?.data.categoryOrder?.length ? active.data.categoryOrder : categories;
  const currency = active?.data.currency || household?.settings?.currency || 'EUR';
  const money = totals(
    items.map((i) => i.data),
    currency,
  );
  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
  const memberName = (id: string | null | undefined) =>
    s.members.find((m) => m.user === id)?.name || 'Former member';
  const productSearch = useProductSearch({
    s,
    hid,
    modal,
    setModal,
    setDraft,
    setPrivateEditing,
    setBusy,
  });
  const abroad = useAbroad({
    s,
    hid,
    active,
    outstanding: derived.outstanding,
    setBusy,
    setSelected,
    setModal,
    setView,
  });
  useEffect(() => {
    // The theme class is applied before first paint by /theme-init.js; mirror it into state.
    const d = document.documentElement.classList.contains('dark');
    const url = new URL(window.location.href);
    const token = url.searchParams.get('invite');
    if (token) {
      // Keep the single-use token out of browser history and shared screenshots of the address bar.
      url.searchParams.delete('invite');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    // One-time sync from the DOM/URL after mount (not derivable during server render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(d);
    if (token) {
      setDraft({ token });
      setModal('join');
    }
  }, []);
  const changeTheme = () => {
    setDark(!dark);
    document.documentElement.classList.toggle('dark', !dark);
    try {
      localStorage.setItem('same-again:theme', dark ? 'light' : 'dark');
    } catch {
      // Storage unavailable (private mode or full): the choice lasts for this session only.
    }
  };
  /** Opens a modal form starting from `data`. */
  function openForm(name: string, data: FormDraft) {
    setDraft(data);
    setModal(name);
  }
  /** Opens the private-product form for a new product. */
  function openPrivate(data: FormDraft) {
    setDraft(data);
    setPrivateEditing(undefined);
    setModal('private');
  }
  async function act(action: string, data: Record<string, unknown> = {}, message = 'Saved') {
    if (s.pending && ['leave', 'deleteHousehold', 'deleteAccount', 'transfer'].includes(action)) {
      toast.error('Sync pending changes before changing access.');
      return;
    }
    // Deleting the account clears this device's cache for every household, so queued
    // changes anywhere (not just in the open household) must be synced first.
    if (action === 'deleteAccount' && s.pendingAnywhere) {
      toast.error(
        'Some changes on this device have not synced yet. Go online and wait for them before deleting your account.',
      );
      return;
    }
    if (s.demo) {
      toast('This action needs your own household. Demo data stays separate.');
      return;
    }
    setBusy(true);
    try {
      const r = await api(action, { household: hid, ...data });
      toast.success(message);
      if (action !== 'deleteAccount') {
        await s.boot();
        await s.refresh();
      }
      return r;
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function openItem(data: RecordFields = {}, old?: RecordData) {
    if (!active) {
      toast.error('Create a list first.');
      return;
    }
    setEditing(old);
    setDraft({
      name: '',
      quantity: 1,
      unit: 'pack',
      pack: '',
      category: 'Other',
      notes: '',
      substitution: 'similar',
      list: active.id,
      order: timestamp(),
      ...data,
    });
    setModal('item');
  }
  function add(data: RecordFields, to = active?.id, repeat = false) {
    if (repeat) data = repeatItem(data);
    if (!to) {
      toast.error('Create a shopping list first.');
      return;
    }
    const d = {
      quantity: 1,
      unit: 'pack',
      category: 'Other',
      notes: '',
      store: lists.find((l) => l.id === to)?.data.store || '',
      substitution: 'similar',
      ...data,
      list: to,
      done: false,
      purchasedAt: null,
      purchasedBy: null,
      actualPrice: null,
      priceCurrency: lists.find((l) => l.id === to)?.data.currency || currency,
    };
    const current = s.currentRecords();
    const exact = current.find(
      (r) => r.kind === 'item' && r.data.list === to && !r.data.done && canMerge(r.data, d),
    );
    // Same name (ignoring case/accents), product or barcode: ask before adding a second line.
    const similar = exact || findDuplicateItem(current, d.name, d.product, to);
    if (similar) {
      setMerge({
        existing: similar,
        data: d,
        combinable:
          !!exact || (similar.data.unit === d.unit && !similar.data.product && !d.product),
      });
      return;
    }
    s.mutate('item', d);
    toast.success('Added to your list');
  }
  function addReceipt(rows: ReceiptListItem[], to: string) {
    if (!lists.some((l) => l.id === to)) throw new Error('Choose an active shopping list.');
    let count = 0;
    for (const data of rows) {
      const duplicate = s
        .currentRecords()
        .some(
          (r) =>
            r.kind === 'item' &&
            r.data.list === to &&
            !r.data.done &&
            r.data.receipt?.fingerprint === data.receipt.fingerprint &&
            r.data.receipt?.line === data.receipt.line &&
            r.data.receipt?.label === data.receipt.label &&
            r.data.quantity === data.quantity &&
            r.data.unit === data.unit &&
            r.data.pack === data.pack,
        );
      if (duplicate) continue;
      const added = s.mutate('item', {
        ...data,
        priceCurrency: lists.find((l) => l.id === to)?.data.currency || currency,
        order: timestamp() + count,
      });
      if (!added) throw new Error('Sign in before adding receipt items.');
      count++;
    }
    setSelected(to);
    setView('lists');
    return count;
  }
  function saveItem(e: FormEvent) {
    e.preventDefault();
    if (!draft.name?.trim()) return;
    if (editing) {
      const oldList = lists.find((l) => l.id === editing.data.list),
        newList = lists.find((l) => l.id === draft.list);
      let next = draft;
      if (
        oldList?.data.currency !== newList?.data.currency ||
        (draft.priceCurrency && draft.priceCurrency !== (newList?.data.currency || currency))
      ) {
        // Only prices recorded in the old currency are cleared; newly typed ones are kept.
        const stale = (k: 'price' | 'actualPrice') =>
          draft[k] != null && draft[k] === editing.data[k];
        if (stale('price') || stale('actualPrice')) {
          next = {
            ...draft,
            price: stale('price') ? null : draft.price,
            actualPrice: stale('actualPrice') ? null : draft.actualPrice,
          };
          toast('Earlier prices cleared because the list uses another currency.');
        }
      }
      s.mutate('item', { ...next, priceCurrency: newList?.data.currency || currency }, editing);
      toast.success('Item updated');
    } else add(draft, draft.list);
    setModal('');
  }
  function toggle(item: RecordData) {
    const updated = s.mutate('item', { ...item.data, done: !item.data.done }, item);
    toast(item.data.done ? 'Back on the list' : 'Added to your basket', {
      action: {
        label: 'Undo',
        onClick: () => {
          if (updated) s.mutate('item', item.data, updated);
        },
      },
      duration: 6000,
    });
  }
  function remove(item: RecordData) {
    const removed = s.mutate(item.kind, item.data, item, true);
    setModal('');
    toast('Item removed', {
      action: {
        label: 'Undo',
        onClick: () => {
          if (removed) s.mutate(item.kind, item.data, removed, false);
        },
      },
    });
  }
  function saveFavourite(data: RecordFields) {
    const productId = data.product?.id;
    if (!productId) return toast.error('Save an exact or private product as a favourite.');
    if (favourites.some((f) => f.data.product?.id === productId))
      return toast('Already in your favourites');
    s.mutate('favourite', {
      ...data,
      list: undefined,
      done: undefined,
      price: null,
      actualPrice: null,
      purchasedBy: null,
      purchasedAt: null,
    });
    toast.success('Saved to household favourites');
  }
  function completeTrip() {
    if (s.pending) return toast.error('Sync pending changes before finishing this trip.');
    if (!done.length) return toast.error('Check off purchased items first.');
    s.mutate('trip', {
      name: active?.data.name,
      date: timestamp(),
      list: active?.id,
      currency,
      // The server rebuilds purchased items from its own records using originalItem/originalVersion;
      // the local copy only needs enough to show history offline, so bulky product data is trimmed.
      items: done.map((i) => ({
        ...i.data,
        product: i.data.product ? compactProduct(i.data.product) : i.data.product,
        originalItem: i.id,
        originalVersion: i.version,
      })),
    });
    if (s.demo) for (const item of done) s.mutate('item', item.data, item, true);
    toast.success('Shopping trip saved. Remaining items stay on the list.');
  }
  function nav(id: string) {
    setView(id);
    setShopping(false);
    void keepAwake(false);
  }
  async function keepAwake(value: boolean) {
    try {
      if (value) {
        if (!('wakeLock' in navigator))
          throw new Error('Keep screen awake is not supported by this browser.');
        const sentinel = await navigator.wakeLock.request('screen');
        wake.current = sentinel;
        sentinel.addEventListener('release', () => setAwake(false));
        setAwake(true);
      } else {
        await wake.current?.release();
        setAwake(false);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  return {
    s,
    now,
    household,
    hid,
    view,
    setView,
    selected,
    setSelected,
    modal,
    setModal,
    draft,
    setDraft,
    editing,
    setEditing,
    privateEditing,
    setPrivateEditing,
    quick,
    setQuick,
    shopping,
    setShopping,
    dark,
    changeTheme,
    busy,
    setBusy,
    photoBusy,
    setPhotoBusy,
    inviteUrl,
    setInviteUrl,
    confirm,
    setConfirm,
    merge,
    setMerge,
    awake,
    keepAwake,
    ...derived,
    categories,
    listCats,
    currency,
    money,
    fmt,
    memberName,
    openForm,
    openPrivate,
    act,
    openItem,
    add,
    addReceipt,
    saveItem,
    toggle,
    remove,
    saveFavourite,
    completeTrip,
    nav,
    ...productSearch,
    ...abroad,
  };
}

export type AppController = ReturnType<typeof useSameAgainController>;
