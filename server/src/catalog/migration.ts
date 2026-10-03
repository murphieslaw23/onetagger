import { createHash } from 'node:crypto';
import { LegacyMixSchema,FieldClaimSchema,MigrationResultSchema,normalizeName,editableFields,type CuratorActor,type MigrationResult } from '@syco23/mixsets-domain';
import type { CatalogRepository } from './repository.js';
import { importCandidate,recordingRef,resolveEntity,resolveEvent } from './identity.js';
import { applyClaims,claimValue }  from './merge.js';
import { persistWaveform } from './media.js';
const demos=new Set(['spiral-warehouse-2001','metek-aniane-98','novabase-live-tech','gotek-roma-2007']);
export function migrateLegacyLibrary(repo:CatalogRepository,records:unknown[],batchId:string,actor:CuratorActor):MigrationResult{
 if(!actor.sessionId)throw new Error('Curator login required');if(records.length>500||!batchId||batchId.length>1000)throw new Error('Migration batch is too large or invalid');
 const previous=repo.db.prepare('SELECT result_json FROM migration_batches WHERE batch_id=?').get(batchId);if(previous)return MigrationResultSchema.parse(JSON.parse(String(previous.result_json)));
 const outcomes:MigrationResult['outcomes']=[];
 for(const raw of records){const legacyId=typeof raw==='object'&&raw&&typeof(raw as {id?:unknown}).id==='string'?(raw as {id:string}).id.slice(0,1000):'invalid-record';
  if(demos.has(legacyId)){outcomes.push({legacyId,status:'skipped',message:'Bundled demonstration record'});continue;}
  try{const outcome=repo.transaction(tx=>{
   const legacy=LegacyMixSchema.parse(raw),imported=importCandidate(tx,{provider:legacy.sources[0].provider,title:legacy.title,artists:legacy.artists,crews:legacy.crews,durationMs:legacy.durationMs||undefined,source:legacy.sources[0],confidence:1,reasons:['Curator browser migration'],raw:{}},actor),id=imported.record.record.id;
   tx.putAlias(legacy.id,id);
   const source=recordingRef(legacy.sources[0]),claims: ReturnType<typeof FieldClaimSchema.parse>[]=[];
   const add=(field:string,value:unknown,curated=false,url=source.url)=>claims.push(FieldClaimSchema.parse({targetRecordId:id,field,value,provider:curated?'curator':legacy.sources[0].provider,sourceUrl:url,observedAt:new Date().toISOString(),evidence:curated?'curated':'parsed',match:curated?'confirmed':'review',reason:curated?'Preserved explicit browser curator selection':'Legacy field retained for verification; browser metadata was not independently proven',confidence:curated?1:.6,state:'pending'}));
   add('sources',legacy.sources.map(recordingRef),true);
   for(const field of ['description','genres','styles','venue','location','durationMs'] as const){const value=legacy[field];if(value!==undefined&&value!==''&&!(Array.isArray(value)&&!value.length))add(field,value,legacy.provenance.some(item=>item.field===field&&item.provider==='curator'));}
   if(legacy.recordedAt)add('recordedAt',{value:legacy.recordedAt,precision:legacy.recordedAt.length===4?'year':legacy.recordedAt.length===7?'month':'day'});
   const covers=legacy.artwork.filter(a=>a.kind==='cover');if(covers.length)add('artwork',covers.map(a=>({url:a.url,kind:'cover',source:a.source==='curator'?'curator':legacy.sources[0].provider,sourceUrl:source.url})),covers.every(a=>a.source==='curator'));
   for(const ref of legacy.entities){if(ref.provider!=='discogs'||!ref.url||!ref.externalId)continue;const entitySource={provider:'discogs' as const,resourceType:ref.kind==='label'?'label' as const:'artist' as const,url:ref.url,externalId:ref.externalId},entity=resolveEntity(tx,ref.name,ref.kind,entitySource,true);
    applyClaims(tx,[FieldClaimSchema.parse({targetRecordId:entity.id,field:'verification',value:'curator-confirmed',provider:'curator',sourceUrl:ref.url,observedAt:new Date().toISOString(),evidence:'curated',match:'confirmed',confidence:1,state:'pending',reason:'Curator preserved the browser-selected entity identity'})]);
    const field=ref.kind==='artist'?'artistIds':ref.kind==='crew'?'crewIds':'labelIds';if(ref.kind!=='label'&&legacy[ref.kind==='artist'?'artists':'crews'].some(name=>normalizeName(name)===normalizeName(ref.name)))add(field,[entity.id],true,ref.url);
    if(ref.profile)applyClaims(tx,[FieldClaimSchema.parse({targetRecordId:entity.id,field:'profile',value:ref.profile,provider:'discogs',sourceUrl:ref.url,resource:entitySource,observedAt:new Date().toISOString(),evidence:'direct',match:'confirmed',confidence:.9,state:'pending',reason:'Preserved profile associated with the browser-selected Discogs ID'})]);
   }
   if(legacy.event){const event=resolveEvent(tx,legacy.event,source,{venue:legacy.venue,location:legacy.location});add('eventIds',[event.id]);}
   if(claims.length)applyClaims(tx,claims);
   for(const candidate of legacy.candidates){
    const fields=typeof candidate.fields==='object'&&candidate.fields?candidate.fields as Record<string,unknown>:typeof candidate.field==='string'?{[candidate.field]:candidate.value}:{};
    for(const [field,rawValue]of Object.entries(fields)){
     if(!editableFields.mix.includes(field)&&field!=='sources')continue;
     const value=field==='sources'&&Array.isArray(rawValue)?rawValue.map(recordingRef):field==='recordedAt'&&typeof rawValue==='string'?{value:rawValue,precision:rawValue.length===4?'year':rawValue.length===7?'month':'day'}:rawValue;
     const validated=claimValue(tx.loadRecord(id)!,field,value),accepted=candidate.state==='accepted',rejected=candidate.state==='rejected'||candidate.resolved===true;
     const input=FieldClaimSchema.parse({targetRecordId:id,field,value:validated,provider:candidate.provider||'curator',sourceUrl:typeof candidate.sourceUrl==='string'?candidate.sourceUrl:source.url,observedAt:new Date().toISOString(),evidence:accepted?'curated':'parsed',match:accepted?'confirmed':'review',reason:'Preserved browser Review '+String(candidate.state||'pending'),confidence:typeof candidate.confidence==='number'?candidate.confidence:.5,state:rejected?'rejected':'pending'});
     if(rejected)tx.saveClaim(input);else applyClaims(tx,[input]);
     if(accepted||rejected){const claim=tx.saveClaim(input);tx.db.prepare('INSERT INTO review_decisions(claim_id,decision,actor,decided_at,record_revision) VALUES(?,?,?,?,?)').run(claim.id!,accepted?'migrated-accept':'migrated-reject',actor.sessionId,new Date().toISOString(),tx.loadRecord(id)!.revision);}
    }
   }
   if(legacy.waveform){if(!legacy.waveform.imageDataUrl.startsWith('data:image/png;base64,'))throw new Error('Legacy waveform is not PNG');persistWaveform(tx,id,Buffer.from(legacy.waveform.imageDataUrl.slice(22),'base64'),legacy.waveform.sourceUrl);}
   return {legacyId:legacy.id,status:imported.created?'imported' as const:'existing' as const,recordId:id};
  });outcomes.push(outcome);}catch(error){outcomes.push({legacyId,status:'error',message:error instanceof Error?error.message:'Migration failed'});}
 }
 const result=MigrationResultSchema.parse({batchId,outcomes});repo.db.prepare('INSERT INTO migration_batches(batch_id,result_json,input_hash) VALUES(?,?,?)').run(batchId,JSON.stringify(result),createHash('sha256').update(JSON.stringify(records)).digest('hex'));return result;
}
