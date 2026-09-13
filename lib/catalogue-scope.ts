import swissReport from './swiss-retailer-report.json';
import retailerReport from './retailer-import-report.json';

export function retailerScope(id:'coop-ch'|'migros-ch'){
 const tag=id==='coop-ch'?'coop':'migros';
 const community=(swissReport as any).coverageByRetailer[tag];
 const imported=(retailerReport as any).retailers[id];
 return {
  id,tag,complete:false as const,
  communityRecords:community.records,
  communityPhotos:community.withPhoto,
  retailerLinks:imported.records,
  retailerPageDetails:imported.pageDetails,
  retailerNutrition:imported.nutrition,
  notice:id==='coop-ch'
   ?'Coop coverage is a partial Open Food Facts snapshot plus a small set of page titles. One official bread page has verified facts. This is not the full Coop assortment or branch stock.'
   :'Migros coverage is a partial Open Food Facts snapshot, capped by the public 10,000-hit search window, plus indexed page titles. Most direct pages have names only. This is not live inventory.',
 };
}
