import {CatalogDetailSchema,CatalogPageSchema,ImportResultSchema,EnrichmentReportSchema,MigrationResultSchema,ReviewItemSchema,type IndexKind} from '@syco23/mixsets-domain';
import type {ApiMixCandidate} from '../services/api';
export const API_BASE=(import.meta.env.VITE_API_BASE||'/api').replace(/\/$/,'');
export class CatalogApiError extends Error{constructor(public status:number,message:string){super(message);}}
export async function request<T>(path:string,schema:{parse(value:unknown):T},init?:RequestInit):Promise<T>{
 const response=await fetch(API_BASE+path,{...init,credentials:'include',headers:{'content-type':'application/json',...(init?.headers||{})}});
 let payload:unknown;try{payload=await response.json();}catch{throw new CatalogApiError(response.status,'The worker returned an unreadable response');}
 if(!response.ok)throw new CatalogApiError(response.status,typeof payload==='object'&&payload&&'error'in payload?String(payload.error):'Request failed ('+response.status+')');
 try{return schema.parse(payload);}catch{throw new CatalogApiError(502,'The worker returned invalid catalog data');}
}
const post=(value:unknown):RequestInit=>({method:'POST',body:JSON.stringify(value)});
const session={parse(value:unknown):{authenticated:boolean,configured:boolean}{if(!value||typeof value!=='object'||!('authenticated'in value)||typeof value.authenticated!=='boolean'||!('configured'in value)||typeof value.configured!=='boolean')throw new Error('Invalid session');return {authenticated:value.authenticated,configured:value.configured};}};
export const catalogApi={
 session:()=>request('/auth/session',session),login:(password:string)=>request('/auth/login',session,post({password})),logout:()=>request('/auth/logout',session,post({})),
 index:(kind:IndexKind,query:{q?:string,offset?:number,includeProposed?:boolean}={})=>request('/catalog/'+kind+'?'+new URLSearchParams(Object.entries(query).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)])),CatalogPageSchema),
 detail:(id:string)=>request('/catalog/records/'+encodeURIComponent(id),CatalogDetailSchema),
 import:(candidate:ApiMixCandidate)=>request('/catalog/import',ImportResultSchema,post(candidate)),
 enrich:(id:string)=>request('/catalog/records/'+encodeURIComponent(id)+'/enrich',EnrichmentReportSchema,post({})),
 patch:(id:string,fields:unknown,revision:number)=>request('/catalog/records/'+encodeURIComponent(id),CatalogDetailSchema,{method:'PATCH',body:JSON.stringify({fields,revision})}),
 migrate:(records:unknown[],batchId:string)=>request('/catalog/migrate',MigrationResultSchema,post({records,batchId})),
 review:()=>request('/catalog/review',ReviewItemSchema.array()),
 decide:(id:string,decision:'accept'|'reject',revision:number)=>request('/catalog/review/'+encodeURIComponent(id),CatalogDetailSchema,post({decision,revision})),
 merge:(survivor:string,duplicate:string,revisions:[number,number])=>request('/catalog/merge',CatalogDetailSchema,post({survivor,duplicate,revisions})),
};
export function mediaUrl(url?:string){return url?.startsWith('/api/')?API_BASE.replace(/\/api$/,'')+url:url;}
