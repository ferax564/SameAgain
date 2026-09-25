/**
 * Optional verification of the identity headers set by the trusted dispatcher.
 *
 * The dispatcher signs in the person and forwards `oai-authenticated-user-id`
 * and `oai-authenticated-user-email`. Those headers alone are only safe when
 * every path to the Worker goes through the dispatcher. When the secret
 * `IDENTITY_ASSERTION_SECRET` is configured (for example with
 * `wrangler secret put IDENTITY_ASSERTION_SECRET`), every request must also
 * carry:
 *
 *   oai-authenticated-assertion-ts: <unix time in seconds>
 *   oai-authenticated-assertion:    hex(HMAC-SHA256(secret, `${id}\n${email}\n${ts}`))
 *
 * where `id` and `email` are the exact header values. Timestamps more than
 * 300 seconds from the Worker clock are rejected. Without the secret the
 * headers are trusted as before, so existing deployments keep working.
 */
export const USER_ID_HEADER = 'oai-authenticated-user-id';
export const USER_EMAIL_HEADER = 'oai-authenticated-user-email';
export const ASSERTION_HEADER = 'oai-authenticated-assertion';
export const ASSERTION_TS_HEADER = 'oai-authenticated-assertion-ts';
export const ASSERTION_MAX_SKEW_SECONDS = 300;

type HeaderSource = { get(name: string): string | null };

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function signIdentityAssertion(
  secret: string,
  id: string,
  email: string,
  timestampSeconds: number,
) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${id}\n${email}\n${timestampSeconds}`),
    ),
  );
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Returns true when no secret is configured or the assertion is valid. */
export async function verifyIdentityAssertion(
  headers: HeaderSource,
  secret: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!secret) return true;
  const id = headers.get(USER_ID_HEADER),
    email = headers.get(USER_EMAIL_HEADER),
    signature = (headers.get(ASSERTION_HEADER) || '').trim().toLowerCase(),
    ts = headers.get(ASSERTION_TS_HEADER) || '';
  if (!id || !email || !/^[0-9a-f]{64}$/.test(signature) || !/^\d{1,12}$/.test(ts)) return false;
  const seconds = Number(ts);
  if (Math.abs(now / 1000 - seconds) > ASSERTION_MAX_SKEW_SECONDS) return false;
  return constantTimeEqual(signature, await signIdentityAssertion(secret, id, email, seconds));
}

/** Reads the optional secret from the Worker environment. */
export function assertionSecret(env: unknown): string | undefined {
  const value =
    env && typeof env === 'object'
      ? (env as { IDENTITY_ASSERTION_SECRET?: unknown }).IDENTITY_ASSERTION_SECRET
      : undefined;
  return typeof value === 'string' && value ? value : undefined;
}
