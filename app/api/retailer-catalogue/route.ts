import {identity,rate,fail,responseError} from '@/lib/server';
import {retailerCatalogue} from '@/lib/retailer-catalogue';
export async function GET(req:Request){try{
 const u=await identity();await rate('retailer-catalogue:'+u.id,60);
 const p=new URL(req.url).searchParams,retailer=p.get('retailer')||'',page=Number(p.get('page')||1),q=(p.get('q')||'').trim();
 if(!['coop-ch','migros-ch'].includes(retailer))fail('Choose Coop Switzerland or Migros.');
 if(!Number.isInteger(page)||page<1||page>1000||q.length>120)fail('Invalid search.');
 return Response.json(await retailerCatalogue(retailer,q,page),{headers:{'Cache-Control':'no-store'}});
 }catch(e){return responseError(e)}}
