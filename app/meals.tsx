'use client';
import { useState } from 'react';
import {
  Plus,
  ArrowRight,
  Clock,
  Users,
  ChefHat,
  CalendarDays,
  Trash2,
  Check,
  ShoppingBasket,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { api, type OpenHouseholdState } from '@/lib/use-household';
import { uid, type RecordData, type RecordFields, type Product } from '@/lib/domain';
import {
  nutrients,
  nutrientText,
  recipeNutrition,
  sumNutrition,
  planShopping,
  weekDates,
  localDate,
  type Recipe,
} from '@/lib/nutrition';
import { recipeSchema } from '@/lib/meal-schema';
import {
  isMealRecord,
  isProductRecord,
  isRecipeRecord,
  productSnapshot,
  type MealFields,
  type MealRecord,
  type RecipeRecord,
} from '@/lib/record-types';
import { errorMessage } from '@/lib/utils';
import sampleRecipes from '@/lib/demo-recipes.json';
import { demoProducts } from '@/lib/demo';
import { Modal, Choice, Photo } from './ui';
import PhotoUpload from './photo-upload';
import { NutritionPanel, NutritionFields, IngredientReview } from './nutrition-panel';
type State = OpenHouseholdState;
/** The meal plan form: fields fill in as the member edits them. */
type PlanDraft = Partial<MealFields>;
/** An ingredient line proposed for a shopping list, and whether to add it. */
type ShopLine = ReturnType<typeof planShopping>[number] & { selected: boolean };
/** A recipe ingredient entered by hand (no catalogue record). */
type ManualIngredient = {
  name: string;
  ingredients?: string;
  nutrition: Record<string, number>;
  basis: '100g' | '100ml';
};
const emptyRecipe = (): Recipe => ({
  name: '',
  description: '',
  servings: 2,
  minutes: 20,
  ingredients: [],
  steps: [''],
  tags: [],
});
const meals = { Breakfast: 'Breakfast', Lunch: 'Lunch', Dinner: 'Dinner', Snack: 'Snack' };
export default function Meals({
  s,
  lists,
  active,
  onAdd,
}: {
  s: State;
  lists: RecordData[];
  active?: RecordData;
  onAdd: (data: RecordFields, to?: string) => void;
}) {
  const recipes = s.records.filter(isRecipeRecord),
    plans = s.records.filter(isMealRecord);
  const [tab, setTab] = useState('recipes'),
    [mode, setMode] = useState(''),
    [current, setCurrent] = useState<RecipeRecord | MealRecord>(),
    [draft, setDraft] = useState<Recipe>(emptyRecipe),
    [plan, setPlan] = useState<PlanDraft>({}),
    [week, setWeek] = useState(localDate()),
    [day, setDay] = useState(localDate()),
    [person, setPerson] = useState(s.user.id),
    [eaten, setEaten] = useState(false),
    [targets, setTargets] = useState<Record<string, number>>(
      s.user.preferences?.nutritionTargets || {},
    ),
    [busy, setBusy] = useState(false),
    [shop, setShop] = useState<ShopLine[]>([]),
    [to, setTo] = useState(active?.id || ''),
    [portions, setPortions] = useState(1);
  // `current` is the recipe in the detail and edit views, and the meal entry in the plan view.
  const currentRecipe = current && isRecipeRecord(current) ? current : undefined,
    currentMeal = current && isMealRecord(current) ? current : undefined;
  const dates = weekDates(week),
    weekPlans = plans.filter((r) => dates.includes(r.data.date)),
    dayPlans = plans.filter(
      (r) => r.data.date === day && r.data.member === person && (!eaten || r.data.eaten),
    ),
    summary = sumNutrition(
      dayPlans.flatMap((r) =>
        r.data.recipeSnapshot ? [recipeNutrition(r.data.recipeSnapshot, r.data.servings)] : [],
      ),
    );
  const memberName = (id: string) => s.members.find((m) => m.user === id)?.name || 'Former member';
  function detail(r: RecipeRecord) {
    setCurrent(r);
    setPortions(r.data.servings);
    setMode('detail');
  }
  function schedule(r: RecipeRecord, date = localDate()) {
    setPlan({
      recipe: r.id,
      date,
      meal: 'Dinner',
      servings: 1,
      member: s.user.id,
      eaten: false,
      recipeSnapshot: r.data,
    });
    setCurrent(undefined);
    setMode('plan');
  }
  function shopping(entries: { recipe: Recipe; servings: number }[]) {
    const items = planShopping(entries).map((i) => ({ ...i, selected: true }));
    setShop(items);
    setTo(active?.id || lists[0]?.id || '');
    setMode('shop');
  }
  function remove(r: RecordData) {
    s.mutate(r.kind, r.data, r, true);
    toast('Removed', {
      action: {
        label: 'Undo',
        onClick: () => s.mutate(r.kind, r.data, { ...r, version: r.version + 1 }),
      },
    });
  }
  return (
    <div className="meals-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">GOOD FOOD. A LITTLE FORETHOUGHT.</span>
          <h1>At our table.</h1>
          <p className="muted">
            The meals you love, the ingredients you need, a week that feels easier.
          </p>
        </div>
        <button
          className="btn primary"
          onClick={() => {
            setCurrent(undefined);
            setDraft(emptyRecipe());
            setMode('edit');
          }}
        >
          <Plus size={18} /> New recipe
        </button>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="view-tabs">
          <TabsTrigger value="recipes">Our recipes</TabsTrigger>
          <TabsTrigger value="week">Meal plan</TabsTrigger>
          <TabsTrigger value="nutrition">Nutrition</TabsTrigger>
        </TabsList>
        <TabsContent value="recipes">
          {!recipes.length ? (
            <div className="empty card">
              <ChefHat size={40} />
              <h2>Start with a family favourite.</h2>
              <p>
                Add a photo, ingredients and the way you make it. Plan it once, shop for it
                together.
              </p>
              <button
                className="btn primary"
                onClick={() => {
                  setCurrent(undefined);
                  setDraft(emptyRecipe());
                  setMode('edit');
                }}
              >
                Create your first recipe
              </button>
            </div>
          ) : (
            <>
              <div className="recipe-grid">
                {recipes.map((r) => {
                  const n = recipeNutrition(r.data);
                  return (
                    <article className="recipe-card" key={r.id}>
                      <button className="recipe-open" onClick={() => detail(r)}>
                        {r.data.image ? (
                          <img src={r.data.image} alt={r.data.name} loading="lazy" />
                        ) : (
                          <div className="recipe-placeholder">
                            <ChefHat size={48} />
                          </div>
                        )}
                        <div className="recipe-copy">
                          <span className="eyebrow">
                            {r.data.tags?.join(' · ') || 'HOUSEHOLD RECIPE'}
                          </span>
                          <h2>{r.data.name}</h2>
                          <p className="muted">{r.data.description}</p>
                          <div className="row wrap recipe-meta">
                            <span>
                              <Clock size={15} />
                              {r.data.minutes ? `${r.data.minutes} min` : 'Time not set'}
                            </span>
                            <span>
                              <Users size={15} />
                              {r.data.servings} servings
                            </span>
                          </div>
                          <p className="fine">
                            Per serving: {nutrientText(n['energy-kcal'], 'energy-kcal')} ·{' '}
                            {nutrientText(n.proteins, 'proteins')} protein
                          </p>
                        </div>
                      </button>
                      <div className="row between recipe-actions">
                        <button className="link" onClick={() => schedule(r)}>
                          <CalendarDays size={17} /> Plan meal
                        </button>
                        <button
                          className="iconbtn"
                          aria-label={'Shop ingredients for ' + r.data.name}
                          onClick={() => shopping([{ recipe: r.data, servings: r.data.servings }])}
                        >
                          <ShoppingBasket size={20} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
          <p className="source-note">
            Generic-food nutrition:{' '}
            <a href="https://valeursnutritives.ch/en/downloads/" target="_blank" rel="noreferrer">
              Swiss Food Composition Database, FSVO · v7.1
            </a>
            . Packaged products: Open Food Facts. Household recipes and label entries are
            user-entered.{' '}
            <a href="/recipes/ATTRIBUTION.txt" target="_blank">
              Example photo credits
            </a>
            .
          </p>
        </TabsContent>
        <TabsContent value="week">
          <div className="planner-toolbar row wrap between">
            <label>
              Seven days starting
              <input
                type="date"
                value={week}
                onChange={(e) => {
                  if (e.target.value) setWeek(e.target.value);
                }}
              />
            </label>
            <button
              className="btn"
              disabled={!weekPlans.length || !lists.length}
              onClick={() =>
                shopping(
                  weekPlans.flatMap((r) =>
                    r.data.recipeSnapshot && !r.data.eaten
                      ? [{ recipe: r.data.recipeSnapshot, servings: r.data.servings }]
                      : [],
                  ),
                )
              }
            >
              <ShoppingBasket size={18} /> Shop planned ingredients
            </button>
          </div>
          <p className="fine">
            Each entry is a portion for one member. Add a separate entry for each person; nutrition
            and shopping quantities follow those servings. Plans and eaten status are visible to
            this household.
          </p>
          <div className="week-grid">
            {dates.map((date) => (
              <section className={'day-column ' + (date === localDate() ? 'today' : '')} key={date}>
                <div className="day-heading">
                  <span>
                    {new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
                      weekday: 'short',
                    })}
                  </span>
                  <strong>{new Date(date + 'T12:00:00').getDate()}</strong>
                  <button
                    className="iconbtn"
                    aria-label={'Plan meal for ' + date}
                    disabled={!recipes.length}
                    onClick={() => schedule(recipes[0], date)}
                  >
                    <Plus size={18} />
                  </button>
                </div>
                {plans
                  .filter((r) => r.data.date === date)
                  .sort(
                    (a, b) =>
                      Object.keys(meals).indexOf(a.data.meal) -
                      Object.keys(meals).indexOf(b.data.meal),
                  )
                  .map((r) => (
                    <article className="meal-tile" key={r.id}>
                      {r.data.recipeSnapshot?.image && (
                        <img src={r.data.recipeSnapshot.image} alt="" loading="lazy" />
                      )}
                      <button
                        className="meal-title"
                        onClick={() => {
                          setCurrent(r);
                          setPlan({ ...r.data });
                          setMode('plan');
                        }}
                      >
                        <small>{r.data.meal}</small>
                        <strong>
                          {r.data.recipeSnapshot?.name || 'Recipe no longer available'}
                        </strong>
                        <span>
                          {memberName(r.data.member)} · {r.data.servings}{' '}
                          {r.data.servings === 1 ? 'serving' : 'servings'}
                        </span>
                      </button>
                      <button
                        className={'meal-check ' + (r.data.eaten ? 'is-eaten' : '')}
                        onClick={() => s.mutate('meal', { ...r.data, eaten: !r.data.eaten }, r)}
                        aria-label={
                          (r.data.eaten ? 'Unmark eaten ' : 'Mark eaten ') +
                          r.data.recipeSnapshot?.name
                        }
                      >
                        <Check size={16} />
                        {r.data.eaten ? 'Eaten' : 'Mark eaten'}
                      </button>
                    </article>
                  ))}
                {!plans.some((r) => r.data.date === date) && (
                  <p className="fine">A little room for something good.</p>
                )}
              </section>
            ))}
          </div>
          {!recipes.length && <p className="notice">Save a recipe to start your meal plan.</p>}
        </TabsContent>
        <TabsContent value="nutrition">
          <section className="card stack nutrition-day">
            <div className="row wrap between">
              <div>
                <h2>A clearer picture of the day.</h2>
                <p className="muted">
                  {eaten
                    ? 'Recorded eaten portions'
                    : 'All planned portions, including eaten meals'}
                  . Food outside these entries is not included.
                </p>
              </div>
              <button
                className="btn"
                onClick={() => {
                  setTargets(s.user.preferences?.nutritionTargets || {});
                  setMode('targets');
                }}
              >
                My daily targets
              </button>
            </div>
            <div className="formgrid">
              <label>
                Day
                <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
              </label>
              <label>
                For
                <Choice
                  label="Nutrition member"
                  value={person}
                  onChange={setPerson}
                  options={Object.fromEntries(s.members.map((m) => [m.user, m.name ?? '']))}
                />
              </label>
              <label>
                Show
                <Choice
                  label="Nutrition scope"
                  value={eaten ? 'eaten' : 'planned'}
                  onChange={(v) => setEaten(v === 'eaten')}
                  options={{ planned: 'Planned portions', eaten: 'Recorded eaten' }}
                />
              </label>
            </div>
            <p className="fine">
              {dayPlans.length} entries for {memberName(person)}.{' '}
              {person === s.user.id
                ? 'Your optional targets are applied.'
                : 'Only this member’s meal portions are shown; your targets are not applied.'}
            </p>
            <NutritionPanel
              title={eaten ? 'Recorded eaten nutrition' : 'Planned nutrition'}
              summary={summary}
              targets={person === s.user.id ? s.user.preferences?.nutritionTargets : undefined}
            />
          </section>
        </TabsContent>
      </Tabs>
      <Modal
        open={mode === 'edit'}
        onClose={() => setMode('')}
        title={current ? 'Edit our recipe' : 'Something worth making again.'}
        description="Your recipe, shared only with this household. Ingredient quantities must match the selected raw/cooked food and nutrition basis."
        wide
      >
        <RecipeEditor
          key={current?.id || 'new'}
          s={s}
          value={draft}
          setValue={setDraft}
          onSave={() => {
            const parsed = recipeSchema.safeParse(draft);
            if (!parsed.success) {
              toast.error(parsed.error.issues[0]?.message || 'Check recipe fields');
              return;
            }
            s.mutate('recipe', parsed.data, current);
            setMode('');
            toast.success('Recipe saved');
          }}
        />
      </Modal>
      <Modal
        open={mode === 'detail'}
        onClose={() => setMode('')}
        title={current?.data.name || 'Recipe'}
        wide
      >
        {currentRecipe && (
          <div className="stack recipe-detail">
            {currentRecipe.data.image && (
              <img
                className="recipe-cover"
                src={currentRecipe.data.image}
                alt={currentRecipe.data.name}
              />
            )}
            <p className="muted">{currentRecipe.data.description}</p>
            {currentRecipe.data.photoCredit && (
              <p className="fine">
                Photo:{' '}
                <a href={currentRecipe.data.sourceUrl} target="_blank" rel="noreferrer">
                  {currentRecipe.data.photoCredit}
                </a>
                . Illustrative serving; nutrition comes from the ingredients below.
              </p>
            )}
            <div className="row wrap">
              <button className="btn primary" onClick={() => schedule(currentRecipe)}>
                Plan a meal
              </button>
              <button
                className="btn"
                onClick={() => {
                  setDraft(structuredClone(currentRecipe.data));
                  setMode('edit');
                }}
              >
                Edit recipe
              </button>
              <button
                className="link danger"
                onClick={() => {
                  remove(currentRecipe);
                  setMode('');
                }}
              >
                Delete recipe
              </button>
            </div>
            <p className="fine">
              Planned meals retain the recipe version used when added, even if this recipe is edited
              or removed later.
            </p>
            <label>
              Servings to prepare
              <input
                type="number"
                min="0.1"
                max="100"
                step="any"
                value={portions}
                onChange={(e) => setPortions(Number(e.target.value))}
              />
            </label>
            <h3>Ingredients</h3>
            <div className="recipe-ingredients">
              {currentRecipe.data.ingredients.map((i) => (
                <div key={i.id}>
                  <strong>
                    {Math.round(((i.amount * portions) / currentRecipe.data.servings) * 100) / 100}{' '}
                    {i.unit}
                  </strong>
                  <span>
                    {i.name}
                    <small>{i.note}</small>
                    <small>{i.product?.source || 'No linked nutrition record'}</small>
                    {i.product?.sourceUrl && (
                      <a
                        className="fine"
                        href={i.product.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Nutrition source ↗
                      </a>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <button
              disabled={!portions || !lists.length}
              className="btn primary"
              onClick={() => shopping([{ recipe: currentRecipe.data, servings: portions }])}
            >
              Review shopping ingredients <ArrowRight size={18} />
            </button>
            <h3>Make it together</h3>
            <ol className="recipe-steps">
              {currentRecipe.data.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
            <NutritionPanel
              summary={recipeNutrition(currentRecipe.data)}
              title="Nutrition per serving"
            />
            <details>
              <summary>Ingredient requirements & evidence</summary>
              {currentRecipe.data.ingredients.map((i) => (
                <div className="card" key={i.id}>
                  <h4>{i.name}</h4>
                  {i.product ? (
                    <IngredientReview
                      product={i.product}
                      constraints={[
                        ...(s.household.settings.constraints || []),
                        ...(s.user.preferences?.constraints || []),
                      ]}
                    />
                  ) : (
                    <p>Ingredient data missing. Check the current label.</p>
                  )}
                </div>
              ))}
              <p className="fine">
                Applies household requirements and {s.user.name}’s preferences. Generic composition
                records do not establish allergen or certification status.
              </p>
            </details>
          </div>
        )}
      </Modal>
      <Modal
        open={mode === 'plan'}
        onClose={() => setMode('')}
        title={currentMeal ? 'Edit this meal' : 'A place in the week.'}
      >
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const r = recipes.find((r) => r.id === plan.recipe);
            if (!r && !currentMeal) return;
            const data = {
              ...plan,
              recipeSnapshot:
                currentMeal && currentMeal.data.recipe === plan.recipe
                  ? currentMeal.data.recipeSnapshot
                  : r?.data,
            };
            s.mutate('meal', data, currentMeal);
            setMode('');
            setTab('week');
            if (plan.date && !dates.includes(plan.date)) setWeek(plan.date);
            toast.success('Meal plan saved');
          }}
        >
          <label>
            Recipe
            <Choice
              label="Meal recipe"
              value={plan.recipe || ''}
              onChange={(v) => setPlan({ ...plan, recipe: v })}
              options={Object.fromEntries(
                [
                  ...recipes,
                  ...(currentMeal && !recipes.some((r) => r.id === plan.recipe)
                    ? [
                        {
                          id: plan.recipe,
                          data: {
                            name: currentMeal.data.recipeSnapshot?.name + ' (saved version)',
                          },
                        },
                      ]
                    : []),
                ].map((r) => [r.id, r.data.name]),
              )}
            />
          </label>
          <div className="grid2">
            <label>
              Date
              <input
                required
                type="date"
                value={plan.date || ''}
                onChange={(e) => setPlan({ ...plan, date: e.target.value })}
              />
            </label>
            <label>
              Meal
              <Choice
                label="Meal type"
                value={plan.meal || 'Dinner'}
                onChange={(v) => setPlan({ ...plan, meal: v })}
                options={meals}
              />
            </label>
            <label>
              For
              <Choice
                label="Meal member"
                value={plan.member || s.user.id}
                onChange={(v) => setPlan({ ...plan, member: v })}
                options={Object.fromEntries(s.members.map((m) => [m.user, m.name ?? '']))}
              />
            </label>
            <label>
              Servings for this person
              <input
                type="number"
                min="0.1"
                max="100"
                step="any"
                required
                value={plan.servings ?? 1}
                onChange={(e) => setPlan({ ...plan, servings: Number(e.target.value) })}
              />
            </label>
          </div>
          <label>
            Prep notes
            <textarea
              maxLength={500}
              value={plan.notes || ''}
              onChange={(e) => setPlan({ ...plan, notes: e.target.value })}
            />
          </label>
          <div className="row between">
            {currentMeal && (
              <button
                type="button"
                className="link danger"
                onClick={() => {
                  remove(currentMeal);
                  setMode('');
                }}
              >
                Remove meal
              </button>
            )}
            <button className="btn primary">Save meal</button>
          </div>
        </form>
      </Modal>
      <Modal
        open={mode === 'shop'}
        onClose={() => setMode('')}
        title="From the kitchen to the list."
        description="Review quantities before adding. Packs are rounded up when a compatible pack size is recorded; notes retain the exact amount needed. Check what you already have."
        wide
      >
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!to || !shop.some((i) => i.selected)) return;
            for (const { selected, ...item } of shop) if (selected) onAdd(item, to);
            setMode('');
          }}
        >
          <Choice
            label="Destination shopping list"
            value={to}
            onChange={setTo}
            options={Object.fromEntries(lists.map((l) => [l.id, l.data.name ?? '']))}
          />
          {shop.map((i, index) => (
            <div className="shop-ingredient" key={index}>
              <input
                type="checkbox"
                aria-label={'Include ' + i.name}
                checked={i.selected}
                onChange={(e) =>
                  setShop(
                    shop.map((x, n) => (n === index ? { ...x, selected: e.target.checked } : x)),
                  )
                }
              />
              <span>
                <strong>{i.name}</strong>
                <small>{i.notes}</small>
              </span>
              <label>
                Quantity
                <input
                  type="number"
                  min="0.01"
                  max="10000"
                  step="any"
                  required={i.selected}
                  disabled={!i.selected}
                  value={i.quantity}
                  onChange={(e) =>
                    setShop(
                      shop.map((x, n) =>
                        n === index ? { ...x, quantity: Number(e.target.value) } : x,
                      ),
                    )
                  }
                />
                <small>
                  {i.unit}
                  {i.pack ? ' · ' + i.pack : ''}
                </small>
              </label>
            </div>
          ))}
          {!shop.length && <p>No uneaten planned meals to shop for.</p>}
          <button className="btn primary" disabled={!to || !shop.some((i) => i.selected)}>
            Add selected ingredients
          </button>
        </form>
      </Modal>
      <Modal
        open={mode === 'targets'}
        onClose={() => setMode('')}
        title="Your daily reference targets."
        description="Optional values you choose, or agree with your dietitian. These are comparison targets, not personalised recommendations or upper safety limits."
        wide
      >
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (s.demo) {
              toast('Personal targets are saved in your own account.');
              return;
            }
            setBusy(true);
            try {
              await api('profile', {
                name: s.user.name,
                preferences: { ...s.user.preferences, nutritionTargets: targets },
              });
              await s.boot();
              setMode('');
              toast.success('Your targets were saved');
            } catch (e) {
              toast.error(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="formgrid nutrient-inputs">
            {Object.entries(nutrients).map(([k, n]) => (
              <label key={k}>
                {n.name} ({n.unit}/day)
                <input
                  type="number"
                  min="0"
                  max="10000000"
                  step="any"
                  value={targets[k] ?? ''}
                  onChange={(e) => {
                    const next = { ...targets };
                    if (e.target.value === '') delete next[k];
                    else next[k] = Number(e.target.value);
                    setTargets(next);
                  }}
                />
              </label>
            ))}
          </div>
          <p className="fine">
            Leave a field blank to skip it. Your targets stay in your account; your meal entries are
            shared with the household. Incomplete nutrient totals are never presented as a complete
            intake.
          </p>
          <button className="btn primary" disabled={busy}>
            Save my targets
          </button>
        </form>
      </Modal>
    </div>
  );
}
let stepKeySeq = 0;
const newStepKey = () => ++stepKeySeq;
function RecipeEditor({
  s,
  value: r,
  setValue,
  onSave,
}: {
  s: State;
  value: Recipe;
  setValue: (r: Recipe) => void;
  onSave: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  // Steps are stored as plain strings; stable per-row keys keep focus/IME state on the right
  // textarea when a middle step is removed.
  // The editor is keyed by recipe in the parent, so keys only need initialising once.
  const [stepKeys, setStepKeys] = useState<number[]>(() => r.steps.map(() => newStepKey()));
  const [picker, setPicker] = useState(false),
    [q, setQ] = useState(''),
    [source, setSource] = useState('foods'),
    [results, setResults] = useState<Product[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [manual, setManual] = useState<ManualIngredient>({ name: '', nutrition: {}, basis: '100g' });
  // Private products and the product snapshots on items and favourites. (Observation and
  // feedback records only hold a product id.)
  const saved = Array.from(
    new Map(
      s.records.flatMap((r) => {
        const p = isProductRecord(r) ? r.data : productSnapshot(r.data);
        return p ? [[p.id, p] as const] : [];
      }),
    ).values(),
  );
  function addProduct(p: Product) {
    setValue({
      ...r,
      ingredients: [
        ...r.ingredients,
        {
          id: uid(),
          name: p.name,
          amount: 100,
          unit: p.basis === '100ml' ? 'ml' : 'g',
          product: p,
        },
      ],
    });
    setPicker(false);
    setResults([]);
    setQ('');
  }
  async function search() {
    setBusy(true);
    setError('');
    try {
      if (s.demo) {
        const foods = sampleRecipes.flatMap((r) =>
          r.ingredients.map((i) => i.product),
        ) as Product[];
        setResults(
          Array.from(
            new Map(
              (source === 'foods' ? foods : source === 'saved' ? saved : demoProducts)
                .filter((p) => (p.name + ' ' + p.brand).toLowerCase().includes(q.toLowerCase()))
                .map((p) => [p.id, p]),
            ).values(),
          ),
        );
        setError(
          'Demo search uses a small example set. Your household can search 1,215 FSVO generic foods and the live packaged-food catalogue.',
        );
      } else if (source === 'saved')
        setResults(saved.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())));
      else {
        const params = new URLSearchParams({
          q,
          ...(source === 'catalogue' ? { household: s.household.id } : {}),
        });
        const response = await fetch(
          '/api/' + (source === 'foods' ? 'foods' : 'catalogue') + '?' + params,
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setResults(data.products);
        setError(data.notice || '');
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <label>
          Recipe name
          <input
            required
            maxLength={160}
            value={r.name}
            onChange={(e) => setValue({ ...r, name: e.target.value })}
          />
        </label>
        <label>
          A little about it
          <textarea
            maxLength={800}
            value={r.description || ''}
            onChange={(e) => setValue({ ...r, description: e.target.value })}
          />
        </label>
        <PhotoUpload
          household={s.household.id}
          demo={s.demo}
          onBusy={setUploading}
          value={r.image}
          onChange={(image) =>
            setValue({ ...r, image, photoCredit: undefined, sourceUrl: undefined })
          }
        />
        <div className="grid2">
          <label>
            Makes this many servings
            <input
              required
              type="number"
              min="0.1"
              max="100"
              step="any"
              value={r.servings}
              onChange={(e) => setValue({ ...r, servings: Number(e.target.value) })}
            />
          </label>
          <label>
            Preparation time (minutes)
            <input
              type="number"
              min="0"
              max="10000"
              value={r.minutes ?? ''}
              onChange={(e) =>
                setValue({ ...r, minutes: e.target.value ? Number(e.target.value) : undefined })
              }
            />
          </label>
        </div>
        <div className="row between">
          <h3>Ingredients</h3>
          <button
            type="button"
            className="btn"
            disabled={r.ingredients.length >= 40}
            onClick={() => setPicker(true)}
          >
            <Plus size={17} /> Add ingredient
          </button>
        </div>
        {!r.ingredients.length && (
          <p className="notice">
            Add ingredients from a food record or manually. Missing nutrition remains unknown.
          </p>
        )}
        {r.ingredients.map((i, index) => (
          <div className="ingredient-editor card stack" key={i.id}>
            <div className="row between">
              <strong>{i.name}</strong>
              <button
                type="button"
                className="iconbtn"
                aria-label={'Remove ' + i.name}
                onClick={() =>
                  setValue({ ...r, ingredients: r.ingredients.filter((x) => x.id !== i.id) })
                }
              >
                <Trash2 size={17} />
              </button>
            </div>
            <p className="fine">
              {i.product?.source || 'Manual ingredient'} ·{' '}
              {i.product?.basis ? 'per ' + i.product.basis : 'nutrition basis unknown'}
            </p>
            <div className="grid2">
              <label>
                Amount
                <input
                  required
                  type="number"
                  min="0.1"
                  max="10000"
                  step="any"
                  value={i.amount}
                  onChange={(e) =>
                    setValue({
                      ...r,
                      ingredients: r.ingredients.map((x, n) =>
                        n === index ? { ...x, amount: Number(e.target.value) } : x,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Unit
                <Choice
                  label={'Unit for ' + i.name}
                  value={i.unit}
                  onChange={(v) =>
                    setValue({
                      ...r,
                      ingredients: r.ingredients.map((x, n) =>
                        n === index ? { ...x, unit: v as 'g' | 'ml' } : x,
                      ),
                    })
                  }
                  options={{ g: 'g · edible portion', ml: 'ml' }}
                />
              </label>
            </div>
            {i.product?.basis !== '100' + i.unit && (
              <p className="notice">
                This amount cannot be compared with the recorded nutrition basis. Nutrition is
                unknown until the units match; we do not assume a density.
              </p>
            )}
            <label>
              Ingredient note
              <input
                maxLength={500}
                placeholder="e.g. cooked and drained"
                value={i.note || ''}
                onChange={(e) =>
                  setValue({
                    ...r,
                    ingredients: r.ingredients.map((x, n) =>
                      n === index ? { ...x, note: e.target.value } : x,
                    ),
                  })
                }
              />
            </label>
          </div>
        ))}
        <h3>Method</h3>
        {r.steps.map((step, index) => (
          <label key={stepKeys[index] ?? 'step-' + index}>
            Step {index + 1}
            <div className="row">
              <textarea
                required
                maxLength={2000}
                value={step}
                onChange={(e) =>
                  setValue({
                    ...r,
                    steps: r.steps.map((s, n) => (n === index ? e.target.value : s)),
                  })
                }
              />
              {r.steps.length > 1 && (
                <button
                  type="button"
                  className="iconbtn"
                  aria-label={'Remove step ' + (index + 1)}
                  onClick={() => {
                    setStepKeys(stepKeys.filter((_, n) => n !== index));
                    setValue({ ...r, steps: r.steps.filter((_, n) => n !== index) });
                  }}
                >
                  <Trash2 size={17} />
                </button>
              )}
            </div>
          </label>
        ))}
        <button
          className="btn"
          type="button"
          disabled={r.steps.length >= 30}
          onClick={() => {
            setStepKeys([...stepKeys, newStepKey()]);
            setValue({ ...r, steps: [...r.steps, ''] });
          }}
        >
          Add a step
        </button>
        <NutritionPanel summary={recipeNutrition(r)} title="Nutrition preview per serving" />
        <button className="btn primary" disabled={!r.ingredients.length || uploading}>
          Save household recipe
        </button>
      </form>
      <Modal
        open={picker}
        onClose={() => setPicker(false)}
        title="Choose the ingredient you use."
        description="Match the food’s preparation state. A generic nutrient record is an average, not an exact branded product."
        wide
      >
        <div className="stack">
          <Choice
            label="Ingredient data source"
            value={source}
            onChange={(v) => {
              setSource(v);
              setResults([]);
              setError('');
            }}
            options={{
              foods: 'Generic foods · Swiss FSVO v7.1',
              catalogue: 'Packaged foods · Open Food Facts',
              saved: 'Our products & favourites',
              manual: 'Enter manually',
            }}
          />
          {source === 'manual' ? (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                addProduct({
                  id: 'manual:' + uid(),
                  name: manual.name,
                  ingredients: manual.ingredients || undefined,
                  categories: [],
                  countries: [],
                  nutrition: manual.nutrition,
                  basis: manual.basis,
                  source: 'User-entered recipe ingredient',
                  retrieved: Date.now(),
                });
                setManual({ name: '', nutrition: {}, basis: '100g' });
              }}
            >
              <label>
                Ingredient name
                <input
                  required
                  maxLength={160}
                  value={manual.name}
                  onChange={(e) => setManual({ ...manual, name: e.target.value })}
                />
              </label>
              <label>
                Label ingredients, if known
                <textarea
                  maxLength={6000}
                  value={manual.ingredients || ''}
                  onChange={(e) => setManual({ ...manual, ingredients: e.target.value })}
                />
              </label>
              <Choice
                label="Nutrition basis"
                value={manual.basis}
                onChange={(v) => setManual({ ...manual, basis: v === '100ml' ? '100ml' : '100g' })}
                options={{ '100g': 'Per 100 g', '100ml': 'Per 100 ml' }}
              />
              <NutritionFields
                value={manual.nutrition}
                onChange={(nutrition) => setManual({ ...manual, nutrition })}
              />
              <button className="btn primary">Use this ingredient</button>
            </form>
          ) : (
            <>
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void search();
                }}
              >
                <input
                  required
                  minLength={2}
                  maxLength={100}
                  aria-label="Search ingredients"
                  placeholder="e.g. chickpea, cooked"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                <button className="btn primary" disabled={busy}>
                  {busy ? 'Searching…' : <Search size={18} />}
                  <span className="sr-only">Search ingredients</span>
                </button>
              </form>
              <p className="fine">
                Search is submitted explicitly and cached. Generic foods include macros and
                available micronutrients; many packaged records have macros only.
              </p>
              {error && (
                <p className="notice" role="status">
                  {error}
                </p>
              )}
              {results.map((p) => (
                <button className="ingredient-result" key={p.id} onClick={() => addProduct(p)}>
                  <Photo product={p} />
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {p.pack || 'Generic edible portion'} ·{' '}
                      {p.basis ? 'per ' + p.basis : 'Basis unknown'}
                    </small>
                    <small>
                      {Object.keys(p.nutrition || {}).length} recorded nutrients · {p.source}
                    </small>
                  </span>
                  <Plus size={20} />
                </button>
              ))}
              {!results.length && !busy && (
                <p className="fine">
                  Search above, or enter an ingredient manually if it is missing.
                </p>
              )}
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
