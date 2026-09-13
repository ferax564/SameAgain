interface D1PreparedStatement {bind(...values:any[]):D1PreparedStatement; all<T=Record<string,unknown>>():Promise<{results:T[];meta:{changes:number}}>;run():Promise<{meta:{changes:number}}>}
interface D1Database {prepare(sql:string):D1PreparedStatement;batch(statements:D1PreparedStatement[]):Promise<{meta:{changes:number}}[]>}
interface Fetcher {fetch(request:Request):Promise<Response>}
declare module 'cloudflare:workers' {export const env:{DB:D1Database;BUCKET:{put(key:string,value:any,options?:any):Promise<any>;get(key:string):Promise<any>;delete(key:string|string[]):Promise<void>;list(options:{prefix:string;cursor?:string}):Promise<any>}}}
