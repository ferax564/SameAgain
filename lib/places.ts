export type Point={lat:number;lon:number};
export type Place=Point&{id:string;name:string;address:string;country:string;countryCode?:string;type:string;sourceUrl:string;distance?:number};
export function point(lat:unknown,lon:unknown):Point{
 if(lat==null||lon==null||lat===''||lon==='')throw new Error('Choose a location first.');
 const a=Number(lat),b=Number(lon);if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a)>90||Math.abs(b)>180)throw new Error('Invalid location.');
 return{lat:Math.round(a*1000)/1000,lon:Math.round(b*1000)/1000};
}
export function distance(a:Point,b:Point){const r=Math.PI/180,dlat=(b.lat-a.lat)*r,dlon=(b.lon-a.lon)*r;return 6371*2*Math.asin(Math.sqrt(Math.min(1,Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlon/2)**2)))}
export function places(data:any,origin?:Point):Place[]{
 if(!Array.isArray(data.features))throw new Error('Unreadable place response');
 const result:Place[]=[];const seen=new Set<string>();
 for(const f of data.features){const p=f.properties||{},coords=f.geometry?.coordinates;const type=({N:'node',W:'way',R:'relation'} as any)[p.osm_type];if(!type||!Number.isSafeInteger(p.osm_id)||!Array.isArray(coords))continue;
  if(origin&&(p.osm_key!=='shop'||!['supermarket','convenience'].includes(p.osm_value)))continue;
  let at:Point;try{at=point(coords[1],coords[0])}catch{continue}
  const id=type+'/'+p.osm_id;if(seen.has(id))continue;seen.add(id);
  const km=origin?distance(origin,at):undefined;if(km!=null&&km>3.2)continue;
  result.push({...at,id,name:p.name||'Unnamed '+(p.osm_value||'place'),address:[p.housenumber,p.street,p.postcode,p.city||p.district,p.state].filter(Boolean).join(' '),country:p.country||'',countryCode:typeof p.countrycode==='string'?p.countrycode.toUpperCase():undefined,type:p.osm_value||'place',sourceUrl:'https://www.openstreetmap.org/'+id,...(km==null?{}:{distance:Math.round(km*10)/10})});
 }return result.sort((a,b)=>(a.distance||0)-(b.distance||0));
}
export function placesUrl(base:string,at?:Point,q?:string){const url=new URL(at?'reverse':'api/',base.endsWith('/')?base:base+'/');if(at){url.search=new URLSearchParams({lat:String(at.lat),lon:String(at.lon),radius:'3',limit:'12'}).toString();url.searchParams.append('osm_tag','shop:supermarket');url.searchParams.append('osm_tag','shop:convenience')}else url.search=new URLSearchParams({q:q||'',limit:'5'}).toString();return url.toString()}
