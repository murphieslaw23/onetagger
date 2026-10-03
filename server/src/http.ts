import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CatalogRepository } from './catalog/repository.js';
import type { CuratorAuth } from './auth/curator.js';
import type { ProviderRegistry } from './core/registry.js';
export class HttpError extends Error { constructor(public status:number,message:string){super(message);} }
export interface ApiContext { catalog:CatalogRepository; auth:CuratorAuth; registry:ProviderRegistry; origins:string[] }
export function json(context:ApiContext,req:IncomingMessage,res:ServerResponse,status:number,data:unknown){
 const payload=status===204?'':JSON.stringify(data),origin=req.headers.origin;
 res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(status===204?{}:{'content-length':Buffer.byteLength(payload)}),
 ...(origin&&context.origins.includes(origin)?{'access-control-allow-origin':origin,'access-control-allow-credentials':'true'}:{}),vary:'Origin',
 'access-control-allow-headers':'content-type','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS'});res.end(payload);
}
export function body(req:IncomingMessage):Promise<unknown>{
 return new Promise((resolve,reject)=>{
  let length=0,exceeded=false;const chunks:Buffer[]=[];
  req.on('data',(chunk:Buffer)=>{length+=chunk.length;if(length>2*1024*1024){if(!exceeded){exceeded=true;chunks.length=0;reject(new HttpError(413,'Request exceeds 2 MiB'));}}else if(!exceeded)chunks.push(chunk);});
  req.on('end',()=>{if(exceeded)return;try{resolve(length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{});}catch{reject(new HttpError(400,'Invalid JSON request'));}});
  req.on('error',()=>reject(new HttpError(400,'Request could not be read')));
 });
}
export function requireCurator(context:ApiContext,req:IncomingMessage){const actor=context.auth.authenticate(req);if(!actor)throw new HttpError(401,'Curator login required');return actor;}
export function requireOrigin(context:ApiContext,req:IncomingMessage){if(!req.headers.origin||!context.origins.includes(req.headers.origin))throw new HttpError(403,'Origin is not approved');}
