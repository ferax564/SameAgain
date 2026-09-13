import {swissSearch,swissBarcode,swissCoverage} from '@/lib/swiss-catalogue';
import {rankSearch,pageCatalogue,ALL_CATALOGUE_MATCHES} from '@/lib/catalogue-search';
import {barcode,countries} from '@/lib/domain';
import {retailers} from '@/lib/retailers';
import imported from '@/lib/retailer-products.json';
import {enrichIndexedProduct} from '@/lib/catalogue-quality';
import {retailerScope} from '@/lib/catalogue-scope';
import type {Product} from '@/lib/domain';

// Only the shipped, publicly licensed catalogue and public retailer links.
// Never reads accounts, household records, photos, database caches or secrets.
export async function GET(req:Request){
 const p=new URL(req.url).searchParams;
 const q=(p.get('q')||'').slice(0,120),country=p.get('country')||undefined,retailer=p.get('retailer')||undefined;
 const page=Number(p.get('page')||1);
 if((country&&!countries[country])||(retailer&&(!retailers[retailer]||retailers[retailer].country!==country)))return Response.json({error:'Choose a matching retailer and country.'},{status:400});
 if(!Number.isInteger(page)||page<1||page>1000)return Response.json({error:'Choose a valid catalogue page.'},{status:400});
 const headers={'Cache-Control':'public, max-age=300'};
 try{
  if(p.get('barcode')){const b=barcode(p.get('barcode')!);if(!b.valid)return Response.json({error:b.error},{status:400});return Response.json({product:await swissBarcode(b.code,req.url)||null,notice:'Saved catalogue record. Check the package; the demo does not refresh live product details.'},{headers})}
  const fromRetailer=p.get('source')==='retailer';
  const retailerRows=(imported as Product[]).filter(r=>!retailer||r.retailer===retailer).map(enrichIndexedProduct);
  const swiss=fromRetailer?[]:await swissSearch(q,country,undefined,retailer?retailers[retailer].tag:undefined,req.url);
  const ranked=rankSearch(fromRetailer?retailerRows:[...swiss,...retailerRows],q,{country,retailer,label:p.get('label')||undefined,limit:ALL_CATALOGUE_MATCHES});
  const paged=pageCatalogue(ranked,page);
  const swissRetailer=retailer==='coop-ch'||retailer==='migros-ch'?retailerScope(retailer):undefined;
  const coverage=fromRetailer?{imported:imported.filter(r=>r.retailer===retailer).length,pageDetails:imported.filter(r=>r.retailer===retailer&&r.evidence==='retailer-page').length,complete:false}:swissCoverage;
  const notice=fromRetailer
   ?`Public retailer sources, partial import. Showing ${Math.min(page*paged.pageSize,paged.total)} of ${paged.total.toLocaleString()} indexed links. Your demo shopping activity stays on this device.`
   :`Showing ${Math.min(page*paged.pageSize,paged.total)} of ${paged.total.toLocaleString()} indexed ${retailer?retailers[retailer].name+' ':''}records. Load more to browse the full snapshot. Demo changes stay on this device. Live refresh is available in your household.`;
  return Response.json({products:paged.products,total:paged.total,page:paged.page,hasMore:paged.hasMore,coverage,scope:swissRetailer,notice},{headers});
 }catch{return Response.json({error:'The saved catalogue is unavailable. Try again shortly.'},{status:503})}
}
