import {productSearchText,rankSearch,ALL_CATALOGUE_MATCHES} from './catalogue-search';
import {env} from 'cloudflare:workers';
import report from './swiss-retailer-report.json';
import {barcode,type Product} from './domain';
import {hasStore} from './retailers';
import {db} from './server';
// Load the licensed data asset on the server, rather than compiling 13,000
// product objects into JavaScript or sending the full index to each browser.
let loaded:Promise<{products:Product[];byBarcode:Map<string,Product>}>|undefined;
async function index(requestUrl?:string){
 if(!loaded)loaded=(async()=>{const r=await (env as any).ASSETS.fetch(new Request(new URL('/catalogue/swiss-retailer-products.json',requestUrl||'https://same-again.frx.chatgpt.site')));if(!r.ok)throw new Error('Local catalogue asset unavailable');const products=await r.json() as Product[];return {products,byBarcode:new Map(products.filter(p=>p.barcode&&barcode(p.barcode).valid).map(p=>[barcode(p.barcode!).code,p]))}})().catch(e=>{loaded=undefined;throw e});
 return loaded;
}
export const swissCoverage=report;
export const swissBarcode=async(code:string,requestUrl?:string)=>(await index(requestUrl)).byBarcode.get(code);
export async function swissSearch(q:string,country?:string,category?:string,store?:string,requestUrl?:string){return rankSearch((await index(requestUrl)).products.filter(p=>!store||hasStore(p.stores,store)),q,{country,category,limit:ALL_CATALOGUE_MATCHES})}
export async function persistSwiss(products:Product[]){for(let i=0;i<products.length;i+=25)await db().batch(products.slice(i,i+25).map(p=>db().prepare("INSERT INTO catalogue(id,data,retrieved,search_text) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,retrieved=excluded.retrieved,search_text=excluded.search_text WHERE catalogue.retrieved<=excluded.retrieved AND COALESCE(json_extract(catalogue.data,'$.detailsRetrieved'),0)=0").bind(p.id,JSON.stringify(p),p.retrieved,productSearchText(p))))}
