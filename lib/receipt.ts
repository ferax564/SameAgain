// Receipt text is evidence of a past purchase, never a product identifier or stock feed.
export type ReceiptItem = {
  key: string;
  name: string;
  quantity: number;
  unit: 'piece' | 'pack' | 'kg' | 'g' | 'l' | 'ml';
  pack: string;
  lineTotal?: number;
  raw: string;
  warnings: string[];
  selected: boolean;
};
export type ReceiptDraft = {
  store: string;
  date: string;
  currency: string;
  total?: number;
  items: ReceiptItem[];
  warnings: string[];
};
const money = /^-?\d{1,6}[.,](?:\d{2}|-)$/;
const value = (s: string) => Number(s.replace(',', '.').replace(/\.-$/, '.00'));
const footer =
  /^(?:total\b|subtotal\b|sub total\b|summe\b|gesamt\b|zu zahlen\b|montant\b|totale\b|amount due\b|balance due\b|twint\b|visa\b|mastercard\b|cash\b|barzahlung\b|cardholder\b|zahlung\b)/i;
const ignored =
  /^(?:coop$|migros$|artikel\b|article\b|menge\b|preis\b|aktion\b|qty\b|quantity\b|description\b|mwst\b|tva\b|vat\b|tax\b|change\b|rückgeld\b|rabatt\b|discount\b|coupon\b|ersparnis\b|sie sparen\b|sammel\w*\b|anzahl\b|purchase\b|www\.|https:|tel\b|thank\b|danke\b|merci\b)/i;
function dateFromText(text: string) {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return validDate(iso[0]);
  const eu = text.match(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2}|\d{2})\b/);
  if (eu)
    return validDate(
      `${eu[3].length === 2 ? '20' : ''}${eu[3]}-${eu[2].padStart(2, '0')}-${eu[1].padStart(2, '0')}`,
    );
  return '';
}
export function validDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(s + 'T12:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : '';
}
export function parseReceipt(text: string): ReceiptDraft {
  const lines = text
    .slice(0, 40000)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const draft: ReceiptDraft = {
    store: /\bcoop\b/i.test(text) ? 'Coop' : /\bmigros\b/i.test(text) ? 'Migros' : '',
    date: dateFromText(text),
    currency:
      text.match(/\b(CHF|EUR|USD|GBP|DKK|SEK|NOK|PLN|CZK|HUF|RON|ISK)\b/i)?.[1].toUpperCase() ||
      (/€/.test(text) ? 'EUR' : ''),
    items: [],
    warnings: [],
  };
  let ended = false,
    pending = '',
    table = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (
      /(?:artikel|article|description|item)\b.*(?:menge|qty|quantity|preis|price|total)/i.test(raw)
    ) {
      table = true;
      continue;
    }
    const clean = raw
      .replace(/[€$£]/g, '')
      .replace(/\b(?:CHF|EUR|USD|GBP)\b/gi, '')
      .trim();
    if (footer.test(raw)) {
      if (
        draft.total === undefined &&
        /^(?:total\b|gesamt\b|summe\b|totale\b|amount due\b)/i.test(raw)
      ) {
        const found = clean.match(/\d+[.,]\d{2}/g) || lines[i + 1]?.match(/^\s*(\d+[.,]\d{2})\s*$/);
        if (found) draft.total = value(found.at(-1)!);
      }
      ended = true;
      continue;
    }
    if (ended || ignored.test(raw) || !/[\p{L}]/u.test(clean) || draft.items.length >= 100)
      continue;
    const columns = clean.split(/\s{2,}/),
      hasColumns = columns.length > 1 && /[\p{L}]{3}/u.test(columns[0]);
    const tokens = clean.split(/\s+/),
      start = tokens.findIndex((t) => money.test(t));
    if (start < 0 && !hasColumns) {
      if (clean.length < 160 && !/[\d]{6,}/.test(clean) && !/[|:]/.test(clean)) pending = clean;
      continue;
    }
    if (start < 0 && !table) continue;
    let name = hasColumns ? columns[0] : tokens.slice(0, start).join(' '),
      quantity = 1,
      unit: ReceiptItem['unit'] = 'piece',
      warnings: string[] = [];
    let numeric = hasColumns ? columns.slice(1).join(' ') : tokens.slice(start).join(' ');
    // Till tax codes can touch the last amount (4.500A = 4.50, tax code 0A).
    if (draft.store === 'Coop')
      numeric = numeric.replace(/(\d+[.,]\d{2})[01](?:[A-Z]|4)?(?=\s*$)/g, '$1');
    const amounts = numeric.split(/\s+/).filter((t) => money.test(t));
    let quantityKnown = false;
    if (hasColumns) {
      const q = numeric.match(/^(\d+(?:[.,]\d{1,3})?|[Il|\]])(?:\s+(kg|g|ml|l))?\s+/i);
      if (q) {
        const n = /^[Il|\]]$/.test(q[1]) ? 1 : value(q[1]);
        if (q[2] || Number.isInteger(n) || (q[1].split(/[.,]/)[1]?.length === 3 && n < 10)) {
          quantity = n;
          quantityKnown = true;
          unit = (q[2]?.toLowerCase() as ReceiptItem['unit']) || 'piece';
          if (!q[2] && !Number.isInteger(n)) {
            unit = 'kg';
            warnings.push('Fractional quantity: kg is suggested. Confirm the unit.');
          }
        }
      }
    } else {
      const q = name.match(/\s+(\d+(?:[.,]\d{1,3})?)\s*(kg|g|ml|l)?$/i);
      if (q) {
        quantity = value(q[1]);
        quantityKnown = true;
        unit = (q[2]?.toLowerCase() as ReceiptItem['unit']) || 'piece';
        name = name.slice(0, q.index);
        if (!q[2] && !Number.isInteger(quantity)) {
          unit = 'kg';
          warnings.push('Fractional quantity: kg is suggested. Confirm the unit.');
        }
      }
    }
    const leading = name.match(/^(\d+)\s*[x×]\s*(.+)$/i);
    if (leading) {
      quantity = Number(leading[1]);
      quantityKnown = true;
      name = leading[2];
    }
    const weight = clean.match(/^(\d+[.,]\d{1,3})\s*(kg|g|ml|l)\s*(?:[x×@]|at)?/i);
    if (weight && pending) {
      name = pending;
      quantity = value(weight[1]);
      quantityKnown = true;
      unit = weight[2].toLowerCase() as ReceiptItem['unit'];
      warnings.push('Description joined from the previous line. Check the match.');
    }
    name = name.replace(/^\d{6,14}\s+/, '').trim();
    if (!name || !/[\p{L}]{2}/u.test(name) || ignored.test(name) || name.length > 160) continue;
    const lineTotal = amounts.length ? value(amounts.at(-1)!) : undefined;
    if (lineTotal !== undefined && (lineTotal < 0 || !Number.isFinite(lineTotal))) {
      draft.warnings.push('A refund or discount line was excluded. The item subtotal may differ.');
      continue;
    }
    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 10000 ||
      (unit === 'piece' && quantity > 50)
    ) {
      quantity = 1;
      quantityKnown = false;
    }
    if (!quantityKnown)
      warnings.push('Quantity was unclear. A placeholder of 1 needs your review.');
    const pack = name.match(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|ml|cl|dl|l)\b/i)?.[0] || '';
    if (lineTotal === undefined) warnings.push('Line price could not be read.');
    else if (amounts.length === 1)
      warnings.push('Only one price was recognised. Check the line total.');
    draft.items.push({
      key: String(i),
      name,
      quantity,
      unit: pack && unit === 'piece' ? 'pack' : unit,
      pack,
      ...(lineTotal !== undefined ? { lineTotal } : {}),
      raw: raw.slice(0, 400),
      warnings,
      selected: quantityKnown,
    });
    pending = '';
  }
  if (!draft.items.length)
    draft.warnings.push(
      'No item rows recognised. Crop to the item table, try another photo, or paste the text.',
    );
  if (!draft.date)
    draft.warnings.push('Purchase date was not recognised. Enter it if you want to keep it.');
  if (!draft.currency)
    draft.warnings.push('Currency was not recognised. Choose the currency printed on the receipt.');
  const sum = draft.items.reduce((n, i) => n + (i.lineTotal || 0), 0);
  if (draft.total !== undefined && Math.abs(sum - draft.total) > 0.02)
    draft.warnings.push(
      'Recognised line totals do not match the receipt total. Check for missing items, discounts or OCR errors.',
    );
  return draft;
}
export function receiptListItem(
  item: ReceiptItem,
  meta: { fingerprint: string; store: string; date: string; currency: string },
  list: string,
) {
  if (
    !['piece', 'pack', 'kg', 'g', 'l', 'ml'].includes(item.unit) ||
    item.pack.length > 100 ||
    meta.store.length > 160 ||
    !['EUR', 'USD', 'CHF', 'GBP', 'DKK', 'SEK', 'NOK', 'PLN', 'CZK', 'HUF', 'RON', 'ISK'].includes(
      meta.currency,
    ) ||
    (meta.date && !validDate(meta.date)) ||
    (item.lineTotal !== undefined &&
      (!Number.isFinite(item.lineTotal) || item.lineTotal < 0 || item.lineTotal > 100000))
  )
    throw new Error('Check receipt units, prices, store, currency and date.');
  if (
    !item.name.trim() ||
    item.name.trim().length > 160 ||
    !Number.isFinite(item.quantity) ||
    item.quantity <= 0 ||
    item.quantity > 10000
  )
    throw new Error('Check item names and quantities before adding.');
  return {
    name: item.name.trim(),
    quantity: item.quantity,
    unit: item.unit,
    pack: item.pack,
    category: 'Other',
    notes: '',
    store: meta.store,
    substitution: 'ask',
    product: null,
    list,
    done: false,
    price: null,
    actualPrice: null,
    receipt: {
      fingerprint: meta.fingerprint,
      line: item.key,
      label: item.name.trim(),
      store: meta.store,
      date: meta.date,
      currency: meta.currency,
      ...(item.lineTotal !== undefined ? { lineTotal: item.lineTotal } : {}),
    },
  };
}
