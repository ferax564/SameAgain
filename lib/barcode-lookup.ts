import { barcode, type Product } from './domain';
const DAY_MS = 86400000;
/** How long an Open Food Facts export snapshot is served without a live refresh. */
export const SNAPSHOT_MAX_AGE = 30 * DAY_MS;
import { fail, member, one } from './server';
import { off } from './catalogue';
import { swissBarcode, persistSwiss } from './swiss-catalogue';
export async function lookupBarcode(
  raw: string,
  user: string,
  household?: string,
  details = false,
  requestUrl?: string,
) {
  const b = barcode(raw);
  if (!b.valid) fail(b.error);
  // Equivalent spellings: 13/14-digit padding, UPC-A without the leading zero, and the UPC-A
  // expansion of an 8-digit code that is also a valid UPC-E.
  const aliases: string[] = [];
  for (const code of [b.code, ...(b.alternatives || [])]) {
    aliases.push(code);
    if (code.length === 13) {
      aliases.push('0' + code);
      if (code.startsWith('0')) aliases.push(code.slice(1));
    }
    if (code.length === 12) aliases.push('0' + code);
  }
  aliases.splice(0, aliases.length, ...new Set(aliases));
  const slots = aliases.map(() => '?').join(',');
  if (household) {
    await member(household, user);
    const local = await one(
      `SELECT data FROM records WHERE household=? AND kind='product' AND deleted=0 AND json_extract(data,'$.barcode') IN (${slots})`,
      household,
      ...aliases,
    );
    if (local)
      return {
        product: JSON.parse(local.data),
        notice: 'Private household product. Check user-entered details against the package.',
      };
  }
  const stored = await one(
    `SELECT data FROM catalogue WHERE barcode IN (${slots}) ORDER BY retrieved DESC LIMIT 1`,
    ...aliases,
  );
  let product: Product | null = stored ? JSON.parse(stored.data) : null;
  const imported = await swissBarcode(b.code, requestUrl).catch(() => undefined);
  // The export snapshot replaces a saved record with fewer or older details.
  const fromExport =
    !!imported &&
    (!product ||
      (product.detailsRetrieved || 0) < (imported.detailsRetrieved || 0) ||
      (!product.detailsRetrieved && product.retrieved <= imported.retrieved));
  if (fromExport) {
    await persistSwiss([imported]);
    product = imported;
  }
  const snapshot =
    !!imported?.detailsRetrieved && product?.detailsRetrieved === imported.detailsRetrieved;
  const localNotice = b.local
    ? ' This may be a retailer-specific or variable-weight code; confirm the product and retailer before adding.'
    : '';
  // Export snapshots already hold full details; refreshing each scan live would spend
  // the shared Open Food Facts quota on data that rarely changes.
  const maxAge = snapshot ? SNAPSHOT_MAX_AGE : DAY_MS;
  if (
    product &&
    Date.now() - (details || snapshot ? product.detailsRetrieved || 0 : product.retrieved) < maxAge
  )
    return {
      product,
      notice:
        (snapshot
          ? `Open Food Facts export of ${new Date(product.detailsRetrieved!).toISOString().slice(0, 10)}; check the current package.`
          : 'Previously retrieved catalogue record; check its source date and current package.') +
        localNotice,
    };
  try {
    const fresh = await off.lookup(b.code, user);
    if (fresh) return { product: fresh, notice: localNotice || undefined };
    if (product)
      return {
        product,
        notice:
          'No current catalogue result. Showing a previously retrieved record; verify the package.' +
          localNotice,
      };
    return {
      product: null,
      notice: 'Barcode recognised, but no catalogue product was found.' + localNotice,
    };
  } catch (e) {
    if (product)
      return {
        product,
        notice:
          'Full product details could not be refreshed. Showing the saved record; missing fields remain unknown. Retry later or check the package.' +
          localNotice,
      };
    throw e;
  }
}
