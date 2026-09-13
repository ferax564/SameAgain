export {db,query,one,run,fail,identity,member,rate,hash,sameOrigin,responseError,decode} from '../lib/server';
import {context} from './runtime-harness';
export const asUser=(id:string,fn:()=>Promise<any>)=>context.run(id,fn);
