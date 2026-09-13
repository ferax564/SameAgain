import {savedCatalogueCandidates} from '@/lib/catalogue-cache-search';
import {rankSearch,searchTerms} from '@/lib/catalogue-search';
import {lookupBarcode} from '@/lib/barcode-lookup';
import {swissSearch,persistSwiss,swissCoverage} from '@/lib/swiss-catalogue';
import {identity,member,one,query,fail,responseError,rate} from '@/lib/server';
import {off} from '@/lib/catalogue';
import {ensureRetailerCatalogue} from '@/lib/retailer-catalogue';
import {retailers,recordedAt} from '@/lib/retailers';
import {countries,countryTag,rank,barcode} from '@/lib/domain';
export async function GET(req:Request){try{const u=await identity();await rate('catalogue:'+u.id,30);const p=new URL(req.url).searchParams,c=p.get('country')||undefined,q=(p.get('q')||'').slice(0,120);if(c&&!countries[c])fail('Choose a supported country.');if(p.get('barcode'))return Response.json(await lookupBarcode(p.get('barcode')!,u.id,p.get('household')||undefined,p.get('details')==='1',req.url));if(p.get('original')){const h=p.get('household')||'';await member(h,u.id);const item=await one("SELECT * FROM records WHERE id=? AND household=? AND kind='item' AND deleted=0",p.get('original'),h);if(!item)fail('Item not found',404);const d=JSON.parse(item.data),original=d.product;if(!original?.categories?.length||!c)return Response.json({matches:[],reason:'The original needs a catalogue category and destination country.'});if(d.substitution==='exact')return Response.json({matches:[],reason:'This item is marked exact product only.'});const hh=await one('SELECT settings FROM households WHERE id=?',h);const settings=JSON.parse(hh.settings);let constraints=settings.constraints||[];const target=d.intendedFor||u.id;if(target){await member(h,target);const profile=await one('SELECT preferences FROM users WHERE id=?',target);constraints=[...constraints,...(JSON.parse(profile.preferences).constraints||[])]}let products;let cachedNotice='';try{products=await off.search('',c,original.categories.at(-1))}catch{products=(await query('SELECT data FROM catalogue')).map(r=>JSON.parse(r.data));cachedNotice=' Live search is unavailable; candidates are limited to previously retrieved catalogue records.'}return Response.json({matches:rank(original,products,c,constraints,p.get('priority')||'ingredients',d.substitution),appliedTo:target,reason:'Candidates must have destination-country evidence, a shared category and enough comparable data. Required attributes with missing evidence are excluded.'+cachedNotice})}
if((q.length<2||!searchTerms(q).length)&&!p.get('retailer'))fail('Enter at least two letters or numbers.');
const retailer=p.get('retailer')||undefined;
if(retailer&&!retailers[retailer])fail('Choose a supported retailer.');
if(retailer&&c!==retailers[retailer].country)fail('Retailer country must match.');
const h=p.get('household');if(h)await member(h,u.id);
await ensureRetailerCatalogue();
const category=p.get('category')||undefined,tag=retailer?retailers[retailer].tag:undefined;
const indexed=await swissSearch(q,c,category,tag,req.url).catch(()=>[]);
await persistSwiss(indexed);
let live:any[]=[],notice='';
// A local match must never suppress the rest of a country or the global catalogue.
try{live=await off.search(q,c,category,tag)}catch{notice='Live search is unavailable. Results are limited to saved catalogue records and private household products. Retry to search more widely.'}
const stored=await savedCatalogueCandidates(q);
let privateProducts:any[]=[];
if(h&&!c&&!p.get('label')&&!retailer&&p.get('source')!=='community')privateProducts=(await query("SELECT data FROM records WHERE household=? AND kind='product' AND deleted=0",h)).map(r=>JSON.parse(r.data));
const products=rankSearch([...indexed,...stored,...live,...privateProducts],q,{country:c,category,retailer,label:p.get('label')||undefined,community:p.get('source')==='community'});
if(!notice)notice='Showing up to 48 relevant matches from live search and saved records. Open a product to check its full details. Different pack sizes remain separate.';
return Response.json({products,notice,coverage:swissCoverage});
}catch(e){return responseError(e)}}
