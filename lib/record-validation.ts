import { z } from 'zod';
import { retailers } from './retailers';
import { dateSchema, nutritionSchema, safeLink, safePhoto } from './meal-schema';
// Records keep fields the client adds (list links, receipt metadata, retailer
// details), but the size of undeclared fields is capped per object.
const EXTRA_LIMIT = 4000;
/** A non-null, non-array object: a JSON record whose fields are still unchecked. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function capExtras<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const known = new Set(Object.keys(schema.shape));
  return schema.passthrough().superRefine((value, ctx) => {
    const extras = Object.fromEntries(Object.entries(value).filter(([k]) => !known.has(k)));
    if (Object.keys(extras).length > 40 || JSON.stringify(extras).length > EXTRA_LIMIT)
      ctx.addIssue({ code: 'custom', message: 'This record has too many extra details.' });
  });
}
const text = z.string().max(800),
  name = z.string().trim().min(1).max(160),
  strings = z.array(z.string().max(200)).max(100);
const amount = z.number().finite().positive().max(10000),
  price = z.number().finite().min(0).max(100000).nullable().optional();
const snapshot = capExtras(
  z.object({
    id: z.string().min(1).max(120),
    name,
    brand: text.optional(),
    pack: text.optional(),
    barcode: z.string().max(14).optional(),
    image: z.string().max(600).optional(),
    ingredients: z.string().max(6000).optional(),
    categories: strings.default([]),
    countries: strings.default([]),
    allergens: strings.optional(),
    traces: strings.optional(),
    ingredientTags: strings.optional(),
    labels: strings.optional(),
    stores: strings.optional(),
    additives: strings.optional(),
    nutrition: nutritionSchema.optional(),
    basis: z.enum(['100g', '100ml']).optional(),
    source: z.string().max(300).default('User-entered snapshot'),
    sourceUrl: z.string().max(600).optional(),
    retrieved: z.number().finite().default(0),
  }),
);
const receipt = z.object({
  fingerprint: z.string().min(1).max(64),
  line: z.string().min(1).max(80),
  label: name,
  store: z.string().max(160),
  date: z.union([z.literal(''), dateSchema]),
  currency: z.enum([
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
  ]),
  lineTotal: z.number().finite().min(0).max(100000).optional(),
});
const item = capExtras(
  z.object({
    name,
    image: z.string().max(600).optional(),
    receipt: receipt.optional(),
    quantity: amount,
    unit: z.enum(['pack', 'piece', 'g', 'kg', 'ml', 'l']),
    pack: text.optional(),
    category: text.optional(),
    notes: text.optional(),
    product: snapshot.nullish(),
    assigned: z.string().max(120).optional(),
    intendedFor: z.string().max(120).optional(),
    store: text.optional(),
    priority: z.enum(['normal', 'high']).optional(),
    substitution: z.enum(['exact', 'brand', 'similar', 'ask']).optional(),
    price,
    actualPrice: price,
    done: z.boolean().optional(),
    order: z.number().finite().optional(),
  }),
);
// A finished trip is sent as references; the server rebuilds the purchased
// items from the database.
export const tripRef = z.object({
  originalItem: z.string().min(1).max(120),
  originalVersion: z.number().int().min(1),
});
/**
 * Validates an untrusted record payload for `kind` (kinds without a schema here are validated by
 * the caller) and checks every nested photo and source link. Returns the parsed payload.
 */
export function validateRecord(
  kind: string,
  input: Record<string, unknown>,
  h: string,
): Record<string, unknown> {
  let d = input;
  if (kind === 'item' || kind === 'favourite') d = item.parse(d);
  if (kind === 'product') d = snapshot.parse(d);
  if (kind === 'shop')
    d = z
      .object({
        name,
        address: z.string().trim().min(1).max(300),
        retailer: z.string().refine((r) => Object.hasOwn(retailers, r), 'Unsupported retailer'),
        country: z.string().length(2),
        sourceUrl: z.string().max(600).optional(),
        placeId: z.string().max(160).optional(),
        evidence: z.enum(['map-listing', 'household-entered']),
      })
      .parse(d);
  if (kind === 'list')
    d = capExtras(
      z.object({
        name,
        store: text.optional(),
        archived: z.boolean().optional(),
        categoryOrder: strings.optional(),
      }),
    ).parse(d);
  if (kind === 'template')
    d = capExtras(z.object({ name, items: z.array(item).max(200) })).parse(d);
  if (kind === 'trip')
    d = capExtras(
      z.object({
        name,
        list: z.string().max(120).optional(),
        items: z.array(tripRef).max(200),
      }),
    ).parse(d);
  if (kind === 'observation')
    d = capExtras(
      z.object({
        name,
        product: z.string().max(120).optional(),
        store: z.string().trim().min(1).max(160),
        date: dateSchema,
        price: z.union([z.literal(''), z.coerce.number().finite().min(0).max(100000)]).optional(),
      }),
    ).parse(d);
  if (kind === 'feedback')
    d = capExtras(
      z.object({
        product: z.string().min(1).max(120),
        feedback: z.enum(['Like', 'Dislike', 'Would buy again', 'Not a suitable substitute']),
        reason: z.string().max(500).optional(),
      }),
    ).parse(d);
  if (kind === 'substitution')
    d = capExtras(
      z.object({
        original: z.string().min(1).max(120),
        product: snapshot,
        country: z.string().length(2),
        reason: text,
      }),
    ).parse(d);
  // Anything other than a string photo or link (when present) is unsafe.
  const photoOk = (v: unknown) => !v || (typeof v === 'string' && safePhoto(v, h));
  const linkOk = (v: unknown) => !v || (typeof v === 'string' && safeLink(v));
  function links(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(links);
      return;
    }
    if (!isRecord(value)) return;
    if (!photoOk(value.image) || !linkOk(value.sourceUrl))
      throw Object.assign(
        new Error('Use an authorised household photo and an HTTPS source link.'),
        { status: 400 },
      );
    for (const v of Object.values(value)) if (v && typeof v === 'object') links(v);
  }
  links(d);
  return d;
}
export function anonymise(data: unknown, user: string): unknown {
  if (Array.isArray(data)) return data.map((v) => anonymise(v, user));
  if (!isRecord(data)) return data;
  return Object.fromEntries(
    Object.entries(data)
      .filter(([k]) => k !== 'personalNote' || (data.user !== user && data.member !== user))
      .map(([k, v]) => [
        k,
        ['user', 'member', 'addedBy', 'purchasedBy', 'reportedBy'].includes(k) && v === user
          ? 'Deleted member'
          : ['assigned', 'intendedFor'].includes(k) && v === user
            ? ''
            : anonymise(v, user),
      ]),
  );
}
