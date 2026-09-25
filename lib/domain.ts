export type Product = {
  detailsRetrieved?: number;
  retailer?: string;
  evidence?: 'indexed-link' | 'retailer-page';
  nutritionNote?: string;
  stores?: string[];
  additives?: string[];
  id: string;
  name: string;
  brand?: string;
  image?: string;
  barcode?: string;
  pack?: string;
  categories: string[];
  countries: string[];
  ingredients?: string;
  ingredientTags?: string[];
  allergens?: string[];
  traces?: string[];
  labels?: string[];
  nutrition?: Record<string, number>;
  basis?: '100g' | '100ml';
  /** Nutri-Score as computed by the source (Open Food Facts), never user-entered. */
  nutriscore?: { grade: 'a' | 'b' | 'c' | 'd' | 'e'; score?: number; source?: string };
  /** NOVA processing group recorded by the source. */
  nova?: 1 | 2 | 3 | 4;
  /** Environmental (Green-Score/Eco-Score) grade recorded by the source. */
  ecoscore?: string;
  /** Source ingredient analysis tags such as `en:vegan` or `en:palm-oil-free`. */
  analysis?: string[];
  source: string;
  sourceUpdated?: number;
  indexedAt?: string;
  sourceUrl?: string;
  retrieved: number;
  demo?: boolean;
};
/** Where a list item imported from a reviewed receipt came from (see lib/receipt.ts). */
export type ReceiptSource = {
  fingerprint?: string;
  line?: string;
  label?: string;
  store?: string;
  date?: string;
  currency?: string;
  lineTotal?: number;
  [key: string]: unknown;
};
/**
 * The typed part of a record's JSON payload. Each kind uses a subset: items, favourites and
 * template/trip items (name, quantity, product snapshot, prices...), lists, trips, shops,
 * offers, observations, feedback and substitutions. Recipes and meal plans have their own
 * shapes (see lib/record-types.ts).
 *
 * `product` is the product snapshot on the item-like kinds. Observation and feedback records
 * store the product *id* there instead; read and write those with `productRef` and
 * `withProductRef` from lib/record-types.ts.
 */
export interface KnownRecordFields {
  name?: string;
  list?: string;
  done?: boolean | null;
  quantity?: number | null;
  unit?: string;
  pack?: string;
  category?: string;
  notes?: string;
  substitution?: string;
  priority?: string;
  assigned?: string;
  intendedFor?: string;
  store?: string;
  image?: string;
  price?: number | null;
  actualPrice?: number | null;
  priceCurrency?: string | null;
  currency?: string;
  product?: Product | null;
  order?: number;
  addedBy?: string;
  purchasedBy?: string | null;
  purchasedAt?: number | null;
  originalItem?: string;
  originalVersion?: number;
  archived?: boolean;
  categoryOrder?: string[];
  /** Trips: a timestamp. Observations, offers and meal plans: a `YYYY-MM-DD` date. */
  date?: string | number;
  items?: RecordFields[];
  retailer?: string;
  shopId?: string;
  placeId?: string;
  address?: string;
  country?: string;
  sourceUrl?: string;
  reason?: string;
  feedback?: string;
  /** Observations and feedback: the member who reported it. */
  user?: string;
  /** Meal plans: the member the meal is for. */
  member?: string;
  /** Meal plans: the recipe record id. */
  recipe?: string;
  receipt?: ReceiptSource;
  allergens?: string[];
  traces?: string[];
}
/** A record's JSON payload: the known fields above, anything else `unknown` until narrowed. */
export interface RecordFields extends KnownRecordFields {
  [key: string]: unknown;
}
export type RecordData = {
  id: string;
  household: string;
  kind: string;
  // Record payloads are validated per kind on the server (lib/record-validation.ts).
  data: RecordFields;
  version: number;
  deleted: number;
  createdBy: string;
  updatedBy: string;
  created: number;
  updated: number;
};
export type Constraint = {
  kind: 'preference' | 'exclusion' | 'allergy' | 'certification';
  value: string;
  owner?: string;
};
/** The currency printed on receipts and prices in each supported country. */
export function countryCurrency(country: string) {
  const own: Record<string, string> = {
    US: 'USD',
    GB: 'GBP',
    CH: 'CHF',
    DK: 'DKK',
    SE: 'SEK',
    NO: 'NOK',
    PL: 'PLN',
    CZ: 'CZK',
    HU: 'HUF',
    RO: 'RON',
    IS: 'ISK',
  };
  return own[country] || 'EUR';
}
export const countries: Record<string, string> = {
  AT: 'Austria',
  BE: 'Belgium',
  BG: 'Bulgaria',
  HR: 'Croatia',
  CY: 'Cyprus',
  CZ: 'Czech Republic',
  DK: 'Denmark',
  EE: 'Estonia',
  FI: 'Finland',
  FR: 'France',
  DE: 'Germany',
  GR: 'Greece',
  HU: 'Hungary',
  IS: 'Iceland',
  IE: 'Ireland',
  IT: 'Italy',
  LV: 'Latvia',
  LT: 'Lithuania',
  LU: 'Luxembourg',
  MT: 'Malta',
  NL: 'Netherlands',
  NO: 'Norway',
  PL: 'Poland',
  PT: 'Portugal',
  RO: 'Romania',
  SK: 'Slovakia',
  SI: 'Slovenia',
  ES: 'Spain',
  SE: 'Sweden',
  CH: 'Switzerland',
  GB: 'United Kingdom',
  US: 'United States',
};
// `countries` is a plain object, so prototype keys such as `constructor` or
// `__proto__` would look like supported countries through `countries[x]`.
export function isCountryCode(x: unknown): x is keyof typeof countries {
  return typeof x === 'string' && Object.hasOwn(countries, x);
}
export const countryTag = (c: string) =>
  'en:' +
  (isCountryCode(c) ? countries[c] : String(c ?? '')).toLowerCase().trim().replace(/\s+/g, '-');

export type BarcodeFormatName = 'EAN-8' | 'UPC-E' | 'UPC-A' | 'EAN-13' | 'GTIN-14';
export type BarcodeResult = {
  valid: boolean;
  code: string;
  error: string;
  local?: boolean;
  format?: BarcodeFormatName;
  /** Other normalised codes that may identify the same article (e.g. UPC-A for a UPC-E). */
  alternatives?: string[];
};
// GS1 mod-10 check over every digit but the last.
function checkDigitOk(code: string) {
  let sum = 0;
  for (let i = code.length - 2, j = 0; i >= 0; i--, j++)
    sum += Number(code[i]) * (j % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(code.at(-1));
}
/**
 * Expands an 8-digit UPC-E (number system 0 or 1) to its 12-digit UPC-A.
 * Returns '' when the code is not a well-formed UPC-E.
 */
export function expandUpcE(code: string) {
  if (!/^[01]\d{7}$/.test(code)) return '';
  const [ns, d1, d2, d3, d4, d5, d6, check] = code;
  const body =
    d6 <= '2'
      ? d1 + d2 + d6 + '0000' + d3 + d4 + d5
      : d6 === '3'
        ? d1 + d2 + d3 + '00000' + d4 + d5
        : d6 === '4'
          ? d1 + d2 + d3 + d4 + '00000' + d5
          : d1 + d2 + d3 + d4 + d5 + '0000' + d6;
  return ns + body + check;
}
// In-store / variable-measure numbers: EAN-13 prefix 20–29, and the UPC number
// systems 2 (random weight) and 4 (in-store) which appear as 02… and 04… once a
// UPC-A is padded to 13 digits. Only the normalised EAN-13 form is tested, so a
// UPC-A such as 025000044786 (0025000044786) or a GTIN-14 with indicator 2 is not local.
const isLocal = (normalised: string) => normalised.length === 13 && /^(?:2|02|04)/.test(normalised);
export function barcode(raw: string): BarcodeResult {
  const code = String(raw ?? '').replace(/[\s-]/g, '');
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length))
    return {
      valid: false,
      code,
      error: 'Enter an EAN-8, UPC-A, UPC-E, EAN-13 or GTIN-14 barcode.',
    };
  if (code.length === 8) {
    const upcA = expandUpcE(code);
    const upcOk = !!upcA && checkDigitOk(upcA);
    const eanOk = checkDigitOk(code);
    if (eanOk)
      // Ambiguous 8-digit codes stay EAN-8 but expose the UPC-A expansion for lookup.
      return {
        valid: true,
        code,
        format: 'EAN-8',
        local: false,
        alternatives: upcOk ? ['0' + upcA] : [],
        error: '',
      };
    if (upcOk)
      return {
        valid: true,
        code: '0' + upcA,
        format: 'UPC-E',
        local: isLocal('0' + upcA),
        alternatives: [],
        error: '',
      };
  } else if (checkDigitOk(code)) {
    const normalised =
      code.length === 12
        ? '0' + code
        : code.length === 14 && code.startsWith('0')
          ? code.slice(1)
          : code;
    return {
      valid: true,
      code: normalised,
      format: code.length === 12 ? 'UPC-A' : code.length === 13 ? 'EAN-13' : 'GTIN-14',
      local: isLocal(normalised),
      alternatives: [],
      error: '',
    };
  }
  return {
    valid: false,
    code,
    error: 'The check digit does not match. Please check the barcode.',
  };
}
/**
 * Every normalised code worth looking up for a scanned/typed barcode, primary first.
 * Empty when the barcode is invalid. An 8-digit code that is valid both as EAN-8 and
 * as UPC-E yields [EAN-8, UPC-A as 13 digits].
 */
export function barcodeAlternatives(raw: string): string[] {
  const b = barcode(raw);
  return b.valid ? [b.code, ...(b.alternatives || []).filter((c) => c !== b.code)] : [];
}

export type PackSize = {
  /** Total amount in g or ml (for a multipack: count × each). */
  amount: number;
  basis: 'g' | 'ml';
  /** Number of units in a multipack such as `6 x 330 ml`; 1 otherwise. */
  count: number;
  /** Amount of one unit in g or ml. */
  each: number;
};
const packUnits: Record<string, [number, 'g' | 'ml']> = {
  mg: [0.001, 'g'],
  g: [1, 'g'],
  gr: [1, 'g'],
  grams: [1, 'g'],
  kg: [1000, 'g'],
  ml: [1, 'ml'],
  cl: [10, 'ml'],
  dl: [100, 'ml'],
  l: [1000, 'ml'],
  lt: [1000, 'ml'],
  ltr: [1000, 'ml'],
};
// Parses a printed pack number. Small units (g, ml, cl, dl) are never sold in 1/1000
// steps, so `1.000 g` / `1,000 g` are thousands; for kg and l `1,5` / `1.500` are decimals.
function packNumber(s: string, unit: string) {
  if (/^\d+$/.test(s)) return Number(s);
  const seps = s.match(/[.,']/g) || [];
  const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','), s.lastIndexOf("'"));
  if (new Set(seps).size > 1)
    // Mixed separators (1.234,5 / 1,234.5 / 1'234.5): the last one is the decimal mark.
    return s[last] === "'"
      ? NaN
      : Number(s.slice(0, last).replace(/[.,']/g, '') + '.' + s.slice(last + 1));
  if (seps.length > 1 || seps[0] === "'")
    return /^[1-9]\d{0,2}(?:[.,']\d{3})+$/.test(s) ? Number(s.replace(/[.,']/g, '')) : NaN;
  if (packUnits[unit][0] < 1000 && /^[1-9]\d{0,2}[.,]\d{3}$/.test(s))
    return Number(s.replace(/[.,]/, ''));
  return Number(s.replace(',', '.'));
}
/**
 * Parses a pack size such as `500 g`, `1,5 kg`, `1.000 g`, `75 cl`, `0.5l`,
 * `6 x 330 ml` or `2x125g`. Returns the total amount in g or ml plus the multipack
 * count and per-unit amount, or null when the text is not a pack size.
 */
export function pack(s: string | null | undefined = ''): PackSize | null {
  const t = String(s ?? '')
    .toLowerCase()
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[×*]/g, 'x')
    .replace(/\s+/g, ' ')
    .trim();
  const num = "(\\d+(?:[.,']\\d+)*)";
  const unit = '(mg|kg|grams|gr|g|ml|cl|dl|ltr|lt|l)';
  let count = 1,
    n = '',
    u = '';
  const countFirst = t.match(new RegExp(`^(\\d{1,3}) ?x ?${num} ?${unit}$`));
  const countLast = t.match(new RegExp(`^${num} ?${unit} ?x ?(\\d{1,3})$`));
  const single = t.match(new RegExp(`^${num} ?${unit}$`));
  if (countFirst) {
    count = Number(countFirst[1]);
    n = countFirst[2];
    u = countFirst[3];
  } else if (countLast) {
    n = countLast[1];
    u = countLast[2];
    count = Number(countLast[3]);
  } else if (single) {
    n = single[1];
    u = single[2];
  } else return null;
  const [factor, basis] = packUnits[u];
  const each = Math.round(packNumber(n, u) * factor * 1000) / 1000;
  if (!Number.isFinite(each) || each <= 0 || !Number.isInteger(count) || count < 1) return null;
  return { amount: Math.round(each * count * 1000) / 1000, basis, count, each };
}
export function conversion(
  a: string | null | undefined,
  b: string | null | undefined,
  quantity: number,
) {
  const x = pack(a),
    y = pack(b);
  if (!x || !y || x.basis !== y.basis) return null;
  return { exact: (quantity * x.amount) / y.amount, original: quantity * x.amount, unit: x.basis };
}
/** The shape of a shopping-list item record's `data` that domain helpers read. */
export type ItemLike = {
  name?: string;
  list?: string;
  done?: boolean | null;
  quantity?: number | null;
  unit?: string;
  pack?: string;
  notes?: string;
  substitution?: string;
  assigned?: string;
  intendedFor?: string;
  store?: string;
  image?: string;
  price?: number | null;
  actualPrice?: number | null;
  priceCurrency?: string | null;
  product?: { id?: string; barcode?: string } | null;
};
export function canMerge(a: ItemLike, b: ItemLike) {
  return (
    !!a.product?.id &&
    a.product.id === b.product?.id &&
    a.unit === b.unit &&
    a.pack === b.pack &&
    a.notes === b.notes &&
    a.substitution === b.substitution &&
    a.assigned === b.assigned &&
    a.intendedFor === b.intendedFor &&
    a.store === b.store &&
    a.price === b.price &&
    a.image === b.image
  );
}
/** Case-, accent- and whitespace-insensitive form of an item name for duplicate checks. */
export function itemNameKey(name: string | null | undefined) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en')
    .replace(/[\s ]+/g, ' ')
    .trim();
}
/**
 * Finds a not-done item that the user probably already has on the list: same list
 * (when `list` is given), and either the same product (id or normalised barcode)
 * or the same name ignoring case, accents and whitespace. Accepts record wrappers
 * (`{kind, data}`) or bare item data; returns the matching element. Use `canMerge`
 * on the result to decide whether quantities can simply be combined.
 */
export function findDuplicateItem<
  T extends ItemLike | { kind?: string; deleted?: number; data?: ItemLike },
>(
  items: readonly T[],
  name: string | null | undefined,
  product?: { id?: string; barcode?: string } | null,
  list?: string,
): T | undefined {
  const key = itemNameKey(name);
  const code = product?.barcode ? barcode(product.barcode) : null;
  return items.find((entry) => {
    const wrapped = 'data' in entry && typeof entry.data === 'object' && entry.data !== null;
    if (
      wrapped &&
      (('kind' in entry && entry.kind && entry.kind !== 'item') ||
        ('deleted' in entry && entry.deleted))
    )
      return false;
    const d = (wrapped ? (entry as { data: ItemLike }).data : entry) as ItemLike;
    if (d.done || (list !== undefined && d.list !== undefined && d.list !== list)) return false;
    if (product?.id && d.product?.id === product.id) return true;
    if (code?.valid && d.product?.barcode && barcode(d.product.barcode).code === code.code)
      return true;
    return !!key && itemNameKey(d.name) === key;
  });
}
const clean = (x: string) =>
  x
    .toLowerCase()
    .replace(/^[a-z]{2}:/, '')
    .trim();
export function rank(
  original: Product,
  candidates: Product[],
  country: string,
  constraints: Constraint[] = [],
  priority = 'ingredients',
  substitution = 'similar',
) {
  if (substitution === 'exact') return [];
  return candidates
    .filter((p) => p.id !== original.id && p.countries.includes(countryTag(country)))
    .map((p) => {
      const reasons: string[] = [],
        differences: string[] = [],
        unknown: string[] = [];
      let score = 0;
      let blocked = false;
      const cats = original.categories.filter((x) => p.categories.includes(x));
      if (!cats.length || !p.categories.includes(original.categories.at(-1) || '')) blocked = true;
      else {
        reasons.push('Shared catalogue category: ' + clean(cats.at(-1)!).replaceAll('-', ' '));
        score += priority === 'use' ? 3 : 2;
      }
      for (const c of constraints) {
        const v = clean(c.value).replaceAll('-', ' ');
        if (
          c.kind === 'allergy' &&
          !p.labels?.some((l) => clean(l).replaceAll('-', ' ') === v + ' free')
        ) {
          blocked = true;
          unknown.push('No explicit absence label for ' + c.value);
        }
        if (c.kind === 'preference') {
          if (p.labels?.some((l) => clean(l).replaceAll('-', ' ') === v)) {
            score += 1;
            reasons.push('Declared preference label: ' + c.value);
          } else unknown.push('Preference not established: ' + c.value);
          continue;
        }
        if (c.kind === 'certification') {
          if (!p.labels?.some((l) => clean(l).replaceAll('-', ' ') === v)) {
            blocked = true;
            unknown.push('Required certification not recorded: ' + c.value);
          }
        } else {
          const text = [
            p.ingredients,
            ...(p.ingredientTags || []),
            ...(p.allergens || []),
            ...(p.traces || []),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .replaceAll('-', ' ');
          if (!p.ingredients || (c.kind === 'allergy' && (!p.allergens || !p.traces))) {
            blocked = true;
            unknown.push('Insufficient declarations for ' + c.value);
          }
          if (text.includes(v)) {
            blocked = true;
            differences.push('Contains or may contain ' + c.value);
          }
        }
      }
      const distinctions = [
        ['unsweetened', 'sweetened'],
        ['powder', 'ready-to-drink'],
        ['concentrate', 'ready-to-use'],
      ];
      for (const [a, b] of distinctions) {
        const x = (original.name + ' ' + original.categories.join(' ')).toLowerCase(),
          y = (p.name + ' ' + p.categories.join(' ')).toLowerCase();
        if ((x.includes(a) && !y.includes(a)) || (!x.includes(a) && y.includes(a))) {
          differences.push('Check ' + a + ' versus ' + b + ' variant');
          blocked = true;
        }
      }
      const ia = original.ingredientTags || [],
        ib = p.ingredientTags || [];
      if (ia.length && ib.length) {
        const overlap = ia.filter((x) => ib.includes(x)).length / Math.max(ia.length, ib.length);
        if (overlap >= 0.5) {
          score += priority === 'ingredients' ? 3 : 2;
          reasons.push('Several declared ingredients in common');
        } else differences.push('Ingredient lists differ');
      } else unknown.push('Ingredient comparison incomplete');
      const keys = ['fat', 'sugars', 'proteins', 'salt'];
      if (original.basis && original.basis === p.basis) {
        let n = 0,
          d = 0;
        for (const k of keys) {
          const a = original.nutrition?.[k],
            b = p.nutrition?.[k];
          if (a != null && b != null) {
            n++;
            d += Math.abs(a - b) / Math.max(a, b, 1);
            if (Math.abs(a - b) > 1) differences.push(`${k}: ${a} → ${b} g / ${p.basis}`);
          }
        }
        if (n >= 3 && d / n < 0.3) {
          score += priority === 'nutrition' ? 3 : 2;
          reasons.push('Similar recorded nutritional profile per ' + p.basis);
        } else if (n < 3) unknown.push('Nutrition comparison incomplete');
      } else unknown.push('No compatible nutrition basis');
      if (original.brand && p.brand?.toLowerCase() === original.brand.toLowerCase()) {
        score += priority === 'brand' || substitution === 'brand' ? 3 : 1;
        reasons.push('Same brand');
      }
      const pa = pack(original.pack),
        pb = pack(p.pack);
      if (pa && pb && pa.basis === pb.basis) {
        if (Math.abs(pa.amount - pb.amount) / pa.amount < 0.2) {
          score += priority === 'pack' ? 2 : 1;
          reasons.push('Similar pack size');
        } else differences.push(`Pack size: ${original.pack} → ${p.pack}`);
      } else unknown.push('Pack-size comparison unavailable');
      return {
        product: p,
        score,
        band: score >= 6 ? 'Strong candidate' : 'Worth comparing',
        reasons,
        differences,
        unknown,
        blocked,
        taste: 'Taste and texture have not been established.',
      };
    })
    .filter((x) => !x.blocked && x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}
/*
 * Price semantics (estimated `price` and `actualPrice` on an item):
 * - unit `piece` / `pack` (or anything unrecognised): the price of one piece/pack,
 *   so the line costs quantity × price;
 * - unit `kg` / `g`: the price per kilogram (what shelf labels and receipts print);
 * - unit `l` / `ml`: the price per litre.
 * So 500 g at 2.50 is 500 / 1000 × 2.50 = 1.25, and 2 kg at 2.50 is 5.00.
 * The item editor labels the field with `priceBasis(unit)` ("per kg", "per l").
 */
export function priceBasis(unit: string | null | undefined): 'kg' | 'l' | 'item' {
  return unit === 'kg' || unit === 'g' ? 'kg' : unit === 'l' || unit === 'ml' ? 'l' : 'item';
}
/** Cost of one list line under the price semantics above; NaN when unknown. */
export function lineCost(
  quantity: number | null | undefined,
  unit: string | null | undefined,
  price: number | null | undefined,
) {
  if (!Number.isFinite(price) || !Number.isFinite(quantity)) return NaN;
  const q = Number(quantity),
    p = Number(price);
  return unit === 'g' || unit === 'ml' ? (q / 1000) * p : q * p;
}
export function totals(items: readonly ItemLike[], currency?: string) {
  const compatible = (i: ItemLike) => !currency || !i.priceCurrency || i.priceCurrency === currency;
  const cost = (i: ItemLike, price: number | null | undefined) =>
    lineCost(i.quantity ?? 1, i.unit, price);
  const estimated = items
    .filter((i) => !i.done && compatible(i) && Number.isFinite(cost(i, i.price)))
    .reduce((s, i) => s + cost(i, i.price), 0);
  const actual = items
    .filter((i) => i.done && compatible(i) && Number.isFinite(cost(i, i.actualPrice)))
    .reduce((s, i) => s + cost(i, i.actualPrice), 0);
  return {
    estimated,
    actual,
    missing: items.filter((i) => !i.done && (!compatible(i) || !Number.isFinite(i.price))).length,
    actualMissing: items.filter(
      (i) => i.done && (!compatible(i) || !Number.isFinite(i.actualPrice)),
    ).length,
  };
}
type Repeated = {
  done: false;
  price: null;
  actualPrice: null;
  purchasedAt: null;
  purchasedBy: null;
  originalItem: undefined;
  order: number;
};
export function repeatItem<T extends object>(data: T): Omit<T, keyof Repeated> & Repeated {
  return {
    ...data,
    done: false,
    price: null,
    actualPrice: null,
    purchasedAt: null,
    purchasedBy: null,
    originalItem: undefined,
    order: Date.now(),
  };
}
// A household photograph describes the original identity. Do not attach it to a
// different exact product, or retain an exact pack shot after choosing generic.
export function substituteItem<T extends ItemLike, P extends Product | null>(
  data: T,
  product: P,
): Omit<T, 'product' | 'image' | 'name' | 'pack'> & {
  product: P extends Product ? Product : undefined;
  image: string | undefined;
  name: string | undefined;
  pack: string | undefined;
} {
  return {
    ...data,
    product: (product || undefined) as P extends Product ? Product : undefined,
    image: product?.id === data.product?.id ? data.image : undefined,
    name: product?.name || data.name,
    pack: product?.pack || data.pack,
  };
}

export function uid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
