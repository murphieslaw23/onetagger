import { randomUUID } from 'node:crypto';
import { FieldClaimSchema,EnrichmentReportSchema,normalizeName,type CatalogDetail,type FieldClaim,type ProviderId,type ProviderRef,type EnrichmentReport,type CuratorActor } from '@syco23/mixsets-domain';
import type { ProviderRegistry } from '../core/registry.js';
import { overlapScore } from '../core/utils.js';
import { probeAudioDuration } from '../core/waveform.js';
import { CatalogRepository } from './repository.js';
import { applyClaims } from './merge.js';
import { claimsFromProvider,ProviderMetadataSchema } from './provider-claims.js';
import { recordingRef,resolveEntity } from './identity.js';
import type { MixCandidate } from '../domain.js';

function sourced(detail:CatalogDetail,source:ProviderRef,field:string,value:unknown,confirmed=true,evidence:FieldClaim['evidence']='direct',reason='Matched provider recording identity'):FieldClaim{
 return FieldClaimSchema.parse({targetRecordId:detail.record.id,field,value,provider:source.provider,sourceUrl:source.url,resource:source,observedAt:new Date().toISOString(),evidence,match:confirmed?'confirmed':'review',reason,confidence:confirmed?.95:.6,state:'pending'});
}
export async function enrichCatalogRecord(repo:CatalogRepository,registry:ProviderRegistry,id:string,actor:CuratorActor):Promise<EnrichmentReport>{
 if(!actor.sessionId)throw new Error('Curator login required');
 const target=repo.getRecord(id);if(!target)throw new Error('Record not found');id=target.record.id;
 if(repo.db.prepare("SELECT id FROM enrichment_runs WHERE record_id=? AND state='running'").get(id))throw new Error('Enrichment is already running for this record');
 const runId=randomUUID();repo.db.prepare("INSERT INTO enrichment_runs(id,record_id,state,created_at) VALUES(?,?,'running',?)").run(runId,id,new Date().toISOString());
 const report:EnrichmentReport={record:target,applied:[],corroborated:[],reviewed:[],missing:target.missingFields,attempted:[],failures:[],runId,state:'complete'};
 const apply=(claims:FieldClaim[])=>{for(const claim of claims){try{const result=applyClaims(repo,[claim]);report.applied.push(...result.applied);report.corroborated.push(...result.corroborated);report.reviewed.push(...result.reviewed);}catch(error){report.failures.push({provider:claim.provider as ProviderId,message:error instanceof Error?error.message:'Invalid provider claim'});}}};
 const attempt=async(provider:ProviderId,work:()=>Promise<void>)=>{report.attempted.push(provider);try{await work();}catch(error){report.failures.push({provider,message:error instanceof Error?error.message:'Provider request failed'});}};
 try{
  if(target.record.category==='entity'){
   const entity=target.record,kind=entity.roles.includes('label')?'label':'artist';
   await attempt('discogs',async()=>{
    const known=entity.sources.find(source=>source.provider==='discogs'&&source.resourceType===kind&&source.externalId);
    const proposals=known?[{externalId:known.externalId!,name:entity.displayName}]:await registry.discogs.enrichEntity(entity.displayName,kind==='label'?'label':'artist');
    for(const proposal of proposals.slice(0,5)){
     if(!proposal.externalId)continue;
     const metadata=ProviderMetadataSchema.parse(await registry.discogs.hydrateEntity(proposal.externalId,kind));
     if(entity.roles.includes('crew')&&!entity.roles.includes('artist')&&metadata.facts.portrait){metadata.facts.crewLogo={...(metadata.facts.portrait as object),kind:'crew-logo'};delete metadata.facts.portrait;delete metadata.facts.realName;}
     apply(claimsFromProvider(repo.getRecord(id)!,metadata));
     if(known){
      const relationships=metadata.relationships.map(relationship=>{
       const source:ProviderRef={provider:'discogs',resourceType:relationship.resourceType,externalId:relationship.externalId,url:`https://www.discogs.com/${relationship.resourceType}/${relationship.externalId}`};
       const related=resolveEntity(repo,relationship.name,relationship.resourceType==='label'?'label':'artist',source);
       if(related.verification==='proposed')applyClaims(repo,[sourced(repo.getRecord(related.id)!,source,'verification','source-confirmed',true,'direct','Structured relationship establishes this provider entity ID')]);
       return {targetId:related.id,relation:relationship.relation};
      });
      if(relationships.length)apply([sourced(repo.getRecord(id)!,metadata.resource,'relationships',relationships,true,'direct','Structured Discogs membership, aliases or label hierarchy')]);
     }
    }
   });
  }else if(target.record.category==='mix'){
   const mix=target.record,artists=target.related.filter(r=>mix.artistIds.includes(r.id)&&r.category==='entity').map(r=>r.category==='entity'?r.displayName:''),crews=target.related.filter(r=>mix.crewIds.includes(r.id)&&r.category==='entity').map(r=>r.category==='entity'?r.displayName:'');
   // Direct lookups work even when provider-wide search has no credentials.
   for(const source of mix.sources.filter(source=>['soundcloud','youtube','hearthis'].includes(source.provider)))await attempt(source.provider as ProviderId,async()=>{
    const resolver=source.provider==='soundcloud'?registry.soundcloud:source.provider==='youtube'?registry.youtube:registry.hearthis;
    const artwork=await resolver.lookupArtwork(source.url);if(artwork)apply([sourced(target,source,'artwork',[{url:artwork,kind:'cover',source:source.provider,sourceUrl:source.url}])]);
   });
   if(!mix.durationMs&&mix.fileUrl)await attempt('freeteknomusic',async()=>{const duration=await probeAudioDuration(mix.fileUrl!);if(duration)apply([sourced(target,recordingRef({provider:'freeteknomusic',url:mix.fileUrl!}),'durationMs',duration)]);});
   const results=await Promise.all([...registry.discovery.entries()].map(async([name,provider])=>{
    const providerId=name as ProviderId;const candidates:MixCandidate[]=[];
    await attempt(providerId,async()=>{
     const known=mix.sources.find(s=>s.provider===providerId),health=await provider.health();
     if(health.state!=='ready'&&['soundcloud','youtube','hearthis'].includes(providerId))throw new Error(health.detail);
     if(health.state==='offline')throw new Error(health.detail);
     if(providerId==='freeteknomusic')return; // Direct audio facts are probed above; directory names cannot supply a cover.
     candidates.push(...await provider.search({q:[artists[0]||crews[0],mix.title].filter(Boolean).join(' '),...(known?{url:known.url}:{}),durationExpectedMs:mix.durationMs,minDurationMs:Math.max(0,(mix.durationMs||1800000)*.8),limit:8}));
    });return candidates;
   }));
   for(const candidate of results.flat().sort((a,b)=>b.confidence-a.confidence).slice(0,20)){
    const source=recordingRef(candidate.source),known=mix.sources.some(ref=>ref.provider===source.provider&&ref.resourceType===source.resourceType&&(ref.url===source.url||!!ref.externalId&&ref.externalId===source.externalId));
    const title=overlapScore(candidate.title,mix.title),artist=overlapScore(candidate.artists.join(' '),artists.join(' ')),duration=mix.durationMs&&candidate.durationMs?Math.abs(mix.durationMs-candidate.durationMs)/mix.durationMs:undefined;
    const proven=known||(candidate.confidence>=.7&&title>=.75&&duration!==undefined&&duration<=.08&&(artist>=.3||candidate.provider==='youtube'));
    if(!known&&(title<.5||candidate.confidence<.6||duration!==undefined&&duration>.15))continue;
    const claims:FieldClaim[]=[sourced(target,source,'sources',[source],proven)];
    for(const [field,value]of Object.entries({description:candidate.description,durationMs:candidate.durationMs,genres:candidate.genres,artwork:candidate.artwork?.map(url=>({url,kind:'cover',source:candidate.provider,sourceUrl:source.url}))}))if(value!==undefined&&value!==''&&!(Array.isArray(value)&&!value.length))claims.push(sourced(target,source,field,value,proven));
    if(candidate.recordedAt)claims.push(sourced(target,source,'recordedAt',{value:candidate.recordedAt,precision:candidate.recordedAt.length===4?'year':candidate.recordedAt.length===7?'month':'day'},false,'parsed','Provider recording-date statement requires verification'));
    const uploaded=candidate.raw?.created_at||((candidate.raw?.snippet as Record<string,unknown>|undefined)?.publishedAt);
    if(typeof uploaded==='string'&&/^\d{4}-\d{2}-\d{2}/.test(uploaded))claims.push(sourced(target,source,'uploadedAt',{value:uploaded.slice(0,10),precision:'day'},proven));
    for(const [field,pattern]of [['venue',/\bvenue\s*:\s*([^\n]+)/i],['location',/\blocation\s*:\s*([^\n]+)/i]] as const){const match=candidate.description?.match(pattern);if(match)claims.push({...sourced(target,source,field,match[1].trim(),false,'parsed','Explicit text statement requires confirmation'),excerpt:match[0]});}
    apply(claims);
   }
   // Hydrate the canonical linked entities; their data is shared by every mix.
   for(const entityId of [...new Set([...mix.artistIds,...mix.crewIds,...mix.labelIds])].slice(0,8)){
    try{const child=await enrichCatalogRecord(repo,registry,entityId,actor);report.attempted.push(...child.attempted);report.failures.push(...child.failures);report.applied.push(...child.applied.map(f=>'entity.'+f));report.reviewed.push(...child.reviewed.map(f=>'entity.'+f));}catch(error){report.failures.push({provider:'discogs',message:error instanceof Error?error.message:'Entity enrichment failed'});}
   }
  }
  else if(target.record.category==='event'){
   const event=target.record;
   for(const providerId of ['youtube','hearthis','archiveorg'] as const){const provider=registry.discovery.get(providerId);if(!provider)continue;
    await attempt(providerId,async()=>{
     const health=await provider.health();if(health.state!=='ready')throw new Error(health.detail);
     const candidates=await provider.search({q:event.name,limit:5});
     for(const candidate of candidates){if(overlapScore(candidate.title,event.name)<.5)continue;const source=recordingRef(candidate.source),text=candidate.description||'';
      for(const [field,pattern]of [['date',/\bevent date\s*:\s*(\d{4}-\d{2}-\d{2})/i],['venue',/\bvenue\s*:\s*([^\n]+)/i],['location',/\blocation\s*:\s*([^\n]+)/i],['country',/\bcountry\s*:\s*([A-Z]{2})\b/i],['flyer',/\bflyer\s*:\s*(https:\/\/[^\s]+)/i]] as const){const match=text.match(pattern);if(!match)continue;const value=field==='date'?{value:match[1],precision:'day'}:field==='flyer'?{url:match[1],kind:'flyer',source:providerId,sourceUrl:source.url}:match[1].trim();apply([{...sourced(target,source,field,value,false,'parsed','Event fact quoted from recording description; verify the event instance'),excerpt:match[0]}]);}
     }
    });
   }
  }
  report.record=repo.getRecord(id)!;report.missing=report.record.missingFields;for(const key of ['applied','corroborated','reviewed','attempted'] as const)report[key]=[...new Set(report[key])] as never;
  const validated=EnrichmentReportSchema.parse(report);repo.db.prepare("UPDATE enrichment_runs SET state='complete',completed_at=?,report_json=? WHERE id=?").run(new Date().toISOString(),JSON.stringify(validated),runId);return validated;
 }catch(error){repo.db.prepare("UPDATE enrichment_runs SET state='interrupted',completed_at=? WHERE id=?").run(new Date().toISOString(),runId);throw error;}
}
