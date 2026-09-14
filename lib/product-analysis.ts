import type {Product} from './domain';
import {additiveEvidenceReviewed,matchAdditives,type AdditiveConcern,type AdditiveEvidence} from './additive-evidence.ts';

export const analysisWeights={nutrition:60,additives:30,organic:10} as const;
export const nutriScorePoints:Record<string,number>={a:60,b:42,c:24,d:10,e:0};
export const scoreBands=[
 {min:75,id:'excellent',label:'Stronger profile',tone:'good'},
 {min:50,id:'fair',label:'Mixed profile',tone:'ok'},
 {min:25,id:'poor',label:'Weaker profile',tone:'watch'},
 {min:0,id:'low',label:'Low-scoring profile',tone:'bad'},
] as const;

export type IngredientChip={text:string;additive?:AdditiveEvidence;unknownCode?:string};
export type ProductAnalysis={
 score?:number;
 band?:typeof scoreBands[number];
 complete:boolean;
 nutritionPoints?:number;
 additivePoints?:number;
 organicPoints:number;
 nutriScore?:string;
 nutriScoreSource?:'open-food-facts'|'estimated-macros';
 novaGroup?:number;
 organic:boolean;
 chips:IngredientChip[];
 additives:AdditiveEvidence[];
 unknownAdditives:string[];
 missingIngredients:boolean;
 missingNutrition:boolean;
 notice:string;
};

const ORGANIC=/organic|bio-suisse|naturaplan|demeter|ab-agriculture|knospe|eu-organic|migros-bio/;

export function nutriScoreGrade(p:Product){
 const recorded=(p.nutriscoreGrade||'').toLowerCase();
 if(recorded&&'abcde'.includes(recorded)&&recorded.length===1)return recorded;
 const fromLabel=(p.labels||[]).map(l=>l.toLowerCase()).find(l=>/nutriscore-grade-[abcde]/.test(l));
 return fromLabel?.slice(-1);
}

export function novaGroup(p:Product){
 const n=p.novaGroup;
 if(n===1||n===2||n===3||n===4)return n;
}

export function isOrganic(p:Product){
 return (p.labels||[]).some(l=>ORGANIC.test(l.toLowerCase().replace(/^[a-z]{2}:/,'')));
}

export function parseIngredients(text=''){
 const parts:string[]=[];let depth=0,cur='';
 for(const ch of text){
  if(ch==='('||ch==='[')depth++;
  else if((ch===')'||ch===']')&&depth)depth--;
  if(ch===','&&depth===0){if(cur.trim())parts.push(cur.trim().replace(/\.+$/,''));cur='';continue;}
  cur+=ch;
 }
 if(cur.trim())parts.push(cur.trim().replace(/\.+$/,''));
 return parts;
}

function clamp(n:number,min:number,max:number){return Math.min(max,Math.max(min,n))}

export function estimateNutritionPoints(p:Product){
 const n=p.nutrition||{};
 const keys=['energy-kcal','saturated-fat','sugars','salt','fiber','proteins'] as const;
 if(keys.filter(k=>typeof n[k]==='number').length<4)return;
 let points=36;
 const energy=n['energy-kcal']??0,sat=n['saturated-fat']??0,sugars=n.sugars??0,salt=n.salt??0,fiber=n.fiber??0,protein=n.proteins??0;
 points-=clamp(Math.floor(energy/80),0,10);
 points-=clamp(Math.floor(sat/2),0,10);
 points-=clamp(Math.floor(sugars/4.5),0,10);
 points-=clamp(Math.floor(salt/0.3),0,10);
 points+=clamp(Math.floor(fiber/0.9),0,5);
 points+=clamp(Math.floor(protein/1.6),0,5);
 return clamp(Math.round(points),0,60);
}

function additivePenalty(concern:AdditiveConcern){return concern==='high'?15:concern==='moderate'?8:1}

export function analyzeProduct(p:Product):ProductAnalysis{
 const grade=nutriScoreGrade(p);
 const nutritionPoints=grade?nutriScorePoints[grade]:estimateNutritionPoints(p);
 const missingNutrition=nutritionPoints==null;
 const text=[p.ingredients,...p.ingredientTags||[],...p.additives||[]].filter(Boolean).join(' ');
 const matched=matchAdditives(text,p.additives||[]);
 const missingIngredients=!p.ingredients&&!(p.additives||[]).length;
 const additivePoints=missingIngredients?undefined:clamp(30-matched.known.reduce((s,a)=>s+additivePenalty(a.concern),0)-matched.unknown.length*3,0,30);
 const organic=isOrganic(p);
 const organicPoints=organic?10:0;
 const complete=nutritionPoints!=null&&additivePoints!=null;
 const score=complete?clamp(Math.round(nutritionPoints+additivePoints+organicPoints),0,100):undefined;
 const band=score==null?undefined:scoreBands.find(b=>score>=b.min);
 const chips:IngredientChip[]=(p.ingredients?parseIngredients(p.ingredients):[]).map(part=>{
  const hit=matchAdditives(part,[]);
  const unknown=part.match(/\be\s*[-:]?\s*(\d{3,4}[a-z]?)\b/i);
  return {text:part,additive:hit.known[0],unknownCode:hit.known[0]?undefined:unknown?'e'+unknown[1].toLowerCase():undefined};
 });
 const notice=complete
  ?'Breakdown uses Open Food Facts Nutri-Score when recorded (60), declared additives (30) and organic labels (10). It is not Yuka’s proprietary score, not a medical rating and not a serving-size exposure estimate.'
  :'Not enough recorded ingredients or nutrition to finish a 0–100 profile. Check the pack; community catalogues omit many declarations.';
 return {
  score,band,complete,nutritionPoints,additivePoints,organicPoints,
  nutriScore:grade,nutriScoreSource:grade?'open-food-facts':nutritionPoints!=null?'estimated-macros':undefined,
  novaGroup:novaGroup(p),organic,chips,additives:matched.known,unknownAdditives:matched.unknown,
  missingIngredients:!p.ingredients,missingNutrition,notice,
 };
}

export {additiveEvidenceReviewed};
