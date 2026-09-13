// Live network verification is deliberately separate from deterministic tests.
import assert from 'node:assert/strict';
import {off} from '../lib/catalogue';
import {GET as catalogue} from '../app/api/catalogue/route';
import {asUser,one} from './server-shim';
for(const [retailer,code] of [['Coop','7610097171076'],['Migros','7617027869157'],['UPC-A','049000006346']]){
 const live=await off.lookup(code);assert(live?.barcode&&live.name);assert(live.image,'Expected front image for known product');
 const result=await asUser('LiveBarcodeCheck',()=>catalogue(new Request('https://same.test/api/catalogue?barcode='+code)));assert.equal(result.status,200);const {product}=await result.json();assert.equal(product.id,live.id);const saved=JSON.parse((await one('SELECT data FROM catalogue WHERE id=?',product.id)).data);assert.equal(saved.barcode,live.barcode);
 console.log(JSON.stringify({test:'live barcode → app route → database readback',retailer,entered:code,barcode:saved.barcode,name:saved.name,image:!!saved.image,basis:saved.basis,nutrients:Object.keys(saved.nutrition||{}).length,source:saved.source}));
}
