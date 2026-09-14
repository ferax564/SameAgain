import {barcode,countryTag,type Product} from './domain';
import {recordedAt} from './retailers';
export function searchText(value:string){return value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()}
export function searchTerms(q:string){return searchText(q).split(/\s+/).filter(Boolean)}
export function productSearchText(p:Pick<Product,'name'|'brand'|'barcode'|'pack'|'categories'|'ingredients'|'sourceIdentifier'>){return searchText([p.name,p.brand,p.barcode,p.sourceIdentifier,p.pack,p.ingredients,...p.categories].filter(Boolean).join(' '))}
export function searchMatches(p:Product,q:string){return searchTerms(q).every(t=>productSearchText(p).includes(t))}
export function catalogueCode(p:Pick<Product,'barcode'|'sourceIdentifier'>){return p.barcode||p.sourceIdentifier||''}
export function ingredientPreview(text?:string,max=110){const t=(text||'').replace(/\s+/g,' ').trim();return t.length>max?t.slice(0,max-1)+'…':t}
// Some source identifiers are retailer-specific or variable-weight codes, not GTINs.
export function scannableProduct(p:Product):Product{return p.barcode&&!barcode(p.barcode).valid?{...p,sourceIdentifier:p.sourceIdentifier||p.barcode,barcode:undefined}:p}
function coverageScore(p:Product){
 return (p.image?8:0)+(p.ingredients?8:p.ingredientsImage?4:0)+(p.barcode||p.sourceIdentifier?4:0)+(p.pack?2:0);
}
function relevance(p:Product,q:string){const name=searchText(p.name),brand=searchText(p.brand||''),text=searchText(q);if(!text)return coverageScore(p);const b=barcode(q);if(b.valid&&p.barcode&&barcode(p.barcode).code===b.code)return 1000;
 return (name===text?100:name.startsWith(text)&&text?70:name.includes(text)&&text?50:brand===text?45:20)+(p.ingredients?5:0)+(p.basis&&Object.keys(p.nutrition||{}).length?5:0)+(p.image?5:-10)+(p.pack?10:-25);
}
export function bestCatalogueRecord(a:Product,b:Product){if(!!a.detailsRetrieved!==!!b.detailsRetrieved)return a.detailsRetrieved?a:b;return (a.detailsRetrieved||a.retrieved)>=(b.detailsRetrieved||b.retrieved)?a:b}
export const CATALOGUE_PAGE_SIZE=48;
export const ALL_CATALOGUE_MATCHES=Number.MAX_SAFE_INTEGER;
export function pageCatalogue<T>(items:T[],page=1,pageSize=CATALOGUE_PAGE_SIZE){
 const n=Number.isInteger(page)&&page>0?page:1;
 const size=Number.isInteger(pageSize)&&pageSize>0&&pageSize<=CATALOGUE_PAGE_SIZE?pageSize:CATALOGUE_PAGE_SIZE;
 const start=(n-1)*size;
 return {products:items.slice(start,start+size),total:items.length,page:n,pageSize:size,hasMore:start+size<items.length};
}
export function rankSearch(products:Product[],q:string,options:{country?:string;category?:string;retailer?:string;label?:string;community?:boolean;limit?:number}={}){
 const unique=new Map<string,Product>();for(const raw of products){const p=scannableProduct(raw);const old=unique.get(p.id);unique.set(p.id,old?bestCatalogueRecord(old,p):p)}
 const cap=options.limit??CATALOGUE_PAGE_SIZE;
 return [...unique.values()].filter(p=>searchMatches(p,q)&&(!options.country||p.countries.includes(countryTag(options.country)))&&(!options.category||p.categories.includes(options.category))&&(!options.retailer||recordedAt(p.stores,options.retailer))&&(!options.label||p.labels?.includes('en:'+options.label))&&(!options.community||p.source==='Open Food Facts')).sort((a,b)=>relevance(b,q)-relevance(a,q)||a.name.localeCompare(b.name)||a.pack?.localeCompare(b.pack||'')||a.id.localeCompare(b.id)).slice(0,cap);
}
