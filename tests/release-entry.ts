import test from 'node:test';
import assert from 'node:assert/strict';
import {GET as catalogue} from '../app/api/catalogue/route';
import {GET as demoCatalogue} from '../app/api/demo-catalogue/route';
import {normalise} from '../lib/catalogue';
import {rankSearch} from '../lib/catalogue-search';
import {validateRecord} from '../lib/record-validation';
import {canMerge,repeatItem,substituteItem} from '../lib/domain';
import {asUser,run} from './server-shim';
const base=normalise({code:'9999999999999',product_name:'Crème de noisettes',categories_tags:['en:hazelnut-spreads'],countries_tags:['en:france']});
await test('destination substitutions never retain a different product household photo',()=>{
 const original={name:base.name,product:base,image:'/api/photo/original.jpg',pack:'500 g',notes:'For breakfast'};
 const other={...base,id:'alternative',name:'Local oats',image:'https://images.openfoodfacts.org/alternative.jpg',pack:'750 g'};
 const chosen=substituteItem(original,other);
 assert.equal(chosen.image,undefined);assert.equal(chosen.product.image,other.image);assert.equal(chosen.pack,'750 g');assert.equal(chosen.notes,original.notes);
 assert.equal(substituteItem(original,base).image,original.image);
 assert.equal(substituteItem(original,null).image,undefined);
 assert.equal(substituteItem({name:'Tomatoes',image:original.image},null).image,original.image);
 assert.equal(original.product.id,base.id);assert.equal(original.image,'/api/photo/original.jpg');
});
await test('cached API search backfills accent and category text during a provider outage',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('',{status:503});
 try{
  await run('INSERT INTO catalogue(id,data,retrieved) VALUES(?,?,?)','cache-accent-fixture',JSON.stringify({...base,id:'cache-accent-fixture'}),Date.now());
  for(const q of ['creme noisettes','hazelnut']){
   const r=await asUser('ReleaseSearch',()=>catalogue(new Request('https://same.test/api/catalogue?'+new URLSearchParams({q,country:'FR'}))));
   assert.equal(r.status,200);assert((await r.json()).products.some((p:any)=>p.id==='cache-accent-fixture'));
  }
 }finally{globalThis.fetch=original}
});
await test('public demo catalogue reads only shipped products and applies retailer/country filters',async()=>{
 for(const retailer of ['coop-ch','migros-ch']){
  const r=await demoCatalogue(new Request('https://same.test/api/demo-catalogue?'+new URLSearchParams({q:'haferflocken',country:'CH',retailer,household:'unrelated'})));
  assert.equal(r.status,200);const d=await r.json();assert(d.products.length>0);
  assert(d.products.every((p:any)=>p.countries.includes('en:switzerland')&&p.stores.some((s:string)=>s.toLowerCase()===retailer.split('-')[0])));
  assert(!d.products.some((p:any)=>p.id==='cache-accent-fixture'),'Database records are never exposed by demo endpoint');
 }
 assert.equal((await demoCatalogue(new Request('https://same.test/api/demo-catalogue?country=FR&retailer=coop-ch'))).status,400);
 const browse=await demoCatalogue(new Request('https://same.test/api/demo-catalogue?country=CH&retailer=coop-ch'));
 assert.equal(browse.status,200);const browsed=await browse.json();assert(browsed.products.length>0);assert(browsed.products.every((p:any)=>p.stores.some((s:string)=>s.toLowerCase().includes('coop'))));assert.equal(browsed.scope.communityRecords,3534);
 assert.match(browsed.scope.notice,/not the full Coop assortment/);
 const migrosBrowse=await demoCatalogue(new Request('https://same.test/api/demo-catalogue?country=CH&retailer=migros-ch'));
 const migros=await migrosBrowse.json();assert.equal(migros.scope.communityRecords,9759);assert.match(migros.scope.notice,/10,000-hit/);
});
await test('public demo barcode keeps leading zeros and separates invalid identifiers',async()=>{
 const r=await demoCatalogue(new Request('https://same.test/api/demo-catalogue?barcode=02425801'));const p=(await r.json()).product;assert.equal(p.barcode,'02425801');assert(p.image);
 assert.equal((await demoCatalogue(new Request('https://same.test/api/demo-catalogue?barcode=02425802'))).status,400);
 const invalid={...base,barcode:'999999999999999999999999'};const hit=rankSearch([invalid],'creme')[0] as any;assert.equal(hit.barcode,undefined);assert.equal(hit.sourceIdentifier,invalid.barcode);
});
await test('item photos are household-authorised and survive repeating without merging different images',()=>{
 const d={name:'Our bread',quantity:2,unit:'pack',product:{...base,barcode:undefined},pack:'500 g',notes:'Sliced',substitution:'similar',image:'/api/photo?family=bad'};
 assert.throws(()=>validateRecord('item',d,'family'));
 const noPhoto={...d,image:undefined};assert.equal(validateRecord('item',noPhoto,'family').name,'Our bread');
 const photo={...noPhoto,image:'/api/photo?household=family&key=family%2Ftest.jpg'};
 assert.equal(validateRecord('item',photo,'family').image,photo.image);assert.equal(repeatItem(photo).image,photo.image);assert(!canMerge(photo,{...photo,image:'https://images.openfoodfacts.org/another.jpg'}));
});
await test('legacy nutrition excludes negative values and missing photos render an accessible fallback',async()=>{
 const p=normalise({code:'1',product_name:'Unknown',nutriments:{fat_100g:-1,proteins_100g:2},nutrition_data_per:'100g'});assert.equal(p.nutrition?.fat,undefined);assert.equal(p.nutrition?.proteins,2);
 const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server'),{Photo}=await import('../app/ui');
 assert.match(renderToStaticMarkup(React.createElement(Photo,{product:{name:'Unknown'},large:true})),/Photo unavailable for Unknown/);
});

await test('receipt photo fingerprint is identical with native crypto and portable fallback',async()=>{
 const {receiptFingerprint}=await import('../lib/receipt-fingerprint');const bytes=new TextEncoder().encode('abc').buffer;
 const expected='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
 assert.equal(await receiptFingerprint(bytes),expected);assert.equal(await receiptFingerprint(bytes,null),expected);
 assert.equal(await receiptFingerprint(new ArrayBuffer(0),null),'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});
