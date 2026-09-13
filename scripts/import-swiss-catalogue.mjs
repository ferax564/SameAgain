// Bounded, resumable read-only OFF import. Eight seconds between requests (<8/min).
// Coop uses the exact Switzerland+store query. Migros is split by barcode prefix so the
// public 10,000-hit search window cannot hide the rest of the tagged snapshot.
// OFF ODbL / DbCL; images CC BY-SA. Never infers branch stock or retailer ownership.
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {build} from 'esbuild';
import {resolve} from 'node:path';
await build({entryPoints:['lib/catalogue.ts'],outfile:'.sites-runtime/import-provider.mjs',bundle:true,platform:'node',format:'esm',alias:{'@/app/chatgpt-auth':resolve('tests/auth-shim.ts'),'next/headers':resolve('tests/headers-shim.ts'),'cloudflare:workers':resolve('tests/cloudflare-shim.ts')}});
const {normalise,fields}=await import('../.sites-runtime/import-provider.mjs');
function hasStore(stores=[],tag=''){const expected=tag.toLowerCase();return stores.some(s=>String(s).toLowerCase().replace(/^[a-z]{2}:/,'').replace(/[._]/g,' ').trim()===expected)}
function keep(p,tag){return p.name&&p.name!=='Unnamed product'&&p.barcode&&p.countries.includes('en:switzerland')&&hasStore(p.stores,tag)}
mkdirSync('.firecrawl/off-swiss',{recursive:true});
const products=new Map();
if(existsSync('public/catalogue/swiss-retailer-products.json')){
 for(const p of JSON.parse(readFileSync('public/catalogue/swiss-retailer-products.json','utf8')))products.set(p.id,p);
}
let last=0;
async function harvest(key,query,tag){
 let pages=1,reported=0,exact=false,success=0;
 for(let page=1;page<=Math.min(pages,20);page++){
  const file=`.firecrawl/off-swiss/${key}-${page}.json`;let data;
  if(existsSync(file))data=JSON.parse(readFileSync(file,'utf8'));else{
   await new Promise(r=>setTimeout(r,Math.max(0,8000-(Date.now()-last))));last=Date.now();
   const url='https://search.openfoodfacts.org/search?'+new URLSearchParams({q:query,page_size:'1000',page:String(page),fields,langs:'en,fr,de,it'});
   try{const r=await fetch(url,{headers:{'User-Agent':'SameAgain/1.1 (https://same-again.frx.chatgpt.site)'},signal:AbortSignal.timeout(25000)});if(!r.ok)throw new Error('HTTP '+r.status);data=await r.json();if(!Array.isArray(data.hits)||data.timed_out)throw new Error('Incomplete response');data.retrieved=Date.now();writeFileSync(file,JSON.stringify(data));}catch(e){console.error(key,page,e.message);break;}
  }
  pages=Math.max(1,Number(data.page_count)||1);reported=data.count;exact=!!data.is_count_exact;success++;
 if(keep(p,tag)){
   const old=products.get(p.id);
   if(!old)products.set(p.id,p);
   else products.set(p.id,{...p,ingredients:old.ingredients||p.ingredients,ingredientTags:old.ingredientTags||p.ingredientTags,image:old.image||p.image,pack:old.pack||p.pack,basis:old.basis||p.basis,allergens:old.allergens??p.allergens,nutrition:Object.keys(old.nutrition||{}).length>=Object.keys(p.nutrition||{}).length?old.nutrition:p.nutrition,stores:[...new Map([...(p.stores||[]),...(old.stores||[])].map(s=>[String(s).toLowerCase(),s])).values()]});
  }
  console.log(JSON.stringify({key,page,pages,reported,exact,unique:products.size}));
 }
 return {key,tag,reported,exact,pagesFetched:success,pagesReported:pages};
}
const reports=[];
reports.push(await harvest('coop','countries_tags:"en:switzerland" stores:"coop"','coop'));
for(const digit of '0123456789')reports.push(await harvest('migros-code-'+digit,`countries_tags:"en:switzerland" stores:"migros" code:${digit}*`,'migros'));
const list=[...products.values()].sort((a,b)=>a.id.localeCompare(b.id));
const coverage=tag=>({records:list.filter(p=>(p.stores||[]).some(s=>String(s).toLowerCase()===tag)).length,withPhoto:list.filter(p=>(p.stores||[]).some(s=>String(s).toLowerCase()===tag)&&p.image).length});
mkdirSync('public/catalogue',{recursive:true});
writeFileSync('public/catalogue/swiss-retailer-products.json',JSON.stringify(list));
writeFileSync('lib/swiss-retailer-report.json',JSON.stringify({
 retrieved:new Date().toISOString(),
 source:'Open Food Facts',
 completeRetailerCatalogue:false,
 harvestMethod:'coop-store-query-and-migros-barcode-prefixes',
 records:list.length,
 retailers:reports,
 coverageByRetailer:{coop:coverage('coop'),migros:coverage('migros')},
 licence:'ODbL 1.0; contents DbCL 1.0; images CC BY-SA 3.0',
 notice:'Community records with retailer and Switzerland tags. Migros was harvested by barcode prefix so it is not limited to one 10,000-hit search. This is still not an official assortment or branch stock.',
},null,2)+'\n');
console.log(JSON.stringify({records:list.length,coop:coverage('coop'),migros:coverage('migros')}));
