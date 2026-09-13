import {savedCatalogueCandidates} from '@/lib/catalogue-cache-search';
import {rankSearch,searchTerms,pageCatalogue,ALL_CATALOGUE_MATCHES} from '@/lib/catalogue-search';
import {lookupBarcode} from '@/lib/barcode-lookup';
import {swissSearch,persistSwiss,swissCoverage} from '@/lib/swiss-catalogue';
import {identity,member,one,query,fail,responseError,rate} from '@/lib/server';
import {off} from '@/lib/catalogue';
import {ensureRetailerCatalogue} from '@/lib/retailer-catalogue';
import {retailers} from '@/lib/retailers';
import {countries,rank} from '@/lib/domain';
import imported from '@/lib/retailer-products.json';
import {enrichIndexedProduct} from '@/lib/catalogue-quality';
import {retailerScope} from '@/lib/catalogue-scope';
import type {Product} from '@/lib/domain';
export async function GET(req:Request){try{const u=await identity();await rate('catalogue:'+u.id,30);const p=new URL(req.url).searchParams,c=p.get('country')||undefined,q=(p.get('q')||'').slice(0,120);if(c&&!countries[c])fail('Choose a supported country.');if(p.get('barcode'))return Response.json(await lookupBarcode(p.get('barcode')!,u.id,p.get('household')||undefined,p.get('details')==='1',req.url));if(p.get('original')){const h=p.get('household')||'';await member(h,u.id);const item=await one("SELECT * FROM records WHERE id=? AND household=? AND kind='item' AND deleted=0",p.get('original'),h);if(!item)fail('Item not found',404);const d=JSON.parse(item.data),original=d.product;if(!original?.categories?.length||!c)return Response.json({matches:[],reason:'The original needs a catalogue category and destination country.'});if(d.substitution==='exact')return Response.json({matches:[],reason:'This item is marked exact product only.'});const hh=await one('SELECT settings FROM households WHERE id=?',h);const settings=JSON.parse(hh.settings);let constraints=settings.constraints||[];const target=d.intendedFor||u.id;if(target){await member(h,target);const profile=await one('SELECT preferences FROM users WHERE id=?',target);constraints=[...constraints,...(JSON.parse(profile.preferences).constraints||[])]}let products;let cachedNotice='';try{products=await off.search('',c,original.categories.at(-1))}catch{products=(await query('SELECT data FROM catalogue')).map(r=>JSON.parse(r.data));cachedNotice=' Live search is unavailable; candidates are limited to previously retrieved catalogue records.'}return Response.json({matches:rank(original,products,c,constraints,p.get('priority')||'ingredients',d.substitution),appliedTo:target,reason:'Candidates must have destination-country evidence, a shared category and enough comparable data. Required attributes with missing evidence are excluded.'+cachedNotice})}
const terms=searchTerms(q);
if((q.length<2||!terms.length)&&!p.get('retailer'))fail('Enter at least two letters or numbers.');
const retailer=p.get('retailer')||undefined;
const page=Number(p.get('page')||1);
if(retailer&&!retailers[retailer])fail('Choose a supported retailer.');
if(retailer&&c!==retailers[retailer].country)fail('Retailer country must match.');
if(!Number.isInteger(page)||page<1||page>1000)fail('Choose a valid catalogue page.');
const h=p.get('household');if(h)await member(h,u.id);
await ensureRetailerCatalogue();
const category=p.get('category')||undefined,tag=retailer?retailers[retailer].tag:undefined;
const indexed=await swissSearch(q,c,category,tag,req.url).catch(()=>[]);
const extra=(retailer==='coop-ch'||retailer==='migros-ch')?(imported as Product[]).filter(r=>r.retailer===retailer).map(enrichIndexedProduct):[];
let live:any[]=[],notice='';
const browsing=!terms.length&&!!retailer;
// A local match must never suppress the rest of a country or the global catalogue.
if(!browsing)try{live=await off.search(q,c,category,tag)}catch{notice='Live search is unavailable. Results are limited to saved catalogue records and private household products. Retry to search more widely.'}
const stored=await savedCatalogueCandidates(q);
let privateProducts:any[]=[];
if(h&&!c&&!p.get('label')&&!retailer&&p.get('source')!=='community')privateProducts=(await query("SELECT data FROM records WHERE household=? AND kind='product' AND deleted=0",h)).map(r=>JSON.parse(r.data));
const ranked=rankSearch([...indexed,...stored,...live,...privateProducts,...extra],q,{country:c,category,retailer,label:p.get('label')||undefined,community:p.get('source')==='community',limit:ALL_CATALOGUE_MATCHES});
const paged=pageCatalogue(ranked,page);
await persistSwiss(paged.products.filter(row=>row.source==='Open Food Facts'));
if(!notice)notice=paged.total
 ?`Showing ${Math.min(page*paged.pageSize,paged.total)} of ${paged.total.toLocaleString()} matches from the indexed catalogue${browsing?'':' and live search'}. Load more to continue through the full snapshot. Open a product to check its full details. Different pack sizes remain separate.`
 :'No matching catalogue records.';
const swissRetailer=retailer==='coop-ch'||retailer==='migros-ch'?retailerScope(retailer):undefined;
return Response.json({products:paged.products,total:paged.total,page:paged.page,hasMore:paged.hasMore,notice,coverage:swissCoverage,scope:swissRetailer});
}catch(e){return responseError(e)}}
