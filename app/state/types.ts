import type { Constraint, Product, RecordData, RecordFields, rank } from '@/lib/domain';

/**
 * Working copy behind the modal forms: the item, favourite, list and private-product editors
 * start from record fields; the remaining fields are form-only.
 */
export type FormDraft = RecordFields & {
  /** Join form: the invitation token. */
  token?: string;
  /** Invite form. */
  email?: string;
  /** Create-household form. */
  listName?: string;
  language?: string;
  /** Household settings and profile forms: one `kind:value` constraint per line. */
  constraintsText?: string;
  categoriesText?: string;
  categories?: string[];
  constraints?: Constraint[];
  /** List settings form: the category order as comma-separated text. */
  categoryOrderText?: string;
  /** Private product form. */
  brand?: string;
  barcode?: string;
  ingredients?: string;
  allergensText?: string;
  tracesText?: string;
  nutrition?: Record<string, number>;
  basis?: '100g' | '100ml';
  /** Observation and feedback forms: the catalogue product id they refer to. */
  productId?: string;
};
/** A substitute chosen for one item in the "Find abroad" flow. */
export type Decision = {
  version: number;
  product: Product | null;
  reason: string;
  quantity?: number | null;
};
/** A candidate from `rank` (demo) or the catalogue API's `matches`. */
export type Match = ReturnType<typeof rank>[number];
/** An add that may duplicate an existing line; the user chooses to combine or keep both. */
export type PendingMerge = { existing: RecordData; data: RecordFields; combinable: boolean };
/** A confirmation dialog request. */
export type ConfirmRequest = {
  title: string;
  description?: string;
  run: () => unknown;
};
