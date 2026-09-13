import test from 'node:test';
import assert from 'node:assert/strict';
import {GET as catalogue} from '../app/api/catalogue/route';
import {GET as nearby} from '../app/api/places/route';
import {off,normalise,searchUrl} from '../lib/catalogue';
import {point,places} from '../lib/places';
import {drain,conflictDraft,currentRefresh,correctedQueue} from '../lib/outbox';
import {ScanSession,cameraError} from '../lib/scan-session';
import {asUser,run,one} from './server-shim';
const fixture={code:'0036000291452',product_name:'Test cereal',brands:['Fixture','Foods'],quantity:'500 g',countries_tags:['en:france'],categories_tags:['en:cereals'],stores:['Coop'],last_modified_t:1000,last_indexed_datetime:'2024-02-01',image_front_url:'https://images.openfoodfacts.org/example.jpg'};
const originalFetch=globalThis.fetch;let requests=0;
await test('search uses supported endpoint, escapes text and enforces country evidence',async()=>{
 const u=new URL(searchUrl('oats OR countries_tags:us','FR'));assert.equal(u.hostname,'search.openfoodfacts.org');assert.equal(u.pathname,'/search');assert(!u.searchParams.get('q')!.includes(' OR '));assert(!u.searchParams.get('q')!.includes('countries_tags:us'));assert(!u.searchParams.get('q')!.includes('"oats"'));assert(u.searchParams.get('q')!.endsWith('countries_tags:"en:france"'));
 globalThis.fetch=async()=>{requests++;return Response.json({hits:[fixture,{...fixture,code:'other',countries_tags:['en:united-states']}],timed_out:false})};
 const results=await off.search('cereal','FR');assert.equal(results.length,1);assert.equal(results[0].brand,'Fixture, Foods');assert.deepEqual(results[0].stores,['Coop']);assert(new URL(searchUrl('', 'CH',undefined,'coop')).searchParams.get('q')?.includes('stores:"coop"'));assert(!new URL(searchUrl('', 'CH',undefined,'coop')).searchParams.get('q')?.includes('stores_tags:'));assert.equal(results[0].barcode,'0036000291452');assert.equal(results[0].sourceUpdated,1000000);assert.equal(results[0].indexedAt,'2024-02-01');
 await off.search('cereal','FR');assert.equal(requests,1,'second identical search is cached');
});
await test('missing nutrition basis and ingredients remain unknown',()=>{const p=normalise({...fixture,nutriments:{fat_100g:2}});assert.equal(p.basis,undefined);assert.equal(p.ingredients,undefined)});
await test('search outage serves retrieved records, preserves dates and pauses upstream retries',async()=>{
 globalThis.fetch=async()=>{requests++;return new Response('busy',{status:503})};
 const r=await asUser('SearchUser',()=>catalogue(new Request('https://same.test/api/catalogue?q=Test&country=FR')));const d=await r.json();assert.equal(r.status,200);assert.equal(d.products[0].barcode,'0036000291452');assert.match(d.notice,/unavailable/);const n=requests;
 const again=await asUser('SearchUser',()=>catalogue(new Request('https://same.test/api/catalogue?q=Test&country=FR')));assert.equal(again.status,200);assert.equal(requests,n);
});
await test('catalogue and places deny anonymous users',async()=>{assert.equal((await asUser('',()=>catalogue(new Request('https://same.test/api/catalogue?q=milk')))).status,401);assert.equal((await asUser('',()=>nearby(new Request('https://same.test/api/places?q=Lyon')))).status,401)});
const store={properties:{osm_id:12,osm_type:'N',name:'Fixture supermarket',osm_key:'shop',osm_value:'supermarket',city:'Lyon',country:'France'},geometry:{coordinates:[4.835,45.764]}};
await test('store normalization filters unrelated places, invalid coordinates and duplicates',()=>{const rows=places({features:[store,store,{...store,properties:{...store.properties,osm_id:13,osm_value:'restaurant'}},{...store,geometry:{coordinates:[181,91]}}]},point(45.764,4.835));assert.equal(rows.length,1);assert.equal(rows[0].distance,0);assert.equal(rows[0].sourceUrl,'https://www.openstreetmap.org/node/12');assert(!('inventory' in rows[0]));assert.throws(()=>point('',0));assert.throws(()=>point('oops',0));assert.equal(point(45.76489,4.83456).lat,45.765)});
await test('nearby API validates, returns actual source schema and caches repeated requests',async()=>{
 assert.equal((await asUser('StoreUser',()=>nearby(new Request('https://same.test/api/places?lat=999&lon=0')))).status,400);
 globalThis.fetch=async(url:any)=>{requests++;assert.equal(new URL(url).hostname,'photon.komoot.io');assert(new URL(url).searchParams.getAll('osm_tag').includes('shop:supermarket'));return Response.json({features:[store]})};
 const n=requests;const r=await asUser('StoreUser',()=>nearby(new Request('https://same.test/api/places?lat=45.764&lon=4.835')));const d=await r.json();assert.equal(d.places[0].name,'Fixture supermarket');assert.equal(d.inventory,'Not connected');assert.equal(d.source,'OpenStreetMap via Photon');
 await asUser('StoreUser',()=>nearby(new Request('https://same.test/api/places?lat=45.764&lon=4.835')));assert.equal(requests,n+1);
});
await test('place service failure is an error, never a fabricated empty result',async()=>{globalThis.fetch=async()=>new Response('unavailable',{status:503});assert.equal((await asUser('StoreUser',()=>nearby(new Request('https://same.test/api/places?q=UnknownTown')))).status,503)});
globalThis.fetch=originalFetch;
const operation=(id:string,version=0)=>({id,record:'item',kind:'item',data:{name:'Milk'},version});
await test('offline edits survive serialized reload and replay once after a lost acknowledgement',async()=>{
 let online=false;const pending=[operation('stable-id')];const stored=JSON.stringify(pending);const reloaded=JSON.parse(stored);const receipts=new Map();let purchases=0,ack=0,attempt=0;
 const send=async(op:any)=>{attempt++;if(!receipts.has(op.id)){receipts.set(op.id,{version:1});purchases++}if(attempt===1)throw new Error('Connection dropped after server commit');return receipts.get(op.id)};
 await drain(reloaded,send,()=>ack++,()=>online);assert.equal(attempt,0);online=true;
 await assert.rejects(drain(reloaded,send,()=>ack++,()=>online));assert.equal(reloaded[0].id,'stable-id');
 await drain(reloaded,send,()=>ack++,()=>online);assert.equal(purchases,1);assert.equal(ack,1);assert.equal(reloaded.length,0);
});
await test('concurrent conflict stops replay and retains latest local draft',async()=>{const q=[operation('a'),{...operation('b',1),data:{name:'Milk',notes:'latest offline note'}}];let calls=0;await assert.rejects(drain(q,async()=>{calls++;throw Object.assign(new Error('conflict'),{status:409})},()=>{},()=>true));assert.equal(calls,1);assert.equal(q.length,2);assert.equal(conflictDraft(q,q[0]).data.notes,'latest offline note')});
await test('queue preserves dependent operation order and pauses if connection disappears',async()=>{const q=[operation('a'),operation('b',1)];let online=true;const seen:string[]=[];await drain(q,async op=>{seen.push(op.id);return{}},()=>{online=false},()=>online);assert.deepEqual(seen,['a']);assert.equal(q[0].id,'b')});
await test('barcode result before camera startup resolves stops stream and suppresses duplicates',async()=>{const session=new ScanSession();let stopped=0;const codes:string[]=[];await session.run(async accept=>{accept('036000291452');accept('036000291452');return{stop:()=>stopped++}},v=>codes.push(v),()=>assert.fail());assert.deepEqual(codes,['0036000291452']);assert.equal(stopped,1)});
await test('closing scanner during permission prompt stops eventual stream and ignores late codes',async()=>{const session=new ScanSession();let release:any,stopped=0,seen=0,callback:any;const pending=session.run(cb=>{callback=cb;return new Promise(r=>release=r)},()=>seen++,()=>{});session.stop();callback('036000291452');release({stop:()=>stopped++});await pending;assert.equal(stopped,1);assert.equal(seen,0)});
await test('camera permission denial offers manual fallback and a subsequent retry works',async()=>{const session=new ScanSession();await assert.rejects(session.run(async()=>{throw Object.assign(new Error(),{name:'NotAllowedError'})},()=>{},()=>{}));assert.match(cameraError({name:'NotAllowedError'}),/Manual entry/);let accepted='';await session.run(async cb=>{cb('96385074');return{stop(){}}},v=>accepted=v,()=>{});assert.equal(accepted,'96385074')});

await test('refresh begun before a local change cannot overwrite the acknowledged edit',()=>{
 assert(currentRefresh({household:'h',revision:1},'h',1,0));
 assert(!currentRefresh({household:'h',revision:1},'h',2,0));
 assert(!currentRefresh({household:'h',revision:1},'other',1,0));
 assert(!currentRefresh({household:'h',revision:1},'h',1,1));
});
await test('correcting a rejected edit preserves other records and first expected version',()=>{
 const q=[operation('a',3),{...operation('other'),record:'other'},operation('b',4)];
 const result=correctedQueue(q,'item',{name:'Corrected'});assert.equal(result.length,2);assert.equal(result[0].version,3);assert.notEqual(result[0].id,'a');assert.equal(result[0].data.name,'Corrected');assert.equal(result[1].record,'other');
});
await test('imported catalogue persists, paginates and separates titles from page facts',async()=>{
 const {GET:retailerGet}=await import('../app/api/retailer-catalogue/route');
 const request=(qs:string,user='CatalogueTester')=>asUser(user,()=>retailerGet(new Request('https://same.test/api/retailer-catalogue?'+qs)));
 assert.equal((await request('retailer=migros-ch','')).status,401);
 const first=await (await request('retailer=migros-ch')).json();assert.equal(first.products.length,24);assert(first.total>24);assert.equal(first.coverage.complete,false);
 const second=await (await request('retailer=migros-ch&page=2')).json();assert(!second.products.some((p:any)=>first.products.some((x:any)=>x.id===p.id)));
 assert.equal((await request('retailer=migros-ch&page=-1')).status,400);
 const coop=await (await request('retailer=coop-ch')).json();assert(coop.products.filter((p:any)=>p.evidence==='indexed-link').every((p:any)=>!p.nutrition&&!p.barcode&&!p.image));const bread=coop.products.find((p:any)=>p.id==='coop:6589691');assert.equal(bread.evidence,'retailer-page');assert.equal(bread.pack,'500 g');assert.equal(bread.nutrition.proteins,6.8);assert(!bread.image&&!bread.barcode,'No unverified image or GTIN is invented');
 const record=await one('SELECT data FROM catalogue WHERE id=?',first.products[0].id);assert(record);
 const none=await (await request('retailer=migros-ch&q=%25')).json();assert.equal(none.products.length,0,'SQL wildcard in user input is treated literally');
});
