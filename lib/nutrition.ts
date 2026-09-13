import type {Product} from './domain';
import {pack} from './domain';
export const nutrients:Record<string,{name:string;unit:string;group:'macro'|'micro'}>={
 'energy-kcal':{name:'Energy',unit:'kcal',group:'macro'},proteins:{name:'Protein',unit:'g',group:'macro'},carbohydrates:{name:'Carbohydrate',unit:'g',group:'macro'},fat:{name:'Fat',unit:'g',group:'macro'},'saturated-fat':{name:'Saturated fat',unit:'g',group:'macro'},sugars:{name:'Total sugars',unit:'g',group:'macro'},fiber:{name:'Fibre',unit:'g',group:'macro'},salt:{name:'Salt',unit:'g',group:'macro'},
 calcium:{name:'Calcium',unit:'mg',group:'micro'},iron:{name:'Iron',unit:'mg',group:'micro'},magnesium:{name:'Magnesium',unit:'mg',group:'micro'},potassium:{name:'Potassium',unit:'mg',group:'micro'},sodium:{name:'Sodium',unit:'mg',group:'micro'},zinc:{name:'Zinc',unit:'mg',group:'micro'},phosphorus:{name:'Phosphorus',unit:'mg',group:'micro'},iodine:{name:'Iodine',unit:'µg',group:'micro'},selenium:{name:'Selenium',unit:'µg',group:'micro'},'vitamin-a':{name:'Vitamin A (RE)',unit:'µg',group:'micro'},'vitamin-c':{name:'Vitamin C',unit:'mg',group:'micro'},'vitamin-d':{name:'Vitamin D',unit:'µg',group:'micro'},'vitamin-e':{name:'Vitamin E (α-tocopherol)',unit:'mg',group:'micro'},'vitamin-k':{name:'Vitamin K',unit:'µg',group:'micro'},'vitamin-b1':{name:'Thiamin (B1)',unit:'mg',group:'micro'},'vitamin-b2':{name:'Riboflavin (B2)',unit:'mg',group:'micro'},'vitamin-b6':{name:'Vitamin B6',unit:'mg',group:'micro'},'vitamin-b9':{name:'Folate',unit:'µg',group:'micro'},'vitamin-b12':{name:'Vitamin B12',unit:'µg',group:'micro'}
};
export type RecipeIngredient={id:string;name:string;amount:number;unit:'g'|'ml';product?:Product;note?:string};
export type Recipe={name:string;description?:string;image?:string;photoCredit?:string;servings:number;minutes?:number;ingredients:RecipeIngredient[];steps:string[];tags?:string[];sourceUrl?:string};
export type NutrientTotal={value:number;known:number;total:number};
export type NutritionSummary=Record<string,NutrientTotal>;
export function ingredientNutrition(ingredients:RecipeIngredient[],scale=1):NutritionSummary{
 const result: NutritionSummary={};for(const key of Object.keys(nutrients)){let value=0,known=0;for(const i of ingredients){const n=i.product?.nutrition?.[key];if(Number.isFinite(scale)&&scale>=0&&i.product?.basis==='100'+i.unit&&typeof n==='number'&&Number.isFinite(n)&&n>=0){value+=n*i.amount/100*scale;known++}}result[key]={value,known,total:ingredients.length}}return result;
}
export function recipeNutrition(recipe:Recipe,servings=1){return ingredientNutrition(recipe.ingredients,servings/recipe.servings)}
export function sumNutrition(values:NutritionSummary[]):NutritionSummary{const result:NutritionSummary={};for(const key of Object.keys(nutrients))result[key]=values.reduce((acc,s)=>({value:acc.value+(s[key]?.value||0),known:acc.known+(s[key]?.known||0),total:acc.total+(s[key]?.total||0)}),{value:0,known:0,total:0});return result}
export function nutrientText(n:NutrientTotal|undefined,key:string){if(!n?.known)return 'Unknown';return (n.known<n.total?'≥ ':'')+new Intl.NumberFormat('en',{maximumFractionDigits:n.value>0&&n.value<0.1?4:1}).format(n.value)+' '+nutrients[key].unit}
export function recipeShopping(recipe:Recipe,servings:number){return recipe.ingredients.map(i=>{const amount=Math.round(i.amount*servings/recipe.servings*100)/100,p=i.product,parsed=pack(p?.pack);const exact=p&&!p.id.startsWith('swiss:')&&!p.id.startsWith('manual:');return {name:i.name,quantity:exact&&parsed?.basis===i.unit&&parsed.amount>0?Math.ceil(amount/parsed.amount):amount,unit:exact&&parsed?.basis===i.unit&&parsed.amount>0?'pack':i.unit,pack:p?.pack||'',...(exact?{product:p}:{}),notes:[i.note,`For ${recipe.name}: ${amount} ${i.unit} needed`].filter(Boolean).join(' · '),category:'Other',substitution:'ask'}})}
export function localDate(date=new Date()){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-')}
export function weekDates(start:string){const date=new Date(start+'T12:00:00');return Array.from({length:7},(_,i)=>{const d=new Date(date);d.setDate(d.getDate()+i);return localDate(d)})}

// Combine compatible weighed requests before rounding exact products to whole packs.
export function planShopping(entries:{recipe:Recipe;servings:number}[]){
 const groups=new Map<string,{ingredient:RecipeIngredient;amount:number;recipes:Set<string>}>();
 for(const {recipe,servings} of entries)for(const i of recipe.ingredients){
  const key=JSON.stringify([i.product?.id||i.name.toLowerCase(),i.product?.pack||'',i.unit,i.note||'']);
  const group=groups.get(key)||{ingredient:i,amount:0,recipes:new Set<string>()};
  group.amount+=i.amount*servings/recipe.servings;group.recipes.add(recipe.name);groups.set(key,group);
 }
 return [...groups.values()].flatMap(g=>recipeShopping({name:[...g.recipes].join(', '),servings:1,ingredients:[{...g.ingredient,amount:g.amount}],steps:[]},1));
}
