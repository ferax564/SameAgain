import { barcode } from './domain';
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
  let stored = await one(
    `SELECT data FROM catalogue WHERE barcode IN (${slots}) ORDER BY retrieved DESC LIMIT 1`,
    ...aliases,
  );
  const imported = await swissBarcode(b.code, requestUrl).catch(() => undefined);
  if (
    imported &&
    (!stored ||
      (!JSON.parse(stored.data).detailsRetrieved &&
        JSON.parse(stored.data).retrieved < imported.retrieved))
  ) {
    await persistSwiss([imported]);
    stored = { data: JSON.stringify(imported) };
  }
  const product = stored ? JSON.parse(stored.data) : null;
  const localNotice = b.local
    ? ' This may be a retailer-specific or variable-weight code; confirm the product and retailer before adding.'
    : '';
  if (
    product &&
    Date.now() - (details ? product.detailsRetrieved || 0 : product.retrieved) < 86400000
  )
    return {
      product,
      notice:
        'Previously retrieved catalogue record; check its source date and current package.' +
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
