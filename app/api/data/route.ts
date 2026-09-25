import { z } from 'zod';
import { recipeSchema, mealSchema, offerSchema, nutritionSchema } from '@/lib/meal-schema';
import { validateRecord, anonymise, tripRef } from '@/lib/record-validation';
import { retailers } from '@/lib/retailers';
import { env } from 'cloudflare:workers';
import { countries, barcode } from '@/lib/domain';
import {
  db,
  query,
  one,
  run,
  identity,
  member,
  rate,
  hash,
  fail,
  sameOrigin,
  requireJson,
  responseError,
  decode,
  syncUser,
  forgetUser,
  DAY,
  DELETED_MEMBER,
} from '@/lib/server';
export const dynamic = 'force-dynamic';

// Validated record payloads are open-ended JSON objects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = Record<string, any>;
type Row = {
  id: string;
  household: string;
  kind: string;
  data: string;
  version: number;
  deleted: number;
  created_by: string;
  updated_by: string;
  created: number;
  updated: number;
  seq?: number;
};
type RecordOut = {
  id: string;
  household: string;
  kind: string;
  data: Data;
  version: number;
  deleted: number;
  createdBy: string;
  updatedBy: string;
  created: number;
  updated: number;
};

// Size limits, in JSON characters.
const REQUEST_LIMIT = 260000; // whole POST body
const CLIENT_LIMIT = 40000; // client-supplied data for ordinary records
const RICH_LIMIT = 120000; // recipes and meals
const TEMPLATE_LIMIT = 200000; // templates carry product snapshots per item
const TRIP_LIMIT = 400000; // trips are rebuilt by the server from stored items

const has = (table: object, key: unknown): key is string =>
  typeof key === 'string' && Object.hasOwn(table, key);
const LANGUAGES = ['en', 'it', 'fr', 'de', 'es'] as const;
const currencySchema = z.enum([
  'EUR',
  'USD',
  'CHF',
  'GBP',
  'DKK',
  'SEK',
  'NOK',
  'PLN',
  'CZK',
  'HUF',
  'RON',
  'ISK',
]);
const countrySchema = z.string().refine((c) => Object.hasOwn(countries, c), 'Unsupported country.');
const constraintSchema = z
  .array(
    z.object({
      kind: z.enum(['preference', 'exclusion', 'allergy', 'certification']),
      value: z.string().min(1).max(100),
    }),
  )
  .max(30);
const settingsSchema = z
  .object(
    {
      country: countrySchema.optional(),
      currency: currencySchema.optional(),
      language: z.enum(LANGUAGES, { message: 'Choose a supported language.' }).optional(),
      constraints: constraintSchema.optional(),
      categories: z.array(z.string().trim().min(1).max(80)).min(1).max(40).optional(),
    },
    { message: 'Household settings are required.' },
  )
  .passthrough();
const str = z.string().max(500);
const id = z.string().min(1).max(120);
const householdName = z.string().trim().min(1, 'Enter a household name.').max(80);
const operation = z.object({
  id: id,
  record: id,
  kind: z.enum([
    'list',
    'item',
    'favourite',
    'product',
    'feedback',
    'substitution',
    'observation',
    'template',
    'trip',
    'recipe',
    'meal',
    'offer',
    'shop',
  ]),
  version: z.number().int().min(0),
  deleted: z.boolean().optional(),
  data: z.record(z.unknown()),
});
// Fields naming household members. The server sets or checks them so a
// member cannot attribute changes to someone else.
const PEOPLE = [
  'addedBy',
  'purchasedBy',
  'reportedBy',
  'createdBy',
  'updatedBy',
  'user',
  'member',
  'assigned',
  'intendedFor',
];

function validate(kind: string, d: Data) {
  if (d.currency) currencySchema.parse(d.currency);
  if (d.priceCurrency) currencySchema.parse(d.priceCurrency);
  if (d.country && !has(countries, d.country)) fail('Unsupported country.');
  if (d.language) z.enum(LANGUAGES).parse(d.language);
  if (d.notes && typeof d.notes !== 'string') fail('Notes must be text.');
  if (d.substitution && !['exact', 'brand', 'similar', 'ask'].includes(d.substitution))
    fail('Invalid substitution preference.');
  if (
    kind === 'product' &&
    d.barcode &&
    (typeof d.barcode !== 'string' || !barcode(d.barcode).valid)
  )
    fail('Invalid barcode.');
  const limit =
    kind === 'template'
      ? TEMPLATE_LIMIT
      : ['recipe', 'meal'].includes(kind)
        ? RICH_LIMIT
        : CLIENT_LIMIT;
  if (JSON.stringify(d).length > limit) fail('This record is too large.');
  if (
    ['list', 'item', 'product', 'template'].includes(kind) &&
    (!d.name || typeof d.name !== 'string' || d.name.length > 160)
  )
    fail('A name of up to 160 characters is required.');
  if (kind === 'item') {
    if (!Number.isFinite(d.quantity) || d.quantity <= 0 || d.quantity > 10000)
      fail('Enter a quantity between 0 and 10,000.');
    if (!['pack', 'piece', 'kg', 'g', 'l', 'ml'].includes(d.unit)) fail('Choose a supported unit.');
    for (const k of ['price', 'actualPrice'])
      if (d[k] != null && (!Number.isFinite(d[k]) || d[k] < 0 || d[k] > 100000))
        fail('Enter a valid price.');
    if (
      d.product?.image &&
      (typeof d.product.image !== 'string' ||
        (!/^https:\/\/images\.openfoodfacts\.org\//.test(d.product.image) &&
          !d.product.image.startsWith('/api/photo?')))
    )
      fail('Invalid product image.');
  }
}
/**
 * Trips are sent as `{originalItem, originalVersion}` references. Older
 * clients queued full item copies; only the reference fields are kept.
 */
function tripRefs(items: unknown) {
  if (!Array.isArray(items)) fail('Choose purchased items to finish the trip.');
  if (items.length > 200) fail('A trip can include up to 200 items.');
  return items.map((i) => {
    const parsed = tripRef.safeParse(i);
    if (!parsed.success) fail('Purchased items changed. Refresh and finish the trip again.');
    return parsed.data;
  });
}
const out = (r: Row): RecordOut => ({
  id: r.id,
  household: r.household,
  kind: r.kind,
  data: JSON.parse(r.data),
  version: r.version,
  deleted: r.deleted,
  createdBy: r.created_by,
  updatedBy: r.updated_by,
  created: r.created,
  updated: r.updated,
});
// Trim bulky catalogue details from a trip's product copies when needed.
function slimProduct(p: unknown) {
  if (!p || typeof p !== 'object') return p;
  const {
    id,
    name,
    brand,
    pack,
    barcode: code,
    image,
    categories,
    countries: c,
    source,
    sourceUrl,
    retrieved,
  } = p as Data;
  return {
    id,
    name,
    brand,
    pack,
    barcode: code,
    image,
    categories,
    countries: c,
    source,
    sourceUrl,
    retrieved,
  };
}
const nextSeq = '(SELECT revision+1 FROM households WHERE id=?)';
const currentSeq = '(SELECT revision FROM households WHERE id=?)';
const bump = (h: string) =>
  db().prepare('UPDATE households SET revision=revision+1 WHERE id=?').bind(h);
const likeEscape = (v: string) => v.replace(/[\\%_]/g, (c) => '\\' + c);

export async function GET(req: Request) {
  try {
    const u = await identity();
    const params = new URL(req.url).searchParams;
    const h = params.get('household');
    const households = await query(
      'SELECT h.id,h.name,h.settings,h.created,m.role FROM households h JOIN memberships m ON m.household=h.id WHERE m.user=?',
      u.id,
    );
    if (!h) {
      let account = await one('SELECT * FROM users WHERE id=?', u.id);
      if (!account) {
        await syncUser(u.id, u.name, u.email, true);
        account = await one('SELECT * FROM users WHERE id=?', u.id);
      }
      return Response.json(
        {
          user: { ...u, name: account.name, preferences: JSON.parse(account.preferences) },
          households: households.map((x) => ({ ...x, settings: JSON.parse(x.settings) })),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const m = await member(h, u.id);
    const sinceParam = params.get('since');
    if (sinceParam !== null && !/^\d{1,15}$/.test(sinceParam)) fail('Invalid sync cursor.');
    // Read the cursor before the records: anything written afterwards is sent
    // again in the next delta, so nothing is missed.
    const house = (await one('SELECT revision,purged_revision FROM households WHERE id=?', h)) as {
      revision: number;
      purged_revision: number;
    };
    const cursor = house.revision;
    const since = sinceParam === null ? null : Number(sinceParam);
    const full = since === null || since < house.purged_revision || since > cursor;
    const etag = `W/"${cursor}.${house.purged_revision}.${full ? 'f' : since}.${m.role}"`;
    const cacheHeaders = { 'Cache-Control': 'private, no-cache', ETag: etag };
    const match = req.headers.get('if-none-match');
    if (match && match.split(',').some((t) => t.trim() === etag))
      return new Response(null, { status: 304, headers: cacheHeaders });
    const members = await query(
      'SELECT m.user,m.role,u.name FROM memberships m JOIN users u ON u.id=m.user WHERE m.household=?',
      h,
    );
    const invites = ['owner', 'admin'].includes(m.role)
      ? await query(
          'SELECT id,expires,revoked,used_by,recipient_email FROM invitations WHERE household=?',
          h,
        )
      : [];
    const rows = full
      ? await query('SELECT * FROM records WHERE household=? AND deleted=0', h)
      : await query('SELECT * FROM records WHERE household=? AND seq>?', h, since);
    return Response.json(
      { records: rows.map(decode), members, invites, cursor, full },
      { headers: cacheHeaders },
    );
  } catch (e) {
    return responseError(e);
  }
}

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    requireJson(req);
    if (Number(req.headers.get('content-length')) > REQUEST_LIMIT) fail('Request too large', 413);
    const u = await identity();
    await rate('write:' + u.id, 180);
    await rate('write-day:' + u.id, 5000, DAY);
    const raw = await req.text();
    if (raw.length > REQUEST_LIMIT) fail('Request too large', 413);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      fail('The request must be a JSON object.');
    const b = parsed as Record<string, unknown>;
    const action = str.parse(b.action);
    if (action === 'createHousehold') {
      const name = householdName.parse(b.name);
      const country = b.country ? countrySchema.parse(b.country) : 'IT';
      const currency = b.currency ? currencySchema.parse(b.currency) : 'EUR';
      const language = b.language ? z.enum(LANGUAGES).parse(b.language) : 'en';
      const listName = z
        .string()
        .trim()
        .min(1)
        .max(160)
        .parse(b.listName || 'Weekly groceries');
      await rate('create-household:' + u.id, 20, DAY);
      const h = crypto.randomUUID(),
        l = crypto.randomUUID(),
        now = Date.now();
      await db().batch([
        db()
          .prepare('INSERT INTO households(id,name,settings,created,revision) VALUES(?,?,?,?,1)')
          .bind(
            h,
            name,
            JSON.stringify({
              country,
              currency,
              language,
              constraints: [],
              categories: [
                'Fruit & vegetables',
                'Dairy & alternatives',
                'Bakery',
                'Pantry',
                'Frozen',
                'Household',
                'Other',
              ],
            }),
            now,
          ),
        db()
          .prepare('INSERT INTO memberships(household,user,role) VALUES(?,?,?)')
          .bind(h, u.id, 'owner'),
        db()
          .prepare(
            'INSERT INTO records(id,household,kind,data,created_by,updated_by,created,updated,seq) VALUES(?,?,?,?,?,?,?,?,1)',
          )
          .bind(
            l,
            h,
            'list',
            JSON.stringify({ name: listName, country, currency }),
            u.id,
            u.id,
            now,
            now,
          ),
      ]);
      return Response.json({ household: h });
    }
    if (action === 'join') {
      await rate('join:' + u.id, 10);
      const token = id.parse(b.token);
      const digest = await hash(token);
      const inv = await one('SELECT * FROM invitations WHERE hash=?', digest);
      if (!inv || inv.revoked || inv.expires < Date.now() || inv.used_by)
        fail('This invitation has expired, was revoked or has already been used.', 410);
      if (inv.recipient_email && inv.recipient_email !== u.email.toLowerCase().trim())
        fail('Sign in with the email address this invitation was created for.', 403);
      const creator = await one(
        'SELECT role FROM memberships WHERE household=? AND user=?',
        inv.household,
        inv.created_by,
      );
      if (!creator || !['owner', 'admin'].includes(creator.role))
        fail('This invitation is no longer valid. Ask for a new one.', 410);
      // An existing member keeps the invitation unused for its intended person.
      if (
        await one(
          'SELECT 1 AS member FROM memberships WHERE household=? AND user=?',
          inv.household,
          u.id,
        )
      )
        return Response.json({ household: inv.household, alreadyMember: true });
      const now = Date.now();
      await db().batch([
        db()
          .prepare(
            "INSERT INTO memberships(household,user,role) SELECT household,?,'member' FROM invitations WHERE hash=? AND revoked=0 AND used_by IS NULL AND expires>? AND EXISTS(SELECT 1 FROM memberships c WHERE c.household=invitations.household AND c.user=invitations.created_by AND c.role IN ('owner','admin')) ON CONFLICT DO NOTHING",
          )
          .bind(u.id, digest, now),
        db()
          .prepare(
            'UPDATE invitations SET used_by=? WHERE hash=? AND revoked=0 AND used_by IS NULL AND expires>? AND changes()>0',
          )
          .bind(u.id, digest, now),
        bump(inv.household),
      ]);
      const used = await one('SELECT used_by FROM invitations WHERE hash=?', digest);
      if (used?.used_by !== u.id) {
        if (
          await one(
            'SELECT 1 AS member FROM memberships WHERE household=? AND user=?',
            inv.household,
            u.id,
          )
        )
          return Response.json({ household: inv.household, alreadyMember: true });
        fail('This invitation has already been used.', 410);
      }
      return Response.json({ household: inv.household });
    }
    if (action === 'profile') {
      const name = z.string().trim().min(1).max(80).parse(b.name);
      const prefs = z.record(z.unknown()).parse(b.preferences ?? {});
      constraintSchema.parse(prefs.constraints || []);
      if (prefs.nutritionTargets) nutritionSchema.parse(prefs.nutritionTargets);
      if (JSON.stringify(prefs).length > 5000) fail('Preferences too long.');
      await db().batch([
        db()
          .prepare('UPDATE users SET name=?,preferences=?,custom_name=1 WHERE id=?')
          .bind(name, JSON.stringify(prefs), u.id),
        db()
          .prepare(
            'UPDATE households SET revision=revision+1 WHERE id IN (SELECT household FROM memberships WHERE user=?)',
          )
          .bind(u.id),
      ]);
      return Response.json({ ok: true });
    }
    if (action === 'deleteAccount') return await deleteAccount(u);

    const h = id.parse(b.household);
    const m = await member(h, u.id);
    if (action === 'op') return await applyOperation(u, h, b.op);
    if (action === 'invite') {
      await member(h, u.id, true);
      await rate('invite:' + u.id, 10);
      await rate('invite-day:' + u.id, 50, DAY);
      const recipient = b.email
        ? z.string().trim().email().max(254).parse(b.email).toLowerCase()
        : null;
      const days = z
        .number()
        .int()
        .min(1)
        .max(30)
        .parse(b.days ?? 7);
      const token = crypto.randomUUID() + crypto.randomUUID(),
        key = crypto.randomUUID();
      const [created] = await db().batch([
        db()
          .prepare(
            "INSERT INTO invitations(id,household,hash,expires,created_by,recipient_email) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM memberships WHERE household=? AND user=? AND role IN ('owner','admin'))",
          )
          .bind(key, h, await hash(token), Date.now() + days * DAY, u.id, recipient, h, u.id),
        bump(h),
      ]);
      if (!created.meta.changes) fail('An administrator is required.', 403);
      return Response.json({ token, id: key, recipient });
    }
    if (action === 'revoke') {
      await member(h, u.id, true);
      await db().batch([
        db()
          .prepare('UPDATE invitations SET revoked=1 WHERE id=? AND household=?')
          .bind(id.parse(b.id), h),
        bump(h),
      ]);
      return Response.json({ ok: true });
    }
    if (action === 'settings') {
      await member(h, u.id, true);
      const name = householdName.parse(b.name);
      const settings = settingsSchema.parse(b.settings);
      if (JSON.stringify(settings).length > 10000) fail('Settings too large.');
      await db().batch([
        db()
          .prepare('UPDATE households SET name=?,settings=? WHERE id=?')
          .bind(name, JSON.stringify(settings), h),
        bump(h),
      ]);
      return Response.json({ ok: true });
    }
    if (action === 'transfer') {
      if (m.role !== 'owner') fail('Only the owner can transfer ownership.', 403);
      const target = id.parse(b.user);
      if (target === u.id) fail('Choose another household member.');
      await member(h, target);
      const [changed] = await db().batch([
        db()
          .prepare(
            "UPDATE memberships SET role=CASE WHEN user=? THEN 'owner' WHEN role='owner' THEN 'admin' ELSE role END WHERE household=? AND EXISTS(SELECT 1 FROM memberships owner_check WHERE owner_check.household=? AND owner_check.user=? AND owner_check.role='owner') AND EXISTS(SELECT 1 FROM memberships target WHERE target.household=? AND target.user=?)",
          )
          .bind(target, h, h, u.id, h, target),
        bump(h),
      ]);
      if (!changed.meta.changes) fail('Household membership changed. Refresh and try again.', 409);
      return Response.json({ ok: true });
    }
    if (action === 'role') {
      if (m.role !== 'owner') fail('Only the owner can change roles.', 403);
      const target = id.parse(b.user);
      const role = z.enum(['admin', 'member']).parse(b.role);
      const tm = await member(h, target);
      if (tm.role === 'owner') fail('Use ownership transfer.');
      const [changed] = await db().batch([
        db()
          .prepare(
            "UPDATE memberships SET role=? WHERE household=? AND user=? AND role!='owner' AND EXISTS(SELECT 1 FROM memberships o WHERE o.household=? AND o.user=? AND o.role='owner')",
          )
          .bind(role, h, target, h, u.id),
        // A demoted administrator's outstanding invitations stop working.
        db()
          .prepare(
            "UPDATE invitations SET revoked=1 WHERE household=? AND created_by=? AND used_by IS NULL AND revoked=0 AND EXISTS(SELECT 1 FROM memberships WHERE household=? AND user=? AND role='member')",
          )
          .bind(h, target, h, target),
        bump(h),
      ]);
      if (!changed.meta.changes) fail('Household membership changed. Refresh and try again.', 409);
      return Response.json({ ok: true });
    }
    if (action === 'leave' || action === 'remove') {
      const target = action === 'leave' ? u.id : id.parse(b.user);
      const tm = await member(h, target);
      if (tm.role === 'owner') fail('Transfer ownership before leaving.');
      const byOwner = m.role === 'owner';
      if (target !== u.id) {
        await member(h, u.id, true);
        if (tm.role === 'admin' && !byOwner) fail('Only the owner can remove administrators.', 403);
      }
      const guard =
        target === u.id
          ? ''
          : byOwner
            ? " AND EXISTS(SELECT 1 FROM memberships a WHERE a.household=memberships.household AND a.user=? AND a.role='owner')"
            : " AND role='member' AND EXISTS(SELECT 1 FROM memberships a WHERE a.household=memberships.household AND a.user=? AND a.role IN ('owner','admin'))";
      const [removed] = await db().batch([
        db()
          .prepare("DELETE FROM memberships WHERE household=? AND user=? AND role!='owner'" + guard)
          .bind(...(target === u.id ? [h, target] : [h, target, u.id])),
        db()
          .prepare(
            'UPDATE invitations SET revoked=1 WHERE household=? AND created_by=? AND used_by IS NULL AND revoked=0 AND NOT EXISTS(SELECT 1 FROM memberships WHERE household=? AND user=?)',
          )
          .bind(h, target, h, target),
        bump(h),
      ]);
      if (!removed.meta.changes) fail('Household membership changed. Refresh and try again.', 409);
      return Response.json({ ok: true });
    }
    if (action === 'deleteHousehold') {
      if (m.role !== 'owner') fail('Only the owner can delete the household.', 403);
      // Refuse new uploads before emptying the photo folder.
      await run('UPDATE households SET deleting=1 WHERE id=?', h);
      let cursor: string | undefined;
      do {
        const files = await env.BUCKET.list({ prefix: h + '/', cursor });
        if (files.objects.length)
          await env.BUCKET.delete(files.objects.map((o: { key: string }) => o.key));
        cursor = files.truncated ? files.cursor : undefined;
      } while (cursor);
      await db().batch(
        ['records', 'memberships', 'invitations', 'operations', 'photos']
          .map((t) => db().prepare(`DELETE FROM ${t} WHERE household=?`).bind(h))
          .concat(db().prepare('DELETE FROM households WHERE id=?').bind(h)),
      );
      return Response.json({ ok: true });
    }
    fail('Unknown action.');
  } catch (e) {
    return responseError(e);
  }
}

async function receiptFor(opId: string, user: string, h: string) {
  const r = await one('SELECT * FROM operations WHERE id=?', opId);
  if (!r) return null;
  if (r.user !== user || r.household !== h) fail('Operation belongs to another account.', 403);
  return JSON.parse(r.result) as Data;
}

async function applyOperation(u: { id: string }, h: string, rawOp: unknown) {
  const op = operation.parse(rawOp);
  const prior = await receiptFor(op.id, u.id, h);
  if (prior) return Response.json(prior);
  // Scoped by household: another household's record id looks like any other
  // id already in use, without revealing where it lives.
  const old = (await one('SELECT * FROM records WHERE id=? AND household=?', op.record, h)) as
    Row | undefined;
  let input: Data = { ...op.data };
  if (op.kind === 'trip') input = { ...input, items: old ? [] : tripRefs(input.items) };
  validate(op.kind, input);
  if (old && (old.kind !== op.kind || old.version !== op.version))
    return Response.json(
      {
        error: 'Someone changed this item. Review the latest version before applying your change.',
        conflict: decode(old),
      },
      { status: 409 },
    );
  if (!old && op.version !== 0) fail('Record no longer exists.', 409);
  if (!old && (await one('SELECT 1 AS taken FROM records WHERE id=?', op.record)))
    fail('This record id is already in use. Refresh and try again.', 409);
  const before: Data | null = old ? JSON.parse(old.data) : null;
  const memberIds = new Set(
    (await query('SELECT user FROM memberships WHERE household=?', h)).map(
      (r: { user: string }) => r.user,
    ),
  );
  let d: Data = validateRecord(op.kind, input, h);
  if (
    op.kind === 'shop' &&
    (!has(retailers, d.retailer) || retailers[d.retailer].country !== d.country)
  )
    fail('Shop country must match the retailer.');
  if (op.kind === 'list' && d.retailer && !has(retailers, d.retailer))
    fail('Choose a supported retailer.');
  if (op.kind === 'list' && d.shopId) {
    const shop = await one(
      "SELECT data FROM records WHERE id=? AND household=? AND kind='shop' AND deleted=0",
      d.shopId,
      h,
    );
    if (!shop) fail('Choose a saved shop in this household.');
    const branch = JSON.parse(shop.data);
    if (d.retailer !== branch.retailer) fail('Choose a branch of the selected retailer.');
    d.store = branch.name + ', ' + branch.address;
  }
  if (op.kind === 'recipe') d = recipeSchema.parse(d);
  if (op.kind === 'meal') {
    d = mealSchema.parse(d);
    if (!before || before.member !== d.member) await member(h, d.member);
    if (!before || before.recipe !== d.recipe) {
      const recipe = await one(
        "SELECT data FROM records WHERE id=? AND household=? AND kind='recipe' AND deleted=0",
        d.recipe,
        h,
      );
      if (!recipe) fail('Choose a recipe in this household.');
      d.recipeSnapshot = JSON.parse(recipe.data);
    } else d.recipeSnapshot = before.recipeSnapshot;
  }
  if (op.kind === 'offer') {
    d = offerSchema.parse(d);
    if (!has(retailers, d.retailer) || retailers[d.retailer].country !== d.country)
      fail('Offer retailer and country must match.');
    if (!has(countries, d.country)) fail('Unsupported country');
    currencySchema.parse(d.currency);
    d.reportedBy = u.id;
    d.evidence = 'Household-entered offer';
  }
  if (op.kind === 'item') {
    const list = await one(
      "SELECT * FROM records WHERE id=? AND household=? AND kind='list' AND deleted=0",
      d.list,
      h,
    );
    if (!list || JSON.parse(list.data).archived) fail('Choose an active list in this household.');
    d.priceCurrency = d.priceCurrency || JSON.parse(list.data).currency || 'EUR';
    // A former member may still be named on an existing item; that must not block ticking,
    // editing or deleting it. New items (e.g. "same again" from history) drop the name.
    for (const k of ['assigned', 'intendedFor'] as const) {
      const v = d[k];
      if (typeof v !== 'string' || !v || memberIds.has(v) || v === before?.[k]) continue;
      if (!before) delete d[k];
      else
        fail(
          k === 'assigned'
            ? 'Assigned shopper is not a household member.'
            : 'Choose a current household member.',
        );
    }
    d.addedBy = before?.addedBy || u.id;
    if (d.done && !before?.done) {
      d.purchasedBy = u.id;
      d.purchasedAt = Date.now();
    } else if (!d.done) {
      d.purchasedBy = null;
      d.purchasedAt = null;
    } else {
      d.purchasedBy = before?.purchasedBy ?? null;
      d.purchasedAt = before?.purchasedAt ?? null;
    }
  }
  if (op.kind === 'favourite') {
    d.addedBy = before?.addedBy || u.id;
    d.purchasedBy = null;
    d.purchasedAt = null;
  }
  if (op.kind === 'observation') d.user = before?.user || u.id;
  if (op.kind === 'feedback') {
    if (before && before.user !== u.id) fail('You can only edit your own feedback.', 403);
    d.user = u.id;
  }
  if (op.kind === 'product') {
    if (d.barcode) d.barcode = barcode(d.barcode).code;
    d.source = 'User-entered · private household data';
    d.id = op.record;
  }
  if (op.kind === 'template' && Array.isArray(d.items))
    // Copied list items may name former members; drop names that are not members.
    d.items = d.items.map((item: Data) =>
      Object.fromEntries(
        Object.entries(item).filter(
          ([k, v]) =>
            !PEOPLE.includes(k) ||
            typeof v !== 'string' ||
            !v ||
            v === DELETED_MEMBER ||
            memberIds.has(v),
        ),
      ),
    );
  for (const k of PEOPLE) {
    const v = d[k];
    if (
      typeof v === 'string' &&
      v &&
      v !== DELETED_MEMBER &&
      !memberIds.has(v) &&
      v !== before?.[k]
    )
      fail('Choose a current household member.');
  }

  const now = Date.now();
  const tripRows: Row[] = [];
  if (op.kind === 'trip') {
    if (old) {
      // A finished trip keeps its server-built items; only its name or
      // deletion can change.
      d.items = before?.items || [];
      d.list = before?.list;
    } else {
      if (!d.list || typeof d.list !== 'string') fail('Choose a list to finish.');
      const refs = d.items as { originalItem: string; originalVersion: number }[];
      const ids = [...new Set(refs.map((r) => r.originalItem))];
      const found = ids.length
        ? ((await query(
            "SELECT * FROM records WHERE household=? AND kind='item' AND deleted=0 AND id IN (SELECT value FROM json_each(?))",
            h,
            JSON.stringify(ids),
          )) as Row[])
        : [];
      const byId = new Map(found.map((r) => [r.id, r]));
      const seen = new Set<string>();
      for (const ref of refs) {
        if (seen.has(ref.originalItem)) continue;
        seen.add(ref.originalItem);
        const r = byId.get(ref.originalItem);
        const data = r ? JSON.parse(r.data) : null;
        if (!r || r.version !== ref.originalVersion || !data.done || data.list !== d.list)
          fail('Purchased items changed. Refresh and finish the trip again.', 400);
        tripRows.push(r);
      }
      d.items = tripRows.map((r) => ({ ...JSON.parse(r.data), originalItem: r.id }));
    }
    if (JSON.stringify(d).length > TRIP_LIMIT)
      d.items = (d.items as Data[]).map((i) => ({ ...i, product: slimProduct(i.product) }));
    if (JSON.stringify(d).length > TRIP_LIMIT)
      fail('This trip is too large to save. Finish it in two parts.');
  }

  const version = op.version + 1;
  const affected: RecordOut[] = [];
  const result = {
    record: {
      id: op.record,
      household: h,
      kind: op.kind,
      data: d,
      version,
      deleted: op.deleted ? 1 : 0,
      createdBy: old?.created_by || u.id,
      updatedBy: u.id,
      created: old?.created || now,
      updated: now,
    },
    affected,
  };
  let statement = old
    ? db()
        .prepare(
          `UPDATE records SET data=?,version=version+1,deleted=?,updated_by=?,updated=?,seq=${nextSeq} WHERE id=? AND household=? AND version=?`,
        )
        .bind(JSON.stringify(d), op.deleted ? 1 : 0, u.id, now, h, op.record, h, op.version)
    : db()
        .prepare(
          `INSERT INTO records(id,household,kind,data,version,deleted,created_by,updated_by,created,updated,seq) VALUES(?,?,?,?,1,?,?,?,?,?,${nextSeq}) ON CONFLICT DO NOTHING`,
        )
        .bind(
          op.record,
          h,
          op.kind,
          JSON.stringify(d),
          op.deleted ? 1 : 0,
          u.id,
          u.id,
          now,
          now,
          h,
        );
  const extras: D1PreparedStatement[] = [];
  const opDone = 'EXISTS(SELECT 1 FROM operations WHERE id=?)';
  if (tripRows.length) {
    const refs = JSON.stringify(tripRows.map((r) => ({ id: r.id, version: r.version })));
    statement = db()
      .prepare(
        `INSERT INTO records(id,household,kind,data,version,deleted,created_by,updated_by,created,updated,seq) SELECT ?,?,?,?,1,0,?,?,?,?,${nextSeq} WHERE NOT EXISTS(SELECT 1 FROM json_each(?) ref LEFT JOIN records r ON r.id=json_extract(ref.value,'$.id') WHERE r.id IS NULL OR r.household!=? OR r.version!=json_extract(ref.value,'$.version') OR r.deleted!=0) ON CONFLICT DO NOTHING`,
      )
      .bind(op.record, h, op.kind, JSON.stringify(d), u.id, u.id, now, now, h, refs, h);
    extras.push(
      db()
        .prepare(
          `UPDATE records SET deleted=1,version=version+1,updated_by=?,updated=?,seq=${currentSeq} WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND household=? AND ${opDone}`,
        )
        .bind(u.id, now, h, refs, h, op.id),
    );
    for (const r of tripRows)
      affected.push({
        ...out(r),
        deleted: 1,
        version: r.version + 1,
        updatedBy: u.id,
        updated: now,
      });
  }
  let currencyUpdate: { index: number; ids: string[] } | undefined;
  if (op.kind === 'list' && before && before.currency !== d.currency) {
    const pinned = before.currency || 'EUR';
    const rows = (await query(
      "SELECT * FROM records WHERE household=? AND kind='item' AND deleted=0 AND json_extract(data,'$.list')=? AND json_extract(data,'$.priceCurrency') IS NULL",
      h,
      op.record,
    )) as Row[];
    if (rows.length) {
      currencyUpdate = { index: extras.length, ids: rows.map((r) => r.id) };
      extras.push(
        db()
          .prepare(
            `UPDATE records SET data=json_set(data,'$.priceCurrency',?),version=version+1,updated=?,seq=${currentSeq} WHERE household=? AND EXISTS(SELECT 1 FROM json_each(?) ref WHERE json_extract(ref.value,'$.id')=records.id AND json_extract(ref.value,'$.version')=records.version) AND json_extract(data,'$.priceCurrency') IS NULL AND ${opDone}`,
          )
          .bind(
            pinned,
            now,
            h,
            h,
            JSON.stringify(rows.map((r) => ({ id: r.id, version: r.version }))),
            op.id,
          ),
      );
      for (const r of rows) {
        const o = out(r);
        affected.push({
          ...o,
          data: { ...o.data, priceCurrency: pinned },
          version: r.version + 1,
          updated: now,
        });
      }
    }
  }
  try {
    const res = await db().batch([
      statement,
      db()
        .prepare(
          'INSERT INTO operations(id,user,household,result,created) SELECT ?,?,?,?,? WHERE changes()>0',
        )
        .bind(op.id, u.id, h, JSON.stringify(result), now),
      db()
        .prepare(`UPDATE households SET revision=revision+1 WHERE id=? AND ${opDone}`)
        .bind(h, op.id),
      ...extras,
    ]);
    if (currencyUpdate && res[0].meta.changes) {
      // The version-guarded currency pin skips items another shopper changed in the
      // meantime; report the rows as they actually are, never a fabricated update.
      const pinnedCount = res[3 + currencyUpdate.index].meta.changes;
      if (pinnedCount !== currencyUpdate.ids.length) {
        const ids = new Set(currencyUpdate.ids);
        const actual = (await query(
          'SELECT * FROM records WHERE household=? AND id IN (SELECT value FROM json_each(?))',
          h,
          JSON.stringify(currencyUpdate.ids),
        )) as Row[];
        const kept = affected.filter((r) => !ids.has(r.id));
        affected.splice(0, affected.length, ...kept, ...actual.map(out));
        await run('UPDATE operations SET result=? WHERE id=?', JSON.stringify(result), op.id);
      }
    }
    if (!res[0].meta.changes) {
      // A retry of an operation that already succeeded is not a conflict.
      const retry = await receiptFor(op.id, u.id, h);
      if (retry) return Response.json(retry);
      const latest = await one('SELECT * FROM records WHERE id=? AND household=?', op.record, h);
      if (!latest && !old) {
        if (tripRows.length)
          fail('Purchased items changed. Refresh and finish the trip again.', 400);
        fail('This record id is already in use. Refresh and try again.', 409);
      }
      return Response.json(
        {
          error: 'Another shopper updated this item.',
          conflict: latest ? decode(latest) : null,
        },
        { status: 409 },
      );
    }
  } catch (e) {
    const retry = await one(
      'SELECT * FROM operations WHERE id=? AND user=? AND household=?',
      op.id,
      u.id,
      h,
    );
    if (retry) return Response.json(JSON.parse(retry.result));
    const concurrent = await one('SELECT * FROM records WHERE id=? AND household=?', op.record, h);
    if (concurrent)
      return Response.json(
        { error: 'Another shopper changed this record.', conflict: decode(concurrent) },
        { status: 409 },
      );
    throw e;
  }
  return Response.json(result);
}

async function deleteAccount(u: { id: string; email: string }) {
  const owned = await query(
    "SELECT household FROM memberships WHERE user=? AND role='owner'",
    u.id,
  );
  if (owned.length)
    fail('Transfer household ownership or delete your households before deleting your account.');
  const pattern = '%' + likeEscape(u.id) + '%';
  // Anonymise every record that mentions the person (including households they
  // already left, where other members' records may still name them in fields such
  // as `assigned` or `member`), plus any record they created or last edited.
  // Account deletion is rare, so a full scan is acceptable. Version-guarded updates are retried;
  // the final round writes the freshly read data without a guard.
  for (let attempt = 0; attempt < 4; attempt++) {
    const rows = (await query(
      "SELECT id,household,data,version FROM records WHERE kind!='feedback' AND (data LIKE ? ESCAPE '\\' OR created_by=? OR updated_by=?)",
      pattern,
      u.id,
      u.id,
    )) as { id: string; household: string; data: string; version: number }[];
    const changes = rows
      .map((r) => ({ ...r, next: JSON.stringify(anonymise(JSON.parse(r.data), u.id)) }))
      .filter((r) => r.next !== r.data);
    if (!changes.length) break;
    const guarded = attempt < 3;
    const results = await db().batch([
      ...[...new Set(changes.map((r) => r.household))].map((h) => bump(h)),
      ...changes.map((r) =>
        db()
          .prepare(
            `UPDATE records SET data=?,version=version+1,seq=(SELECT revision FROM households WHERE id=records.household) WHERE id=?${guarded ? ' AND version=?' : ''}`,
          )
          .bind(...(guarded ? [r.next, r.id, r.version] : [r.next, r.id])),
      ),
    ]);
    if (results.slice(-changes.length).every((r) => r.meta.changes === 1)) break;
  }
  const email = u.email.toLowerCase().trim();
  const statements = [
    // Aborts the whole batch if the person became an owner meanwhile.
    db()
      .prepare(
        "SELECT CASE WHEN EXISTS(SELECT 1 FROM memberships WHERE user=? AND role='owner') THEN json('owner-guard') END",
      )
      .bind(u.id),
    db()
      .prepare(
        'UPDATE households SET revision=revision+1 WHERE id IN (SELECT household FROM memberships WHERE user=? UNION SELECT household FROM records WHERE created_by=? OR updated_by=?)',
      )
      .bind(u.id, u.id, u.id),
    db()
      .prepare(
        `UPDATE records SET deleted=1,data='{}',version=version+1,seq=(SELECT revision FROM households WHERE id=records.household) WHERE kind='feedback' AND created_by=? AND json_extract(data,'$.user')=?`,
      )
      .bind(u.id, u.id),
    db()
      .prepare(
        `UPDATE records SET created_by=CASE WHEN created_by=? THEN '${DELETED_MEMBER}' ELSE created_by END,updated_by=CASE WHEN updated_by=? THEN '${DELETED_MEMBER}' ELSE updated_by END,seq=(SELECT revision FROM households WHERE id=records.household) WHERE created_by=? OR updated_by=?`,
      )
      .bind(u.id, u.id, u.id, u.id),
    // Invitations: revoke the person's outstanding invitations and remove
    // their id and email address.
    db()
      .prepare(
        `UPDATE invitations SET revoked=CASE WHEN used_by IS NULL THEN 1 ELSE revoked END,created_by='${DELETED_MEMBER}' WHERE created_by=?`,
      )
      .bind(u.id),
    db().prepare(`UPDATE invitations SET used_by='${DELETED_MEMBER}' WHERE used_by=?`).bind(u.id),
    db()
      .prepare(
        'UPDATE invitations SET recipient_email=NULL,revoked=CASE WHEN used_by IS NULL THEN 1 ELSE revoked END WHERE recipient_email=?',
      )
      .bind(email),
    // Other members' operation receipts that mention the person.
    db()
      .prepare(
        'DELETE FROM operations WHERE household IN (SELECT household FROM memberships WHERE user=?) AND instr(result,?)>0',
      )
      .bind(u.id, JSON.stringify(u.id)),
    db().prepare('DELETE FROM operations WHERE user=?').bind(u.id),
    db().prepare('DELETE FROM memberships WHERE user=?').bind(u.id),
    db()
      .prepare("DELETE FROM limits WHERE key LIKE ? ESCAPE '\\'")
      .bind('%:' + likeEscape(u.id) + ':%'),
    db().prepare('DELETE FROM users WHERE id=?').bind(u.id),
  ];
  try {
    await db().batch(statements);
  } catch (e) {
    if (await one("SELECT 1 AS owner FROM memberships WHERE user=? AND role='owner'", u.id))
      fail('You became a household owner. Transfer ownership before deleting your account.', 409);
    throw e;
  }
  forgetUser(u.id);
  return Response.json({ ok: true });
}
