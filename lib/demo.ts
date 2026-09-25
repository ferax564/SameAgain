import recipes from './demo-recipes.json';
import { localDate } from './nutrition';
import samples from './sample-products.json';
import { Product, RecordData, type RecordFields } from './domain';
import type { Household, Member } from './sync-core';
export const demoProducts = samples as unknown as Product[];
const now = 1788599400000;
export const demoHousehold: Household = {
  id: 'demo',
  name: 'The Sunday household',
  role: 'owner',
  settings: {
    country: 'IT',
    currency: 'EUR',
    language: 'en',
    constraints: [],
    categories: [
      'Fruit & vegetables',
      'Dairy & alternatives',
      'Bakery',
      'Pantry',
      'Household',
      'Other',
    ],
  },
};
export const demoMembers: Member[] = [
  { user: 'demo-alex', name: 'Alex', role: 'owner' },
  { user: 'demo-sam', name: 'Sam', role: 'member' },
];
function record(id: string, kind: string, data: RecordFields): RecordData {
  return {
    id,
    household: 'demo',
    kind,
    data,
    version: 1,
    deleted: 0,
    createdBy: 'demo-alex',
    updatedBy: 'demo-alex',
    created: now,
    updated: now,
  };
}
const almond = demoProducts.find((p) => p.barcode === '5411188112709'),
  pasta = demoProducts.find((p) => p.barcode === '8076800195057'),
  spread = demoProducts.find((p) => p.barcode === '3017620422003');
export const demoRecords = [
  ...recipes.map(({ id, ...r }) => record(id, 'recipe', r)),
  record('demo-breakfast', 'meal', {
    recipe: 'demo-oats',
    date: localDate(),
    meal: 'Breakfast',
    servings: 1,
    member: 'demo-alex',
    eaten: false,
    recipeSnapshot: recipes[0],
  }),
  record('weekly', 'list', {
    name: 'Weekly groceries',
    country: 'IT',
    currency: 'EUR',
    store: 'Any store',
  }),
  record('weekend', 'list', { name: 'Weekend dinner', country: 'IT', currency: 'EUR' }),
  record('essentials', 'list', { name: 'Household essentials', country: 'IT', currency: 'EUR' }),
  ...[
    {
      name: 'Cherry tomatoes',
      quantity: 2,
      unit: 'pack',
      pack: '250 g',
      category: 'Fruit & vegetables',
      notes: 'The little sweet ones',
      assigned: 'demo-sam',
    },
    {
      name: almond?.name || 'Unsweetened almond drink',
      product: almond,
      quantity: 2,
      unit: 'pack',
      pack: almond?.pack,
      category: 'Dairy & alternatives',
      notes: 'Unsweetened, please',
      assigned: 'demo-alex',
    },
    {
      name: 'Sourdough loaf',
      quantity: 1,
      unit: 'piece',
      category: 'Bakery',
      notes: 'Sliced, if possible',
    },
    {
      name: pasta?.name || 'Spaghetti',
      product: pasta,
      quantity: 2,
      unit: 'pack',
      pack: pasta?.pack,
      category: 'Pantry',
      notes: 'Our usual for Sunday pasta',
    },
    {
      name: spread?.name || 'Nutella',
      product: spread,
      quantity: 1,
      unit: 'pack',
      pack: spread?.pack,
      category: 'Pantry',
      notes: '',
      done: true,
      purchasedBy: 'demo-sam',
      purchasedAt: now,
    },
    {
      name: 'Bananas',
      quantity: 6,
      unit: 'piece',
      category: 'Fruit & vegetables',
      done: true,
      purchasedBy: 'demo-alex',
      purchasedAt: now,
    },
  ].map((x, i) =>
    record('demo-item-' + i, 'item', {
      ...x,
      list: 'weekly',
      substitution: 'similar',
      addedBy: 'demo-alex',
      order: i,
    }),
  ),
  ...[almond, pasta, spread].filter(Boolean).map((p, i) =>
    record('demo-fav-' + i, 'favourite', {
      product: p,
      name: p!.name,
      quantity: 1,
      unit: 'pack',
      pack: p!.pack,
      notes: i === 0 ? 'The unsweetened one' : '',
      category: i === 0 ? 'Dairy & alternatives' : 'Pantry',
      substitution: 'similar',
    }),
  ),
  record('demo-trip', 'trip', {
    name: 'Last Saturday',
    date: now - 7 * 86400000,
    items: [
      {
        name: pasta?.name,
        product: pasta,
        quantity: 2,
        unit: 'pack',
        pack: pasta?.pack,
        category: 'Pantry',
        notes: 'Our usual',
        substitution: 'similar',
      },
    ],
  }),
];
