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
  source: string;
  sourceUpdated?: number;
  indexedAt?: string;
  sourceUrl?: string;
  retrieved: number;
  demo?: boolean;
};
export type RecordData = {
  id: string;
  household: string;
  kind: string;
  data: any;
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
export const countryTag = (c: string) =>
  'en:' + (countries[c] || c).toLowerCase().replaceAll(' ', '-');
export function barcode(raw: string) {
  const code = raw.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length))
    return { valid: false, code, error: 'Enter an EAN-8, UPC-A, EAN-13 or GTIN-14 barcode.' };
  let sum = 0;
  for (let i = code.length - 2, j = 0; i >= 0; i--, j++)
    sum += Number(code[i]) * (j % 2 === 0 ? 3 : 1);
  if ((10 - (sum % 10)) % 10 !== Number(code.at(-1)))
    return {
      valid: false,
      code,
      error: 'The check digit does not match. Please check the barcode.',
    };
  return {
    valid: true,
    code:
      code.length === 12
        ? '0' + code
        : code.length === 14 && code.startsWith('0')
          ? code.slice(1)
          : code,
    local: /^(2|02)/.test(code),
    error: '',
  };
}
export function pack(s = '') {
  const m = s
    .toLowerCase()
    .replace(',', '.')
    .match(/^(\d+(?:\.\d+)?)\s*(kg|g|ml|l)$/);
  if (!m || Number(m[1]) <= 0) return null;
  return {
    amount: Number(m[1]) * (m[2] === 'kg' || m[2] === 'l' ? 1000 : 1),
    basis: m[2] === 'g' || m[2] === 'kg' ? 'g' : 'ml',
  };
}
export function conversion(a: string, b: string, quantity: number) {
  const x = pack(a),
    y = pack(b);
  if (!x || !y || x.basis !== y.basis) return null;
  return { exact: (quantity * x.amount) / y.amount, original: quantity * x.amount, unit: x.basis };
}
export function canMerge(a: any, b: any) {
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
export function totals(items: any[], currency?: string) {
  const compatible = (i: any) => !currency || !i.priceCurrency || i.priceCurrency === currency;
  const estimated = items
    .filter((i) => !i.done && compatible(i) && Number.isFinite(i.price))
    .reduce((s, i) => s + i.price * i.quantity, 0);
  const actual = items
    .filter((i) => i.done && compatible(i) && Number.isFinite(i.actualPrice))
    .reduce((s, i) => s + i.actualPrice * i.quantity, 0);
  return {
    estimated,
    actual,
    missing: items.filter((i) => !i.done && (!compatible(i) || !Number.isFinite(i.price))).length,
    actualMissing: items.filter(
      (i) => i.done && (!compatible(i) || !Number.isFinite(i.actualPrice)),
    ).length,
  };
}
export function repeatItem(data: any) {
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
export function substituteItem(data: any, product: Product | null) {
  return {
    ...data,
    product: product || undefined,
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
