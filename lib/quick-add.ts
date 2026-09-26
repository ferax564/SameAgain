// Quick-add text parsing: "2 kg apples", "bread x3", "500g pasta", "eggs 12".
// Pure and deterministic so the list UI can preview what will be added.
export type QuickAddUnit = 'pack' | 'piece' | 'kg' | 'g' | 'l' | 'ml';
export type QuickAdd = { name: string; quantity: number; unit: QuickAddUnit };

// Written units (en/it/de/fr/es) mapped to the app's units, with a multiplier for
// units the app does not store directly (cl, dl).
const unitWords: Record<string, [QuickAddUnit, number]> = {};
const addUnits = (unit: QuickAddUnit, factor: number, words: string) => {
  for (const w of words.split(' ')) unitWords[w] = [unit, factor];
};
addUnits('kg', 1, 'kg kgs kilo kilos kilogram kilograms kilogramm kilogrammi chilo chili');
addUnits('g', 1, 'g gr grs gram grams gramm gramme grammes grammi gramos');
addUnits('l', 1, 'l lt ltr litre litres liter liters litri litro litros');
addUnits('ml', 1, 'ml');
addUnits('ml', 10, 'cl');
addUnits('ml', 100, 'dl');
addUnits(
  'pack',
  1,
  'pack packs pk pkt pkts packet packets pkg package packages box boxes tin tins can cans jar jars bottle bottles bag bags carton cartons ' +
    'pacco pacchi confezione confezioni scatola scatole barattolo barattoli bottiglia bottiglie ' +
    'packung packungen dose dosen flasche flaschen glas gläser ' +
    'paquet paquets boîte boîtes bouteille bouteilles ' +
    'paquete paquetes lata latas botella botellas bote botes',
);
addUnits('piece', 1, 'pc pcs piece pieces pz pezzo pezzi stk stück st pièce pièces pieza piezas');

const NUM = '(\\d+(?:[.,]\\d+)?)';
const WORD = '([\\p{L}]+\\.?)';
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const hasLetter = (s: string) => /\p{L}/u.test(s);
const toNumber = (s: string) => Number(s.replace(',', '.'));
/** "1.000 g" and "1,500 ml" use a thousands separator; "1.5 kg" does not. */
const amount = (s: string, unit: QuickAddUnit) =>
  (unit === 'g' || unit === 'ml') && /^\d{1,3}[.,]\d{3}$/.test(s)
    ? Number(s.replace(/[.,]/, ''))
    : toNumber(s);
// Words whose trailing number is part of the name.
const namedNumber =
  /(?:^|\s)(?:\p{L}|omega|vitamin|vitamine|vitamina|typ|type|nr|no|size|grösse|größe|stufe|level)$/iu;
function unitOf(word: string): [QuickAddUnit, number] | undefined {
  const w = word.toLowerCase().replace(/\.$/, '');
  return Object.hasOwn(unitWords, w) ? unitWords[w] : undefined;
}
function stripOf(name: string) {
  return tidy(name.replace(/^(?:of|di|de|d'|du|des|del|della|von)\s+/i, ''));
}
function result(name: string, quantity: number, unit: QuickAddUnit): QuickAdd | null {
  name = stripOf(name);
  if (!name || !hasLetter(name) || !Number.isFinite(quantity) || quantity <= 0) return null;
  // "2 kg" alone is a quantity without a name.
  if (unitOf(name)) return null;
  if (quantity > 10000) return null;
  // Counted units must be whole numbers.
  if ((unit === 'piece' || unit === 'pack') && (!Number.isInteger(quantity) || quantity > 999))
    return null;
  return { name, quantity: Math.round(quantity * 1000) / 1000, unit };
}

/**
 * Parses a quick-add line into name, quantity and unit. Anything that does not
 * clearly carry a quantity is returned unchanged as the name with 1 piece, so
 * product names that contain digits ("7up", "2% milk") are never mangled.
 */
export function parseQuickAdd(text: string): QuickAdd {
  const t = tidy(String(text ?? ''));
  const fallback: QuickAdd = { name: t, quantity: 1, unit: 'piece' };
  if (!t) return fallback;
  let m: RegExpMatchArray | null;
  // "2 kg apples", "500g pasta", "1,5 l milk", "3 tins tomatoes", "2 packs of rice"
  // "2 x 1.5 l water", "6x0.5l Cola": a count of packs whose size belongs to the name.
  if (
    (m = t.match(
      new RegExp(
        `^(\\d{1,3})\\s*[x×*]\\s*(${NUM.slice(1, -1)}\\s*${WORD.slice(1, -1)})\\s+(.+)$`,
        'iu',
      ),
    ))
  ) {
    if (unitOf(m[2].replace(/^[\d.,\s]+/, ''))) {
      const r = result(m[2].replace(/\s+/g, ' ') + ' ' + m[3], Number(m[1]), 'pack');
      if (r) return r;
    }
  }
  if ((m = t.match(new RegExp(`^${NUM}\\s*${WORD}\\s+(.+)$`, 'u')))) {
    const u = unitOf(m[2]);
    if (u) {
      const r = result(m[3], amount(m[1], u[0]) * u[1], u[0]);
      if (r) return r;
    }
  }
  // "apples 2kg", "milk 1.5 l", "rice 2 packs"
  if ((m = t.match(new RegExp(`^(.+?)\\s+${NUM}\\s*${WORD}$`, 'u')))) {
    const u = unitOf(m[3]);
    if (u) {
      const r = result(m[1], amount(m[2], u[0]) * u[1], u[0]);
      if (r) return r;
    }
  }
  // "3x bread", "3 x bread", "3× bread"
  if ((m = t.match(/^(\d{1,3})\s*[x×*]\s*(.+)$/iu)) && hasLetter(m[2][0])) {
    const r = result(m[2], Number(m[1]), 'piece');
    if (r) return r;
  }
  // "bread x3", "bread x 3", "bread ×3"
  if ((m = t.match(/^(.+?)\s+[x×*]\s*(\d{1,3})$/iu) || t.match(/^(.+?)\s*[×*]\s*(\d{1,3})$/u))) {
    const r = result(m[1], Number(m[2]), 'piece');
    if (r) return r;
  }
  // "12 eggs": a bare leading count followed by a word ("7 up" and "2 x …" are not).
  if ((m = t.match(/^(\d{1,2})\s+(\p{L}.*)$/u)) && !/^(?:[x×]\s|\p{L}{1,2}$)/iu.test(m[2])) {
    const r = result(m[2], Number(m[1]), 'piece');
    if (r) return r;
  }
  // "eggs 12": a bare trailing count, but not "Omega 3" or "Vitamin B 12".
  if ((m = t.match(/^(\p{L}.*?)\s+(\d{1,2})$/u)) && !namedNumber.test(m[1])) {
    const r = result(m[1], Number(m[2]), 'piece');
    if (r) return r;
  }
  return fallback;
}

// Default household categories (see the household settings defaults).
export const defaultCategories = [
  'Fruit & vegetables',
  'Dairy & alternatives',
  'Bakery',
  'Pantry',
  'Frozen',
  'Household',
  'Other',
] as const;
// Checked in order; the first category with a matching keyword wins, so specific
// product types ("frozen peas", "apple juice", "peanut butter") come before
// generic ingredients. Keywords of 5+ letters also match inside compounds
// (German "Vollmilch"); shorter ones must start a word; ≤3 letters must be a word.
const keywordGroups: [string, string][] = [
  [
    'Frozen',
    'frozen ice-cream ice-lolly gelato surgelat congelat tiefkühl tiefgekühl tk-pizza surgelé surgelés glace helado fish-fingers',
  ],
  // Specific names that would otherwise match a shorter keyword inside them.
  ['Fruit & vegetables', 'butternut pumpkin squash kürbis zucca courge calabaza'],
  ['Frozen', 'eiscreme glacé'],
  ['Pantry', 'pearl-barley barley gerste orzo rollmops'],
  [
    'Household',
    'toilet-paper kitchen-roll paper-towel detergent washing-up dish-soap dishwasher laundry bleach sponge bin-bags trash-bags soap shampoo toothpaste toothbrush deodorant tissues nappies diapers cleaner foil cling-film batteries ' +
      'carta-igienica detersivo sapone spugna sacchetti dentifricio pannolini ' +
      'toilettenpapier klopapier waschmittel spülmittel seife schwamm müllbeutel zahnpasta windeln küchenrolle ' +
      'papier-toilette lessive savon éponge dentifrice couches ' +
      'papel-higiénico detergente jabón esponja pañales',
  ],
  [
    'Pantry',
    'juice succo saft jus zumo peanut-butter jam marmalade marmellata konfitüre confiture mermelada sauce passata sugo ketchup mayonnaise mustard senf chips crisps',
  ],
  [
    'Bakery',
    'bread baguette roll rolls bun buns croissant bagel pita wrap tortilla brioche cake muffin ' +
      'pane panino panini focaccia cornetto grissini ' +
      'brot brötchen semmel laugen brezel zopf ' +
      'pain boulangerie ' +
      'pan barra bollo',
  ],
  [
    'Dairy & alternatives',
    'milk cheese butter yogurt yoghurt cream eggs egg kefir quark oat-drink soy-drink almond-drink mozzarella parmesan cheddar feta ' +
      'latte formaggio burro yogurt panna uova uovo ricotta mascarpone parmigiano ' +
      'milch käse butter joghurt sahne eier rahm ' +
      'lait fromage beurre yaourt crème œufs oeufs ' +
      'leche queso mantequilla yogur nata huevos',
  ],
  [
    'Fruit & vegetables',
    'apple apples banana bananas orange oranges lemon lemons lime pear grapes berries strawberries blueberries raspberries melon watermelon peach plum kiwi mango pineapple avocado ' +
      'tomato tomatoes potato potatoes onion onions garlic carrot carrots lettuce salad spinach cucumber courgette zucchini pepper peppers broccoli cauliflower cabbage mushrooms celery leek herbs basil parsley ' +
      'mela mele banane arancia arance limone pera uva fragole pesca pesche pomodori pomodoro patate cipolla cipolle aglio carote insalata spinaci cetriolo peperoni funghi verdura frutta ' +
      'apfel äpfel birne zitrone trauben erdbeeren kartoffeln zwiebel zwiebeln knoblauch karotten möhren gurke gurken salat tomaten paprika pilze gemüse obst ' +
      'pomme pommes poire citron raisin fraises tomate tomates oignon ail carottes laitue concombre champignons légumes fruits ' +
      'manzana manzanas plátano naranja limón uvas fresas patata patatas cebolla ajo zanahoria lechuga pepino champiñones verduras frutas',
  ],
  [
    'Pantry',
    'pasta spaghetti penne rice flour sugar salt oil olive-oil vinegar beans lentils chickpeas coffee tea cereal cereals oats muesli honey spices pepper-corns stock tuna canned tinned biscuits cookies chocolate nuts ' +
      'riso farina zucchero sale olio aceto fagioli lenticchie ceci caffè tè biscotti tonno ' +
      'reis mehl zucker salz öl essig bohnen linsen kaffee tee nudeln haferflocken honig ' +
      'riz farine sucre sel huile vinaigre haricots lentilles café thé ' +
      'arroz harina azúcar sal aceite vinagre alubias lentejas',
  ],
];
const fold = (s: string) =>
  s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/œ/g, 'oe').replace(/ß/g, 'ss');
const groups = keywordGroups.map(
  ([category, words]) =>
    [
      category,
      words
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => fold(w).replace(/-/g, ' ')),
    ] as const,
);
function matches(words: string[], joined: string, keyword: string) {
  if (keyword.includes(' ')) return (' ' + joined + ' ').includes(' ' + keyword + ' ');
  if (keyword.length <= 3) return words.includes(keyword);
  if (keyword.length >= 5 && joined.includes(keyword)) return true;
  return words.some((w) => w.startsWith(keyword));
}
/**
 * Best-effort category for an item name using a small multilingual keyword map.
 * Returns one of `categories` (default: the app's default categories); a guess that
 * is not in the household's category list, or no match at all, gives 'Other'.
 */
export function guessCategory(name: string, categories: readonly string[] = defaultCategories) {
  const words = fold(String(name ?? ''))
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
  const joined = words.join(' ');
  if (!joined) return 'Other';
  for (const [category, keywords] of groups)
    if (keywords.some((k) => matches(words, joined, k)))
      return categories.includes(category) ? category : 'Other';
  return 'Other';
}
