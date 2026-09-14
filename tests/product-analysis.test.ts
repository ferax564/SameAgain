import test from 'node:test';
import assert from 'node:assert/strict';
import {matchAdditives} from '../lib/additive-evidence.ts';
import {analyzeProduct,parseIngredients} from '../lib/product-analysis.ts';
import type {Product} from '../lib/domain.ts';

const base:Product={id:'p',name:'Test',categories:['en:foods'],countries:['en:switzerland'],source:'fixture',retrieved:1};

test('ingredient lists split on commas and keep nested parentheses',()=>{
 assert.deepEqual(parseIngredients('sugar, palm oil, hazelnuts (13%), emulsifier: lecithins (soya)'),['sugar','palm oil','hazelnuts (13%)','emulsifier: lecithins (soya)']);
});

test('nitrites and Southampton colours are matched from tags and names',()=>{
 const nitrite=matchAdditives('cured pork, sodium nitrite',['en:e250']);
 assert.equal(nitrite.known[0].id,'e250');
 assert.equal(nitrite.known[0].concern,'high');
 const colour=matchAdditives('colour: tartrazine',[]);
 assert.equal(colour.known.some(a=>a.id==='e102'),true);
});

test('Nutella-like spread scores from macros, lecithin and no organic label',()=>{
 const a=analyzeProduct({...base,ingredients:'sugar, palm oil, hazelnuts (13%), skimmed milk powder, cocoa, emulsifier: lecithins (soya), vanillin',additives:['en:e322'],nutriscoreGrade:'e',nutrition:{'energy-kcal':539,fat:30.9,'saturated-fat':10.6,sugars:56.3,fiber:3,proteins:6.3,salt:0.11},basis:'100g'});
 assert.equal(a.complete,true);
 assert.equal(a.nutritionPoints,0);
 assert.ok((a.score||0)<40,'Nutri-Score E keeps a spread out of the stronger bands');
 assert.equal(a.additives[0].id,'e322');
 assert.equal(a.additives[0].concern,'low');
 assert.equal(a.organicPoints,0);
 assert.ok(a.chips.some(c=>c.additive?.id==='e322'));
});

test('organic oat flakes with Nutri-Score A and no additives reach 100',()=>{
 const a=analyzeProduct({...base,ingredients:'whole grain oat flakes',labels:['en:organic','en:nutriscore-grade-a'],novaGroup:1,nutrition:{'energy-kcal':370,'saturated-fat':1.2,sugars:0.8,fiber:10,proteins:13,salt:0.01},basis:'100g'});
 assert.equal(a.nutriScore,'a');
 assert.equal(a.score,100);
 assert.equal(a.nutritionPoints,60);
 assert.equal(a.additivePoints,30);
 assert.equal(a.organicPoints,10);
 assert.equal(a.novaGroup,1);
});

test('cured meat with nitrite is penalised on the additive axis',()=>{
 const a=analyzeProduct({...base,ingredients:'pork, salt, sodium nitrite',additives:['en:e250'],nutriscoreGrade:'d'});
 assert.equal(a.nutritionPoints,10);
 assert.equal(a.additivePoints,15);
 assert.equal(a.score,25);
 assert.equal(a.band?.id,'poor');
});

test('missing ingredients do not invent a clean additive score',()=>{
 const a=analyzeProduct({...base,nutriscoreGrade:'b'});
 assert.equal(a.complete,false);
 assert.equal(a.score,undefined);
 assert.equal(a.additivePoints,undefined);
 assert.match(a.notice,/Not enough recorded/);
});
