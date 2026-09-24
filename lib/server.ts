import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
export const db = () => {
  if (!env.DB) throw new Error('Database unavailable');
  return env.DB;
};
export const query = async (sql: string, ...args: any[]) => {
  const r = await db()
    .prepare(sql)
    .bind(...args)
    .all();
  return r.results as any[];
};
export const one = async (sql: string, ...args: any[]) => (await query(sql, ...args))[0];
export const run = async (sql: string, ...args: any[]) =>
  db()
    .prepare(sql)
    .bind(...args)
    .run();
export function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
export async function identity() {
  const person = await getChatGPTUser();
  const h = await headers();
  const id = h.get('oai-authenticated-user-id');
  if (!person || !id) fail('Sign in to access your household.', 401);
  await run(
    'INSERT INTO users(id,name,email,created) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING',
    id,
    person.displayName,
    person.email,
    Date.now(),
  );
  return { id, name: person.displayName, email: person.email };
}
export async function member(h: string, u: string, admin = false) {
  const m = await one('SELECT * FROM memberships WHERE household=? AND user=?', h, u);
  if (!m) fail('You do not have access to this household.', 403);
  if (admin && !['owner', 'admin'].includes(m.role)) fail('An administrator is required.', 403);
  return m;
}
export async function rate(key: string, max: number, window = 60000) {
  const k = key + ':' + Math.floor(Date.now() / window);
  const r = await one(
    'INSERT INTO limits(key,count) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',
    k,
  );
  if (r.count > max) fail('Please wait before trying again.', 429);
}
export async function hash(token: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
  )
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) fail('Cross-origin write denied.', 403);
}
export function responseError(e: any) {
  console.error(e?.message);
  return Response.json(
    {
      error: e.status
        ? e.message
        : 'The service is temporarily unavailable. Your changes have been kept for retry.',
    },
    { status: e.status || 503 },
  );
}
export function decode(r: any) {
  return { ...r, data: JSON.parse(r.data), createdBy: r.created_by, updatedBy: r.updated_by };
}
