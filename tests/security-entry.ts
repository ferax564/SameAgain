import test from 'node:test';
import assert from 'node:assert/strict';
import {GET as exportData} from '../app/api/export/route';
import {GET,POST} from '../app/api/data/route';
import {asUser,run,one,hash} from './server-shim';
const call=async(user:string,body?:any,h?:string)=>asUser(user,async()=>{const r=body?await POST(new Request('https://same.test/api/data',{method:'POST',headers:{'content-type':'application/json','origin':'https://same.test'},body:JSON.stringify(body)})):await GET(new Request('https://same.test/api/data'+(h?'?household='+h:'')));return {status:r.status,...await r.json()}});
let household='',list='',item:any,inv:any;
await test('anonymous API access denied',async()=>assert.equal((await call('')).status,401));
await test('account creates household and first persistent list',async()=>{const d=await call('Alex',{action:'createHousehold',name:'Security test family',country:'IT'});assert.equal(d.status,200);household=d.household;const data=await call('Alex',undefined,household);list=data.records[0].id;assert.equal(data.members[0].role,'owner')});
await test('unrelated account cannot read or write by identifier',async()=>{assert.equal((await call('Eve',undefined,household)).status,403);assert.equal((await call('Eve',{action:'invite',household})).status,403)});
await test('revoked invitation rejected',async()=>{const i=await call('Alex',{action:'invite',household});await call('Alex',{action:'revoke',household,id:i.id});assert.equal((await call('Sam',{action:'join',token:i.token})).status,410)});
await test('expired invitation rejected',async()=>{const i=await call('Alex',{action:'invite',household});await run('UPDATE invitations SET expires=0 WHERE id=?',i.id);assert.equal((await call('Sam',{action:'join',token:i.token})).status,410)});
await test('secure invitation joins second account and cannot be reused',async()=>{inv=await call('Alex',{action:'invite',household});assert.equal((await call('Sam',{action:'join',token:inv.token})).status,200);assert.equal((await call('Eve',{action:'join',token:inv.token})).status,410);const d=await call('Sam',undefined,household);assert.equal(d.members.length,2)});
await test('normal member cannot manage membership or settings',async()=>{assert.equal((await call('Sam',{action:'invite',household})).status,403);assert.equal((await call('Sam',{action:'settings',household,name:'Intrusion',settings:{}})).status,403)});
const op=(data:any,old?:any)=>({id:crypto.randomUUID(),record:old?.id||crypto.randomUUID(),kind:'item',version:old?.version||0,data});
await test('two accounts collaborate with server-owned attribution and idempotent retries',async()=>{const o=op({name:'Milk',list,quantity:2,unit:'pack',notes:'plain',addedBy:'spoofed'});const a=await call('Alex',{action:'op',household,op:o});assert.equal(a.status,200);item=a.record;assert.equal(item.data.addedBy,'Alex');const duplicate=await call('Alex',{action:'op',household,op:o});assert.equal(duplicate.record.id,item.id);assert.equal((await call('Sam',undefined,household)).records.filter((x:any)=>x.kind==='item').length,1);const bought=await call('Sam',{action:'op',household,op:op({...item.data,done:true,purchasedBy:'spoofed'},item)});assert.equal(bought.record.data.purchasedBy,'Sam')});
await test('offline stale edit and stale undo conflict instead of overwriting',async()=>{const stale=await call('Alex',{action:'op',household,op:op({...item.data,notes:'offline note'},item)});assert.equal(stale.status,409);assert.equal(stale.conflict.data.purchasedBy,'Sam');assert.equal(stale.conflict.data.notes,'plain');item=stale.conflict});
await test('reviewed conflict can apply against latest version',async()=>{const saved=await call('Alex',{action:'op',household,op:op({...item.data,notes:'reviewed note'},item)});assert.equal(saved.status,200);assert.equal(saved.record.data.purchasedBy,'Sam');item=saved.record});
await test('private barcode identity remains a string with leading zero',async()=>{const data={...item.data,product:{id:'private',name:'Example',barcode:'0036000291452'},notes:'private'};const saved=await call('Alex',{action:'op',household,op:op(data,item)});assert.equal(saved.record.data.product.barcode,'0036000291452');item=saved.record});
await test('destination copy preserves original list and quantities',async()=>{const copy=await call('Alex',{action:'op',household,op:{id:crypto.randomUUID(),record:crypto.randomUUID(),kind:'list',version:0,data:{name:'France copy',originalList:list,country:'FR'}}});const original=await one('SELECT data FROM records WHERE id=?',list);assert.equal(JSON.parse(original.data).name,'Weekly groceries');const saved=await call('Sam',{action:'op',household,op:op({...item.data,list:copy.record.id,originalItem:item.id,done:false,quantity:3})});assert.equal(saved.status,200);assert.equal(JSON.parse((await one('SELECT data FROM records WHERE id=?',item.id)).data).quantity,2)});
await test('foreign-household list references denied',async()=>{const d=await call('Eve',{action:'createHousehold',name:'Other'});const other=await call('Eve',undefined,d.household);assert.equal((await call('Alex',{action:'op',household,op:op({...item.data,list:other.records[0].id})})).status,400)});
await test('sole owner cannot leave; ownership transfer enables departure',async()=>{assert.equal((await call('Alex',{action:'leave',household})).status,400);assert.equal((await call('Alex',{action:'transfer',household,user:'Sam'})).status,200);assert.equal((await call('Alex',{action:'leave',household})).status,200);assert.equal((await call('Alex',undefined,household)).status,403);assert.equal((await call('Sam',undefined,household)).members[0].role,'owner')});
await test('cross-origin mutation rejected',async()=>{const r=await asUser('Sam',()=>POST(new Request('https://same.test/api/data',{method:'POST',headers:{origin:'https://evil.test'},body:JSON.stringify({action:'invite',household})})));assert.equal(r.status,403)});

await test('private product can be edited; malformed records and nested foreign photos rejected',async()=>{
 const make=(kind:string,data:any,old?:any)=>({action:'op',household,op:{...op(data,old),kind}});
 const p=await call('Sam',make('product',{id:'draft',name:'Family cereal',barcode:'0036000291452',pack:'500 g'}));assert.equal(p.status,200);
 const edited=await call('Sam',make('product',{...p.record.data,ingredients:'Oats, salt'},p.record));assert.equal(edited.record.data.ingredients,'Oats, salt');assert.equal(edited.record.data.id,p.record.id);
 assert.equal((await call('Sam',make('product',{id:'x',name:'Bad',barcode:36000291452}))).status,400);
 assert.equal((await call('Sam',make('favourite',{name:'Invalid',quantity:-1,unit:'pack'}))).status,400);
 assert.equal((await call('Sam',make('trip',{name:'Invalid photo',items:[{name:'Milk',quantity:1,unit:'pack',product:{id:'x',name:'Milk',image:'/api/photo?household=foreign&key=foreign%2Fphoto'}}]}))).status,400);
});
await test('archived list rejects new items and can be restored',async()=>{
 const before=(await call('Sam',undefined,household)).records.find((r:any)=>r.id===list);
 const archive=await call('Sam',{action:'op',household,op:{...op({...before.data,archived:true},before),kind:'list'}});assert.equal(archive.status,200);
 assert.equal((await call('Sam',{action:'op',household,op:op({name:'Milk',quantity:1,unit:'pack',list})})).status,400);
 assert.equal((await call('Sam',{action:'op',household,op:{...op({...archive.record.data,archived:false},archive.record),kind:'list'}})).status,200);
});
await test('account export is scoped and deleting an account preserves shared text exactly',async()=>{
 const invite=await call('Sam',{action:'invite',household});await call('u',{action:'join',token:invite.token});
 const saved=await call('u',{action:'op',household,op:op({name:'Unsweetened',notes:'usual product',list,quantity:1,unit:'pack',assigned:'u'})});assert.equal(saved.status,200);
 const r=await asUser('u',()=>exportData());const d=await r.json();assert.equal(d.households.length,1);assert(d.records.every((r:any)=>r.household===household));
 assert.equal((await call('u',{action:'deleteAccount'})).status,200);
 const retained=JSON.parse((await one('SELECT data FROM records WHERE id=?',saved.record.id)).data);assert.equal(retained.name,'Unsweetened');assert.equal(retained.notes,'usual product');assert.equal(retained.addedBy,'Deleted member');assert.equal(retained.assigned,'');assert.equal((await one('SELECT id FROM users WHERE id=?','u'))??null,null);
 assert.equal((await call('Sam',{action:'deleteAccount'})).status,400);
});
await test('finishing a trip atomically saves server snapshots, clears purchases, and retries once',async()=>{
 const purchase=await call('Sam',{action:'op',household,op:op({name:'Trip cereal',list,quantity:2,unit:'pack',done:true})});
 const request={action:'op',household,op:{...op({name:'Final trip',list,items:[{...purchase.record.data,originalItem:purchase.record.id,originalVersion:purchase.record.version}]}),kind:'trip'}};
 const saved=await call('Sam',request);assert.equal(saved.status,200);assert.equal(saved.record.data.items[0].name,'Trip cereal');assert.equal((await one('SELECT deleted FROM records WHERE id=?',purchase.record.id)).deleted,1);
 assert.equal((await call('Sam',request)).record.id,saved.record.id);
 const changed=await call('Sam',{action:'op',household,op:op({name:'Changing purchase',list,quantity:1,unit:'pack',done:true})});
 await call('Sam',{action:'op',household,op:op({...changed.record.data,done:false},changed.record)});
 const stale=await call('Sam',{action:'op',household,op:{...op({name:'Stale trip',list,items:[{...changed.record.data,originalItem:changed.record.id,originalVersion:changed.record.version}]}),kind:'trip'}});assert.equal(stale.status,400);assert.equal((await one('SELECT deleted FROM records WHERE id=?',changed.record.id)).deleted,0);
});
await test('email-bound family invitation rejects another account without consuming the token',async()=>{
 const invitation=await call('Sam',{action:'invite',household,email:' FamilyMember@EXAMPLE.TEST '});assert.equal(invitation.status,200);
 assert.equal((await call('WrongPerson',{action:'join',token:invitation.token})).status,403);
 assert.equal((await call('FamilyMember',{action:'join',token:invitation.token})).status,200);
 assert.equal((await call('ThirdPerson',{action:'join',token:invitation.token})).status,410);
});
await test('individual shops persist across members and foreign household shop references are denied',async()=>{
 const data={name:'Migros Test branch',address:'Example Street 1, Test town',country:'CH',retailer:'migros-ch',evidence:'household-entered'};
 const shop=await call('FamilyMember',{action:'op',household,op:{...op(data),kind:'shop'}});assert.equal(shop.status,200);
 const before=(await call('Sam',undefined,household)).records.find((r:any)=>r.id===list);
 const chosen=await call('Sam',{action:'op',household,op:{...op({...before.data,shopId:shop.record.id,retailer:'migros-ch'},before),kind:'list'}});assert.equal(chosen.status,200);assert.equal(chosen.record.data.store,data.name+', '+data.address);
 const shared=(await call('FamilyMember',undefined,household)).records.find((r:any)=>r.id===list);assert.equal(shared.data.shopId,shop.record.id);
 const outsider=await call('StoreOutsider',{action:'createHousehold',name:'Other shop family'});const otherList=(await call('StoreOutsider',undefined,outsider.household)).records[0];
 assert.equal((await call('StoreOutsider',{action:'op',household:outsider.household,op:{...op({...otherList.data,shopId:shop.record.id,retailer:'migros-ch'},otherList),kind:'list'}})).status,400);
 assert.equal((await call('Sam',{action:'op',household,op:{...op({...data,country:'US'}),kind:'shop'}})).status,400);
});
