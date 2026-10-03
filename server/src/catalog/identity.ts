import { randomUUID } from 'node:crypto';
import {
 EntityRecordSchema, EventRecordSchema, MixRecordSchema, FieldClaimSchema, normalizeProviderRef, normalizeName, normalizedSet,
 type CuratorActor, type EntityRecord, type EntityRole, type EventRecord, type ImportResult, type ProviderRef,
} from '@syco23/mixsets-domain';
import type { MixCandidate, SourceRef } from '../domain.js';
import { CatalogRepository } from './repository.js';
import { applyClaims, pendingReviewCount } from './merge.js';

export function recordBase(verification:'proposed'|'source-confirmed'|'curator-confirmed'='source-confirmed'){
 const now=new Date().toISOString();return {id:randomUUID(),revision:1,verification,reviewState:'ready' as const,createdAt:now,updatedAt:now,sources:[]};
}
export function recordingRef(source:SourceRef):ProviderRef{
 const resourceType=source.provider==='freeteknomusic'?'audio':source.provider==='archiveorg'?'item':source.provider==='youtube'?'video':'track';
 return normalizeProviderRef({...source,resourceType});
}
export function resolveEntity(repo:CatalogRepository,name:string,role:EntityRole,source:ProviderRef,confirmedByCurator=false):EntityRecord{
 return repo.transaction(tx=>{
  const entitySource=source.resourceType==='artist'||source.resourceType==='label';
  const existing=entitySource?(tx.findByProvider(source)||tx.findBySource(source)):undefined;
  if(existing){const record=tx.loadRecord(existing);if(record?.category!=='entity'||!record.roles.includes(role))throw new Error('Existing identity has another role; review classification first');return record;}
  const similar=tx.findNameCandidates(role,name);
  const confirmed=confirmedByCurator&&similar.length===0;
  const record=EntityRecordSchema.parse({...recordBase(confirmed?'curator-confirmed':'proposed'),category:'entity',displayName:name,roles:[role],aliases:[],websites:[],relationships:[],sources:entitySource?[source]:[]});
  tx.saveRecord(record);
  const claims=similar.map(other=>FieldClaimSchema.parse({targetRecordId:record.id,field:'possibleDuplicate',value:{recordId:other.id},provider:'curator',sourceUrl:source.url,observedAt:new Date().toISOString(),evidence:'parsed',match:'review',reason:'Matching name suggests an identity to compare; names alone do not confirm equivalence',confidence:.5,state:'pending'}));
  if(!confirmed)claims.push(FieldClaimSchema.parse({targetRecordId:record.id,field:'verification',value:'curator-confirmed',provider:'curator',sourceUrl:source.url,observedAt:new Date().toISOString(),evidence:'parsed',match:'review',reason:'Confirm this '+role+' identity and its source before publishing it',confidence:.5,state:'pending'}));
  if(claims.length)applyClaims(tx,claims);
  return tx.loadRecord(record.id) as EntityRecord;
 });
}
export function importCandidate(repo:CatalogRepository,candidate:MixCandidate,actor:CuratorActor):ImportResult{
 if(!actor.sessionId)throw new Error('Curator confirmation is required');
 return repo.transaction(tx=>{
  const source=recordingRef(candidate.source);
  const existing=tx.findByProvider(source)||tx.findBySource(source);
  if(existing){const detail=tx.getRecord(existing)!;if(detail.record.category!=='mix')throw new Error('Source belongs to another record type');return {record:detail,created:false,reviewItems:pendingReviewCount(tx,existing)};}
  // Add-to-index confirms the title and performer/crew names shown in the discovery card.
  // Other inferred provider facts are not elevated by this action.
  const artists=normalizedSet(candidate.artists).filter(name=>!/^unknown(?: artist)?$/i.test(name)).map(name=>resolveEntity(tx,name,'artist',source,true).id);
  const crews=normalizedSet(candidate.crews).map(name=>resolveEntity(tx,name,'crew',source,true).id);
  const record=MixRecordSchema.parse({...recordBase(),category:'mix',title:candidate.title,artistIds:artists,crewIds:crews,labelIds:[],eventIds:[],durationMs:candidate.durationMs||undefined,description:candidate.description?.trim()||undefined,genres:normalizedSet(candidate.genres||[]),styles:[],recordedAt:candidate.recordedAt?{value:candidate.recordedAt.slice(0,10),precision:candidate.recordedAt.length===4?'year':candidate.recordedAt.length===7?'month':'day'}:undefined,artwork:(candidate.artwork||[]).map(url=>({url,kind:'cover',source:candidate.provider,sourceUrl:source.url})),sources:[source],fileUrl:candidate.provider==='freeteknomusic'?source.url:undefined});
  tx.saveRecord(record);
  for(const field of ['title','artistIds','crewIds']){
   const value=(record as unknown as Record<string,unknown>)[field];if(Array.isArray(value)&&!value.length)continue;
   const claim=tx.saveClaim(FieldClaimSchema.parse({targetRecordId:record.id,field,value,provider:'curator',sourceUrl:source.url,observedAt:new Date().toISOString(),evidence:'curated',match:'confirmed',reason:'Curator confirmed the visible discovery '+field+' during import',confidence:1,state:'selected'}));tx.selectEvidence(record.id,field,claim.id!);
  }
  const similar=tx.listIndex('mix',{q:record.title,includeProposed:true}).items.filter(other=>other.id!==record.id&&other.category==='mix'&&normalizeName(other.title)===normalizeName(record.title));
  if(similar.length)applyClaims(tx,similar.map(other=>FieldClaimSchema.parse({targetRecordId:record.id,field:'possibleDuplicate',value:{recordId:other.id},provider:'curator',sourceUrl:source.url,observedAt:new Date().toISOString(),evidence:'parsed',match:'review',reason:'Similar title suggests a recording to compare; confirm artists and duration before merging',confidence:.5,state:'pending'})));
  return {record:tx.getRecord(record.id)!,created:true,reviewItems:pendingReviewCount(tx,record.id)};
 });
}
export function resolveEvent(repo:CatalogRepository,name:string,source:ProviderRef,facts:Pick<Partial<EventRecord>,'date'|'endDate'|'venue'|'location'|'country'|'description'>={},confirmedByCurator=false):EventRecord{
 return repo.transaction(tx=>{
  const record=EventRecordSchema.parse({...recordBase(confirmedByCurator?'curator-confirmed':'proposed'),category:'event',name,...(confirmedByCurator?facts:{}),organizerIds:[]});
  tx.saveRecord(record);
  const claims=Object.entries(facts).map(([field,value])=>FieldClaimSchema.parse({targetRecordId:record.id,field,value,provider:'curator',sourceUrl:source.url,observedAt:new Date().toISOString(),evidence:confirmedByCurator?'curated':'parsed',match:confirmedByCurator?'confirmed':'review',reason:'Event fact requires confirmation from its source context',confidence:confirmedByCurator?1:.5,state:'pending'}));
  if(!confirmedByCurator)claims.push(FieldClaimSchema.parse({targetRecordId:record.id,field:'verification',value:'curator-confirmed',provider:'curator',sourceUrl:source.url,observedAt:new Date().toISOString(),evidence:'parsed',match:'review',reason:'Confirm the event instance, date and venue before publishing',confidence:.5,state:'pending'}));
  if(claims.length)applyClaims(tx,claims);
  return tx.loadRecord(record.id) as EventRecord;
 });
}
