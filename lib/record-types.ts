// Typed views of record payloads for the kinds whose shape differs from the item-like fields
// in `RecordFields` (lib/domain.ts). The server validates each kind before storing it
// (lib/record-validation.ts, lib/meal-schema.ts), so a record's `kind` determines its shape.
import type { KnownRecordFields, Product, RecordData, RecordFields } from './domain';
import type { z } from 'zod';
import type { offerSchema } from './meal-schema';
import type { Recipe } from './nutrition';

/** Payload of a `recipe` record. */
export type RecipeFields = RecordFields & Recipe;
/** Payload of a `meal` (meal plan) record; see `mealSchema` in lib/meal-schema.ts. */
export type MealFields = RecordFields & {
  recipe: string;
  date: string;
  meal: string;
  servings: number;
  member: string;
  eaten?: boolean;
  notes?: string;
  recipeSnapshot?: Recipe;
};
/** A dated retailer offer a member entered (see `offerSchema`). */
export type Offer = z.infer<typeof offerSchema>;
/** Payload of an `offer` record. */
export type OfferFields = RecordFields & Offer;
/** Payload of a `product` record (a household's private product). */
export type ProductFields = RecordFields & Product;
export type RecipeRecord = RecordData & { data: RecipeFields };
export type MealRecord = RecordData & { data: MealFields };
export type OfferRecord = RecordData & { data: OfferFields };
export type ProductRecord = RecordData & { data: ProductFields };

export const isRecipeRecord = (r: RecordData): r is RecipeRecord => r.kind === 'recipe';
export const isMealRecord = (r: RecordData): r is MealRecord => r.kind === 'meal';
export const isOfferRecord = (r: RecordData): r is OfferRecord => r.kind === 'offer';
export const isProductRecord = (r: RecordData): r is ProductRecord => r.kind === 'product';

/** The product snapshot on an item-like record, if any (never the id an observation holds). */
export function productSnapshot(data: RecordFields): Product | undefined {
  return typeof data.product === 'object' && data.product ? data.product : undefined;
}

/**
 * Observation and feedback records reference a catalogue product by id: their `product` is a
 * string, not the snapshot `RecordFields.product` describes. Returns that id, if any.
 */
export function productRef(data: RecordFields): string | undefined {
  const value: unknown = data.product;
  return typeof value === 'string' ? value : undefined;
}
/** Payload for an observation or feedback record that references product `id` (see `productRef`). */
export function withProductRef(
  data: Omit<KnownRecordFields, 'product'> & { [key: string]: unknown },
  id: string | undefined,
): RecordFields {
  const fields: RecordFields = { ...data };
  // Stored under `product`, which RecordFields reserves for snapshots; write it as a plain key.
  const bag: Record<string, unknown> = fields;
  bag.product = id;
  return fields;
}
