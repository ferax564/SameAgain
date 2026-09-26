import { type Dispatch, type SetStateAction, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { HouseholdState } from '@/lib/use-household';
import {
  type Product,
  type RecordData,
  countries,
  countryCurrency,
  rank,
  substituteItem,
} from '@/lib/domain';
import { demoProducts } from '@/lib/demo';
import { errorMessage } from '@/lib/utils';
import type { Decision, Match } from './types';

/** The "Shop in another country" flow: destination, candidate matches and approved choices. */
export function useAbroad({
  s,
  hid,
  active,
  outstanding,
  setBusy,
  setSelected,
  setModal,
  setView,
}: {
  s: HouseholdState;
  hid: string | undefined;
  active: RecordData | undefined;
  outstanding: RecordData[];
  setBusy: Dispatch<SetStateAction<boolean>>;
  setSelected: Dispatch<SetStateAction<string>>;
  setModal: Dispatch<SetStateAction<string>>;
  setView: Dispatch<SetStateAction<string>>;
}) {
  const household = s.household;
  const [destination, setDestination] = useState('FR'),
    [priority, setPriority] = useState('ingredients'),
    [compareItem, setCompareItem] = useState<RecordData>(),
    [matches, setMatches] = useState<Match[]>([]),
    [matchReason, setMatchReason] = useState(''),
    [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const matchSerial = useRef(0);
  /** Opens the flow with no decisions yet, on the basket overview. */
  function openTranslate() {
    setDecisions({});
    setCompareItem(undefined);
    setModal('translate');
  }
  function closeTranslate() {
    matchSerial.current++;
    setBusy(false);
    setModal('');
    setCompareItem(undefined);
  }
  function changeDestination(v: string) {
    matchSerial.current++;
    setBusy(false);
    setDestination(v);
    setDecisions({});
    setCompareItem(undefined);
    setMatches([]);
  }
  function changePriority(v: string) {
    matchSerial.current++;
    setBusy(false);
    setPriority(v);
    setCompareItem(undefined);
    setMatches([]);
  }
  async function findMatches(item: RecordData) {
    const serial = ++matchSerial.current;
    setCompareItem(item);
    setMatches([]);
    setMatchReason('');
    setBusy(true);
    try {
      if (s.demo) {
        const original = item.data.product;
        if (!original) throw new Error('This item has no catalogue product to compare.');
        setMatches(
          rank(
            original,
            demoProducts,
            destination,
            household?.settings.constraints,
            priority,
            item.data.substitution,
          ),
        );
        setMatchReason(
          'Example basket with real catalogue records. No candidate is invented when the sample catalogue has no credible match.',
        );
      } else {
        const r = await fetch(
            '/api/catalogue?' +
              new URLSearchParams({
                original: item.id,
                household: hid ?? '',
                country: destination,
                priority,
              }),
          ),
          d = await r.json();
        if (!r.ok) throw new Error(d.error);
        if (serial !== matchSerial.current) return;
        setMatches(d.matches);
        setMatchReason(d.reason);
      }
    } catch (e) {
      if (serial === matchSerial.current) setMatchReason(errorMessage(e));
    } finally {
      if (serial === matchSerial.current) setBusy(false);
    }
  }
  function choose(item: RecordData, p: Product | null, reason: string, quantity?: number) {
    setDecisions((d) => ({
      ...d,
      [item.id]: {
        version: item.version,
        product: p,
        reason,
        quantity: quantity || item.data.quantity,
      },
    }));
    toast.success('Choice saved for the destination copy');
    setCompareItem(undefined);
  }
  function clearDecision(id: string) {
    setDecisions((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
  }
  function translate() {
    if (!active) return;
    const originalItems = outstanding;
    if (originalItems.some((i) => !decisions[i.id] || decisions[i.id].version !== i.version))
      return toast.error(
        'Review each current item before creating the destination copy. An item may have changed since your approval.',
      );
    const copy = s.mutate('list', {
      name: active.data.name + ' · ' + countries[destination],
      country: destination,
      currency: countryCurrency(destination),
      originalList: active.id,
    });
    if (!copy) return;
    for (const item of originalItems) {
      const choice = decisions[item.id];
      s.mutate('item', {
        ...substituteItem(item.data, choice.product),
        list: copy.id,
        quantity: choice.quantity,
        done: false,
        price: null,
        actualPrice: null,
        priceCurrency: countryCurrency(destination),
        originalItem: item.id,
        replacementReason: choice.reason,
      });
      if (choice.product && choice.product.id !== item.data.product?.id)
        s.mutate('substitution', {
          original: item.data.product?.id,
          product: choice.product,
          country: destination,
          reason: choice.reason,
        });
    }
    setSelected(copy.id);
    setModal('');
    setView('lists');
    toast.success('Destination list created. Your original is preserved.');
  }
  return {
    destination,
    setDestination,
    changeDestination,
    priority,
    changePriority,
    compareItem,
    setCompareItem,
    matches,
    matchReason,
    decisions,
    openTranslate,
    closeTranslate,
    findMatches,
    choose,
    clearDecision,
    translate,
  };
}
