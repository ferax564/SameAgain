import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync('public/sw.js','utf8');
function runtime(){const listeners={},stored=new Map();let network=async()=>new Response('network');const key=r=>typeof r==='string'?r:r.url;
 const caches={async open(){return{async addAll(){},async put(k,v){stored.set(key(k),v)}}},async match(k){return stored.get(key(k))?.clone()},async keys(){return['same-again-shell-v1','unrelated-cache']},async delete(k){stored.set('deleted:'+k,true)}};
 vm.runInNewContext(code,{URL,Response,AbortSignal,caches,location:{origin:'https://same.test'},fetch:(...a)=>network(...a),self:{addEventListener:(k,v)=>listeners[k]=v,async skipWaiting(){},clients:{async claim(){}}}});
 return{stored,setNetwork(fn){network=fn},async dispatch(request){let response;const pending=[];listeners.fetch({request,respondWith(p){response=p},waitUntil(p){pending.push(p)}});const r=await response;await Promise.all(pending);return r},async event(name){let p;listeners[name]({waitUntil(v){p=v}});await p}};
}
const nav={url:'https://same.test/',method:'GET',mode:'navigate'};
test('offline navigation serves the previously cached application shell',async()=>{const r=runtime();r.setNetwork(async()=>new Response('app shell',{headers:{'X-Same-Again-Shell':'1'}}));await r.dispatch(nav);r.setNetwork(async()=>{throw new Error('offline')});assert.equal(await(await r.dispatch(nav)).text(),'app shell')});
test('API and sign-in requests are never intercepted or cached',async()=>{const r=runtime();for(const path of ['/api/data','/api/photo','/signin-with-chatgpt','/callback'])assert.equal(await r.dispatch({...nav,url:'https://same.test'+path}),undefined)});
test('access-gate HTML cannot replace the application shell',async()=>{const r=runtime();r.stored.set('/',new Response('app shell'));r.setNetwork(async()=>new Response('Sign in'));await r.dispatch(nav);assert.equal(await r.stored.get('/').text(),'app shell')});
test('cache upgrade removes only Same Again caches',async()=>{const r=runtime();await r.event('activate');assert.equal(r.stored.get('deleted:same-again-shell-v1'),true);assert(!r.stored.has('deleted:unrelated-cache'))});
