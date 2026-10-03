import { createHash } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import {
 CatalogRecordSchema, FieldClaimSchema, MediaAssetSchema, normalizeName, normalizeProviderRef, normalizedSet,
 missingFields, completeness, type CatalogRecord, type CatalogDetail, type CatalogPage, type EntityRecord,
 type EntityRole, type FieldClaim, type IndexKind, type MediaAsset, type PageQuery, type ProviderRef, type RecordId,
} from '@syco23/mixsets-domain';
import { openDatabase } from './database.js';

type Row=Record<string,SQLInputValue>;
const optional=(value:SQLInputValue|undefined)=>value===null?undefined:value;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class RevisionConflict extends Error {constructor(){super('Record revision changed; refresh before saving');}}
export type CatalogTransaction=CatalogRepository;

export class CatalogRepository {
 readonly db:DatabaseSync;
 private depth=0;
 constructor(readonly path:string){this.db=openDatabase(path);}
 close(){this.db.close();}
 transaction<T>(operation:(tx:CatalogTransaction)=>T):T {
  if(this.depth)return operation(this);
  this.db.exec('BEGIN IMMEDIATE');this.depth++;
  try{const result=operation(this);if(result instanceof Promise)throw new Error('Catalog transactions must be synchronous');this.db.exec('COMMIT');return result;}
  catch(error){this.db.exec('ROLLBACK');throw error;}finally{this.depth--;}
 }
 private rows(sql:string,...params:SQLInputValue[]):Row[]{return this.db.prepare(sql).all(...params) as Row[];}
 private row(sql:string,...params:SQLInputValue[]):Row|undefined{return this.db.prepare(sql).get(...params) as Row|undefined;}
 private upsert(table:string, values:Record<string,SQLInputValue|undefined>){
  const columns=Object.keys(values);const params=Object.values(values).map(v=>v??null);
  this.db.prepare('INSERT OR REPLACE INTO '+table+' ('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')').run(...params);
 }
 resolveId(id:string):string{return String(this.row('SELECT record_id FROM legacy_aliases WHERE legacy_id=?',id)?.record_id||id);}
 loadRecord(id:RecordId):CatalogRecord|undefined{
  id=this.resolveId(id);const row=this.row('SELECT * FROM catalog_records WHERE id=?',id);if(!row)return undefined;
  const common={id,revision:row.revision,verification:row.verification,reviewState:row.review_state,createdAt:row.created_at,updatedAt:row.updated_at,sources:this.rows('SELECT * FROM provider_sources WHERE record_id=? ORDER BY provider,url',id).map(s=>({provider:s.provider,resourceType:s.resource_type,url:s.url,...(s.external_id?{externalId:s.external_id}:{})}))};
  const texts=(field:string)=>this.rows('SELECT value FROM record_texts WHERE record_id=? AND field=? ORDER BY position',id,field).map(r=>r.value);
  const links=(field:string)=>this.rows('SELECT target_id FROM record_links WHERE record_id=? AND field=? ORDER BY position',id,field).map(r=>r.target_id);
  const media=(field:string)=>this.rows('SELECT * FROM media_assets WHERE record_id=? AND field=? ORDER BY position',id,field).map(r=>MediaAssetSchema.parse({url:r.url,kind:r.kind,source:optional(r.source),sourceUrl:optional(r.source_url),width:optional(r.width),height:optional(r.height),analyzedAt:optional(r.analyzed_at)}));
  let values:Record<string,unknown>;
  if(row.category==='mix'){
   const m=this.row('SELECT * FROM mixes WHERE record_id=?',id)!;
   values={...common,category:'mix',title:m.title,description:optional(m.description),durationMs:optional(m.duration_ms),recordedAt:m.recorded_value?{value:m.recorded_value,precision:m.recorded_precision}:undefined,uploadedAt:m.uploaded_value?{value:m.uploaded_value,precision:m.uploaded_precision}:undefined,
    artistIds:links('artistIds'),crewIds:links('crewIds'),labelIds:links('labelIds'),eventIds:links('eventIds'),genres:texts('genres'),styles:texts('styles'),artwork:media('artwork'),waveform:media('waveform')[0],
    location:optional(m.location),venue:optional(m.venue),fileUrl:optional(m.file_url),streamUrl:optional(m.stream_url),bpmRange:m.bpm_min? [m.bpm_min,m.bpm_max]:undefined,loudnessLufs:optional(m.loudness_lufs)};
  }else if(row.category==='entity'){
   const e=this.row('SELECT * FROM entities WHERE record_id=?',id)!;
   values={...common,category:'entity',displayName:e.display_name,profile:optional(e.profile),country:optional(e.country),roles:this.rows('SELECT role FROM entity_roles WHERE record_id=? ORDER BY role',id).map(r=>r.role),aliases:this.rows('SELECT name FROM entity_aliases WHERE record_id=? ORDER BY position',id).map(r=>r.name),websites:texts('websites'),
    realName:optional(this.row('SELECT real_name FROM artist_details WHERE record_id=?',id)?.real_name),contactInfo:optional(this.row('SELECT contact_info FROM label_details WHERE record_id=?',id)?.contact_info),portrait:media('portrait')[0],crewLogo:media('crewLogo')[0],labelLogo:media('labelLogo')[0],
    relationships:this.rows('SELECT * FROM entity_relationships WHERE record_id=? ORDER BY position',id).map(r=>({targetId:r.target_id,relation:r.relation}))};
  }else{
   const e=this.row('SELECT * FROM events WHERE record_id=?',id)!;
   values={...common,category:'event',name:e.name,date:e.date_value?{value:e.date_value,precision:e.date_precision}:undefined,endDate:e.end_value?{value:e.end_value,precision:e.end_precision}:undefined,venue:optional(e.venue),location:optional(e.location),country:optional(e.country),description:optional(e.description),flyer:media('flyer')[0],organizerIds:links('organizerIds')};
  }
  return CatalogRecordSchema.parse(values);
 }
 getRecord(id:RecordId):CatalogDetail|undefined{
  const record=this.loadRecord(id);if(!record)return undefined;
  const targets=new Set<string>();
  for(const row of this.rows('SELECT target_id FROM record_links WHERE record_id=? UNION SELECT record_id AS target_id FROM record_links WHERE target_id=?',record.id,record.id))targets.add(String(row.target_id));
  if(record.category==='entity')for(const relation of record.relationships)targets.add(relation.targetId);
  targets.delete(record.id);
  return {record,related:[...targets].map(id=>this.loadRecord(id)).filter((r):r is CatalogRecord=>Boolean(r)),claims:this.listClaims(record.id),missingFields:missingFields(record),completeness:completeness(record)};
 }
 listIndex(kind:IndexKind,query:PageQuery):CatalogPage{
  const offset=Math.max(0,Math.floor(query.offset||0)),limit=Math.min(50,Math.max(1,Math.floor(query.limit||50)));
  const conditions:string[]=[],params:SQLInputValue[]=[];
  if(['artist','crew','label'].includes(kind)){conditions.push("r.category='entity' AND EXISTS(SELECT 1 FROM entity_roles er WHERE er.record_id=r.id AND er.role=?)");params.push(kind);}
  else{conditions.push('r.category=?');params.push(kind);}
  if(!query.includeProposed)conditions.push("r.verification<>'proposed'");
  if(query.q){conditions.push("(r.normalized_name LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM entity_aliases ea WHERE ea.record_id=r.id AND ea.normalized_name LIKE ? ESCAPE '\\'))");const pattern='%'+normalizeName(query.q).replace(/[\\%_]/g,'\\$&')+'%';params.push(pattern,pattern);}
  const where=conditions.join(' AND '),total=Number(this.row('SELECT count(*) AS total FROM catalog_records r WHERE '+where,...params)!.total);
  const details=this.rows('SELECT r.id FROM catalog_records r WHERE '+where+' ORDER BY r.normalized_name,r.id LIMIT ? OFFSET ?',...params,limit,offset).map(r=>this.getRecord(String(r.id))!);
  const related=new Map<string,CatalogRecord>();for(const d of details)for(const r of d.related)if(query.includeProposed||r.verification!=='proposed')related.set(r.id,r);
  return {items:details.map(d=>d.record),related:[...related.values()],total,nextOffset:offset+details.length<total?offset+details.length:null};
 }
 findByProvider(input:ProviderRef):RecordId|undefined{
  const ref=normalizeProviderRef(input);if(!ref.externalId)return undefined;
  const row=this.row('SELECT record_id FROM provider_identities WHERE provider=? AND resource_type=? AND external_id=?',ref.provider,ref.resourceType,ref.externalId);
  return row?String(row.record_id):undefined;
 }
 findBySource(input:ProviderRef):RecordId|undefined{
  const ref=normalizeProviderRef(input);const row=this.row('SELECT record_id FROM provider_sources WHERE provider=? AND resource_type=? AND url=?',ref.provider,ref.resourceType,ref.url);return row?String(row.record_id):undefined;
 }
 findNameCandidates(role:EntityRole,name:string):EntityRecord[]{
  return this.rows('SELECT DISTINCT r.id FROM catalog_records r JOIN entity_roles er ON er.record_id=r.id LEFT JOIN entity_aliases a ON a.record_id=r.id WHERE er.role=? AND (r.normalized_name=? OR a.normalized_name=?) LIMIT 50',role,normalizeName(name),normalizeName(name)).map(r=>this.loadRecord(String(r.id))).filter((r):r is EntityRecord=>r?.category==='entity');
 }
 private validateLinks(record:CatalogRecord){
  if(record.category==='entity'){
   for(const link of this.rows('SELECT field FROM record_links WHERE target_id=?',record.id)){
    const required=({artistIds:'artist',crewIds:'crew',labelIds:'label'} as Record<string,EntityRole>)[String(link.field)];
    if(required&&!record.roles.includes(required))throw new Error('Cannot remove a role required by an existing mix');
   }
   for(const link of this.rows("SELECT relation FROM entity_relationships WHERE target_id=? AND relation IN ('parent-label','sub-label')",record.id))if(!record.roles.includes('label'))throw new Error('Label relationship requires the label role');
  }
  const links: Array<[string,string,string?]>=record.category==='mix'?[...record.artistIds.map(id=>[id,'entity','artist'] as [string,string,string]),...record.crewIds.map(id=>[id,'entity','crew'] as [string,string,string]),...record.labelIds.map(id=>[id,'entity','label'] as [string,string,string]),...record.eventIds.map(id=>[id,'event'] as [string,string])]:record.category==='event'?record.organizerIds.map(id=>[id,'entity'] as [string,string]):record.relationships.map(r=>[r.targetId,'entity',r.relation==='parent-label'||r.relation==='sub-label'?'label':undefined]);
  for(const [id,category,role] of links){const target=this.loadRecord(id);if(!target||target.category!==category||(role&&target.category==='entity'&&!target.roles.includes(role as EntityRole)))throw new Error('Relationship target has incorrect type or is missing: '+id);}
 }
 saveRecord(input:CatalogRecord,expectedRevision?:number):CatalogRecord{
  if(!this.depth)return this.transaction(tx=>tx.saveRecord(input,expectedRevision));
  let record=CatalogRecordSchema.parse(input);
  const current=this.loadRecord(record.id);
  if(expectedRevision!==undefined&&current?.revision!==expectedRevision)throw new RevisionConflict();
  if(current&&current.category!==record.category)throw new Error('Canonical record category cannot change');
  this.validateLinks(record);
  const sources=new Map<string,ProviderRef>();
  for(const inputRef of record.sources){
   const ref=normalizeProviderRef(inputRef),key=ref.provider+':'+ref.resourceType+':'+ref.url,prior=sources.get(key);
   if(prior?.externalId&&ref.externalId&&prior.externalId!==ref.externalId)throw new Error('Conflicting external identity for one source URL');
   for(const owner of [this.findBySource(ref),this.findByProvider(ref)])if(owner&&owner!==record.id)throw new Error('Provider identity already belongs to another canonical record');
   sources.set(key,{...ref,externalId:ref.externalId||prior?.externalId});
  }
  record={...record,sources:[...sources.values()]};
  const name=record.category==='mix'?record.title:record.category==='entity'?record.displayName:record.name;
  if(current)this.db.prepare('UPDATE catalog_records SET name=?,normalized_name=?,revision=?,verification=?,review_state=?,updated_at=? WHERE id=?').run(name,normalizeName(name),record.revision,record.verification,record.reviewState,record.updatedAt,record.id);
  else this.db.prepare('INSERT INTO catalog_records VALUES(?,?,?,?,?,?,?,?,?)').run(record.id,record.category,name,normalizeName(name),record.revision,record.verification,record.reviewState,record.createdAt,record.updatedAt);
  const id=record.id;
  // Detail rows have no inbound references; common/entity rows use UPDATE, never REPLACE.
  if(record.category==='mix')this.upsert('mixes',{record_id:id,title:record.title,description:record.description,duration_ms:record.durationMs,recorded_value:record.recordedAt?.value,recorded_precision:record.recordedAt?.precision,uploaded_value:record.uploadedAt?.value,uploaded_precision:record.uploadedAt?.precision,location:record.location,venue:record.venue,file_url:record.fileUrl,stream_url:record.streamUrl,bpm_min:record.bpmRange?.[0],bpm_max:record.bpmRange?.[1],loudness_lufs:record.loudnessLufs});
  else if(record.category==='entity'){
   this.db.prepare('INSERT INTO entities(record_id,display_name,profile,country) VALUES(?,?,?,?) ON CONFLICT(record_id) DO UPDATE SET display_name=excluded.display_name,profile=excluded.profile,country=excluded.country').run(id,record.displayName,record.profile??null,record.country??null);
   this.db.prepare('DELETE FROM entity_roles WHERE record_id=?').run(id);
   for(const role of new Set(record.roles))this.db.prepare('INSERT INTO entity_roles VALUES(?,?)').run(id,role);
   for(const table of ['artist_details','crew_details','label_details'])this.db.prepare('DELETE FROM '+table+' WHERE record_id=?').run(id);
   if(record.roles.includes('artist'))this.upsert('artist_details',{record_id:id,real_name:record.realName});
   if(record.roles.includes('crew'))this.upsert('crew_details',{record_id:id});
   if(record.roles.includes('label'))this.upsert('label_details',{record_id:id,contact_info:record.contactInfo});
   this.db.prepare('DELETE FROM entity_aliases WHERE record_id=?').run(id);
   normalizedSet(record.aliases).forEach((name,i)=>this.db.prepare('INSERT INTO entity_aliases VALUES(?,?,?,?)').run(id,name,normalizeName(name),i));
   this.db.prepare('DELETE FROM entity_relationships WHERE record_id=?').run(id);
   record.relationships.forEach((r,i)=>this.db.prepare('INSERT OR IGNORE INTO entity_relationships VALUES(?,?,?,?)').run(id,r.targetId,r.relation,i));
  }else this.upsert('events',{record_id:id,name:record.name,date_value:record.date?.value,date_precision:record.date?.precision,end_value:record.endDate?.value,end_precision:record.endDate?.precision,venue:record.venue,location:record.location,country:record.country,description:record.description});
  for(const table of ['record_texts','record_links','provider_sources','media_assets'])this.db.prepare('DELETE FROM '+table+' WHERE record_id=?').run(id);
  this.db.prepare('DELETE FROM provider_identities WHERE record_id=?').run(id);
  const texts:Record<string,string[]>=record.category==='mix'?{genres:record.genres,styles:record.styles}:record.category==='entity'?{websites:record.websites}:{};
  for(const [field,values] of Object.entries(texts))normalizedSet(values).forEach((value,i)=>this.db.prepare('INSERT INTO record_texts VALUES(?,?,?,?,?)').run(id,field,value,normalizeName(value),i));
  const links:Record<string,string[]>=record.category==='mix'?{artistIds:record.artistIds,crewIds:record.crewIds,labelIds:record.labelIds,eventIds:record.eventIds}:record.category==='event'?{organizerIds:record.organizerIds}:{};
  for(const [field,values] of Object.entries(links))[...new Set(values)].forEach((target,i)=>this.db.prepare('INSERT INTO record_links VALUES(?,?,?,?)').run(id,field,target,i));
  for(const ref of record.sources){
   if(ref.externalId)this.db.prepare('INSERT OR IGNORE INTO provider_identities VALUES(?,?,?,?)').run(ref.provider,ref.resourceType,ref.externalId,id);
   this.db.prepare('INSERT INTO provider_sources VALUES(?,?,?,?,?)').run(id,ref.provider,ref.resourceType,ref.externalId??null,ref.url);
  }
  // OR IGNORE only coalesces duplicate refs owned by this record, never an identity owned elsewhere.
  for(const ref of record.sources)if((this.findBySource(ref)||this.findByProvider(ref))!==id)throw new Error('Provider identity already belongs to another canonical record');
  const media:Record<string,MediaAsset[]>=record.category==='mix'?{artwork:record.artwork,waveform:record.waveform?[record.waveform]:[]}:record.category==='entity'?{portrait:record.portrait?[record.portrait]:[],crewLogo:record.crewLogo?[record.crewLogo]:[],labelLogo:record.labelLogo?[record.labelLogo]:[]}: {flyer:record.flyer?[record.flyer]:[]};
  for(const [field,assets] of Object.entries(media))assets.forEach((asset,i)=>this.db.prepare('INSERT INTO media_assets VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(asset.url.startsWith('/api/catalog/media/')?asset.url.split('/').pop()!:hash([id,field,i,asset.url]),id,field,i,asset.url,asset.kind,asset.source??null,asset.sourceUrl??null,asset.width??null,asset.height??null,asset.analyzedAt??null));
  return this.loadRecord(id)!;
 }
 listClaims(id:string):FieldClaim[]{return this.rows('SELECT * FROM field_claims WHERE record_id=? ORDER BY observed_at,id',id).map(row=>this.claimFromRow(row));}
 private claimFromRow(row:Row):FieldClaim{return FieldClaimSchema.parse({id:row.id,targetRecordId:row.record_id,field:row.field,value:JSON.parse(String(row.value_json)),provider:row.provider,sourceUrl:row.source_url,resource:row.resource_json?JSON.parse(String(row.resource_json)):undefined,observedAt:row.observed_at,evidence:row.evidence,match:row.match_state,reason:row.reason,confidence:row.confidence,state:row.disposition,recordRevision:optional(row.record_revision),excerpt:optional(row.excerpt)});}
 getClaim(id:string):FieldClaim|undefined{const row=this.row('SELECT * FROM field_claims WHERE id=?',id);return row?this.claimFromRow(row):undefined;}
 saveClaim(input:FieldClaim):FieldClaim{
  const claim=FieldClaimSchema.parse(input);
  const fingerprint=hash([claim.targetRecordId,claim.field,claim.value,claim.provider,claim.sourceUrl,claim.resource||null,claim.evidence]);
  const id='claim-'+fingerprint;const existing=this.getClaim(id);if(existing)return existing;
  this.db.prepare('INSERT INTO field_claims VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,fingerprint,claim.targetRecordId,claim.field,JSON.stringify(claim.value),claim.provider,claim.sourceUrl,claim.resource?JSON.stringify(claim.resource):null,claim.observedAt,claim.evidence,claim.match,claim.reason,claim.confidence,claim.state,claim.recordRevision??null,claim.excerpt??null);
  return this.getClaim(id)!;
 }
 selectEvidence(id:string,field:string,claimId:string){const claim=this.getClaim(claimId);if(claim?.targetRecordId!==id||claim.field!==field)throw new Error('Selected evidence belongs to another field');this.db.prepare('INSERT INTO selected_evidence VALUES(?,?,?) ON CONFLICT(record_id,field) DO UPDATE SET claim_id=excluded.claim_id').run(id,field,claimId);}
 setClaimState(id:string,state:FieldClaim['state']){this.db.prepare('UPDATE field_claims SET disposition=? WHERE id=?').run(state,id);}
 putAlias(legacyId:string,id:string){const existing=this.row('SELECT record_id FROM legacy_aliases WHERE legacy_id=?',legacyId);if(existing&&existing.record_id!==id)throw new Error('Legacy identity collision requires review');this.db.prepare('INSERT OR IGNORE INTO legacy_aliases VALUES(?,?)').run(legacyId,id);}
 mediaAsset(id:string):{recordId:string;asset:MediaAsset}|undefined{const row=this.row('SELECT * FROM media_assets WHERE id=?',id);return row?{recordId:String(row.record_id),asset:MediaAssetSchema.parse({url:row.url,kind:row.kind,source:optional(row.source),sourceUrl:optional(row.source_url),analyzedAt:optional(row.analyzed_at),width:optional(row.width),height:optional(row.height)})}:undefined;}
}
export function openCatalog(path:string):CatalogRepository{return new CatalogRepository(path);}
