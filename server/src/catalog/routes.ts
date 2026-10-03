import type { IncomingMessage,ServerResponse } from 'node:http';
import { z } from 'zod';
import { ProviderIdSchema,HttpUrlSchema,CatalogRecordSchema,FieldClaimSchema,editableFields,validateField,type CatalogDetail,type IndexKind } from '@syco23/mixsets-domain';
import { body,json,requireCurator,HttpError,type ApiContext } from '../http.js';
import { enrichCatalogRecord } from './enrich.js';
import { importCandidate } from './identity.js';
import { pendingReviewCount,valueKey } from './merge.js';
import { listReview,decideReview,mergeRecords } from './review.js';
export const CandidateSchema=z.object({provider:ProviderIdSchema,title:z.string().trim().min(1).max(1000),artists:z.array(z.string().trim().min(1).max(1000)).max(100),crews:z.array(z.string().trim().min(1).max(1000)).max(100),durationMs:z.number().int().positive().max(604800000).optional(),recordedAt:z.string().max(100).optional(),description:z.string().max(100000).optional(),genres:z.array(z.string().max(1000)).max(100).optional(),artwork:z.array(HttpUrlSchema).max(10).optional(),source:z.object({provider:ProviderIdSchema,url:HttpUrlSchema,externalId:z.string().max(512).optional()}).strict(),confidence:z.number().min(0).max(1),reasons:z.array(z.string().max(4000)).max(100),raw:z.record(z.string(),z.unknown()).default({})}).strip().refine(v=>v.provider===v.source.provider,'Provider and source must agree');
export function publicDetail(detail:CatalogDetail):CatalogDetail{
 const record=detail.record as unknown as Record<string,unknown>;
 return {...detail,related:detail.related.filter(r=>r.verification!=='proposed'),claims:detail.claims.filter(c=>['selected','corroborated'].includes(c.state)&&valueKey(record[c.field])===valueKey(c.value))};
}
export async function handleCatalogRoute(context:ApiContext,req:IncomingMessage,res:ServerResponse):Promise<boolean>{
 const url=new URL(req.url!,'http://localhost'),path=url.pathname,repo=context.catalog,actor=context.auth.authenticate(req);
 const reply=(status:number,value:unknown)=>json(context,req,res,status,value);
 if(req.method==='GET'&&path==='/api/catalog/review'){requireCurator(context,req);reply(200,listReview(repo));return true;}
 const index=path.match(/^\/api\/catalog\/(mix|artist|crew|label|event)$/);
 if(req.method==='GET'&&index){const query=z.object({q:z.string().max(1000).optional(),offset:z.coerce.number().int().nonnegative().default(0),limit:z.coerce.number().int().min(1).max(50).default(50)}).parse(Object.fromEntries(url.searchParams));reply(200,repo.listIndex(index[1] as IndexKind,{...query,includeProposed:!!actor&&url.searchParams.get('includeProposed')==='true'}));return true;}
 const record=path.match(/^\/api\/catalog\/records\/([^/]+)$/);
 if(req.method==='GET'&&record){const detail=repo.getRecord(decodeURIComponent(record[1]));if(!detail||(!actor&&detail.record.verification==='proposed'))throw new HttpError(404,'Record not found');reply(200,actor?detail:publicDetail(detail));return true;}
 const enrichment=path.match(/^\/api\/catalog\/records\/([^/]+)\/enrich$/);
 if(req.method==='POST'&&enrichment){reply(200,await enrichCatalogRecord(repo,context.registry,decodeURIComponent(enrichment[1]),requireCurator(context,req)));return true;}
 if(req.method==='POST'&&path==='/api/catalog/import'){reply(200,importCandidate(repo,CandidateSchema.parse(await body(req)),requireCurator(context,req)));return true;}
 if(req.method==='PATCH'&&record){
  const curator=requireCurator(context,req),input=z.object({revision:z.number().int().positive(),fields:z.record(z.string(),z.json())}).strict().parse(await body(req));
  const detail=repo.transaction(tx=>{
   const current=tx.loadRecord(decodeURIComponent(record[1]));if(!current)throw new HttpError(404,'Record not found');
   const patch:Record<string,unknown>={};for(const [field,value]of Object.entries(input.fields)){if(!editableFields[current.category].includes(field))throw new HttpError(400,'Field cannot be edited');patch[field]=validateField(current,field,value);}
   const updated=tx.saveRecord(CatalogRecordSchema.parse({...current,...patch,revision:current.revision+1,updatedAt:new Date().toISOString()}),input.revision);
   for(const [field,value]of Object.entries(patch)){
    const claim=tx.saveClaim(FieldClaimSchema.parse({targetRecordId:current.id,field,value,provider:'curator',sourceUrl:current.sources[0]?.url||'https://mixsets.syco23.org/entity/'+current.id,observedAt:new Date().toISOString(),evidence:'curated',match:'confirmed',confidence:1,state:'selected',reason:'Explicit curator correction',recordRevision:updated.revision}));tx.selectEvidence(current.id,field,claim.id!);
    for(const pending of tx.listClaims(current.id))if(pending.state==='pending'&&pending.field===field&&valueKey(pending.value)===valueKey(value))tx.setClaimState(pending.id!,'corroborated');
    tx.db.prepare('INSERT INTO review_decisions(claim_id,decision,actor,decided_at,record_revision) VALUES(?,?,?,?,?)').run(claim.id!,'edited',curator.sessionId,new Date().toISOString(),input.revision);
   }
   tx.saveRecord({...updated,reviewState:pendingReviewCount(tx,current.id)?'review':'ready'},updated.revision);return tx.getRecord(current.id)!;
  });reply(200,detail);return true;
 }
 const decision=path.match(/^\/api\/catalog\/review\/([^/]+)$/);
 if(req.method==='POST'&&decision){const input=z.object({decision:z.enum(['accept','reject']),revision:z.number().int().positive()}).strict().parse(await body(req));reply(200,decideReview(repo,decodeURIComponent(decision[1]),input.decision,input.revision,requireCurator(context,req)));return true;}
 if(req.method==='POST'&&path==='/api/catalog/merge'){const input=z.object({survivor:z.string().max(1000),duplicate:z.string().max(1000),revisions:z.tuple([z.number().int().positive(),z.number().int().positive()])}).strict().parse(await body(req));reply(200,mergeRecords(repo,input.survivor,input.duplicate,input.revisions,requireCurator(context,req)));return true;}
 return false;
}
