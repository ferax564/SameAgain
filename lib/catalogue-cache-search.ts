import { db, query } from './server';
import { productSearchText, searchTerms } from './catalogue-search';
import type { Product } from './domain';

// Backfill pre-release caches in small batches. New imports write this field
// alongside the product, so ordinary queries do not reread the full catalogue.
export async function savedCatalogueCandidates(q: string) {
  for (;;) {
    const rows = await query("SELECT id,data FROM catalogue WHERE search_text='' LIMIT 100");
    if (!rows.length) break;
    for (let i = 0; i < rows.length; i += 25)
      await db().batch(
        rows.slice(i, i + 25).map((r) =>
          db()
            .prepare("UPDATE catalogue SET search_text=? WHERE id=? AND search_text=''")
            .bind(productSearchText(JSON.parse(r.data)) || 'unnamed product', r.id),
        ),
      );
  }
  const terms = searchTerms(q);
  const where = terms.length
    ? terms.map(() => "search_text LIKE ? ESCAPE '\\'").join(' AND ')
    : '1=1';
  return (
    await query(
      'SELECT data FROM catalogue WHERE ' + where,
      ...terms.map((t) => '%' + t.replace(/[\\%_]/g, (v) => '\\' + v) + '%'),
    )
  ).map((r) => JSON.parse(r.data) as Product);
}
