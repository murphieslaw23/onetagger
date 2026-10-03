import { CatalogRecordSchema, FieldClaimSchema, editableFields, isMissing, normalizedSet, type CatalogDetail, type CatalogRecord, type CuratorActor, type ReviewItem } from '@syco23/mixsets-domain';
import { CatalogRepository, RevisionConflict } from './repository.js';
import { claimValue, pendingReviewCount, valueKey } from './merge.js';

export function listReview(repo:CatalogRepository):ReviewItem[]{
 return (repo.db.prepare("SELECT id FROM field_claims WHERE disposition='pending' ORDER BY observed_at,id").all() as {id:string}[]).map(({id})=>{
  const candidate=repo.getClaim(id)!,record=repo.loadRecord(candidate.targetRecordId)!;
  return {id,recordId:record.id,field:candidate.field,current:(record as unknown as Record<string,unknown>)[candidate.field] as ReviewItem['current'],candidate,recordRevision:record.revision,createdAt:candidate.observedAt};
 });
}
export function decideReview(repo:CatalogRepository,id:string,decision:'accept'|'reject',expectedRevision:number,actor:CuratorActor):CatalogDetail{
 return repo.transaction(tx=>{
  const claim=tx.getClaim(id);if(!claim||claim.state!=='pending')throw new Error('Review item is no longer pending');
  let record=tx.loadRecord(claim.targetRecordId)!;if(record.revision!==expectedRevision)throw new RevisionConflict();
  if(decision==='accept'){
   if(claim.field==='possibleDuplicate')throw new Error('Use the duplicate merge preview to confirm both records');
   const value=claimValue(record,claim.field,claim.value);
   record=CatalogRecordSchema.parse({...record,[claim.field]:value,verification:claim.field==='verification'?'curator-confirmed':record.verification});
   tx.setClaimState(id,'selected');tx.selectEvidence(record.id,claim.field,id);
   for(const other of tx.listClaims(record.id))if(other.id!==id&&other.state==='pending'&&other.field===claim.field&&valueKey(other.value)===valueKey(value))tx.setClaimState(other.id!,'corroborated');
  }else tx.setClaimState(id,'rejected');
  tx.db.prepare('INSERT INTO review_decisions(claim_id,decision,actor,decided_at,record_revision) VALUES(?,?,?,?,?)').run(id,decision,actor.sessionId,new Date().toISOString(),expectedRevision);
  record=tx.saveRecord({...record,revision:record.revision+1,reviewState:pendingReviewCount(tx,record.id)?'review':'ready',updatedAt:new Date().toISOString()},expectedRevision);
  return tx.getRecord(record.id)!;
 });
}
function rewritten(record:CatalogRecord,oldId:string,newId:string):CatalogRecord{
 const value={...record} as unknown as Record<string,unknown>;
 for(const key of ['artistIds','crewIds','labelIds','eventIds','organizerIds'])if(Array.isArray(value[key]))value[key]=[...new Set((value[key] as string[]).map(id=>id===oldId?newId:id))];
 if(record.category==='entity')value.relationships=record.relationships.map(r=>({...r,targetId:r.targetId===oldId?newId:r.targetId})).filter(r=>r.targetId!==record.id);
 return CatalogRecordSchema.parse(value);
}
export function mergeRecords(repo:CatalogRepository,survivorId:string,duplicateId:string,expectedRevisions:[number,number],actor:CuratorActor):CatalogDetail{
 return repo.transaction(tx=>{
  const survivor=tx.loadRecord(survivorId),duplicate=tx.loadRecord(duplicateId);
  if(!survivor||!duplicate||survivor.id===duplicate.id||survivor.category!==duplicate.category)throw new Error('Merge requires two distinct records of the same category');
  if(survivor.revision!==expectedRevisions[0]||duplicate.revision!==expectedRevisions[1])throw new RevisionConflict();
  let merged={...survivor,sources:[...survivor.sources,...duplicate.sources],verification:'curator-confirmed',revision:survivor.revision+1,updatedAt:new Date().toISOString()} as CatalogRecord;
  if(merged.category==='entity'&&duplicate.category==='entity')merged={...merged,roles:[...new Set([...merged.roles,...duplicate.roles])],aliases:normalizedSet([...merged.aliases,...duplicate.aliases,...(merged.displayName!==duplicate.displayName?[duplicate.displayName]:[])])};
  const conflicting:string[]=[],filled:string[]=[];
  for(const field of editableFields[survivor.category]){
   if(['roles','aliases'].includes(field))continue;
   const current=(merged as unknown as Record<string,unknown>)[field],proposed=(duplicate as unknown as Record<string,unknown>)[field];
   if(isMissing(current)&&!isMissing(proposed)){(merged as unknown as Record<string,unknown>)[field]=proposed;filled.push(field);}
   else if(!isMissing(proposed)&&valueKey(current)!==valueKey(proposed))conflicting.push(field);
  }
  merged=rewritten(CatalogRecordSchema.parse(merged),duplicate.id,survivor.id);
  // Move ownership before saving combined sources/media; rollback retains the old owners on any failure.
  tx.db.prepare('DELETE FROM provider_sources WHERE record_id=?').run(duplicate.id);
  tx.db.prepare('DELETE FROM provider_identities WHERE record_id=?').run(duplicate.id);
  tx.db.prepare('DELETE FROM media_assets WHERE record_id=?').run(duplicate.id);
  tx.saveRecord(merged,survivor.revision);
  const oldClaims=tx.listClaims(duplicate.id);
  for(const old of oldClaims){
   const value=old.value;
   const resolved=old.field==='possibleDuplicate'&&[survivor.id,duplicate.id].includes(String((value as {recordId?:string}).recordId));
   const copied=tx.saveClaim(FieldClaimSchema.parse({...old,id:undefined,targetRecordId:survivor.id,value,state:resolved?'rejected':conflicting.includes(old.field)&&old.state==='selected'?'pending':old.state,recordRevision:merged.revision}));
   tx.db.prepare('UPDATE review_decisions SET claim_id=? WHERE claim_id=?').run(copied.id!,old.id!);
   if(old.state==='selected'&&!conflicting.includes(old.field)&&valueKey((merged as unknown as Record<string,unknown>)[old.field])===valueKey(value))tx.selectEvidence(survivor.id,old.field,copied.id!);
  }
  for(const field of filled){
   const selected=tx.saveClaim(FieldClaimSchema.parse({targetRecordId:survivor.id,field,value:(merged as unknown as Record<string,unknown>)[field],provider:'curator',sourceUrl:duplicate.sources[0]?.url||'https://mixsets.syco23.org/entity/'+duplicate.id,observedAt:new Date().toISOString(),evidence:'curated',match:'confirmed',reason:'Curator retained a missing field from the confirmed duplicate',confidence:1,state:'selected',recordRevision:merged.revision}));
   tx.selectEvidence(survivor.id,field,selected.id!);
  }
  for(const field of conflicting){
   const value=(duplicate as unknown as Record<string,unknown>)[field];
   tx.saveClaim(FieldClaimSchema.parse({targetRecordId:survivor.id,field,value,provider:'curator',sourceUrl:duplicate.sources[0]?.url||'https://mixsets.syco23.org/mix/'+duplicate.id,observedAt:new Date().toISOString(),evidence:'curated',match:'review',reason:'Conflicting value retained from curator-confirmed duplicate merge',confidence:1,state:'pending',recordRevision:merged.revision}));
  }
  // A merged duplicate proposal is resolved explicitly; retain its evidence and decision.
  for(const claim of tx.listClaims(survivor.id))if(claim.field==='possibleDuplicate'&&[survivor.id,duplicate.id].includes(String((claim.value as {recordId?:string}).recordId))){
   tx.setClaimState(claim.id!,'rejected');
   tx.db.prepare('INSERT INTO review_decisions(claim_id,decision,actor,decided_at,record_revision) VALUES(?,?,?,?,?)').run(claim.id!,'merged',actor.sessionId,new Date().toISOString(),merged.revision);
  }
  const incoming=tx.db.prepare('SELECT id FROM catalog_records WHERE id NOT IN (?,?)').all(survivor.id,duplicate.id) as {id:string}[];
  for(const {id} of incoming){
   const original=tx.loadRecord(id)!,updated=rewritten(original,duplicate.id,survivor.id);
   if(valueKey(original)!==valueKey(updated))tx.saveRecord({...updated,revision:original.revision+1,updatedAt:new Date().toISOString()},original.revision);
  }
  tx.db.prepare('UPDATE legacy_aliases SET record_id=? WHERE record_id=?').run(survivor.id,duplicate.id);
  tx.db.prepare('DELETE FROM selected_evidence WHERE record_id=?').run(duplicate.id);
  tx.db.prepare('DELETE FROM review_decisions WHERE claim_id IN (SELECT id FROM field_claims WHERE record_id=?)').run(duplicate.id);
  tx.db.prepare('UPDATE enrichment_runs SET record_id=? WHERE record_id=?').run(survivor.id,duplicate.id);
  tx.db.prepare('DELETE FROM catalog_records WHERE id=?').run(duplicate.id);
  tx.putAlias(duplicate.id,survivor.id);
  const record=tx.loadRecord(survivor.id)!;
  tx.saveRecord({...record,reviewState:pendingReviewCount(tx,survivor.id)?'review':'ready'},record.revision);
  return tx.getRecord(survivor.id)!;
 });
}
