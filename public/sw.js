const CACHE = 'same-again-shell-v3';
// Household records and operations live in an account-scoped outbox, never this cache.
function shell(response) {
  return response.ok && !response.redirected && response.headers.get('X-Same-Again-Shell') === '1';
}
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      await c.addAll(['/manifest.webmanifest', '/favicon.svg']);
      try {
        const r = await fetch('/', { cache: 'reload' });
        if (shell(r)) await c.put('/', r);
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
          .filter((k) => k.startsWith('same-again-shell-') && k !== CACHE)
          .map((k) => caches.delete(k)),
      );
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
            event.waitUntil(caches.open(CACHE).then((c) => c.put('/', copy)));
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
  if (
    u.pathname.startsWith('/assets/') ||
    u.pathname.endsWith('.js') ||
    u.pathname.endsWith('.css')
  )
    event.respondWith(
      (async () => {
        const hit = await caches.match(event.request);
        if (hit) return hit;
        const r = await fetch(event.request);
        if (r.ok && !r.redirected) {
          const copy = r.clone();
          event.waitUntil(caches.open(CACHE).then((c) => c.put(event.request, copy)));
        }
        return r;
      })(),
    );
});
