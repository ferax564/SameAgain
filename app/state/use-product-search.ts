import { type Dispatch, type SetStateAction, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { HouseholdState } from '@/lib/use-household';
import { type Product, type RecordData, barcode, pack } from '@/lib/domain';
import { rankSearch } from '@/lib/catalogue-search';
import { demoProducts } from '@/lib/demo';
import { errorMessage } from '@/lib/utils';
import type { FormDraft } from './types';

/** Catalogue search (Discover and the scanner) and the product-detail dialog state. */
export function useProductSearch({
  s,
  hid,
  modal,
  setModal,
  setDraft,
  setPrivateEditing,
  setBusy,
}: {
  s: HouseholdState;
  hid: string | undefined;
  modal: string;
  setModal: Dispatch<SetStateAction<string>>;
  setDraft: Dispatch<SetStateAction<FormDraft>>;
  setPrivateEditing: Dispatch<SetStateAction<RecordData | undefined>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
}) {
  const [query, setQuery] = useState(''),
    [searchCountry, setSearchCountry] = useState(''),
    [dietFilter, setDietFilter] = useState(''),
    [results, setResults] = useState<Product[]>([]),
    [searched, setSearched] = useState(false),
    [searchError, setSearchError] = useState(''),
    [product, setProduct] = useState<Product>(),
    [productLoading, setProductLoading] = useState(false),
    [productNotice, setProductNotice] = useState(''),
    [productStore, setProductStore] = useState('');
  const queryTimer = useRef<ReturnType<typeof setTimeout>>(undefined),
    productSerial = useRef(0),
    searchSerial = useRef(0);
  async function openProduct(p: Product, store = '') {
    setProductStore(store);
    if (s.demo) p = demoProducts.find((row) => row.id === p.id) || p;
    const serial = ++productSerial.current;
    setProduct(p);
    setProductNotice('');
    setModal('product');
    if (p.source !== 'Open Food Facts' || !p.barcode || !barcode(p.barcode).valid || s.demo) {
      setProductLoading(false);
      return;
    }
    setProductLoading(true);
    try {
      const r = await fetch(
        '/api/catalogue?' +
          new URLSearchParams({ barcode: p.barcode, details: '1', household: hid ?? '' }),
        { signal: AbortSignal.timeout(25000) },
      );
      const d = await r.json();
      if (serial !== productSerial.current) return;
      if (!r.ok) throw new Error(d.error || 'Could not refresh this product.');
      if (!d.product) {
        setProductNotice(
          'This barcode is no longer found in the live catalogue. The saved record is shown below; check the package.',
        );
        return;
      }
      const refreshed = d.product as Product;
      const before = pack(p.pack),
        after = pack(refreshed.pack);
      const changed =
        p.pack &&
        refreshed.pack &&
        (before && after
          ? before.basis !== after.basis || before.amount !== after.amount
          : p.pack !== refreshed.pack);
      setProduct(refreshed);
      setResults((rows) => rows.map((row) => (row.id === p.id ? refreshed : row)));
      setProductNotice(
        [
          changed
            ? `Pack-size discrepancy: the saved result says ${p.pack}; the current catalogue says ${refreshed.pack}. Check the actual package before adding.`
            : '',
          d.notice,
        ]
          .filter(Boolean)
          .join(' '),
      );
    } catch (e) {
      if (serial === productSerial.current)
        setProductNotice(
          (errorMessage(e) || 'Details could not be refreshed.') +
            ' Saved information remains visible. Retry or check the package.',
        );
    } finally {
      if (serial === productSerial.current) setProductLoading(false);
    }
  }
  /** Closes the product dialog and ignores any detail refresh still in flight. */
  function closeProduct() {
    productSerial.current++;
    setProductLoading(false);
    setModal('');
  }
  async function search(code?: string) {
    setProductStore('');
    const serial = ++searchSerial.current;
    clearTimeout(queryTimer.current);
    setBusy(true);
    setSearchError('');
    setSearched(true);
    try {
      if (!code && /^[\d\s-]{8,20}$/.test(query.trim())) code = query.trim();
      if (s.demo) {
        setProductStore('');
        const params = new URLSearchParams(
          code ? { barcode: code } : { q: query, country: searchCountry, label: dietFilter },
        );
        const response = await fetch('/api/demo-catalogue?' + params, {
          signal: AbortSignal.timeout(15000),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (serial !== searchSerial.current) return;
        if (code) {
          const found = demoProducts.find((p) => p.barcode === barcode(code!).code) || data.product;
          if (found) {
            setProduct(found);
            setProductLoading(false);
            setProductNotice(data.notice || 'Saved demo catalogue record.');
            setModal('product');
          } else {
            setDraft({ barcode: code, name: '', brand: '', pack: '' });
            setPrivateEditing(undefined);
            setModal('private');
          }
        } else {
          setResults(
            rankSearch([...demoProducts, ...data.products], query, {
              country: searchCountry || undefined,
              label: dietFilter || undefined,
            }),
          );
          setSearchError(data.notice || '');
        }
      } else {
        const params = new URLSearchParams(
          code
            ? { barcode: code, household: hid ?? '', details: '1' }
            : {
                q: query,
                household: hid ?? '',
                ...(searchCountry ? { country: searchCountry } : {}),
                ...(dietFilter ? { label: dietFilter } : {}),
              },
        );
        const r = await fetch('/api/catalogue?' + params, { signal: AbortSignal.timeout(25000) });
        if (r.status === 401)
          throw Object.assign(new Error('Sign in again to look up products in your household.'), {
            status: 401,
          });
        const d = await r.json();
        if (!r.ok)
          throw Object.assign(new Error(d.error || 'Product lookup failed. Please retry.'), {
            status: r.status,
          });
        if (serial !== searchSerial.current) return;
        if (d.notice && code) toast(d.notice, { duration: 8000 });
        if (code) {
          if (d.product) {
            setProduct(d.product);
            setProductLoading(false);
            setProductNotice(d.notice || '');
            setModal('product');
          } else {
            setDraft({ barcode: code, name: '', brand: '', pack: '' });
            setPrivateEditing(undefined);
            setModal('private');
          }
        } else {
          setResults(d.products);
          if (d.notice) setSearchError(d.notice);
        }
      }
    } catch (e) {
      if (serial === searchSerial.current) {
        setSearchError(errorMessage(e));
        toast.error(errorMessage(e));
        if (code && modal === 'scanner') throw e;
      }
    } finally {
      if (serial === searchSerial.current) setBusy(false);
    }
  }
  function setSearch(v: string) {
    searchSerial.current++;
    setBusy(false);
    setQuery(v);
    clearTimeout(queryTimer.current);
  }
  /** Changes a catalogue filter: cancels any search in flight and clears the previous results. */
  function changeFilter(set: Dispatch<SetStateAction<string>>, v: string) {
    searchSerial.current++;
    setBusy(false);
    set(v);
    setResults([]);
    setSearched(false);
    setSearchError('');
  }
  return {
    query,
    setQuery,
    setSearch,
    searchCountry,
    setSearchCountry,
    changeSearchCountry: (v: string) => changeFilter(setSearchCountry, v),
    dietFilter,
    changeDietFilter: (v: string) => changeFilter(setDietFilter, v),
    results,
    setResults,
    searched,
    setSearched,
    searchError,
    search,
    product,
    setProduct,
    productLoading,
    productNotice,
    productStore,
    openProduct,
    closeProduct,
  };
}
