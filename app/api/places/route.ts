import { env } from 'cloudflare:workers';
import { identity, rate, hash, fail, responseError, DAY } from '@/lib/server';
import { point, places, placesUrl } from '@/lib/places';
// Bounded isolate cache: no user IDs, query logs, or persistent location history.
const cache = new Map<string, { expires: number; data: Record<string, unknown> }>();
export async function GET(req: Request) {
  try {
    const user = await identity();
    // Per-account limits stay well below the shared Photon quota
    // (12 per minute, 300 per day) so one person cannot use it all.
    await rate('places:' + user.id, 4);
    await rate('places-day:' + user.id, 40, DAY);
    const p = new URL(req.url).searchParams;
    let at;
    try {
      if (p.has('lat') || p.has('lon')) at = point(p.get('lat'), p.get('lon'));
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Invalid location.');
    }
    const q = (p.get('q') || '').trim();
    if (!at && (q.length < 2 || q.length > 100))
      fail('Enter a city, neighbourhood or postcode (2–100 characters).');
    const configured = (env as unknown as { PHOTON_BASE_URL?: unknown }).PHOTON_BASE_URL;
    const base =
      typeof configured === 'string' && configured ? configured : 'https://photon.komoot.io/';
    if (!base.startsWith('https://')) fail('Store search is not configured.', 503);
    const url = placesUrl(base, at, q),
      key = await hash(url),
      now = Date.now();
    for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
    const hit = cache.get(key);
    if (hit) return Response.json({ ...hit.data, cached: true });
    await rate('photon:all', 12);
    await rate('photon:daily', 300, DAY);
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'SameAgain/1.1 (https://same-again.frx.chatgpt.site)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    if (!r)
      fail(
        'Place search is temporarily unavailable. Retry later or open the map search below.',
        503,
      );
    if (!r.ok)
      fail(
        'Place search is temporarily unavailable. Retry later or open the map search below.',
        503,
      );
    const upstream: unknown = await r.json().catch(() => null);
    if (!upstream) fail('Place search returned an unreadable response. Retry later.', 503);
    const rows = places(upstream, at),
      data = {
        places: rows,
        kind: at ? 'stores' : 'locations',
        retrieved: now,
        source: 'OpenStreetMap via Photon',
        inventory: 'Not connected',
      };
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: now + 3600000, data });
    return Response.json(data);
  } catch (e) {
    return responseError(e);
  }
}
