import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { ZodError } from 'zod';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { assertionSecret, verifyIdentityAssertion, USER_ID_HEADER } from './identity-assertion';
import { photoKeys } from './photo-files';
export const db = () => {
  if (!env.DB) throw new Error('Database unavailable');
  return env.DB;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const query = async (sql: string, ...args: unknown[]): Promise<any[]> => {
  const r = await db()
    .prepare(sql)
    .bind(...args)
    .all();
  return r.results;
};
export const one = async (sql: string, ...args: unknown[]) => (await query(sql, ...args))[0];
export const run = async (sql: string, ...args: unknown[]) =>
  db()
    .prepare(sql)
    .bind(...args)
    .run();
export function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
export const DELETED_MEMBER = 'Deleted member';

// Per-isolate memory of the last profile written for each account, so that a
// normal request does not write to D1 just to refresh the users row.
const knownUsers = new Map<string, { signature: string; at: number }>();
const KNOWN_USER_TTL = 5 * 60000;
export function forgetUser(id: string) {
  knownUsers.delete(id);
}
export async function syncUser(id: string, name: string, email: string, force = false) {
  const signature = name + '\n' + email,
    now = Date.now(),
    known = knownUsers.get(id);
  if (!force && known && known.signature === signature && now - known.at < KNOWN_USER_TTL) return;
  // Writes only when the account is new or its provider name or email changed.
  // A name the person chose in their profile (custom_name=1) is kept.
  const changed = await one(
    'INSERT INTO users(id,name,email,created) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=CASE WHEN users.custom_name=1 THEN users.name ELSE excluded.name END,email=excluded.email WHERE users.email IS NOT excluded.email OR (users.custom_name=0 AND users.name IS NOT excluded.name) RETURNING id',
    id,
    name,
    email,
    now,
  );
  // Member names are part of every household response, so changed profiles
  // must invalidate the household ETag.
  if (changed)
    await run(
      'UPDATE households SET revision=revision+1 WHERE id IN (SELECT household FROM memberships WHERE user=?)',
      id,
    );
  if (knownUsers.size > 5000) knownUsers.clear();
  knownUsers.set(id, { signature, at: now });
}
export async function identity() {
  const person = await getChatGPTUser();
  const h = await headers();
  const id = h.get(USER_ID_HEADER);
  if (!person || !id) fail('Sign in to access your household.', 401);
  // Optional signed dispatcher assertion (IDENTITY_ASSERTION_SECRET); see
  // lib/identity-assertion.ts. The same check guards getChatGPTUser().
  if (!(await verifyIdentityAssertion(h, assertionSecret(env))))
    fail('Sign in to access your household.', 401);
  await syncUser(id, person.displayName, person.email);
  await maybeCleanup();
  return { id, name: person.displayName, email: person.email };
}
export async function member(h: string, u: string, admin = false) {
  const m = await one('SELECT * FROM memberships WHERE household=? AND user=?', h, u);
  if (!m) fail('You do not have access to this household.', 403);
  if (admin && !['owner', 'admin'].includes(m.role)) fail('An administrator is required.', 403);
  return m as { household: string; user: string; role: string };
}
/**
 * Fixed-window counter. Keys that contain a user id must use the form
 * `<name>:<user id>` so account deletion can remove them.
 */
export async function rate(key: string, max: number, window = 60000) {
  const slot = Math.floor(Date.now() / window);
  const r = await one(
    'INSERT INTO limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',
    key + ':' + slot,
    (slot + 1) * window,
  );
  if (r.count > max) fail('Please wait before trying again.', 429);
}
export const DAY = 86400000;
export async function hash(token: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
  )
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
/**
 * State-changing requests must prove they come from this site: a matching
 * Origin header, or (when a browser omits Origin) Sec-Fetch-Site: same-origin.
 */
export function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (origin) {
    if (origin !== new URL(req.url).origin) fail('Cross-origin write denied.', 403);
    return;
  }
  if (req.headers.get('sec-fetch-site') === 'same-origin') return;
  fail('Cross-origin write denied.', 403);
}
export function requireJson(req: Request) {
  const type = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') fail('Send the request as application/json.', 415);
}
/**
 * Input problems (malformed JSON, schema violations, wrong value types) are
 * final 400 responses so the client stops retrying them. Only failures
 * without a status (database or upstream outages) become 503.
 */
export function responseError(e: unknown) {
  if (e instanceof ZodError)
    return Response.json({ error: e.issues[0]?.message || 'Invalid request.' }, { status: 400 });
  if (e instanceof SyntaxError)
    return Response.json({ error: 'The request is not valid JSON.' }, { status: 400 });
  if (e instanceof TypeError)
    return Response.json({ error: 'The request is malformed.' }, { status: 400 });
  const status =
    e && typeof e === 'object' && typeof (e as { status?: unknown }).status === 'number'
      ? (e as { status: number }).status
      : 0;
  const message = e instanceof Error ? e.message : String(e);
  if (!status) console.error(message);
  return Response.json(
    {
      error: status
        ? message
        : 'The service is temporarily unavailable. Your changes have been kept for retry.',
    },
    { status: status || 503 },
  );
}
type RecordRow = {
  data: string;
  created_by: string;
  updated_by: string;
  [column: string]: unknown;
};
export function decode(r: RecordRow) {
  return { ...r, data: JSON.parse(r.data), createdBy: r.created_by, updatedBy: r.updated_by };
}

// ---------------------------------------------------------------------------
// Photos stored in R2 under `<household>/<uuid>`.
type Bucket = {
  delete(key: string | string[]): Promise<void>;
};
/**
 * Best-effort removal of photos that no remaining live record references.
 * Failures are logged; an orphaned object only costs storage.
 */
export async function releasePhotos(household: string, keys: string[]) {
  for (const key of keys.slice(0, 50)) {
    try {
      const encoded = encodeURIComponent(key);
      const used = await one(
        'SELECT 1 AS used FROM records WHERE household=? AND deleted=0 AND (instr(data,?)>0 OR instr(data,?)>0) LIMIT 1',
        household,
        encoded,
        key,
      );
      if (used) continue;
      await (env.BUCKET as Bucket).delete(key);
      await run('DELETE FROM photos WHERE key=?', key);
    } catch (e) {
      console.error('photo clean-up', e instanceof Error ? e.message : e);
    }
  }
}
export { photoKeys };

// ---------------------------------------------------------------------------
// Opportunistic clean-up. Runs at most once per interval per isolate and, via
// a lease row in `cache`, at most once per interval across isolates. Every
// delete is batched with a LIMIT so a request never does unbounded work.
export const RETENTION = 30 * DAY;
const CLEANUP_INTERVAL = 10 * 60000;
const CLEANUP_BATCH = 500;
const TOMBSTONE_BATCH = 100;
let lastCleanup = 0;
export async function maybeCleanup(now = Date.now()) {
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  try {
    const lease = await one(
      "INSERT INTO cache(key,data,expires) VALUES('cleanup:lease','{}',?) ON CONFLICT(key) DO UPDATE SET expires=excluded.expires WHERE cache.expires<=? RETURNING key",
      now + CLEANUP_INTERVAL,
      now,
    );
    if (lease) await runCleanup(now);
  } catch (e) {
    console.error('clean-up', e instanceof Error ? e.message : e);
  }
}
export async function runCleanup(now = Date.now()) {
  await db().batch([
    db()
      .prepare('DELETE FROM limits WHERE key IN (SELECT key FROM limits WHERE expires<? LIMIT ?)')
      .bind(now, CLEANUP_BATCH),
    db()
      .prepare('DELETE FROM cache WHERE key IN (SELECT key FROM cache WHERE expires<? LIMIT ?)')
      .bind(now, CLEANUP_BATCH),
    db()
      .prepare(
        'DELETE FROM operations WHERE id IN (SELECT id FROM operations WHERE created<? LIMIT ?)',
      )
      .bind(now - RETENTION, CLEANUP_BATCH),
  ]);
  // Tombstones: raise each household's purge horizon first, so clients with an
  // older cursor are told to resynchronise in full.
  const tombstones = (await query(
    'SELECT id,household,seq,data FROM records WHERE deleted=1 AND updated<? LIMIT ?',
    now - RETENTION,
    TOMBSTONE_BATCH,
  )) as { id: string; household: string; seq: number; data: string }[];
  if (!tombstones.length) return;
  const horizon = new Map<string, number>();
  for (const t of tombstones)
    horizon.set(t.household, Math.max(horizon.get(t.household) || 0, t.seq));
  await db().batch([
    ...[...horizon].map(([h, seq]) =>
      db()
        .prepare('UPDATE households SET purged_revision=MAX(purged_revision,?) WHERE id=?')
        .bind(seq, h),
    ),
    db()
      .prepare(
        'DELETE FROM records WHERE id IN (SELECT value FROM json_each(?)) AND deleted=1 AND updated<?',
      )
      .bind(JSON.stringify(tombstones.map((t) => t.id)), now - RETENTION),
  ]);
  // Photos of purged records are removed once nothing else references them.
  // Waiting for the purge keeps "Undo" working for deleted records.
  for (const t of tombstones) {
    let keys: string[] = [];
    try {
      keys = photoKeys(JSON.parse(t.data), t.household);
    } catch {
      keys = [];
    }
    if (keys.length) await releasePhotos(t.household, keys);
  }
}
