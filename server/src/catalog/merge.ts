import {
 CatalogRecordSchema, FieldClaimSchema, ProviderRefSchema, isMissing, validateField, normalizeName, normalizedSet, normalizeProviderRef,
 type CatalogRecord, type EnrichmentReport, type FieldClaim,
} from '@syco23/mixsets-domain';
import { CatalogRepository } from './repository.js';

export function valueKey(value:unknown):string {
 if(typeof value==='string')return normalizeName(value);
 if(Array.isArray(value))return JSON.stringify(value.map(valueKey).sort());
 if(value&&typeof value==='object')return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,valueKey(value)])));
 return JSON.stringify(value);
}
export function claimValue(record:CatalogRecord,field:string,value:unknown):unknown{
 if(field==='sources')return ProviderRefSchema.array().max(100).parse(value).map(normalizeProviderRef);
 if(field==='verification'){
  if(!['proposed','source-confirmed','curator-confirmed'].includes(String(value)))throw new Error('Invalid identity verification');
  return value;
 }
 if(field==='possibleDuplicate'){
  if(!value||typeof value!=='object'||typeof (value as {recordId?:unknown}).recordId!=='string')throw new Error('Invalid duplicate proposal');
  return value;
 }
 return validateField(record,field,value);
}
export function pendingReviewCount(repo:CatalogRepository,id:string):number{return repo.listClaims(id).filter(c=>c.state==='pending').length;}
export function applyClaims(repo:CatalogRepository,inputs:FieldClaim[]):EnrichmentReport{
 if(!inputs.length)throw new Error('An enrichment target is required');
 const applied:string[]=[],corroborated:string[]=[],reviewed:string[]=[];
 for(const input of inputs)repo.transaction(tx=>{
  let record=tx.loadRecord(input.targetRecordId);if(!record)throw new Error('Enrichment target not found');
  const value=claimValue(record,input.field,input.value);
  let claim=FieldClaimSchema.parse({...input,value,recordRevision:record.revision});
  const current=(record as unknown as Record<string,unknown>)[claim.field];
  const equal=claim.field!=='possibleDuplicate'&&valueKey(current)===valueKey(value);
  const permitted=claim.match==='confirmed'&&claim.evidence!=='parsed'&&(record.verification!=='proposed'||claim.evidence==='curated'||claim.field==='verification');
  const additive=claim.field==='sources'||claim.field==='aliases';
  const disposition:FieldClaim['state']=equal?'corroborated':permitted&&(isMissing(current)||additive)?'selected':'pending';
  claim=tx.saveClaim({...claim,state:disposition});
  // Persisted rejection/selection wins over a repeated provider observation.
  if(claim.state==='pending'&&disposition==='selected'){tx.db.prepare("UPDATE field_claims SET disposition='selected',match_state='confirmed',reason=?,record_revision=? WHERE id=?").run(input.reason,record.revision,claim.id!);claim=tx.getClaim(claim.id!)!;}
  if(claim.state!==disposition)return;
  if(claim.state==='corroborated'){corroborated.push(claim.field);return;}
  if(claim.state==='selected'){
   let selected=value;
   if(additive&&Array.isArray(current)&&Array.isArray(value))selected=claim.field==='aliases'?normalizedSet([...current,...value] as string[]):[...current,...value];
   record=CatalogRecordSchema.parse({...record,[claim.field]:selected,reviewState:pendingReviewCount(tx,record.id)?'review':'ready',revision:record.revision+1,updatedAt:new Date().toISOString()});
   record=tx.saveRecord(record,record.revision-1);
   tx.selectEvidence(record.id,claim.field,claim.id!);
   applied.push(claim.field);
  }else{
   reviewed.push(claim.field);
   if(record.reviewState!=='review')tx.saveRecord({...record,reviewState:'review',revision:record.revision+1,updatedAt:new Date().toISOString()},record.revision);
  }
 });
 const record=repo.getRecord(inputs[0].targetRecordId)!;
 return {record,applied:[...new Set(applied)],corroborated:[...new Set(corroborated)],reviewed:[...new Set(reviewed)],missing:record.missingFields,attempted:[],failures:[],state:'complete'};
}
