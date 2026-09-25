import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const code = readFileSync('public/sw.js', 'utf8');
const ORIGIN = 'https://same.test';
const path = (r) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).pathname;

function runtime() {
  const listeners = {},
    named = new Map([
      ['same-again-shell-v1', new Map()],
      ['unrelated-cache', new Map()],
    ]),
    deleted = [];
  let network = async () => new Response('network');
  const open = (name) => {
    if (!named.has(name)) named.set(name, new Map());
    const store = named.get(name);
    return {
      store,
      async addAll() {},
      async put(k, v) {
        store.delete(path(k)); // re-insert at the end, like Cache
        store.set(path(k), v);
      },
      async match(k) {
        return store.get(path(k))?.clone();
      },
      async keys() {
        return [...store.keys()].map((p) => new Request(ORIGIN + p));
      },
      async delete(k) {
        return store.delete(path(k));
      },
    };
  };
  const caches = {
    async open(name) {
      return open(name);
    },
    async match(k) {
      for (const store of named.values()) if (store.has(path(k))) return store.get(path(k)).clone();
    },
    async keys() {
      return [...named.keys()];
    },
    async delete(name) {
      deleted.push(name);
      return named.delete(name);
    },
  };
  vm.runInNewContext(code, {
    URL,
    Response,
    Request,
    Headers,
    AbortSignal,
    caches,
    location: { origin: ORIGIN },
    fetch: (...a) => network(...a),
    self: {
      addEventListener: (k, v) => (listeners[k] = v),
      async skipWaiting() {},
      clients: { async claim() {} },
    },
  });
  return {
    cache: (name = 'same-again-shell-v4') => open(name).store,
    deleted,
    setNetwork(fn) {
      network = fn;
    },
    async dispatch(request) {
      let response;
      const pending = [];
      listeners.fetch({
        request,
        respondWith(p) {
          response = p;
        },
        waitUntil(p) {
          pending.push(p);
        },
      });
      const r = await response;
      await Promise.all(pending);
      return r;
    },
    async event(name) {
      let p;
      listeners[name]({
        waitUntil(v) {
          p = v;
        },
      });
      await p;
    },
  };
}
const nav = { url: ORIGIN + '/', method: 'GET', mode: 'navigate' };
const get = (p) => ({ url: ORIGIN + p, method: 'GET', mode: 'cors' });
const shellHtml = (...assets) =>
  new Response(assets.map((a) => `<script type="module" src="${a}"></script>`).join(''), {
    headers: { 'X-Same-Again-Shell': '1', 'Content-Type': 'text/html' },
  });
const js = (body = 'export {}') =>
  new Response(body, { headers: { 'Content-Type': 'text/javascript' } });

test('offline navigation serves the previously cached application shell', async () => {
  const r = runtime();
  r.setNetwork(async () => new Response('app shell', { headers: { 'X-Same-Again-Shell': '1' } }));
  await r.dispatch(nav);
  r.setNetwork(async () => {
    throw new Error('offline');
  });
  assert.equal(await (await r.dispatch(nav)).text(), 'app shell');
});
test('API and sign-in requests are never intercepted or cached', async () => {
  const r = runtime();
  for (const p of ['/api/data', '/api/photo', '/signin-with-chatgpt', '/callback'])
    assert.equal(await r.dispatch({ ...nav, url: ORIGIN + p }), undefined);
});
test('access-gate HTML cannot replace the application shell', async () => {
  const r = runtime();
  r.cache().set('/', new Response('app shell'));
  r.setNetwork(async () => new Response('Sign in'));
  await r.dispatch(nav);
  assert.equal(await r.cache().get('/').text(), 'app shell');
});
test('cache upgrade removes only Same Again caches', async () => {
  const r = runtime();
  await r.event('activate');
  assert(r.deleted.includes('same-again-shell-v1'));
  assert(!r.deleted.includes('unrelated-cache'));
  assert(!r.deleted.includes('same-again-shell-v4'));
});
test('HTML or failed responses are never cached for scripts, styles or wasm', async () => {
  const r = runtime();
  r.setNetwork(
    async () => new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }),
  );
  await r.dispatch(get('/assets/index-abc.js'));
  r.setNetwork(async () => new Response('missing', { status: 404 }));
  await r.dispatch(get('/assets/style-abc.css'));
  r.setNetwork(async () => new Response('x', { headers: { 'Content-Type': 'text/plain' } }));
  await r.dispatch(get('/assets/core.wasm'));
  assert.equal(r.cache().size, 0);
  r.setNetwork(async () => js());
  await r.dispatch(get('/assets/index-abc.js'));
  assert(r.cache().has('/assets/index-abc.js'));
});
test('a new shell evicts assets of the previous build but keeps its own', async () => {
  const r = runtime();
  r.setNetwork(async () => shellHtml('/assets/index-old.js'));
  await r.dispatch(nav);
  r.setNetwork(async () => js());
  await r.dispatch(get('/assets/index-old.js'));
  await r.dispatch(get('/assets/lazy-old.js'));
  await new Promise((done) => setTimeout(done, 5));
  r.setNetwork(async () => shellHtml('/assets/index-new.js'));
  await r.dispatch(nav);
  assert(!r.cache().has('/assets/index-old.js'));
  assert(!r.cache().has('/assets/lazy-old.js'));
  r.setNetwork(async () => js());
  await r.dispatch(get('/assets/index-new.js'));
  await r.dispatch(get('/assets/lazy-new.js'));
  await r.event('activate');
  assert(r.cache().has('/assets/index-new.js'));
  assert(r.cache().has('/assets/lazy-new.js'), 'lazily loaded chunks of this build stay');
});
test('the asset cache is bounded without evicting the shell entry assets', async () => {
  const r = runtime();
  r.setNetwork(async () => shellHtml('/assets/index-main.js'));
  await r.dispatch(nav);
  r.setNetwork(async () => js());
  await r.dispatch(get('/assets/index-main.js'));
  for (let i = 0; i < 200; i++) await r.dispatch(get(`/assets/chunk-${i}.js`));
  const assets = [...r.cache().keys()].filter((k) => k.startsWith('/assets/'));
  assert(assets.length <= 160, `cache holds ${assets.length} assets`);
  assert(r.cache().has('/assets/index-main.js'));
  assert(r.cache().has('/assets/chunk-199.js'));
});
test('OCR files are cached on first use and served offline', async () => {
  const r = runtime();
  let calls = 0;
  r.setNetwork(async () => {
    calls++;
    return new Response('model', { headers: { 'Content-Type': 'application/gzip' } });
  });
  await r.dispatch(get('/ocr/v7/lang/eng.traineddata.gz'));
  r.setNetwork(async () => {
    throw new Error('offline');
  });
  const hit = await r.dispatch(get('/ocr/v7/lang/eng.traineddata.gz'));
  assert.equal(await hit.text(), 'model');
  assert.equal(calls, 1);
  assert(r.cache('same-again-ocr-v1').has('/ocr/v7/lang/eng.traineddata.gz'));
});
test('OCR error pages are not cached', async () => {
  const r = runtime();
  r.setNetwork(
    async () => new Response('<html>gate</html>', { headers: { 'Content-Type': 'text/html' } }),
  );
  await r.dispatch(get('/ocr/v7/worker.min.js'));
  r.setNetwork(async () => new Response('nope', { status: 500 }));
  await r.dispatch(get('/ocr/v7/core/tesseract-core.wasm'));
  assert.equal(r.cache('same-again-ocr-v1').size, 0);
});
