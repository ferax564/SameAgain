import {
  swissSearch,
  swissBarcode,
  swissCoverage,
  swissBetter,
  swissMatch,
} from '@/lib/swiss-catalogue';
import { rankSearch } from '@/lib/catalogue-search';
import { barcode, countries } from '@/lib/domain';
import { retailers } from '@/lib/retailers';
import imported from '@/lib/retailer-products.json';
import type { Product } from '@/lib/domain';
import { rate } from '@/lib/server';

// The demo needs no sign-in, so it is throttled per client IP instead.
async function throttled(req: Request) {
  const ip = req.headers.get('cf-connecting-ip');
  if (!ip) return false;
  try {
    await rate('demo-ip:' + ip, 60);
    return false;
  } catch (e) {
    return (e as { status?: number }).status === 429;
  }
}

// Only the shipped, publicly licensed catalogue and public retailer links.
// Never reads accounts, household records, photos, database caches or secrets.
export async function GET(req: Request) {
  if (await throttled(req))
    return Response.json(
      { error: 'Please wait before searching the demo again.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  const p = new URL(req.url).searchParams;
  const q = (p.get('q') || '').slice(0, 120),
    country = p.get('country') || undefined,
    retailer = p.get('retailer') || undefined;
  if (
    (country && !Object.hasOwn(countries, country)) ||
    (retailer && (!Object.hasOwn(retailers, retailer) || retailers[retailer].country !== country))
  )
    return Response.json({ error: 'Choose a matching retailer and country.' }, { status: 400 });
  const headers = { 'Cache-Control': 'public, max-age=300' };
  try {
    if (p.has('match')) {
      const labels = p
        .getAll('match')
        .slice(0, 60)
        .map((v) => v.slice(0, 160));
      return Response.json(
        {
          matches: await swissMatch(
            labels,
            retailer ? retailers[retailer].tag : undefined,
            req.url,
          ),
        },
        { headers },
      );
    }
    if (p.get('better')) {
      const b = barcode(p.get('better')!);
      if (!b.valid) return Response.json({ error: b.error }, { status: 400 });
      const product = await swissBarcode(b.code, req.url);
      return Response.json(
        {
          alternatives: product
            ? await swissBetter(product, retailer ? retailers[retailer].tag : undefined, req.url)
            : [],
        },
        { headers },
      );
    }
    if (p.get('barcode')) {
      const b = barcode(p.get('barcode')!);
      if (!b.valid) return Response.json({ error: b.error }, { status: 400 });
      return Response.json(
        {
          product: (await swissBarcode(b.code, req.url)) || null,
          notice:
            'Saved catalogue record. Check the package; the demo does not refresh live product details.',
        },
        { headers },
      );
    }
    const fromRetailer = p.get('source') === 'retailer';
    const rows = fromRetailer
      ? rankSearch(imported as Product[], q, { country, retailer, limit: 48 })
      : await swissSearch(
          q,
          country,
          undefined,
          retailer ? retailers[retailer].tag : undefined,
          req.url,
        );
    const products = rankSearch(rows, q, {
      country,
      retailer,
      label: p.get('label') || undefined,
      limit: 48,
    });
    return Response.json(
      {
        products,
        hasMore: false,
        coverage: fromRetailer
          ? {
              imported: imported.filter((r) => r.retailer === retailer).length,
              pageDetails: imported.filter(
                (r) => r.retailer === retailer && r.evidence === 'retailer-page',
              ).length,
            }
          : swissCoverage,
        notice: fromRetailer
          ? 'Public retailer sources, partial import. Your demo shopping activity stays on this device.'
          : 'Real Open Food Facts records from the saved Swiss index. Demo changes stay on this device. Live refresh is available in your household.',
      },
      { headers },
    );
  } catch {
    return Response.json(
      { error: 'The saved catalogue is unavailable. Try again shortly.' },
      { status: 503 },
    );
  }
}
