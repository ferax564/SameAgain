const CACHE = 'same-again-shell-v4';
const OCR_CACHE = 'same-again-ocr-v1';
const CURRENT = [CACHE, OCR_CACHE];
// Response header recording when an asset or the shell was stored (eviction by generation).
const STAMP = 'X-Same-Again-Cached';
const MAX_ASSETS = 150;
const MAX_OCR = 40;
// Household records and operations live in an account-scoped outbox, never this cache.
function shell(response) {
  return response.ok && !response.redirected && response.headers.get('X-Same-Again-Shell') === '1';
}
function isAsset(pathname) {
  return (
    pathname.startsWith('/assets/') ||
    pathname.endsWith('.js') ||
    pathname.endsWith('.mjs') ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.wasm')
  );
}
// Only successful, same-origin, non-HTML responses of the expected type are cached: an access
// gate, SPA fallback or error page must never be served later in place of a script.
function cacheable(pathname, response) {
  if (!response.ok || response.redirected || response.status !== 200) return false;
  if (response.type === 'opaque' || response.type === 'error') return false;
  const type = (response.headers.get('Content-Type') || '').toLowerCase();
  if (type.includes('text/html')) return false;
  if (/\.m?js$/.test(pathname)) return !type || type.includes('javascript');
  if (pathname.endsWith('.css')) return !type || type.includes('text/css');
  if (pathname.endsWith('.wasm')) return !type || type.includes('wasm') || type.includes('octet');
  return true;
}
async function stamped(response) {
  const headers = new Headers(response.headers);
  headers.set(STAMP, String(Date.now()));
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
function referencedAssets(html) {
  const out = new Set();
  for (const m of html.matchAll(/["'(=](\/assets\/[^"'()\s>]+)/g)) out.add(m[1]);
  return out;
}
function keyPath(request) {
  return new URL(typeof request === 'string' ? request : request.url, location.origin).pathname;
}
// Drop the oldest entries (insertion order) beyond `max`, never touching `keep`.
async function trim(cache, max, keep = new Set(), filter = () => true) {
  const keys = (await cache.keys()).filter((k) => filter(keyPath(k)));
  let excess = keys.length - max;
  for (const k of keys) {
    if (excess <= 0) break;
    if (keep.has(keyPath(k))) continue;
    await cache.delete(k);
    excess--;
  }
}
// Remove assets of earlier builds: anything the current shell does not reference and that
// was stored before the current shell. Assets loaded lazily by this build (stored after the
// shell) stay. Then bound the cache size.
async function evictAssets() {
  const cache = await caches.open(CACHE);
  const current = await cache.match('/');
  const keep = current ? referencedAssets(await current.clone().text()) : new Set();
  const since = (current && Number(current.headers.get(STAMP))) || 0;
  if (since)
    for (const k of await cache.keys()) {
      const path = keyPath(k);
      if (path === '/' || !isAsset(path) || keep.has(path)) continue;
      const hit = await cache.match(k);
      if ((Number(hit && hit.headers.get(STAMP)) || 0) < since) await cache.delete(k);
    }
  await trim(cache, MAX_ASSETS, keep, isAsset);
}
async function storeShell(response) {
  const cache = await caches.open(CACHE);
  const previous = await cache.match('/');
  const next = await stamped(response);
  const changed = !previous || (await previous.clone().text()) !== (await next.clone().text());
  await cache.put('/', next);
  if (changed) await evictAssets();
}
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      await c.addAll([
        '/manifest.webmanifest',
        '/favicon.svg',
        '/theme-init.js',
        '/icons/icon-192.png',
        '/icons/icon-512.png',
        '/apple-touch-icon.png',
      ]);
      try {
        const r = await fetch('/', { cache: 'reload' });
        if (shell(r)) await c.put('/', await stamped(r));
      } catch {}
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (k) =>
              (k.startsWith('same-again-shell-') || k.startsWith('same-again-ocr-')) &&
              !CURRENT.includes(k),
          )
          .map((k) => caches.delete(k)),
      );
      try {
        await evictAssets();
      } catch {}
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('fetch', (event) => {
  const u = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    u.origin !== location.origin ||
    u.pathname.startsWith('/api/') ||
    u.pathname.includes('chatgpt') ||
    u.pathname === '/callback'
  )
    return;
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const r = await fetch(event.request, { signal: AbortSignal.timeout(8000) });
          if (u.pathname === '/' && shell(r)) {
            const copy = r.clone();
            event.waitUntil(storeShell(copy).catch(() => {}));
          }
          return r;
        } catch {
          return (
            (await caches.match('/')) ||
            new Response('Open Same Again online once before shopping offline.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' },
            })
          );
        }
      })(),
    );
    return;
  }
  // Receipt OCR worker, core and language models: cache-first so OCR works offline after
  // its first use. Versioned paths (/ocr/v7/) make entries immutable.
  if (u.pathname.startsWith('/ocr/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(OCR_CACHE);
        const hit = await cache.match(event.request, { ignoreSearch: true });
        if (hit) return hit;
        const r = await fetch(event.request);
        if (cacheable(u.pathname, r)) {
          const copy = r.clone();
          event.waitUntil(
            cache
              .put(event.request, copy)
              .then(() => trim(cache, MAX_OCR))
              .catch(() => {}),
          );
        }
        return r;
      })(),
    );
    return;
  }
  if (isAsset(u.pathname))
    event.respondWith(
      (async () => {
        const hit = await caches.match(event.request);
        if (hit) return hit;
        const r = await fetch(event.request);
        if (cacheable(u.pathname, r)) {
          const copy = r.clone();
          event.waitUntil(
            (async () => {
              const cache = await caches.open(CACHE);
              await cache.put(event.request, await stamped(copy));
              // Bound the cache without evicting the current shell's own assets.
              if ((await cache.keys()).length > MAX_ASSETS + 10) await evictAssets();
            })().catch(() => {}),
          );
        }
        return r;
      })(),
    );
});
