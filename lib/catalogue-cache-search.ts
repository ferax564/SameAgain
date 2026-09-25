import { db, query } from './server';
import { productSearchText, searchTerms } from './catalogue-search';
import type { Product } from './domain';

export const SAVED_SEARCH_LIMIT = 200;
const BACKFILL_ROUNDS = 5;

// Backfill pre-release caches in small, bounded batches. New imports write this
// field alongside the product, so ordinary queries do not reread the catalogue.
async function backfillSearchText() {
  for (let round = 0; round < BACKFILL_ROUNDS; round++) {
    const rows = (await query("SELECT id,data FROM catalogue WHERE search_text='' LIMIT 100")) as {
      id: string;
      data: string;
    }[];
    if (!rows.length) break;
    for (let i = 0; i < rows.length; i += 25)
      await db().batch(
        rows.slice(i, i + 25).map((r) =>
          db()
            .prepare("UPDATE catalogue SET search_text=? WHERE id=? AND search_text=''")
            .bind(productSearchText(JSON.parse(r.data)) || 'unnamed product', r.id),
        ),
      );
    if (rows.length < 100) break;
  }
}

/**
 * Saved catalogue matches for a text search. At least one term of two or
 * more characters is required, and the result is always bounded.
 */
export async function savedCatalogueCandidates(q: string) {
  const terms = searchTerms(q).filter((t) => t.length >= 2);
  if (!terms.length) return [];
  await backfillSearchText();
  const where = terms.map(() => "search_text LIKE ? ESCAPE '\\'").join(' AND ');
  return (
    (await query(
      'SELECT data FROM catalogue WHERE ' + where + ' LIMIT ?',
      ...terms.map((t) => '%' + t.replace(/[\\%_]/g, (v) => '\\' + v) + '%'),
      SAVED_SEARCH_LIMIT,
    )) as { data: string }[]
  ).map((r) => JSON.parse(r.data) as Product);
}

/** Saved products in a category, for substitution when live search fails. */
export async function savedCategoryCandidates(category: string) {
  if (!category) return [];
  return (
    (await query(
      "SELECT data FROM catalogue WHERE instr(data,?)>0 AND EXISTS(SELECT 1 FROM json_each(catalogue.data,'$.categories') WHERE value=?) LIMIT ?",
      JSON.stringify(category),
      category,
      SAVED_SEARCH_LIMIT,
    )) as { data: string }[]
  ).map((r) => JSON.parse(r.data) as Product);
}
