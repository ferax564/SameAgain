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
   ?'Browse every Open Food Facts Swiss Coop record in this snapshot, plus indexed page titles. Load more to move through the full index. This is still not Coop’s official assortment or branch stock.'
   :'Browse every harvested Open Food Facts Swiss Migros record in this snapshot, plus indexed page titles. Migros was collected by barcode prefix so it is not limited to one 10,000-hit search. This is still not live inventory.',
 };
}
