// Receipt text is evidence of a past purchase, never a product identifier or stock feed.
export type ReceiptItem = {
  key: string;
  name: string;
  quantity: number;
  unit: 'piece' | 'pack' | 'kg' | 'g' | 'l' | 'ml';
  pack: string;
  lineTotal?: number;
  /** Price per piece or per kg/l when the receipt prints `qty x price`. */
  unitPrice?: number;
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
export type ReceiptOptions = {
  /** Currency of the list/household, used when the receipt does not print one. */
  currency?: string;
};
export const receiptCurrencies = [
  'EUR',
  'USD',
  'CHF',
  'GBP',
  'DKK',
  'SEK',
  'NOK',
  'PLN',
  'CZK',
  'HUF',
  'RON',
  'ISK',
];
// Currencies whose receipts print whole amounts (HUF has fillér officially, but
// tills print whole forints).
const zeroDecimal = new Set(['HUF', 'ISK', 'JPY', 'KRW', 'CLP']);
const letterBefore = '(?<![\\p{L}\\d])';
const letterAfter = '(?![\\p{L}])';
/** Detects the receipt currency from codes and symbols; `hint` resolves an ambiguous "kr". */
export function detectCurrency(text: string, hint = '') {
  const code = text.match(
    new RegExp(
      `${letterBefore}(CHF|EURO?|USD|GBP|DKK|SEK|NOK|PLN|CZK|HUF|RON|ISK)${letterAfter}`,
      'iu',
    ),
  )?.[1];
  if (code) return code.toUpperCase().startsWith('EUR') ? 'EUR' : code.toUpperCase();
  if (/€/.test(text)) return 'EUR';
  if (/£/.test(text)) return 'GBP';
  if (new RegExp(`${letterBefore}Ft${letterAfter}`, 'u').test(text)) return 'HUF';
  if (new RegExp(`${letterBefore}zł${letterAfter}`, 'iu').test(text)) return 'PLN';
  if (new RegExp(`${letterBefore}Kč${letterAfter}`, 'u').test(text)) return 'CZK';
  if (new RegExp(`${letterBefore}kr\\.?${letterAfter}`, 'iu').test(text)) {
    if (['DKK', 'SEK', 'NOK', 'ISK'].includes(hint)) return hint;
    if (/[ðþ]|samtals/i.test(text)) return 'ISK';
  }
  return '';
}
const currencyTokens = new RegExp(
  `[€$£]|${letterBefore}(?:CHF|EURO?|USD|GBP|DKK|SEK|NOK|PLN|CZK|HUF|RON|ISK|Ft|kr|zł|Kč|lei|SFr|Fr)\\.?${letterAfter}`,
  'giu',
);
/**
 * Rewrites grouped amounts to plain numbers: `1.234,56`, `1,234.56`, `1'234.50` and
 * `1 234,56` become `1234.56`; with `zero` (whole-unit currencies) `1 758` and
 * `1.299` become `1758` / `1299`. Weights such as `1.500 kg` are left alone.
 */
export function normaliseAmounts(line: string, zero = false) {
  let s = line.replace(/[  ]/g, ' ');
  s = s.replace(
    /(?<![\d.,'’])(\d{1,3})((?:[.'’ ]\d{3})+),(\d{2})(?!\d)/g,
    (_, a, b, c) => a + b.replace(/[.'’ ]/g, '') + '.' + c,
  );
  s = s.replace(
    /(?<![\d.,'’])(\d{1,3})((?:[,'’ ]\d{3})+)\.(\d{2})(?!\d)/g,
    (_, a, b, c) => a + b.replace(/[,'’ ]/g, '') + '.' + c,
  );
  if (zero) {
    s = s.replace(
      /(?<![\d.,'’])([1-9]\d{0,2})((?:[.'’]\d{3})+)(?![\d]|[.,]\d)(?!\s?(?:kg|g|ml|cl|l)\b)/gi,
      (_, a, b) => a + b.replace(/[.'’]/g, ''),
    );
    // A space is only read as a thousands separator when "1 299" is the whole trailing
    // amount after a word; "Kenyér 2 450 900" (count, price, total) and "2 x 299 598"
    // stay separate numbers.
    const m = s.match(/^(?:(.*\s)?(\S+)\s+)?([1-9]\d{0,2}) (\d{3})\s*$/u);
    if (m && (!m[2] || (/\p{L}/u.test(m[2]) && !/^[x×*@]$/iu.test(m[2]))))
      s = (m[1] || '') + (m[2] ? m[2] + ' ' : '') + m[3] + m[4];
  }
  return s;
}
const value = (s: string) => Number(s.replace(',', '.').replace(/\.-$/, '.00'));
const round2 = (n: number) => Math.round(n * 100) / 100;
const totalWords =
  /^(?:total\b|totale\b|totaal\b|totalt\b|summe\b|gesamt\w*\b|zu zahlen\b|montant\b|amount due\b|balance due\b|összesen|samtals\b|i alt\b|att betala\b|summa\b|razem\b|suma\b|celkem\b|te betalen\b|a pagar\b|importo\b)/i;
const footer =
  /^(?:total\b|totale\b|totaal\b|totalt\b|subtotal\b|subtotale\b|sub total\b|summe\b|gesamt\w*\b|zu zahlen\b|montant\b|amount due\b|balance due\b|összesen|samtals\b|i alt\b|att betala\b|summa\b|razem\b|suma\b|celkem\b|te betalen\b|a pagar\b|importo\b|twint\b|visa\b|mastercard\b|maestro\b|cash\b|contanti\b|bancomat\b|barzahlung\b|bar\b|kartenzahlung\b|ec-karte\b|girocard\b|cardholder\b|zahlung\b|pagamento\b|paiement\b)/i;
const ignored =
  /^(?:coop$|migros$|artikel\b|article\b|menge\b|preis\b|aktion\b|qty\b|quantity\b|description\b|mwst\b|tva\b|vat\b|iva\b|p\.?\s?iva\b|ust\b|steuer\b|netto\b|brutto\b|tax\b|change\b|rückgeld\b|resto\b|rendu\b|rabatt\b|discount\b|sconto\b|coupon\b|ersparnis\b|sie sparen\b|sammel\w*\b|anzahl\b|purchase\b|www\.|https:|tel\b|thank\b|danke\b|merci\b|grazie\b)/i;
// Lines that describe the shop rather than an article.
const headerLike =
  /\b(?:str\.|straße|strasse|street|road|rd\.|via|viale|piazza|corso|rue|avenue|av\.|calle|platz|weg|gasse|allee|filiale|branch|kasse|bon\b|beleg|receipt|scontrino|fattura|documento|commerciale|uid|gmbh|ag|srl|s\.r\.l|spa|s\.p\.a|ltd|inc|sa|tel|fax|www|kassierer|cashier|operatore)\b|\b\d{4,5}\s+\p{L}{3,}|\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*$|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/iu;

// Dates printed next to these words are validity/expiry dates, not the purchase date.
const notPurchase =
  /(?:gültig|gueltig|valid|validity|expires?|expiry|scadenza|scad\.?|bis|until|thru|through|best before|mhd|use by|à utiliser|avant|hasta|caduca|einlösbar|redeem)\W*$/i;
const datePatterns: [RegExp, (m: RegExpExecArray, us: boolean) => string][] = [
  [/\b(20\d{2})-(\d{2})-(\d{2})\b/g, (m) => `${m[1]}-${m[2]}-${m[3]}`],
  [
    /\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2}|\d{2})\b/g,
    (m, us) => {
      const y = (m[3].length === 2 ? '20' : '') + m[3];
      let d = m[1],
        mo = m[2];
      // US receipts print month first; otherwise day first unless impossible.
      if ((us && Number(m[1]) <= 12) || Number(m[2]) > 12) [d, mo] = [m[2], m[1]];
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    },
  ],
];
/**
 * Picks the purchase date: dates introduced by "valid until / gültig bis / scadenza"
 * are skipped; a date on the same line as a time wins; otherwise the first date.
 */
export function purchaseDate(text: string, currency = '') {
  const lines = text.split(/\r?\n/);
  const found: { date: string; timed: boolean }[] = [];
  for (const line of lines)
    for (const [re, build] of datePatterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) {
        if (notPurchase.test(line.slice(0, m.index))) continue;
        const date = validDate(build(m, currency === 'USD'));
        if (date) found.push({ date, timed: /\b\d{1,2}:\d{2}\b/.test(line) });
      }
    }
  return (found.find((f) => f.timed) || found[0])?.date || '';
}
export function validDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(s + 'T12:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : '';
}
const itemLine = (s: string, store: string) =>
  s.length <= 60 &&
  /\p{L}{2}/u.test(s) &&
  s.split(/\s+/).length <= 8 &&
  !/[|:@]/.test(s) &&
  !/\d{6,}/.test(s) &&
  !headerLike.test(s) &&
  !ignored.test(s) &&
  !footer.test(s) &&
  (!store || s.toLowerCase() !== store.toLowerCase());

export function parseReceipt(text: string, options: ReceiptOptions = {}): ReceiptDraft {
  const source = text.slice(0, 40000);
  const lines = source
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const hint = receiptCurrencies.includes(options.currency || '') ? options.currency! : '';
  const detected = detectCurrency(source, hint);
  const currency = detected || hint;
  // Whole-unit amounts: a whole-unit currency, or no currency/“kr” and no decimal prices at all.
  const zero =
    zeroDecimal.has(currency) ||
    (!currency && !/(?<![\d.,])\d+[.,]\d{2}(?!\d)/.test(source) && /\d{2,}\s*$/m.test(source));
  const M = zero ? '-?\\d{1,7}(?:[.,]\\d{2}|[.,]-)?' : '-?\\d{1,7}[.,](?:\\d{2}|-)';
  const money = new RegExp(`^${M}$`);
  const taxCode = '(?:[A-H]\\d{0,2}\\*?|\\*+|\\d{1,2}(?:[.,]\\d{1,2})?\\s?%|\\d)';
  const trailingTax = new RegExp(`(\\d)((?:\\s+${taxCode})+)$`);
  const vatRate = new RegExp(
    `\\s(?:iva|mwst|vat|ust)?\\s*(?:4|5|7|10|19|20|21|22)(?:[.,]0{1,2})?\\s?%(?=\\s+${M}(?:\\s|$))`,
    'iu',
  );
  const qtyTimes = new RegExp(
    `^(.*?)(?:^|\\s)(\\d+(?:[.,]\\d{1,3})?)\\s*(kg|g|l|st|stk|stück|pz|pcs|pc|db)?\\.?\\s*[x×*@]\\s*(${M})(?:\\s+(${M}))?$`,
    'iu',
  );
  const store = /\bcoop\b/i.test(source) ? 'Coop' : /\bmigros\b/i.test(source) ? 'Migros' : '';
  const draft: ReceiptDraft = {
    store,
    date: purchaseDate(source, currency),
    currency,
    items: [],
    warnings: [],
  };
  let ended = false,
    pending = '',
    table = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const previous = pending;
    pending = '';
    if (
      /(?:artikel|article|description|item)\b.*(?:menge|qty|quantity|preis|price|total)/i.test(raw)
    ) {
      table = true;
      continue;
    }
    let clean = normaliseAmounts(raw.replace(currencyTokens, ' ').replace(/\s+$/, ''), zero);
    if (footer.test(raw)) {
      if (draft.total === undefined && totalWords.test(raw)) {
        const amounts = clean
          .trim()
          .split(/\s+/)
          .filter((t) => money.test(t));
        const next = normaliseAmounts(
          (lines[i + 1] || '').replace(currencyTokens, ' ').trim(),
          zero,
        );
        const found = amounts.length ? amounts.at(-1)! : money.test(next) ? next : '';
        if (found) draft.total = value(found);
      }
      ended = true;
      continue;
    }
    if (ended || ignored.test(raw) || !/[\p{L}]/u.test(clean) || draft.items.length >= 100)
      continue;
    // Till tax codes can touch the last amount (4.500A = 4.50, tax code 0A).
    if (store === 'Coop') clean = clean.replace(/(\d+[.,]\d{2})[01](?:[A-Z]|4)?(?=\s*$)/g, '$1');
    clean = clean.replace(trailingTax, '$1').replace(vatRate, ' ').trim();
    if (!clean) continue;
    const warnings: string[] = [];
    let name = '',
      quantity = 1,
      unit: ReceiptItem['unit'] = 'piece',
      quantityKnown = false,
      unitPrice: number | undefined,
      lineTotal: number | undefined,
      amounts: string[] = [];

    const times = clean.match(qtyTimes);
    if (times) {
      // "Gurke 2 x 0.95 1.90", "2 St x 0.95", "0,750 kg x 2,99 2,24"
      const q = value(times[2]),
        u = times[3]?.toLowerCase();
      name = times[1].trim();
      if (!name && previous) {
        name = previous;
        warnings.push('Description joined from the previous line. Check the match.');
      }
      if (u === 'kg' || u === 'g' || u === 'l') unit = u;
      else if (!Number.isInteger(q)) {
        unit = 'kg';
        warnings.push('Fractional quantity: kg is suggested. Confirm the unit.');
      }
      quantity = q;
      quantityKnown = true;
      unitPrice = value(times[4]);
      const expected = round2((unit === 'g' ? q / 1000 : q) * unitPrice);
      lineTotal = times[5] !== undefined ? value(times[5]) : expected;
      if (times[5] !== undefined && Math.abs(expected - lineTotal) > 0.02)
        warnings.push('Quantity × price does not match the line total. Check the row.');
      amounts = [times[4], ...(times[5] !== undefined ? [times[5]] : [])];
    } else {
      const columns = zero ? [clean] : clean.split(/\s{2,}/),
        hasColumns = columns.length > 1 && /[\p{L}]{3}/u.test(columns[0]);
      const tokens = clean.split(/\s+/);
      let start = tokens.findIndex((t) => money.test(t));
      if (zero) {
        // Whole-unit receipts: amounts are the trailing run of numbers.
        let k = tokens.length;
        while (k > 0 && money.test(tokens[k - 1])) k--;
        start = k < tokens.length && k > 0 ? k : -1;
      }
      if (start < 0 && !hasColumns) {
        if (itemLine(clean, store) && i > 0) pending = clean;
        continue;
      }
      if (start < 0 && !table) continue;
      name = hasColumns ? columns[0] : tokens.slice(0, start).join(' ');
      const numeric = hasColumns ? columns.slice(1).join(' ') : tokens.slice(start).join(' ');
      amounts = numeric.split(/\s+/).filter((t) => money.test(t));
      if (hasColumns) {
        const q = numeric.match(/^(\d+(?:[.,]\d{1,3})?|[Il|\]])(?:\s+(kg|g|ml|l))?\s+/i);
        // A price-shaped token (12.00, 10,00) is never a quantity unless a unit follows.
        if (q && (q[2] || !/^\d+[.,]\d{2}$/.test(q[1]))) {
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
        if (q && (q[2] || !/^\d+[.,]\d{2}$/.test(q[1]))) {
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
      // A weight row ("0.750 kg 2.24") belongs to the name on the line just above it.
      const weight = clean.match(/^(\d+[.,]\d{1,3})\s*(kg|g|ml|l)\b/i);
      const weightRow =
        weight &&
        !/\p{L}/u.test(clean.slice(weight[0].length).replace(/\b(?:at|x|kg|l)\b|[×@*/]/gi, ''));
      if (weightRow) {
        if (!previous) continue;
        name = previous;
        quantity = value(weight[1]);
        quantityKnown = true;
        unit = weight[2].toLowerCase() as ReceiptItem['unit'];
        warnings.push('Description joined from the previous line. Check the match.');
      }
      lineTotal = amounts.length ? value(amounts.at(-1)!) : undefined;
      // "Olive oil 12.00 12.00": unit price and line total imply the count.
      if (!quantityKnown && amounts.length === 2 && lineTotal !== undefined) {
        const each = value(amounts[0]),
          n = each > 0 ? lineTotal / each : NaN;
        if (Math.abs(n - Math.round(n)) < 0.001 && n >= 1) {
          quantity = Math.round(n);
          quantityKnown = true;
          unitPrice = each;
        }
      }
      // Whole-unit receipts: "Kenyér 2 450 900" is count, unit price, line total.
      if (!quantityKnown && amounts.length === 3 && lineTotal !== undefined) {
        const [c, each] = [value(amounts[0]), value(amounts[1])];
        if (Number.isInteger(c) && c >= 1 && c <= 50 && Math.abs(c * each - lineTotal) < 0.01) {
          quantity = c;
          quantityKnown = true;
          unitPrice = each;
        }
      }
    }
    name = name.replace(/^\d{6,14}\s+/, '').trim();
    if (!name || !/[\p{L}]{2}/u.test(name) || ignored.test(name) || name.length > 160) continue;
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
    else if (amounts.length === 1 && !times)
      warnings.push('Only one price was recognised. Check the line total.');
    draft.items.push({
      key: String(i),
      name,
      quantity,
      unit: pack && unit === 'piece' ? 'pack' : unit,
      pack,
      ...(lineTotal !== undefined ? { lineTotal } : {}),
      ...(unitPrice !== undefined && Number.isFinite(unitPrice) ? { unitPrice } : {}),
      raw: raw.slice(0, 400),
      warnings,
      selected: quantityKnown,
    });
  }
  if (!draft.items.length)
    draft.warnings.push(
      'No item rows recognised. Crop to the item table, try another photo, or paste the text.',
    );
  if (!draft.date)
    draft.warnings.push('Purchase date was not recognised. Enter it if you want to keep it.');
  if (!detected)
    draft.warnings.push(
      currency
        ? `Currency was not printed on the receipt. ${currency} from the list is assumed.`
        : 'Currency was not recognised. Choose the currency printed on the receipt.',
    );
  const sum = draft.items.reduce((n, i) => n + (i.lineTotal || 0), 0);
  if (draft.total !== undefined && Math.abs(sum - draft.total) > 0.02)
    draft.warnings.push(
      'Recognised line totals do not match the receipt total. Check for missing items, discounts or OCR errors.',
    );
  return draft;
}
/** A list item row built from a reviewed receipt line. */
export type ReceiptListItem = ReturnType<typeof receiptListItem>;
export function receiptListItem(
  item: ReceiptItem,
  meta: { fingerprint: string; store: string; date: string; currency: string },
  list: string,
) {
  if (
    !['piece', 'pack', 'kg', 'g', 'l', 'ml'].includes(item.unit) ||
    item.pack.length > 100 ||
    meta.store.length > 160 ||
    !receiptCurrencies.includes(meta.currency) ||
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
