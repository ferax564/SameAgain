import {productSearchText,searchTerms} from './catalogue-search';
import products from './retailer-products.json';
import report from './retailer-import-report.json';
import {enrichIndexedProduct} from './catalogue-quality';
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
 const terms=searchTerms(q);
 if(q.trim()&&!terms.length)return {products:[],total:0,page,hasMore:false,coverage:{complete:false,imported:products.filter(p=>p.retailer===retailer).length,pageDetails:products.filter(p=>p.retailer===retailer&&p.evidence==='retailer-page').length},notice:'Partial import. Indexed titles are discovery links, not a current retailer assortment. Pack sizes taken from a title are labelled as such. Stock and prices are not verified.'};
 const where=["json_extract(data,'$.retailer')=?"];
 const params:any[]=[retailer];
 if(terms.length){
  for(const t of terms){where.push("search_text LIKE ? ESCAPE '\\'");params.push('%'+t.replace(/[\\%_]/g,c=>'\\'+c)+'%')}
 }
 const clause=where.join(' AND ');
 const total=await one('SELECT count(*) AS n FROM catalogue WHERE '+clause,...params);
 const rows=await query('SELECT data FROM catalogue WHERE '+clause+" ORDER BY CASE WHEN json_extract(data,'$.evidence')='retailer-page' THEN 0 ELSE 1 END,json_extract(data,'$.name'),id LIMIT 24 OFFSET ?",...params,(page-1)*24);
 return {products:rows.map(r=>enrichIndexedProduct(JSON.parse(r.data) as Product)),total:total.n,page,hasMore:page*24<total.n,coverage:{complete:false,imported:products.filter(p=>p.retailer===retailer).length,pageDetails:products.filter(p=>p.retailer===retailer&&p.evidence==='retailer-page').length},notice:'Partial import. Indexed titles are discovery links, not a current retailer assortment. Pack sizes taken from a title are labelled as such. Stock and prices are not verified.'};
}
