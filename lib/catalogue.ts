import {productSearchText} from './catalogue-search';
import {Product,countryTag,barcode} from './domain';
import {hasStore} from './retailers';
import {one,run,rate,fail} from './server';
import {nutrients} from './nutrition';
export const fields='code,product_name,product_name_en,product_name_de,product_name_fr,product_name_it,brands,quantity,image_front_url,ingredients_text,ingredients_text_en,ingredients_text_de,ingredients_text_fr,ingredients_text_it,ingredients_text_es,ingredients,allergens_tags,traces_tags,labels_tags,categories_tags,countries_tags,nutriments,nutrition,nutrition_data_per,product_quantity_unit,serving_size,last_modified_t,last_indexed_datetime,stores,stores_tags,additives_tags';
export interface CatalogueProvider{lookup(code:string):Promise<Product|null>;search(q:string,country?:string,category?:string,store?:string):Promise<Product[]>}
export function normalise(p:any,retrieved=Date.now()):Product{
 const n:Record<string,number>={};
 const declared=p.nutrition_data_per,unit=p.product_quantity_unit;
 let basis:'100g'|'100ml'|undefined=declared==='100ml'?'100ml':declared==='100g'?(unit==='ml'||unit==='l'?'100ml':'100g'):undefined;
 // v3.5+ stores values in an explicitly based aggregate, not legacy nutriments.
 const aggregate=p.nutrition?.aggregated_set;
 if(aggregate&&aggregate.preparation==='as_sold'&&['100g','100ml'].includes(aggregate.per)){
  basis=aggregate.per;
  const grams:Record<string,number>={g:1,mg:0.001,'µg':0.000001,ug:0.000001};
  for(const [key,meta] of Object.entries(nutrients)){const v=aggregate.nutrients?.[key];if(!v||v.source==='estimate'||typeof v.value!=='number'||!Number.isFinite(v.value)||v.value<0||v.modifier)continue;
   if(v.unit===meta.unit)n[key]=v.value;else if(grams[v.unit]&&grams[meta.unit])n[key]=v.value*grams[v.unit]/grams[meta.unit];
  }
 }else for(const k of ['energy-kcal','fat','saturated-fat','carbohydrates','sugars','fiber','proteins','salt'])if(typeof p.nutriments?.[k+'_100g']==='number'&&Number.isFinite(p.nutriments[k+'_100g'])&&p.nutriments[k+'_100g']>=0)n[k]=p.nutriments[k+'_100g'];
 return {id:'off:'+String(p.code),barcode:String(p.code),name:(p.product_name||p.product_name_en||p.product_name_de||p.product_name_fr||p.product_name_it||'Unnamed product').trim(),brand:Array.isArray(p.brands)?p.brands.join(', '):p.brands||'',image:p.image_front_url?.startsWith('https://images.openfoodfacts.org/')?p.image_front_url:undefined,pack:p.quantity||'',stores:Array.isArray(p.stores_tags)&&p.stores_tags.length?p.stores_tags:Array.isArray(p.stores)?p.stores:typeof p.stores==='string'?p.stores.split(',').map((v:string)=>v.trim().toLowerCase()):[],additives:p.additives_tags||[],categories:p.categories_tags||[],countries:p.countries_tags||[],ingredients:p.ingredients_text||p.ingredients_text_en||p.ingredients_text_de||p.ingredients_text_fr||p.ingredients_text_it||p.ingredients_text_es||undefined,ingredientTags:p.ingredients?.map((i:any)=>i.id).filter(Boolean),allergens:p.allergens_tags,traces:p.traces_tags,labels:p.labels_tags,nutrition:n,basis,source:'Open Food Facts',sourceUrl:'https://world.openfoodfacts.org/product/'+p.code,retrieved,sourceUpdated:typeof p.last_modified_t==='number'?p.last_modified_t*1000:undefined,indexedAt:p.last_indexed_datetime||undefined};
}
// Treat input as plain text; only application-owned category/country filters use Lucene syntax.
// The deployed OFF index currently mishandles quoted free text as a literal wildcard field.
export function searchUrl(q:string,country?:string,category?:string,store?:string){
 const literal=(v:string)=>'"'+v.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
 const text=q.replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/).filter(v=>v&&!/^(AND|OR|NOT)$/i.test(v)).join(' ');
 const clauses=text?[text]:[];
 if(category)clauses.push('categories_tags:'+literal(category));
 if(store)clauses.push('stores:'+literal(store));
 if(country)clauses.push('countries_tags:'+literal(countryTag(country)));
 return 'https://search.openfoodfacts.org/search?'+new URLSearchParams({q:clauses.join(' '),page_size:'24',fields,langs:'en,fr,de,it,es,nl'});
}
async function cached(key:string,url:string,type:'product'|'search'){
 const c=await one('SELECT * FROM cache WHERE key=? AND expires>?',key,Date.now());if(c){const data=JSON.parse(c.data);data._sameAgainRetrieved??=c.expires-(type==='product'?86400000:21600000);return data;}
 if(await one('SELECT key FROM cache WHERE key=? AND expires>?','off:cooldown:'+type,Date.now()))fail('The catalogue is recovering. Cached and private products remain available; retry in a minute.',503);
 await rate('off:'+type,type==='product'?12:8);
 try{
  const res=await fetch(url,{headers:{'User-Agent':'SameAgain/1.1 (https://same-again.frx.chatgpt.site)','Accept':'application/json'},signal:AbortSignal.timeout(type==='product'?20000:15000)});
  if(res.status===404&&type==='product')return null;
  if(!res.ok)throw new Error('Catalogue response '+res.status);
  const data:any=await res.json();data._sameAgainRetrieved=Date.now();
  if(type==='search'&&(!Array.isArray(data.hits)||data.timed_out))throw new Error('Incomplete search response');
  await run('INSERT INTO cache(key,data,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires=excluded.expires',key,JSON.stringify(data),Date.now()+(type==='product'?86400000:21600000));return data;
 }catch{
  await run('INSERT INTO cache(key,data,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET expires=excluded.expires','off:cooldown:'+type,'{}',Date.now()+60000);
  fail('The live catalogue is temporarily unavailable. Use a cached product or add a private product.',503);
 }
}
async function persist(p:Product){await run("INSERT INTO catalogue(id,data,retrieved,search_text) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,retrieved=excluded.retrieved,search_text=excluded.search_text WHERE COALESCE(json_extract(excluded.data,'$.detailsRetrieved'),0)>COALESCE(json_extract(catalogue.data,'$.detailsRetrieved'),0) OR (COALESCE(json_extract(catalogue.data,'$.detailsRetrieved'),0)=0 AND excluded.retrieved>=catalogue.retrieved)",p.id,JSON.stringify(p),p.retrieved,productSearchText(p));return JSON.parse((await one('SELECT data FROM catalogue WHERE id=?',p.id)).data) as Product}
export const off:CatalogueProvider={async lookup(raw){const b=barcode(raw);if(!b.valid)fail(b.error);const data=await cached('product-details-v2:'+b.code,'https://world.openfoodfacts.org/api/v3.6/product/'+b.code+'.json?fields='+fields,'product');if(!data?.product)return null;return persist({...normalise(data.product,data._sameAgainRetrieved),detailsRetrieved:data._sameAgainRetrieved})},async search(q,country,category,store){const url=searchUrl(q,country,category,store);const data=await cached('search-v2:'+url,url,'search');const products=data.hits.filter((p:any)=>p.code&&(p.product_name||p.product_name_en)).map((p:any)=>normalise(p,data._sameAgainRetrieved)).filter((p:Product)=>(!country||p.countries.includes(countryTag(country)))&&(!category||p.categories.includes(category))&&(!store||hasStore(p.stores,store)));const saved=[];for(const p of products)saved.push(await persist(p));return saved}};
