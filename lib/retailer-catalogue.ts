import {productSearchText} from './catalogue-search';
import products from './retailer-products.json';
import report from './retailer-import-report.json';
import {db,one,run,query} from './server';
import type {Product} from './domain';
const revision='retailer-import:'+report.sha256;
export async function ensureRetailerCatalogue(){
 if(await one('SELECT key FROM cache WHERE key=?',revision))return;
 for(let i=0;i<products.length;i+=25)await db().batch(products.slice(i,i+25).map(p=>db().prepare('INSERT INTO catalogue(id,data,retrieved,search_text) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,retrieved=excluded.retrieved,search_text=excluded.search_text WHERE catalogue.retrieved<=excluded.retrieved').bind(p.id,JSON.stringify(p),p.retrieved,productSearchText(p))));
 await run('INSERT INTO cache(key,data,expires) VALUES(?,?,?) ON CONFLICT(key) DO NOTHING',revision,'{}',8640000000000000);
}
export async function retailerCatalogue(retailer:string,q:string,page=1){
 await ensureRetailerCatalogue();
 const term='%'+q.replace(/[\\%_]/g,c=>'\\'+c)+'%';
 const where="json_extract(data,'$.retailer')=? AND (json_extract(data,'$.name') LIKE ? ESCAPE '\\' OR json_extract(data,'$.brand') LIKE ? ESCAPE '\\')";
 const total=await one('SELECT count(*) AS n FROM catalogue WHERE '+where,retailer,term,term);
 const rows=await query('SELECT data FROM catalogue WHERE '+where+" ORDER BY CASE WHEN json_extract(data,'$.evidence')='retailer-page' THEN 0 ELSE 1 END,json_extract(data,'$.name'),id LIMIT 24 OFFSET ?",retailer,term,term,(page-1)*24);
 return {products:rows.map(r=>JSON.parse(r.data) as Product),total:total.n,page,hasMore:page*24<total.n,coverage:{complete:false,imported:products.filter(p=>p.retailer===retailer).length,pageDetails:products.filter(p=>p.retailer===retailer&&p.evidence==='retailer-page').length},notice:'Partial import. Indexed titles are discovery links, not a current retailer assortment. Page details show their retrieval date. Stock and prices are not verified.'};
}
