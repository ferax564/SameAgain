import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  preferences: text('preferences').notNull().default('{}'),
  created: integer('created').notNull(),
  // 1 once the person chose a display name in their profile; sign-in then
  // stops replacing it with the identity provider's name.
  customName: integer('custom_name').notNull().default(0),
});
export const households = sqliteTable('households', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  settings: text('settings').notNull().default('{}'),
  created: integer('created').notNull(),
  // Monotonic change counter. Every record write assigns records.seq to the
  // new revision in the same batch, so clients can ask for `seq > cursor`.
  revision: integer('revision').notNull().default(0),
  // Highest revision whose tombstones have been purged. Clients whose cursor
  // is older than this must resynchronise in full.
  purgedRevision: integer('purged_revision').notNull().default(0),
  // Set while the owner deletes the household so uploads are refused.
  deleting: integer('deleting').notNull().default(0),
});
export const memberships = sqliteTable(
  'memberships',
  {
    household: text('household').notNull(),
    user: text('user').notNull(),
    role: text('role').notNull(),
  },
  (t) => [primaryKey({ columns: [t.household, t.user] }), index('memberships_user').on(t.user)],
);
export const invitations = sqliteTable(
  'invitations',
  {
    recipientEmail: text('recipient_email'),
    id: text('id').primaryKey(),
    household: text('household').notNull(),
    hash: text('hash').notNull().unique(),
    expires: integer('expires').notNull(),
    revoked: integer('revoked').notNull().default(0),
    usedBy: text('used_by'),
    createdBy: text('created_by').notNull(),
  },
  (t) => [
    index('invitations_household').on(t.household),
    index('invitations_created_by').on(t.createdBy),
  ],
);
export const records = sqliteTable(
  'records',
  {
    id: text('id').primaryKey(),
    household: text('household').notNull(),
    kind: text('kind').notNull(),
    data: text('data').notNull(),
    version: integer('version').notNull().default(1),
    deleted: integer('deleted').notNull().default(0),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    created: integer('created').notNull(),
    updated: integer('updated').notNull(),
    seq: integer('seq').notNull().default(0),
  },
  (t) => [
    index('records_household_kind').on(t.household, t.kind),
    index('records_household_seq').on(t.household, t.seq),
    index('records_created_by').on(t.createdBy),
    index('records_updated_by').on(t.updatedBy),
    index('records_deleted_updated').on(t.deleted, t.updated),
  ],
);
export const operations = sqliteTable(
  'operations',
  {
    id: text('id').primaryKey(),
    user: text('user').notNull(),
    household: text('household').notNull(),
    result: text('result').notNull(),
    created: integer('created').notNull(),
  },
  (t) => [
    index('operations_household').on(t.household),
    index('operations_user').on(t.user),
    index('operations_created').on(t.created),
  ],
);
export const catalogue = sqliteTable(
  'catalogue',
  {
    id: text('id').primaryKey(),
    data: text('data').notNull(),
    retrieved: integer('retrieved').notNull(),
    searchText: text('search_text').notNull().default(''),
    barcode: text('barcode'),
  },
  (t) => [index('catalogue_barcode').on(t.barcode)],
);
export const cache = sqliteTable(
  'cache',
  {
    key: text('key').primaryKey(),
    data: text('data').notNull(),
    expires: integer('expires').notNull(),
  },
  (t) => [index('cache_expires').on(t.expires)],
);
export const limits = sqliteTable(
  'limits',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull(),
    expires: integer('expires').notNull().default(0),
  },
  (t) => [index('limits_expires').on(t.expires)],
);
// Private household photos stored in R2, tracked for quota and clean-up.
export const photos = sqliteTable(
  'photos',
  {
    key: text('key').primaryKey(),
    household: text('household').notNull(),
    bytes: integer('bytes').notNull(),
    created: integer('created').notNull(),
  },
  (t) => [index('photos_household').on(t.household)],
);
