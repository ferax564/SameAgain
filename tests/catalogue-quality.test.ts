import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {hasStore} from '../lib/retailers.ts';
import {classifyRetailerProduct,declaredNutritionCount,enrichIndexedProduct,inferPackFromName} from '../lib/catalogue-quality.ts';
import {catalogueCode,ingredientPreview,searchMatches} from '../lib/catalogue-search.ts';
import type {Product} from '../lib/domain.ts';

test('indexed Coop titles expose pack size without inventing a barcode',()=>{
 assert.equal(inferPackFromName('Parmigiano DOP Reggiano Keil ca. ca. 250g'),'250 g');
 assert.equal(inferPackFromName('Frischback Stäckebrot 2x250g (500g)'),'500 g');
 assert.equal(inferPackFromName('El Tony Mate & Ginger 6x 33cl'),'330 ml');
 const p=enrichIndexedProduct({id:'coop:7371200',name:'Parmigiano DOP Reggiano Keil ca. ca. 250g',categories:[],countries:['en:switzerland'],source:'Coop · indexed page title',retrieved:1,evidence:'indexed-link'} as Product);
 assert.equal(p.pack,'250 g');assert.equal(p.barcode,undefined);assert.match(p.nutritionNote||'',/indexed page title/);
 assert.equal(enrichIndexedProduct({...p,evidence:'retailer-page',pack:undefined} as Product).pack,undefined);
});

test('household goods stay labelled separately from groceries',()=>{
 assert.equal(classifyRetailerProduct({name:'Potz · Ablaufentstopfer'}),'household');
 assert.equal(classifyRetailerProduct({name:'Prix Garantie Roggenbrot'}),'grocery');
 assert.equal(declaredNutritionCount({}),0);
 assert.equal(declaredNutritionCount({fat:2.5,proteins:6.8}),2);
});

test('retailer tags match prefixed and plain store values',()=>{
 assert(hasStore(['Coop'],'coop'));
 assert(hasStore([' Coop'],'coop'));
 assert(hasStore(['en:migros'],'migros'));
 assert(!hasStore(['en:migros'],'coop'));
 assert(!hasStore(['Coop Pronto'],'coop'));
});

test('Coop and Migros coverage reports stay honest and match the shipped snapshots',async()=>{
 const swiss=JSON.parse(await readFile('public/catalogue/swiss-retailer-products.json','utf8')) as Product[];
 const imported=JSON.parse(await readFile('lib/retailer-products.json','utf8')) as Product[];
 const report=JSON.parse(await readFile('lib/swiss-retailer-report.json','utf8'));
 const retailerReport=JSON.parse(await readFile('lib/retailer-import-report.json','utf8'));
 const swissCoop=swiss.filter(p=>hasStore(p.stores,'coop'));
 const swissMigros=swiss.filter(p=>hasStore(p.stores,'migros'));
 const reportedCoop=swiss.filter(p=>(p.stores||[]).some(s=>s.toLowerCase()==='coop'));
 const reportedMigros=swiss.filter(p=>(p.stores||[]).some(s=>s.toLowerCase()==='migros'));
 assert.equal(swiss.length,report.records);
 assert.equal(reportedCoop.length,report.coverageByRetailer.coop.records);
 assert.equal(reportedMigros.length,report.coverageByRetailer.migros.records);
 assert.equal(reportedCoop.filter(p=>p.image).length,report.coverageByRetailer.coop.withPhoto);
 assert.equal(reportedMigros.filter(p=>p.image).length,report.coverageByRetailer.migros.withPhoto);
 assert.ok(swissCoop.length>=reportedCoop.length);
 assert.ok(swissMigros.length>=reportedMigros.length);
 assert.equal(imported.filter(p=>p.retailer==='coop-ch').length,retailerReport.retailers['coop-ch'].records);
 assert.equal(imported.filter(p=>p.retailer==='migros-ch').length,retailerReport.retailers['migros-ch'].records);
 assert.equal(imported.filter(p=>p.retailer==='coop-ch'&&p.evidence==='retailer-page').length,retailerReport.retailers['coop-ch'].pageDetails);
 assert.equal(imported.filter(p=>p.retailer==='migros-ch'&&p.evidence==='retailer-page').length,retailerReport.retailers['migros-ch'].pageDetails);
 assert.ok(swiss.filter(p=>p.ingredients).length>=8000,'Bulk CSV enrichment adds ingredient lists to the Swiss index');
 assert.ok(swiss.filter(p=>p.additives?.length).length>=4000);
 assert.equal(report.analysisCoverage.withIngredients,swiss.filter(p=>p.ingredients).length);
 const oats=swiss.find(p=>p.barcode==='7610200011435');
 assert.ok(oats?.ingredients);assert.equal(oats?.nutriscoreGrade,'a');
 assert.equal(new Set(swiss.map(p=>p.id)).size,swiss.length);
 assert.equal(swiss.filter(p=>p.barcode||p.sourceIdentifier).length,swiss.length,'Every community record keeps a barcode or pack code');
 if(report.coverageByRetailer.coop.withBarcode!=null){
  assert.equal(report.coverageByRetailer.coop.withBarcode,swiss.filter(p=>hasStore(p.stores,'coop')&&(p.barcode||p.sourceIdentifier)).length);
 }
 assert.ok(swiss.filter(p=>p.image).length>=16000);
 assert.equal(report.completeRetailerCatalogue,false);
 assert.equal(retailerReport.complete,false);
 const scopeSrc=await readFile('lib/catalogue-scope.ts','utf8');
 assert.match(scopeSrc,/communityRecords:community\.records/);
 assert.match(scopeSrc,/communityBarcodes/);
 assert.match(scopeSrc,/communityIngredients/);
 assert.match(scopeSrc,/official assortment/);
 assert.match(scopeSrc,/10,000-hit/);
});

test('ingredient lists and pack codes are searchable on catalogue cards',()=>{
 const p={id:'off:7610200011435',name:'Haferflocken',brand:'M-Budget',barcode:'7610200011435',pack:'500 g',categories:['en:oats'],countries:['en:switzerland'],ingredients:'flocons d avoine complets',source:'Open Food Facts',retrieved:1} as Product;
 assert.equal(catalogueCode(p),'7610200011435');
 assert.equal(catalogueCode({sourceIdentifier:'277610807057287000000100'}),'277610807057287000000100');
 assert.equal(ingredientPreview(p.ingredients,12),'flocons d a…');
 assert(searchMatches(p,'avoine'));
 assert(searchMatches(p,'7610200011435'));
});
