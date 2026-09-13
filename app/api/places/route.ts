import {env} from 'cloudflare:workers';
import {identity,rate,hash,fail,responseError} from '@/lib/server';
import {point,places,placesUrl} from '@/lib/places';
// Bounded isolate cache: no user IDs, query logs, or persistent location history.
const cache=new Map<string,{expires:number;data:any}>();
export async function GET(req:Request){try{
 const user=await identity();await rate('places:user:'+user.id,8);
 const p=new URL(req.url).searchParams;let at;try{if(p.has('lat')||p.has('lon'))at=point(p.get('lat'),p.get('lon'))}catch(e:any){fail(e.message)}
 const q=(p.get('q')||'').trim();if(!at&&(q.length<2||q.length>100))fail('Enter a city, neighbourhood or postcode (2–100 characters).');
 const base=(env as any).PHOTON_BASE_URL||'https://photon.komoot.io/';if(!base.startsWith('https://'))fail('Store search is not configured.',503);
 const url=placesUrl(base,at,q),key=await hash(url),now=Date.now();
 for(const [k,v]of cache)if(v.expires<=now)cache.delete(k);
 const hit=cache.get(key);if(hit)return Response.json({...hit.data,cached:true});
 await rate('photon:all',12);await rate('photon:daily',300,86400000);
 const r=await fetch(url,{headers:{'User-Agent':'SameAgain/1.1 (https://same-again.frx.chatgpt.site)','Accept':'application/json'},signal:AbortSignal.timeout(10000)});
 if(!r.ok)fail('Place search is temporarily unavailable. Retry later or open the map search below.',503);
 const rows=places(await r.json(),at),data={places:rows,kind:at?'stores':'locations',retrieved:now,source:'OpenStreetMap via Photon',inventory:'Not connected'};
 if(cache.size>=100)cache.delete(cache.keys().next().value!);cache.set(key,{expires:now+3600000,data});
 return Response.json(data);
 }catch(e){return responseError(e)}}
