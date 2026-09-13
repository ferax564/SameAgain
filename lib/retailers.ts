export const retailers:Record<string,{name:string;country:string;tag:string;home:string;offers:string}>={
 'coop-ch':{name:'Coop Switzerland',country:'CH',tag:'coop',home:'https://www.coop.ch/en/',offers:'https://www.coop.ch/en/promotions/current-promotions/c/m_1011'},
 'migros-ch':{name:'Migros',country:'CH',tag:'migros',home:'https://www.migros.ch/en',offers:'https://www.migros.ch/en/offers/home'},
 'tesco-gb':{name:'Tesco',country:'GB',tag:'tesco',home:'https://www.tesco.com/',offers:'https://www.tesco.com/groceries/en-GB/promotions'},
 'carrefour-fr':{name:'Carrefour France',country:'FR',tag:'carrefour',home:'https://www.carrefour.fr/',offers:'https://www.carrefour.fr/promotions'},
 'walmart-us':{name:'Walmart',country:'US',tag:'walmart',home:'https://www.walmart.com/',offers:'https://www.walmart.com/shop/deals'},
};
export function recordedAt(stores:string[]|undefined,retailer:string){const r=retailers[retailer];return !!r&&!!stores?.some(s=>s.toLowerCase().replace(/^[a-z]{2}:/,'').trim()===r.tag)}
export function retailerSearch(id:string,q:string){const r=retailers[id];return 'https://www.google.com/search?q='+encodeURIComponent('site:'+new URL(r.home).hostname+' '+q)}
export function offerState(o:{start:string;end:string},date:string){return date<o.start?'Upcoming':date>o.end?'Expired':'Within reported dates'}
export function inferRetailer(name:string,country:string){const n=name.toLowerCase();return Object.keys(retailers).find(id=>retailers[id].country===country&&(n===retailers[id].tag||n.startsWith(retailers[id].tag+' ')||n.startsWith(retailers[id].tag+'-')))}
