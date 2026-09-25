import type { Product } from './domain';
/**
 * Product health indicator: Nutri-Score (the 2023 algorithm), additive flags and organic
 * certification, combined into a 0–100 score with a visible breakdown.
 *
 * - The source's own Nutri-Score (Open Food Facts) is used when recorded; otherwise it is
 *   estimated from declared per-100 g/ml values and labelled as an estimate.
 * - Additive flags summarise regulatory evidence. "No flag" is not a safety finding.
 * - The score is withheld when nutrition is unknown, rather than guessed.
 */
export type Grade = 'a' | 'b' | 'c' | 'd' | 'e';
export type NutriKind = 'food' | 'beverage' | 'water' | 'cheese' | 'fat' | 'red-meat';
export type NutriScore = {
  grade: Grade;
  score?: number;
  kind?: NutriKind;
  /** `source`: recorded by the catalogue. `estimate`: computed here from declared values. */
  origin: 'source' | 'estimate';
  notes: string[];
};
export type AdditiveRisk = 'high' | 'moderate' | 'limited';
export type AdditiveFlag = {
  code: string;
  name: string;
  risk: AdditiveRisk;
  summary: string;
  source: string;
};
export type HealthScore = {
  /** 0–100, or undefined when nutrition is too incomplete to score. */
  value?: number;
  band?: 'excellent' | 'good' | 'mediocre' | 'poor';
  nutrition?: NutriScore;
  nutritionPoints?: number;
  additives: { code: string; flag?: AdditiveFlag }[];
  additivePoints: number;
  organic: boolean;
  organicPoints: number;
  nova?: 1 | 2 | 3 | 4;
  /** Why the score is missing or capped. */
  notes: string[];
};
export const scoreReviewed = '2026-09-25';
const EFSA_ADDITIVES = 'https://www.efsa.europa.eu/en/topics/topic/food-additives';
const COLOURS_WARNING = 'https://eur-lex.europa.eu/eli/reg/2008/1333/oj';
const SOUTHAMPTON =
  'EU law requires the warning “may have an adverse effect on activity and attention in children” on foods containing this colour.';
const NSS =
  'A non-sugar sweetener. WHO’s 2023 guideline advises against relying on non-sugar sweeteners for weight control; authorised uses remain permitted.';
const WHO_NSS =
  'https://www.who.int/news/item/15-05-2023-who-advises-not-to-use-non-sugar-sweeteners-for-weight-control-in-newly-released-guideline';
const flags: Record<string, Omit<AdditiveFlag, 'code'>> = {
  e171: {
    name: 'Titanium dioxide',
    risk: 'high',
    summary:
      'EFSA (2021) could no longer consider it safe as a food additive because genotoxicity could not be ruled out; the EU withdrew its authorisation in 2022.',
    source:
      'https://www.efsa.europa.eu/en/news/titanium-dioxide-e171-no-longer-considered-safe-when-used-food-additive',
  },
  e249: {
    name: 'Potassium nitrite',
    risk: 'high',
    summary:
      'Nitrites contribute to nitrosamine formation in cured meat. EFSA (2023) concluded that nitrosamine exposure in food raises a health concern.',
    source: EFSA_ADDITIVES,
  },
  e250: {
    name: 'Sodium nitrite',
    risk: 'high',
    summary:
      'Nitrites contribute to nitrosamine formation in cured meat. EFSA (2023) concluded that nitrosamine exposure in food raises a health concern.',
    source: EFSA_ADDITIVES,
  },
  e251: {
    name: 'Sodium nitrate',
    risk: 'moderate',
    summary: 'Converted to nitrite in food and the body; see the nitrite entries.',
    source: EFSA_ADDITIVES,
  },
  e252: {
    name: 'Potassium nitrate',
    risk: 'moderate',
    summary: 'Converted to nitrite in food and the body; see the nitrite entries.',
    source: EFSA_ADDITIVES,
  },
  e102: { name: 'Tartrazine', risk: 'high', summary: SOUTHAMPTON, source: COLOURS_WARNING },
  e104: { name: 'Quinoline yellow', risk: 'high', summary: SOUTHAMPTON, source: COLOURS_WARNING },
  e110: { name: 'Sunset yellow FCF', risk: 'high', summary: SOUTHAMPTON, source: COLOURS_WARNING },
  e122: { name: 'Azorubine', risk: 'high', summary: SOUTHAMPTON, source: COLOURS_WARNING },
  e124: { name: 'Ponceau 4R', risk: 'high', summary: SOUTHAMPTON, source: COLOURS_WARNING },
  e129: { name: 'Allura red AC', risk: 'high', summary: SOUTHAMPTON, source: COLOURS_WARNING },
  e320: {
    name: 'Butylated hydroxyanisole (BHA)',
    risk: 'moderate',
    summary: 'IARC classifies BHA as possibly carcinogenic to humans (Group 2B).',
    source: EFSA_ADDITIVES,
  },
  e951: {
    name: 'Aspartame',
    risk: 'moderate',
    summary:
      'IARC classified aspartame as possibly carcinogenic (Group 2B) in 2023; JECFA kept the 40 mg/kg/day acceptable daily intake. Not suitable for people with PKU.',
    source:
      'https://www.who.int/news/item/14-07-2023-aspartame-hazard-and-risk-assessment-results-released',
  },
  e220: {
    name: 'Sulphur dioxide',
    risk: 'moderate',
    summary:
      'Sulphites can trigger reactions in sensitive people, including some with asthma; they must be declared as allergens above 10 mg/kg.',
    source: EFSA_ADDITIVES,
  },
  e621: {
    name: 'Monosodium glutamate',
    risk: 'limited',
    summary:
      'EFSA (2017) set a group acceptable daily intake of 30 mg/kg/day for glutamates and noted that high consumers may exceed it.',
    source: EFSA_ADDITIVES,
  },
  e407: {
    name: 'Carrageenan',
    risk: 'limited',
    summary:
      'EFSA (2018) kept a temporary acceptable daily intake because of data gaps and asked for more studies.',
    source: EFSA_ADDITIVES,
  },
  e150c: {
    name: 'Ammonia caramel',
    risk: 'limited',
    summary: 'EFSA set an acceptable daily intake in 2011; high consumers may approach it.',
    source: EFSA_ADDITIVES,
  },
  e150d: {
    name: 'Sulphite ammonia caramel',
    risk: 'limited',
    summary: 'EFSA set an acceptable daily intake in 2011; high consumers may approach it.',
    source: EFSA_ADDITIVES,
  },
  e211: {
    name: 'Sodium benzoate',
    risk: 'limited',
    summary: 'Can form small amounts of benzene in drinks that also contain vitamin C.',
    source: EFSA_ADDITIVES,
  },
  e321: {
    name: 'Butylated hydroxytoluene (BHT)',
    risk: 'limited',
    summary: 'EFSA (2012) set a low acceptable daily intake of 0.25 mg/kg/day.',
    source: EFSA_ADDITIVES,
  },
  e433: {
    name: 'Polysorbate 80',
    risk: 'limited',
    summary:
      'Animal studies suggest effects on gut microbiota; EFSA found no safety concern at reported uses.',
    source: EFSA_ADDITIVES,
  },
  e466: {
    name: 'Carboxymethylcellulose',
    risk: 'limited',
    summary:
      'Animal and small human studies suggest effects on gut microbiota; EFSA found no safety concern at reported uses.',
    source: EFSA_ADDITIVES,
  },
  e120: {
    name: 'Carmine',
    risk: 'limited',
    summary: 'Can cause allergic reactions in sensitive people.',
    source: EFSA_ADDITIVES,
  },
  e950: { name: 'Acesulfame K', risk: 'limited', summary: NSS, source: WHO_NSS },
  e952: { name: 'Cyclamate', risk: 'limited', summary: NSS, source: WHO_NSS },
  e954: { name: 'Saccharin', risk: 'limited', summary: NSS, source: WHO_NSS },
  e955: { name: 'Sucralose', risk: 'limited', summary: NSS, source: WHO_NSS },
  e960: { name: 'Steviol glycosides', risk: 'limited', summary: NSS, source: WHO_NSS },
};
// Families that share an assessment.
for (const code of ['e221', 'e222', 'e223', 'e224', 'e225', 'e226', 'e227', 'e228'])
  flags[code] = { ...flags.e220, name: 'Sulphite (' + code.toUpperCase() + ')' };
for (const code of ['e338', 'e339', 'e340', 'e341', 'e343', 'e450', 'e451', 'e452'])
  flags[code] = {
    name: 'Phosphate (' + code.toUpperCase() + ')',
    risk: 'limited',
    summary:
      'EFSA (2019) set a group acceptable daily intake for phosphates and noted that some high consumers, especially children, may exceed it.',
    source: EFSA_ADDITIVES,
  };
for (const code of ['e620', 'e622', 'e623', 'e624', 'e625'])
  flags[code] = { ...flags.e621, name: 'Glutamate (' + code.toUpperCase() + ')' };
/** `en:e150d` / `E 150 d` / `e250` → `e150d`. */
export function additiveCode(tag: string) {
  const m = tag
    .toLowerCase()
    .replace(/^[a-z]{2}:/, '')
    .replace(/\s+/g, '')
    .match(/^e(\d{3,4})([a-z]?)/);
  return m ? 'e' + m[1] + m[2] : '';
}
export function additiveFlag(tag: string): AdditiveFlag | undefined {
  const code = additiveCode(tag);
  const f = flags[code] || flags[code.replace(/[a-z]$/, '')];
  return f ? { code, ...f } : undefined;
}
const SWEETENERS = /^e(?:950|951|952|954|955|957|959|960[a-d]?|961|962|969)$/;
const has = (p: Product, re: RegExp) => p.categories.some((c) => re.test(c));
export function nutriKind(p: Product): NutriKind | undefined {
  if (has(p, /^en:(?:alcoholic-beverages|baby-foods|baby-milks|food-additives)$/)) return undefined;
  if (
    has(p, /^en:(?:waters|mineral-waters|spring-waters|natural-mineral-waters|still-waters)$/) &&
    !has(p, /flavo|sweetened|sodas|juices/)
  )
    return 'water';
  if (has(p, /^en:cheeses$/)) return 'cheese';
  if (
    has(
      p,
      /^en:(?:fats|vegetable-fats|animal-fats|vegetable-oils|olive-oils|butters|margarines|creams|nut-butters|peanut-butters|oilseed-purees)$/,
    )
  )
    return 'fat';
  if (has(p, /^en:beverages$/) && !has(p, /^en:(?:dairies|yogurts|fermented-milk-products)$/))
    return 'beverage';
  if (has(p, /^en:(?:beef|pork|lamb|veal|mutton|red-meats|beef-meat|pork-meat)$/))
    return 'red-meat';
  return 'food';
}
// Categories whose fruit, vegetable and legume share is at least 80% by definition (the
// 2023 update counts olive, rapeseed and walnut oils). Other products count zero.
const MOSTLY_FVL =
  /^en:(?:fruit-juices|vegetable-juices|orange-juices|apple-juices|squeezed-juices|fresh-fruits|fresh-vegetables|fruits|vegetables|frozen-vegetables|canned-vegetables|legumes|pulses|dried-fruits|olive-oils|extra-virgin-olive-oils|rapeseed-oils|walnut-oils|fruits-puree-without-sugar-added)$/;
const points = (v: number, thresholds: number[]) => thresholds.filter((t) => v > t).length;
const GENERAL = {
  energy: [335, 670, 1005, 1340, 1675, 2010, 2345, 2680, 3015, 3350],
  sugars: [3.4, 6.8, 10, 14, 17, 20, 24, 27, 31, 34, 37, 41, 44, 48, 51],
  saturated: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  salt: Array.from({ length: 20 }, (_, i) => Math.round((i + 1) * 0.2 * 10) / 10),
  protein: [2.4, 4.8, 7.2, 9.6, 12, 14, 17],
  fibre: [3, 4.1, 5.2, 6.3, 7.4],
};
const BEVERAGE = {
  energy: [30, 90, 150, 210, 240, 270, 300, 330, 360, 390],
  sugars: [0.5, 2, 3.5, 5, 6, 7, 8, 9, 10, 11],
  protein: [1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 3],
};
/**
 * Nutri-Score (2023 update for foods, fats, cheese and beverages) from declared per-100
 * values. Fruit, vegetable and legume share is not declared on labels, so it counts as
 * zero; the result is labelled as an estimate.
 */
export function estimateNutriScore(p: Product): NutriScore | undefined {
  const kind = nutriKind(p);
  if (!kind) return undefined;
  if (kind === 'water') return { grade: 'a', kind, origin: 'estimate', notes: [] };
  const n = p.nutrition || {};
  const kcal = n['energy-kcal'],
    sugars = n.sugars,
    sat = n['saturated-fat'],
    salt = n.salt ?? (n.sodium !== undefined ? (n.sodium * 2.5) / 1000 : undefined);
  if ([kcal, sugars, sat, salt].some((v) => v === undefined || !Number.isFinite(v)))
    return undefined;
  const kj = kcal! * 4.184,
    protein = n.proteins ?? 0,
    fibre = n.fiber ?? 0;
  const fvl = has(p, MOSTLY_FVL);
  const notes = [
    fvl
      ? 'Fruit, vegetable and legume content is assumed to be over 80% from the category.'
      : 'Fruit, vegetable and legume content is not declared and counts as zero.',
  ];
  if (n.fiber === undefined) notes.push('Fibre is not declared and counts as zero.');
  let negative: number, positive: number, score: number;
  if (kind === 'beverage') {
    const sweetener = (p.additives || []).some((a) => SWEETENERS.test(additiveCode(a)));
    negative =
      points(kj, BEVERAGE.energy) +
      points(sugars!, BEVERAGE.sugars) +
      points(sat!, GENERAL.saturated) +
      points(salt!, GENERAL.salt) +
      (sweetener ? 4 : 0);
    positive = points(protein, BEVERAGE.protein) + points(fibre, GENERAL.fibre) + (fvl ? 6 : 0);
    score = negative - positive;
    const grade: Grade = score <= 2 ? 'b' : score <= 6 ? 'c' : score <= 9 ? 'd' : 'e';
    return { grade, score, kind, origin: 'estimate', notes };
  }
  if (kind === 'fat') {
    const fat = n.fat;
    const ratio = fat && fat > 0 ? (sat! / fat) * 100 : 0;
    negative =
      points(sat! * 37, [120, 240, 360, 480, 600, 720, 840, 960, 1080, 1200]) +
      points(sugars!, GENERAL.sugars) +
      [10, 16, 22, 28, 34, 40, 46, 52, 58, 64].filter((t) => ratio >= t).length +
      points(salt!, GENERAL.salt);
    const proteinPoints = negative < 7 ? points(protein, GENERAL.protein) : 0;
    positive = proteinPoints + points(fibre, GENERAL.fibre) + (fvl ? 5 : 0);
    score = negative - positive;
    const grade: Grade =
      score <= -6 ? 'a' : score <= 2 ? 'b' : score <= 10 ? 'c' : score <= 18 ? 'd' : 'e';
    return { grade, score, kind, origin: 'estimate', notes };
  }
  negative =
    points(kj, GENERAL.energy) +
    points(sugars!, GENERAL.sugars) +
    points(sat!, GENERAL.saturated) +
    points(salt!, GENERAL.salt);
  let proteinPoints = points(protein, GENERAL.protein);
  if (kind === 'red-meat') proteinPoints = Math.min(proteinPoints, 2);
  if (negative >= 11 && kind !== 'cheese') proteinPoints = 0;
  positive = proteinPoints + points(fibre, GENERAL.fibre) + (fvl ? 5 : 0);
  score = negative - positive;
  const grade: Grade =
    score <= 0 ? 'a' : score <= 2 ? 'b' : score <= 10 ? 'c' : score <= 18 ? 'd' : 'e';
  return { grade, score, kind, origin: 'estimate', notes };
}
export function nutriScore(p: Product): NutriScore | undefined {
  if (p.nutriscore && /^[a-e]$/.test(p.nutriscore.grade))
    return {
      grade: p.nutriscore.grade,
      ...(p.nutriscore.score !== undefined ? { score: p.nutriscore.score } : {}),
      kind: nutriKind(p),
      origin: 'source',
      notes: [],
    };
  return estimateNutriScore(p);
}
const ORGANIC =
  /^(?:en|fr|de|it):(?:organic|eu-organic|bio|bio-suisse|bio-suisse-knospe|knospe|demeter|ch-bio|ab-agriculture-biologique|organic-farming|naturaplan-bio|migros-bio|bio-migros)$/;
export const isOrganic = (p: Product) => !!p.labels?.some((l) => ORGANIC.test(l.toLowerCase()));
const GRADE_POINTS: Record<Grade, number> = { a: 60, b: 48, c: 33, d: 18, e: 5 };
const ADDITIVE_PENALTY: Record<AdditiveRisk, number> = { high: 15, moderate: 8, limited: 3 };
export function healthScore(p: Product): HealthScore {
  const notes: string[] = [];
  const nutrition = nutriScore(p);
  const codes = [...new Set((p.additives || []).map(additiveCode).filter(Boolean))];
  const additives = codes.map((code) => ({ code, flag: additiveFlag(code) }));
  const penalty = additives.reduce((n, a) => n + (a.flag ? ADDITIVE_PENALTY[a.flag.risk] : 0), 0);
  const additivePoints = Math.max(0, 30 - penalty);
  const organic = isOrganic(p);
  const organicPoints = organic ? 10 : 0;
  const base = {
    nutrition,
    additives,
    additivePoints,
    organic,
    organicPoints,
    ...(p.nova ? { nova: p.nova } : {}),
  };
  if (!nutrition) {
    notes.push(
      nutriKind(p)
        ? 'Not scored: energy, sugars, saturated fat and salt per 100 g/ml are needed.'
        : 'Not scored: Nutri-Score does not apply to this kind of product.',
    );
    return { ...base, notes };
  }
  if (!p.additives && !p.ingredients)
    notes.push('Ingredients are not recorded, so additives may be missing.');
  let value = GRADE_POINTS[nutrition.grade] + additivePoints + organicPoints;
  if (additives.some((a) => a.flag?.risk === 'high')) {
    value = Math.min(value, 49);
    notes.push('Capped at 49 because an additive has a high-level flag.');
  }
  return {
    ...base,
    value,
    nutritionPoints: GRADE_POINTS[nutrition.grade],
    band: value >= 75 ? 'excellent' : value >= 50 ? 'good' : value >= 25 ? 'mediocre' : 'poor',
    notes,
  };
}
/**
 * Candidates in the same specific category with a clearly better score (at least 10
 * points higher), best first. Candidates without a score are never suggested.
 */
export function betterAlternatives(original: Product, candidates: Product[], limit = 6) {
  const own = healthScore(original).value;
  const category = original.categories.at(-1);
  if (own === undefined || !category) return [];
  const seen = new Set<string>([original.id]);
  return candidates
    .filter((c) => {
      if (seen.has(c.id) || !c.categories.includes(category)) return false;
      seen.add(c.id);
      return true;
    })
    .map((product) => ({ product, score: healthScore(product) }))
    .filter((c) => c.score.value !== undefined && c.score.value >= own + 10)
    .sort(
      (a, b) =>
        b.score.value! - a.score.value! ||
        Number(!!b.product.image) - Number(!!a.product.image) ||
        a.product.name.localeCompare(b.product.name),
    )
    .slice(0, limit);
}
