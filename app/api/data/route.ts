import { z } from 'zod';
import { recipeSchema, mealSchema, offerSchema, nutritionSchema } from '@/lib/meal-schema';
import { validateRecord, anonymise } from '@/lib/record-validation';
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
  responseError,
  decode,
} from '@/lib/server';
export const dynamic = 'force-dynamic';
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
const constraintSchema = z
  .array(
    z.object({
      kind: z.enum(['preference', 'exclusion', 'allergy', 'certification']),
      value: z.string().min(1).max(100),
    }),
  )
  .max(30);
const str = z.string().max(500);
const id = z.string().min(1).max(120);
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
  data: z.record(z.any()),
});
function validate(kind: string, d: any) {
  if (d.currency) currencySchema.parse(d.currency);
  if (d.priceCurrency) currencySchema.parse(d.priceCurrency);
  if (d.country && !countries[d.country]) fail('Unsupported country.');
  if (d.notes && typeof d.notes !== 'string') fail('Notes must be text.');
  if (d.substitution && !['exact', 'brand', 'similar', 'ask'].includes(d.substitution))
    fail('Invalid substitution preference.');
  if (
    kind === 'product' &&
    d.barcode &&
    (typeof d.barcode !== 'string' || !barcode(d.barcode).valid)
  )
    fail('Invalid barcode.');
  if (JSON.stringify(d).length > (['recipe', 'meal'].includes(kind) ? 120000 : 40000))
    fail('This record is too large.');
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
      !/^https:\/\/images\.openfoodfacts\.org\//.test(d.product.image) &&
      !d.product.image.startsWith('/api/photo?')
    )
      fail('Invalid product image.');
  }
}
export async function GET(req: Request) {
  try {
    const u = await identity();
    const h = new URL(req.url).searchParams.get('household');
    const households = await query(
      'SELECT h.*,m.role FROM households h JOIN memberships m ON m.household=h.id WHERE m.user=?',
      u.id,
    );
    const account = await one('SELECT * FROM users WHERE id=?', u.id);
    if (!h)
      return Response.json(
        {
          user: { ...u, name: account.name, preferences: JSON.parse(account.preferences) },
          households: households.map((x) => ({ ...x, settings: JSON.parse(x.settings) })),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    const m = await member(h, u.id);
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
    return Response.json(
      {
        records: (await query('SELECT * FROM records WHERE household=?', h)).map(decode),
        members,
        invites,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return responseError(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    if (Number(req.headers.get('content-length')) > 150000) fail('Request too large', 413);
    const u = await identity();
    await rate('write:' + u.id, 180);
    const raw = await req.text();
    if (raw.length > 150000) fail('Request too large', 413);
    const b = JSON.parse(raw);
    const action = str.parse(b.action);
    if (action === 'createHousehold') {
      const name = z.string().trim().min(1).max(80).parse(b.name);
      if (b.country && !countries[b.country]) fail('Unsupported country.');
      if (b.currency) currencySchema.parse(b.currency);
      const h = crypto.randomUUID(),
        l = crypto.randomUUID(),
        now = Date.now();
      await db().batch([
        db()
          .prepare('INSERT INTO households(id,name,settings,created) VALUES(?,?,?,?)')
          .bind(
            h,
            name,
            JSON.stringify({
              country: b.country || 'IT',
              currency: b.currency || 'EUR',
              language: b.language || 'en',
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
            'INSERT INTO records(id,household,kind,data,created_by,updated_by,created,updated) VALUES(?,?,?,?,?,?,?,?)',
          )
          .bind(
            l,
            h,
            'list',
            JSON.stringify({
              name: z
                .string()
                .trim()
                .min(1)
                .max(160)
                .parse(b.listName || 'Weekly groceries'),
              country: b.country || 'IT',
              currency: b.currency || 'EUR',
            }),
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
      const now = Date.now();
      await db().batch([
        db()
          .prepare(
            "INSERT INTO memberships(household,user,role) SELECT household,?,'member' FROM invitations WHERE hash=? AND revoked=0 AND used_by IS NULL AND expires>? ON CONFLICT DO NOTHING",
          )
          .bind(u.id, digest, now),
        db()
          .prepare(
            'UPDATE invitations SET used_by=? WHERE hash=? AND revoked=0 AND used_by IS NULL AND expires>? AND EXISTS(SELECT 1 FROM memberships WHERE household=invitations.household AND user=?)',
          )
          .bind(u.id, digest, now, u.id),
      ]);
      const used = await one('SELECT used_by FROM invitations WHERE hash=?', digest);
      if (used.used_by !== u.id) fail('This invitation has already been used.', 410);
      return Response.json({ household: inv.household });
    }
    if (action === 'profile') {
      const name = z.string().trim().min(1).max(80).parse(b.name);
      const prefs = b.preferences || {};
      constraintSchema.parse(prefs.constraints || []);
      if (prefs.nutritionTargets) nutritionSchema.parse(prefs.nutritionTargets);
      if (JSON.stringify(prefs).length > 5000) fail('Preferences too long.');
      await run(
        'UPDATE users SET name=?,preferences=? WHERE id=?',
        name,
        JSON.stringify(prefs),
        u.id,
      );
      return Response.json({ ok: true });
    }
    if (action === 'deleteAccount') {
      const owned = await query(
        "SELECT household FROM memberships WHERE user=? AND role='owner'",
        u.id,
      );
      if (owned.length)
        fail(
          'Transfer household ownership or delete your households before deleting your account.',
        );
      const rows = await query(
        "SELECT id,data,version FROM records WHERE kind!='feedback' AND data LIKE ?",
        '%' + u.id + '%',
      );
      const changes = rows
        .filter((r) => JSON.stringify(anonymise(JSON.parse(r.data), u.id)) !== r.data)
        .map((r) =>
          db()
            .prepare('UPDATE records SET data=?,version=version+1 WHERE id=? AND version=?')
            .bind(JSON.stringify(anonymise(JSON.parse(r.data), u.id)), r.id, r.version),
        );
      await db().batch([
        ...changes,
        db().prepare('DELETE FROM memberships WHERE user=?').bind(u.id),
        db()
          .prepare("DELETE FROM records WHERE kind='feedback' AND json_extract(data,'$.user')=?")
          .bind(u.id),
        db()
          .prepare(
            "UPDATE records SET created_by=CASE WHEN created_by=? THEN 'Deleted member' ELSE created_by END,updated_by=CASE WHEN updated_by=? THEN 'Deleted member' ELSE updated_by END WHERE created_by=? OR updated_by=?",
          )
          .bind(u.id, u.id, u.id, u.id),
        db().prepare('DELETE FROM operations WHERE user=?').bind(u.id),
        db().prepare('DELETE FROM users WHERE id=?').bind(u.id),
      ]);
      return Response.json({ ok: true });
    }

    const h = id.parse(b.household);
    const m = await member(h, u.id);
    if (action === 'op') {
      const op = operation.parse(b.op);
      const oldOp = await one('SELECT * FROM operations WHERE id=?', op.id);
      if (oldOp) {
        if (oldOp.user !== u.id || oldOp.household !== h)
          fail('Operation belongs to another account.', 403);
        return Response.json(JSON.parse(oldOp.result));
      }
      validate(op.kind, op.data);
      const old = await one('SELECT * FROM records WHERE id=?', op.record);
      if (old && old.household !== h) fail('Record not accessible.', 403);
      if (old && (old.kind !== op.kind || old.version !== op.version))
        return Response.json(
          {
            error:
              'Someone changed this item. Review the latest version before applying your change.',
            conflict: decode(old),
          },
          { status: 409 },
        );
      if (!old && op.version !== 0) fail('Record no longer exists.', 409);
      let d = validateRecord(op.kind, { ...op.data }, h);
      if (op.kind === 'shop' && retailers[d.retailer].country !== d.country)
        fail('Shop country must match the retailer.');
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
        const before = old ? JSON.parse(old.data) : null;
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
        if (!retailers[d.retailer] || retailers[d.retailer].country !== d.country)
          fail('Offer retailer and country must match.');
        if (!countries[d.country]) fail('Unsupported country');
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
        if (!list || JSON.parse(list.data).archived)
          fail('Choose an active list in this household.');
        d.priceCurrency = d.priceCurrency || JSON.parse(list.data).currency || 'EUR';
        if (d.intendedFor) await member(h, d.intendedFor);
        if (
          d.assigned &&
          !(await one('SELECT user FROM memberships WHERE household=? AND user=?', h, d.assigned))
        )
          fail('Assigned shopper is not a household member.');
        const before = old ? JSON.parse(old.data) : null;
        d.addedBy = before?.addedBy || u.id;
        if (d.done && !before?.done) {
          d.purchasedBy = u.id;
          d.purchasedAt = Date.now();
        } else if (!d.done) {
          d.purchasedBy = null;
          d.purchasedAt = null;
        } else {
          d.purchasedBy = before.purchasedBy;
          d.purchasedAt = before.purchasedAt;
        }
      }
      if (op.kind === 'feedback') {
        if (old && JSON.parse(old.data).user !== u.id)
          fail('You can only edit your own feedback.', 403);
        d.user = u.id;
      }
      if (op.kind === 'product') {
        if (d.barcode) d.barcode = barcode(d.barcode).code;
        d.source = 'User-entered · private household data';
        d.id = op.record;
      }
      let tripRows: any[] = [];
      if (op.kind === 'trip' && !old) {
        if (!d.list) fail('Choose a list to finish.');
        for (const item of d.items) {
          const r = await one(
            "SELECT * FROM records WHERE id=? AND household=? AND kind='item' AND deleted=0",
            item.originalItem,
            h,
          );
          if (
            !r ||
            r.version !== item.originalVersion ||
            !JSON.parse(r.data).done ||
            JSON.parse(r.data).list !== d.list
          )
            fail('Purchased items changed. Refresh and finish the trip again.', 400);
          tripRows.push(r);
        }
        d.items = tripRows.map((r) => ({ ...JSON.parse(r.data), originalItem: r.id }));
      }
      const now = Date.now(),
        version = op.version + 1,
        result = {
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
        };
      let statement = old
        ? db()
            .prepare(
              'UPDATE records SET data=?,version=version+1,deleted=?,updated_by=?,updated=? WHERE id=? AND household=? AND version=?',
            )
            .bind(JSON.stringify(d), op.deleted ? 1 : 0, u.id, now, op.record, h, op.version)
        : db()
            .prepare(
              'INSERT INTO records(id,household,kind,data,version,deleted,created_by,updated_by,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              op.record,
              h,
              op.kind,
              JSON.stringify(d),
              1,
              op.deleted ? 1 : 0,
              u.id,
              u.id,
              now,
              now,
            );
      const extras: any[] = [];
      if (tripRows.length) {
        const refs = JSON.stringify(tripRows.map((r) => ({ id: r.id, version: r.version })));
        statement = db()
          .prepare(
            "INSERT INTO records(id,household,kind,data,version,deleted,created_by,updated_by,created,updated) SELECT ?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM json_each(?) ref LEFT JOIN records r ON r.id=json_extract(ref.value,'$.id') WHERE r.id IS NULL OR r.version!=json_extract(ref.value,'$.version') OR r.deleted!=0)",
          )
          .bind(op.record, h, op.kind, JSON.stringify(d), 1, 0, u.id, u.id, now, now, refs);
        extras.push(
          db()
            .prepare(
              "UPDATE records SET deleted=1,version=version+1,updated_by=?,updated=? WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND household=? AND EXISTS(SELECT 1 FROM operations WHERE id=?)",
            )
            .bind(u.id, now, refs, h, op.id),
        );
      }
      if (op.kind === 'list' && old && JSON.parse(old.data).currency !== d.currency) {
        extras.push(
          db()
            .prepare(
              "UPDATE records SET data=json_set(data,'$.priceCurrency',?),version=version+1 WHERE household=? AND kind='item' AND json_extract(data,'$.list')=? AND json_extract(data,'$.priceCurrency') IS NULL AND EXISTS(SELECT 1 FROM operations WHERE id=?)",
            )
            .bind(JSON.parse(old.data).currency || 'EUR', h, op.record, op.id),
        );
      }
      try {
        const res = await db().batch([
          statement,
          db()
            .prepare(
              'INSERT INTO operations(id,user,household,result,created) SELECT ?,?,?,?,? WHERE changes()>0',
            )
            .bind(op.id, u.id, h, JSON.stringify(result), now),
          ...extras,
        ]);
        if (!res[0].meta.changes) {
          const latest = await one(
            'SELECT * FROM records WHERE id=? AND household=?',
            op.record,
            h,
          );
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
        const concurrent = await one(
          'SELECT * FROM records WHERE id=? AND household=?',
          op.record,
          h,
        );
        if (concurrent)
          return Response.json(
            { error: 'Another shopper changed this record.', conflict: decode(concurrent) },
            { status: 409 },
          );
        throw e;
      }
      return Response.json(result);
    }
    if (action === 'invite') {
      await member(h, u.id, true);
      await rate('invite:' + u.id, 10);
      const recipient = b.email
        ? z.string().trim().email().max(254).parse(b.email).toLowerCase()
        : null;
      const token = crypto.randomUUID() + crypto.randomUUID(),
        key = crypto.randomUUID();
      await run(
        'INSERT INTO invitations(id,household,hash,expires,created_by,recipient_email) VALUES(?,?,?,?,?,?)',
        key,
        h,
        await hash(token),
        Date.now() +
          z
            .number()
            .int()
            .min(1)
            .max(30)
            .parse(b.days ?? 7) *
            86400000,
        u.id,
        recipient,
      );
      return Response.json({ token, id: key, recipient });
    }
    if (action === 'revoke') {
      await member(h, u.id, true);
      await run('UPDATE invitations SET revoked=1 WHERE id=? AND household=?', id.parse(b.id), h);
      return Response.json({ ok: true });
    }
    if (action === 'settings') {
      await member(h, u.id, true);
      constraintSchema.parse(b.settings?.constraints || []);
      if (b.settings?.categories)
        z.array(z.string().trim().min(1).max(80)).min(1).max(40).parse(b.settings.categories);
      if (b.settings?.country && !countries[b.settings.country]) fail('Unsupported country.');
      if (b.settings?.currency) currencySchema.parse(b.settings.currency);
      if (JSON.stringify(b.settings).length > 10000) fail('Settings too large.');
      await run(
        'UPDATE households SET name=?,settings=? WHERE id=?',
        z.string().min(1).max(80).parse(b.name),
        JSON.stringify(b.settings),
        h,
      );
      return Response.json({ ok: true });
    }
    if (action === 'transfer') {
      if (m.role !== 'owner') fail('Only the owner can transfer ownership.', 403);
      const target = id.parse(b.user);
      if (target === u.id) fail('Choose another household member.');
      await member(h, target);
      await run(
        "UPDATE memberships SET role=CASE WHEN user=? THEN 'owner' WHEN role='owner' THEN 'admin' ELSE role END WHERE household=? AND EXISTS(SELECT 1 FROM memberships owner_check WHERE owner_check.household=? AND owner_check.user=? AND owner_check.role='owner')",
        target,
        h,
        h,
        u.id,
      );
      return Response.json({ ok: true });
    }
    if (action === 'role') {
      if (m.role !== 'owner') fail('Only the owner can change roles.', 403);
      const target = await member(h, id.parse(b.user));
      if (target.role === 'owner') fail('Use ownership transfer.');
      await run(
        'UPDATE memberships SET role=? WHERE household=? AND user=?',
        z.enum(['admin', 'member']).parse(b.role),
        h,
        b.user,
      );
      return Response.json({ ok: true });
    }
    if (action === 'leave' || action === 'remove') {
      const target = action === 'leave' ? u.id : id.parse(b.user);
      const tm = await member(h, target);
      if (tm.role === 'owner') fail('Transfer ownership before leaving.');
      if (target !== u.id) {
        await member(h, u.id, true);
        if (tm.role === 'admin' && m.role !== 'owner')
          fail('Only the owner can remove administrators.', 403);
      }
      await run('DELETE FROM memberships WHERE household=? AND user=?', h, target);
      return Response.json({ ok: true });
    }
    if (action === 'deleteHousehold') {
      if (m.role !== 'owner') fail('Only the owner can delete the household.', 403);
      let cursor: string | undefined;
      do {
        const files = await env.BUCKET.list({ prefix: h + '/', cursor });
        if (files.objects.length) await env.BUCKET.delete(files.objects.map((o: any) => o.key));
        cursor = files.truncated ? files.cursor : undefined;
      } while (cursor);
      await db().batch(
        ['records', 'memberships', 'invitations', 'operations']
          .map((t) => db().prepare(`DELETE FROM ${t} WHERE household=?`).bind(h))
          .concat(db().prepare('DELETE FROM households WHERE id=?').bind(h)),
      );
      return Response.json({ ok: true });
    }
    fail('Unknown action.');
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json({ error: e.issues[0].message }, { status: 400 });
    return responseError(e);
  }
}
