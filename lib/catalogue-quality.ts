import type {Product} from './domain';

const householdPattern=/(entstopfer|waschmittel|abwaschmittel|geschirrspül|kalkreiniger|wäschesack|papierbeutel|rechaud|wickelunterlage|putzmittel|reiniger|waschbeutel|muttermilchbeutel)/i;

export function inferPackFromName(name=''){
 const paren=name.match(/\((\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|cl)\)/i);
 const raw=paren||name.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|cl)\b/i);
 if(!raw)return;
 const amount=Number(String(raw[1]).replace(',','.'));
 let unit=raw[2].toLowerCase();
 if(unit==='cl'){if(!Number.isFinite(amount)||amount<=0)return;return `${amount*10} ml`}
 if(!Number.isFinite(amount)||amount<=0)return;
 return `${amount} ${unit}`;
}

export function classifyRetailerProduct(p:Pick<Product,'name'> & {categories?:string[]}){
 const text=(p.name||'').toLowerCase();
 if(householdPattern.test(text)||p.categories?.some(c=>/cleaning|household-chemicals|non-food/.test(c)))return 'household';
 if(p.categories?.some(c=>c.startsWith('en:')&&!/non-food|cleaning/.test(c)))return 'grocery';
 return p.name?'grocery':'unknown';
}

export function enrichIndexedProduct(p:Product):Product{
 if(p.pack||p.evidence!=='indexed-link')return p;
 const pack=inferPackFromName(p.name);
 if(!pack)return p;
 return {...p,pack,nutritionNote:[p.nutritionNote,'Pack size read from the indexed page title, not a verified product sheet.'].filter(Boolean).join(' ')};
}

export function declaredNutritionCount(nutrition?:Record<string,number>){return nutrition?Object.keys(nutrition).filter(k=>Number.isFinite(nutrition[k])).length:0}
