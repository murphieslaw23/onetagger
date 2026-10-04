import {computed,reactive} from 'vue';
import {providerHealth} from '../domain/fixtures';
import {missingFields,completeness,type CatalogDetail} from '@syco23/mixsets-domain';
import {useCatalogStore} from '../catalog/store';
import {toMixView} from '../catalog/views';
import {request} from '../catalog/api';
import {CatalogDetailSchema} from '@syco23/mixsets-domain';
import type {ImportJob,MixCandidate,MixSet,ProviderId} from '../domain/types';
import type {ApiDiscoveryJob,ApiMixCandidate,ApiProviderHealth} from '../services/api';
const catalog=useCatalogStore();
function detailFor(id:string):CatalogDetail|undefined{
 const cached=catalog.state.details[id],record=cached?catalog.state.records[cached.record.id]||cached.record:catalog.state.records[id];if(!record)return;
 return {record,related:Object.values(catalog.state.records).filter(r=>r.id!==record.id),claims:cached?.claims||[],missingFields:cached&&record.revision===cached.record.revision?cached.missingFields:missingFields(record),completeness:cached&&record.revision===cached.record.revision?cached.completeness:completeness(record)};
}
function findMix(id:string){const detail=detailFor(id);return detail?.record.category==='mix'?toMixView(detail):undefined;}
const state=reactive({
 get mixes(){return (catalog.state.indexes.mix?.items||[]).map(r=>findMix(r.id)).filter((r):r is NonNullable<typeof r>=>!!r);},
 jobs:[] as ImportJob[],providers:structuredClone(providerHealth),apiState:'checking' as 'checking'|'online'|'offline',query:'',source:'all' as ProviderId|'all',status:'all',selected:new Set<string>(),
});
function jobView(job:ApiDiscoveryJob):ImportJob{return {id:job.id,provider:job.provider,label:String(job.query?.url||job.query?.q||job.query?.artist||'Discovery'),query:job.query||{},state:job.state,progress:job.progress,scanned:job.scanned,found:job.found,createdAt:job.createdAt||new Date().toISOString(),error:job.error};}
export function useMixStore(){
 const filtered=computed(()=>state.mixes.filter(mix=>(state.source==='all'||mix.sources.some(s=>s.provider===state.source))&&(state.status==='all'||mix.status===state.status)));
 const reviewCount=computed(()=>catalog.state.review.length),runningJobs=computed(()=>state.jobs.filter(j=>['running','queued'].includes(j.state)).length);
 const findMixBySource=(url:string)=>Object.values(catalog.state.records).filter(r=>r.category==='mix').map(r=>findMix(r.id)!).find(m=>m.sources.some(s=>s.url===url));
 const findCandidateMatch=(candidate:ApiMixCandidate)=>findMixBySource(candidate.source.url)||Object.values(catalog.state.records).filter(r=>r.category==='mix').map(r=>findMix(r.id)!).find(m=>m.sources.some(s=>s.provider===candidate.source.provider&&candidate.source.externalId&&s.externalId===candidate.source.externalId));
 async function addDiscoveredCandidate(candidate:ApiMixCandidate){const result=await catalog.importCandidate(candidate);await catalog.loadIndex('mix');return findMix(result.record.record.id)!;}
 async function enrichMixRecord(mix:MixSet){const report=await catalog.enrichRecord(mix.id);return {filledFields:report.applied,reviewCandidatesAdded:report.reviewed.length,attempted:report.attempted,failures:report.failures,remainingMissing:report.missing,report};}
 async function useLinkedCover(mix:MixSet,provider:ProviderId,sourceUrl:string,_artworkUrl:string){const detail=await request('/catalog/records/'+encodeURIComponent(mix.id)+'/cover',CatalogDetailSchema,{method:'POST',body:JSON.stringify({provider,sourceUrl,revision:findMix(mix.id)!.revision})});await catalog.loadDetail(detail.record.id);}
 return {state,filtered,reviewCount,runningJobs,findMix,findMixBySource,findCandidateMatch,addDiscoveredCandidate,enrichMixRecord,useLinkedCover,
  applyCandidate:(mix:MixSet,candidate:MixCandidate)=>catalog.decideReview(candidate.id,'accept',findMix(mix.id)!.revision),rejectCandidate:(candidate:MixCandidate,mix?:MixSet)=>catalog.decideReview(candidate.id,'reject',findMix(mix!.id)!.revision),markReviewed:(_mix:MixSet)=>false,
  syncApiJobs:(jobs:ApiDiscoveryJob[])=>{state.jobs=jobs.map(jobView);},upsertApiJob:(job:ApiDiscoveryJob)=>{const index=state.jobs.findIndex(j=>j.id===job.id);if(index<0)state.jobs.unshift(jobView(job));else state.jobs[index]=jobView(job);},
  updateProviderHealth:(health:ApiProviderHealth[])=>{for(const item of health){const provider=state.providers.find(p=>p.id===item.id);if(provider)Object.assign(provider,{state:item.state,detail:item.detail,lastCheck:item.checkedAt});}},setApiState:(value:typeof state.apiState)=>{state.apiState=value;},toggleSelected:(id:string)=>{state.selected.has(id)?state.selected.delete(id):state.selected.add(id);},clearSelection:()=>state.selected.clear(),
 };
}
