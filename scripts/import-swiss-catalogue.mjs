// Bounded, resumable read-only OFF import. Eight seconds between requests (<8/min).
// OFF ODbL / DbCL; images CC BY-SA. Never infers branch stock or retailer ownership.
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {build} from 'esbuild';
import {resolve} from 'node:path';
await build({entryPoints:['lib/catalogue.ts'],outfile:'.sites-runtime/import-provider.mjs',bundle:true,platform:'node',format:'esm',alias:{'@/app/chatgpt-auth':resolve('tests/auth-shim.ts'),'next/headers':resolve('tests/headers-shim.ts'),'cloudflare:workers':resolve('tests/cloudflare-shim.ts')}});
const {normalise,fields}=await import('../.sites-runtime/import-provider.mjs');
mkdirSync('.firecrawl/off-swiss',{recursive:true});
const products=new Map(),reports=[];let last=0;
for(const retailer of ['coop','migros']){
 let pages=1,reported=0,exact=false,success=0;
 for(let page=1;page<=Math.min(pages,10);page++){
  const file=`.firecrawl/off-swiss/${retailer}-${page}.json`;let data;
  if(existsSync(file))data=JSON.parse(readFileSync(file,'utf8'));else{
   await new Promise(r=>setTimeout(r,Math.max(0,8000-(Date.now()-last))));last=Date.now();
   const url='https://search.openfoodfacts.org/search?'+new URLSearchParams({q:`countries_tags:"en:switzerland" stores:"${retailer}"`,page_size:'1000',page:String(page),fields,langs:'en,fr,de,it'});
   try{const r=await fetch(url,{headers:{'User-Agent':'SameAgain/1.1 (https://same-again.frx.chatgpt.site)'},signal:AbortSignal.timeout(25000)});if(!r.ok)throw new Error('HTTP '+r.status);data=await r.json();if(!Array.isArray(data.hits)||data.timed_out)throw new Error('Incomplete response');data.retrieved=Date.now();writeFileSync(file,JSON.stringify(data));}catch(e){console.error(retailer,page,e.message);break;}
  }
  pages=data.page_count;reported=data.count;exact=data.is_count_exact;success++;
  for(const raw of data.hits){const p=normalise(raw,data.retrieved);if(!p.name||p.name==='Unnamed product'||!p.barcode||!p.countries.includes('en:switzerland')||!p.stores?.some(s=>s.toLowerCase()===retailer))continue;products.set(p.id,p);}
  console.log(JSON.stringify({retailer,page,pages,unique:products.size}));
 }
 reports.push({retailer,reported,exact,pagesFetched:success,pagesReported:pages});
}
const list=[...products.values()].sort((a,b)=>a.id.localeCompare(b.id));
mkdirSync('public/catalogue',{recursive:true});
writeFileSync('public/catalogue/swiss-retailer-products.json',JSON.stringify(list));
writeFileSync('lib/swiss-retailer-report.json',JSON.stringify({retrieved:new Date().toISOString(),source:'Open Food Facts',completeRetailerCatalogue:false,records:list.length,retailers:reports,licence:'ODbL 1.0; contents DbCL 1.0; images CC BY-SA 3.0',notice:'Community records with retailer and Switzerland tags. Up to 10,000 search hits per retailer; no exhaustive assortment or branch stock claim.'},null,2)+'\n');
