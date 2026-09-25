import { productSearchText } from './catalogue-search';
import { Product, countryTag, barcode } from './domain';
import { one, run, rate, fail, DAY } from './server';
import { nutrients } from './nutrition';
export const fields =
  'code,product_name,product_name_en,product_name_de,product_name_fr,product_name_it,brands,quantity,image_front_url,ingredients_text,ingredients_text_en,ingredients_text_de,ingredients_text_fr,ingredients_text_it,ingredients_text_es,ingredients,allergens_tags,traces_tags,labels_tags,categories_tags,countries_tags,nutriments,nutrition,nutrition_data_per,product_quantity_unit,serving_size,last_modified_t,last_indexed_datetime,stores,stores_tags,additives_tags';
export interface CatalogueProvider {
  lookup(code: string, user?: string): Promise<Product | null>;
  search(
    q: string,
    country?: string,
    category?: string,
    store?: string,
    user?: string,
  ): Promise<Product[]>;
}
/** One nutrient in an OFF v3.5+ `nutrition.aggregated_set`. */
type OffNutrient = { value?: unknown; unit?: string; source?: string; modifier?: unknown };
/**
 * An Open Food Facts product as returned for the `fields` above. Every field is optional
 * upstream data; other fields may be present.
 */
export interface OffProduct {
  code?: string | number;
  product_name?: string;
  product_name_en?: string;
  product_name_de?: string;
  product_name_fr?: string;
  product_name_it?: string;
  brands?: string | string[];
  quantity?: string;
  image_front_url?: string;
  ingredients_text?: string;
  ingredients_text_en?: string;
  ingredients_text_de?: string;
  ingredients_text_fr?: string;
  ingredients_text_it?: string;
  ingredients_text_es?: string;
  ingredients?: { id?: string }[];
  allergens_tags?: string[];
  traces_tags?: string[];
  labels_tags?: string[];
  categories_tags?: string[];
  countries_tags?: string[];
  nutriments?: Record<string, unknown>;
  nutrition?: {
    aggregated_set?: {
      preparation?: string;
      per?: string;
      nutrients?: Record<string, OffNutrient | undefined>;
    };
  };
  nutrition_data_per?: string;
  product_quantity_unit?: string;
  last_modified_t?: number;
  last_indexed_datetime?: string;
  stores?: string | string[];
  stores_tags?: string[];
  additives_tags?: string[];
  [key: string]: unknown;
}
/** A product or search response as cached, stamped with when it was fetched. */
type OffResponse = {
  product?: OffProduct;
  hits?: OffProduct[];
  timed_out?: boolean;
  _sameAgainRetrieved?: number;
};
export function normalise(p: OffProduct, retrieved = Date.now()): Product {
  const n: Record<string, number> = {};
  const declared = p.nutrition_data_per,
    unit = p.product_quantity_unit;
  let basis: '100g' | '100ml' | undefined =
    declared === '100ml'
      ? '100ml'
      : declared === '100g'
        ? unit === 'ml' || unit === 'l'
          ? '100ml'
          : '100g'
        : undefined;
  // v3.5+ stores values in an explicitly based aggregate, not legacy nutriments.
  const aggregate = p.nutrition?.aggregated_set;
  if (
    aggregate &&
    aggregate.preparation === 'as_sold' &&
    (aggregate.per === '100g' || aggregate.per === '100ml')
  ) {
    basis = aggregate.per;
    const grams: Record<string, number> = { g: 1, mg: 0.001, µg: 0.000001, ug: 0.000001 };
    for (const [key, meta] of Object.entries(nutrients)) {
      const v = aggregate.nutrients?.[key];
      if (
        !v ||
        v.source === 'estimate' ||
        typeof v.value !== 'number' ||
        !Number.isFinite(v.value) ||
        v.value < 0 ||
        v.modifier
      )
        continue;
      const unit = v.unit ?? '';
      if (unit === meta.unit) n[key] = v.value;
      else if (grams[unit] && grams[meta.unit]) n[key] = (v.value * grams[unit]) / grams[meta.unit];
    }
  } else
    for (const k of [
      'energy-kcal',
      'fat',
      'saturated-fat',
      'carbohydrates',
      'sugars',
      'fiber',
      'proteins',
      'salt',
    ]) {
      const value = p.nutriments?.[k + '_100g'];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) n[k] = value;
    }
  return {
    id: 'off:' + String(p.code),
    barcode: String(p.code),
    name: (
      p.product_name ||
      p.product_name_en ||
      p.product_name_de ||
      p.product_name_fr ||
      p.product_name_it ||
      'Unnamed product'
    ).trim(),
    brand: Array.isArray(p.brands) ? p.brands.join(', ') : p.brands || '',
    image: p.image_front_url?.startsWith('https://images.openfoodfacts.org/')
      ? p.image_front_url
      : undefined,
    pack: p.quantity || '',
    stores:
      Array.isArray(p.stores_tags) && p.stores_tags.length
        ? p.stores_tags
        : Array.isArray(p.stores)
          ? p.stores
          : typeof p.stores === 'string'
            ? p.stores.split(',').map((v: string) => v.trim().toLowerCase())
            : [],
    additives: p.additives_tags || [],
    categories: p.categories_tags || [],
    countries: p.countries_tags || [],
    ingredients:
      p.ingredients_text ||
      p.ingredients_text_en ||
      p.ingredients_text_de ||
      p.ingredients_text_fr ||
      p.ingredients_text_it ||
      p.ingredients_text_es ||
      undefined,
    ingredientTags: p.ingredients?.flatMap((i) => (i.id ? [i.id] : [])),
    allergens: p.allergens_tags,
    traces: p.traces_tags,
    labels: p.labels_tags,
    nutrition: n,
    basis,
    source: 'Open Food Facts',
    sourceUrl: 'https://world.openfoodfacts.org/product/' + p.code,
    retrieved,
    sourceUpdated: typeof p.last_modified_t === 'number' ? p.last_modified_t * 1000 : undefined,
    indexedAt: p.last_indexed_datetime || undefined,
  };
}
// Treat input as plain text; only application-owned category/country filters use Lucene syntax.
// The deployed OFF index currently mishandles quoted free text as a literal wildcard field.
export function searchUrl(q: string, country?: string, category?: string, store?: string) {
  const literal = (v: string) => '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const text = q
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((v) => v && !/^(AND|OR|NOT)$/i.test(v))
    .join(' ');
  const clauses = text ? [text] : [];
  if (category) clauses.push('categories_tags:' + literal(category));
  if (store) clauses.push('stores:' + literal(store));
  if (country) clauses.push('countries_tags:' + literal(countryTag(country)));
  return (
    'https://search.openfoodfacts.org/search?' +
    new URLSearchParams({
      q: clauses.join(' '),
      page_size: '24',
      fields,
      langs: 'en,fr,de,it,es,nl',
    })
  );
}
// Upstream failures that indicate Open Food Facts is overloaded or down. Only
// these start the shared cool-down; a bad response to one request does not.
class UpstreamUnavailable extends Error {}
const GLOBAL_LIMIT = { product: 12, search: 8 };
// Per-account limits stay well below the shared ones so one person cannot
// exhaust the catalogue quota for everyone.
const USER_LIMIT = { product: 4, search: 3 };
const USER_DAILY_LIMIT = 200;
async function cached(
  key: string,
  url: string,
  type: 'product' | 'search',
  user?: string,
): Promise<OffResponse | null> {
  const c = await one('SELECT * FROM cache WHERE key=? AND expires>?', key, Date.now());
  if (c) {
    const data: OffResponse = JSON.parse(c.data);
    data._sameAgainRetrieved ??= c.expires - (type === 'product' ? 86400000 : 21600000);
    return data;
  }
  if (
    await one('SELECT key FROM cache WHERE key=? AND expires>?', 'off:cooldown:' + type, Date.now())
  )
    fail(
      'The catalogue is recovering. Cached and private products remain available; retry in a minute.',
      503,
    );
  if (user) {
    await rate('off-' + type + ':' + user, USER_LIMIT[type]);
    await rate('off-day:' + user, USER_DAILY_LIMIT, DAY);
  }
  await rate('off:' + type, GLOBAL_LIMIT[type]);
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          'User-Agent': 'SameAgain/1.1 (https://same-again.frx.chatgpt.site)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(type === 'product' ? 20000 : 15000),
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      if (name === 'TimeoutError' || name === 'AbortError')
        throw new UpstreamUnavailable('Catalogue timeout');
      throw e;
    }
    if (res.status === 404 && type === 'product') return null;
    if (res.status >= 500 || res.status === 429)
      throw new UpstreamUnavailable('Catalogue response ' + res.status);
    if (!res.ok) throw new Error('Catalogue response ' + res.status);
    const data: OffResponse = await res.json();
    data._sameAgainRetrieved = Date.now();
    if (type === 'search' && data.timed_out) throw new UpstreamUnavailable('Search timed out');
    if (type === 'search' && !Array.isArray(data.hits))
      throw new Error('Incomplete search response');
    await run(
      'INSERT INTO cache(key,data,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires=excluded.expires',
      key,
      JSON.stringify(data),
      Date.now() + (type === 'product' ? 86400000 : 21600000),
    );
    return data;
  } catch (e) {
    if (e instanceof UpstreamUnavailable)
      await run(
        'INSERT INTO cache(key,data,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET expires=excluded.expires',
        'off:cooldown:' + type,
        '{}',
        Date.now() + 60000,
      );
    fail(
      'The live catalogue is temporarily unavailable. Use a cached product or add a private product.',
      503,
    );
  }
}
async function persist(p: Product) {
  await run(
    "INSERT INTO catalogue(id,data,retrieved,search_text,barcode) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,retrieved=excluded.retrieved,search_text=excluded.search_text,barcode=excluded.barcode WHERE COALESCE(json_extract(excluded.data,'$.detailsRetrieved'),0)>COALESCE(json_extract(catalogue.data,'$.detailsRetrieved'),0) OR (COALESCE(json_extract(catalogue.data,'$.detailsRetrieved'),0)=0 AND excluded.retrieved>=catalogue.retrieved)",
    p.id,
    JSON.stringify(p),
    p.retrieved,
    productSearchText(p),
    p.barcode ?? null,
  );
  return JSON.parse((await one('SELECT data FROM catalogue WHERE id=?', p.id)).data) as Product;
}
export const off: CatalogueProvider = {
  async lookup(raw, user) {
    const b = barcode(raw);
    if (!b.valid) fail(b.error);
    const data = await cached(
      'product-details-v2:' + b.code,
      'https://world.openfoodfacts.org/api/v3.6/product/' + b.code + '.json?fields=' + fields,
      'product',
      user,
    );
    if (!data?.product) return null;
    return persist({
      ...normalise(data.product, data._sameAgainRetrieved),
      detailsRetrieved: data._sameAgainRetrieved,
    });
  },
  async search(q, country, category, store, user) {
    const url = searchUrl(q, country, category, store);
    const data = await cached('search-v2:' + url, url, 'search', user);
    // `cached` checked that a search response has `hits`.
    const products = (data?.hits ?? [])
      .filter((p) => p.code && (p.product_name || p.product_name_en))
      .map((p) => normalise(p, data?._sameAgainRetrieved))
      .filter(
        (p) =>
          (!country || p.countries.includes(countryTag(country))) &&
          (!category || p.categories.includes(category)) &&
          (!store || p.stores?.some((s) => s.toLowerCase() === store)),
      );
    const saved = [];
    for (const p of products) saved.push(await persist(p));
    return saved;
  },
};
