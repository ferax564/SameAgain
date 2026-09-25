import { productSearchText } from './catalogue-search';
import { rankSearch } from './catalogue-search';
import { env } from 'cloudflare:workers';
import report from './swiss-retailer-report.json';
import { barcode, type Product } from './domain';
import { db } from './server';
import { betterAlternatives } from './health-score';
/**
 * Compact search record written by scripts/import-off-dump.py. Derivable fields (id,
 * source URL, countries, retrieval date) are restored on load; full details live in
 * the barcode shards.
 */
type Compact = {
  b: string;
  n: string;
  r?: string;
  q?: string;
  s?: string[];
  c: string[];
  i?: string;
  l?: string[];
  a?: string[];
  /** Nutri-Score grade, optionally followed by the score: `c7`, `a-2`. */
  g?: string;
  v?: 1 | 2 | 3 | 4;
};
type Index = { format: 2; retrieved: number; products: Compact[] };
const assets = () =>
  (env as unknown as { ASSETS: { fetch(request: Request): Promise<Response> } }).ASSETS;
const assetUrl = (path: string, requestUrl?: string) =>
  new URL(path, requestUrl || 'https://same-again.frx.chatgpt.site');
/** OFF's image folder for a code: 13 digits split 3/3/3/4, shorter codes zero-padded. */
export function imageFolder(code: string) {
  const c = code.length < 13 ? code.padStart(13, '0') : code;
  return c.length === 13 ? [c.slice(0, 3), c.slice(3, 6), c.slice(6, 9), c.slice(9)].join('/') : c;
}
export function expandCompact(r: Compact, retrieved: number): Product {
  const p: Product = {
    id: 'off:' + r.b,
    barcode: r.b,
    name: r.n,
    brand: r.r || '',
    pack: r.q || '',
    stores: r.s || [],
    additives: r.a || [],
    categories: r.c,
    countries: ['en:switzerland'],
    nutrition: {},
    source: 'Open Food Facts',
    sourceUrl: 'https://world.openfoodfacts.org/product/' + r.b,
    retrieved,
  };
  if (r.i)
    p.image = r.i.startsWith('https://')
      ? r.i
      : `https://images.openfoodfacts.org/images/products/${imageFolder(r.b)}/${r.i}.jpg`;
  if (r.l) p.labels = r.l;
  const g = r.g?.match(/^([a-e])(-?\d+)?$/);
  if (g)
    p.nutriscore = {
      grade: g[1] as 'a',
      ...(g[2] !== undefined ? { score: Number(g[2]) } : {}),
      source: 'Open Food Facts',
    };
  if (r.v) p.nova = r.v;
  return p;
}
// Load the licensed data asset on the server, rather than compiling tens of thousands
// of product objects into JavaScript or sending the full index to each browser. Search
// text is computed once per isolate; Product objects are built only for results.
let loaded: Promise<{ rows: Compact[]; text: string[]; retrieved: number }> | undefined;
async function index(requestUrl?: string) {
  if (!loaded)
    loaded = (async () => {
      const r = await assets().fetch(
        new Request(assetUrl('/catalogue/swiss-retailer-products.json', requestUrl)),
      );
      if (!r.ok) throw new Error('Local catalogue asset unavailable');
      const data = (await r.json()) as Index;
      if (data.format !== 2) throw new Error('Unsupported catalogue format');
      return {
        rows: data.products,
        text: data.products.map((c) =>
          productSearchText({ name: c.n, brand: c.r, barcode: c.b, pack: c.q, categories: c.c }),
        ),
        retrieved: data.retrieved,
      };
    })().catch((e) => {
      loaded = undefined;
      throw e;
    });
  return loaded;
}
// Full records by barcode, sharded by the last two digits (padding-invariant). A few
// recently used shards stay in memory per isolate.
const shards = new Map<string, Promise<Record<string, Product>>>();
const SHARD_CACHE = 6;
async function shard(key: string, requestUrl?: string) {
  let s = shards.get(key);
  if (s) {
    shards.delete(key);
    shards.set(key, s);
    return s;
  }
  s = (async () => {
    const r = await assets().fetch(
      new Request(assetUrl(`/catalogue/barcodes/${key}.json.gz`, requestUrl)),
    );
    if (!r.ok) throw new Error('Barcode shard unavailable');
    // Normally served as a stored gzip file; a host that adds Content-Encoding hands over
    // plain JSON instead, so check the gzip magic bytes.
    const bytes = new Uint8Array(await r.arrayBuffer());
    const text =
      bytes[0] === 0x1f && bytes[1] === 0x8b
        ? await new Response(
            new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
          ).text()
        : new TextDecoder().decode(bytes);
    return JSON.parse(text) as Record<string, Product>;
  })();
  s.catch(() => shards.delete(key));
  shards.set(key, s);
  while (shards.size > SHARD_CACHE) shards.delete(shards.keys().next().value!);
  return s;
}
/** Codes under which OFF may have recorded a normalised barcode. */
function spellings(code: string) {
  const out = [code];
  if (code.length === 13) {
    out.push('0' + code);
    if (code.startsWith('0')) out.push(code.slice(1));
  }
  if (code.length === 12) out.push('0' + code);
  return out;
}
export const swissCoverage = report;
export async function swissBarcode(code: string, requestUrl?: string) {
  const b = barcode(code);
  if (!b.valid) return undefined;
  for (const c of [b.code, ...(b.alternatives || [])]) {
    const records = await shard(c.slice(-2), requestUrl);
    for (const s of spellings(c)) if (Object.hasOwn(records, s)) return records[s];
  }
  return undefined;
}
export async function swissSearch(
  q: string,
  country?: string,
  category?: string,
  store?: string,
  requestUrl?: string,
) {
  const { rows, text, retrieved } = await index(requestUrl);
  const terms = q ? productSearchText({ name: q, categories: [] }).split(' ') : [];
  const matches: Product[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (store && !r.s?.some((s) => s.toLowerCase() === store)) continue;
    if (category && !r.c.includes(category)) continue;
    if (terms.length && !terms.every((t) => text[i].includes(t))) continue;
    matches.push(expandCompact(r, retrieved));
  }
  return rankSearch(matches, q, { country, category });
}
/**
 * Indexed products in the same specific category, for alternative suggestions. Only
 * retailer-linked records are searched; `store` narrows to one retailer tag.
 */
export async function swissCategory(category: string, store?: string, requestUrl?: string) {
  const { rows, retrieved } = await index(requestUrl);
  const out: Product[] = [];
  for (const r of rows)
    if (r.c.includes(category) && (!store || r.s?.some((s) => s.toLowerCase() === store)))
      out.push(expandCompact(r, retrieved));
  return out;
}
export async function persistSwiss(products: Product[]) {
  for (let i = 0; i < products.length; i += 25)
    await db().batch(
      products.slice(i, i + 25).map((p) =>
        db()
          .prepare(
            "INSERT INTO catalogue(id,data,retrieved,search_text,barcode) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,retrieved=excluded.retrieved,search_text=excluded.search_text,barcode=excluded.barcode WHERE catalogue.retrieved<=excluded.retrieved AND COALESCE(json_extract(catalogue.data,'$.detailsRetrieved'),0)<=COALESCE(json_extract(excluded.data,'$.detailsRetrieved'),0)",
          )
          .bind(p.id, JSON.stringify(p), p.retrieved, productSearchText(p), p.barcode ?? null),
      ),
    );
}
/**
 * Retailer-linked products in the original's most specific category with a clearly better
 * health score. `store` narrows to one retailer tag, e.g. `migros`.
 */
export async function swissBetter(original: Product, store?: string, requestUrl?: string) {
  const category = original.categories.at(-1);
  if (!category) return [];
  return betterAlternatives(original, await swissCategory(category, store, requestUrl));
}
/**
 * Best saved-catalogue product for each receipt label, only when every meaningful word of
 * the label appears in the product's name, brand or categories. Receipt abbreviations
 * often match nothing; that is reported as `null`, never guessed.
 */
export async function swissMatch(labels: string[], store?: string, requestUrl?: string) {
  const { rows, text, retrieved } = await index(requestUrl);
  return labels.map((label) => {
    const terms = productSearchText({ name: label, categories: [] })
      .split(' ')
      .filter((t) => t.length >= 2 && !/\d/.test(t));
    if (terms.filter((t) => t.length >= 4).length < 1 || terms.length < 2) return null;
    const hits: Product[] = [];
    for (let i = 0; i < rows.length && hits.length < 200; i++) {
      const r = rows[i];
      if (store && !r.s?.some((s) => s.toLowerCase() === store)) continue;
      if (terms.every((t) => text[i].includes(t))) hits.push(expandCompact(r, retrieved));
    }
    return rankSearch(hits, terms.join(' '), { limit: 1 })[0] || null;
  });
}
