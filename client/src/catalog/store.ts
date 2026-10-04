import {shallowReactive} from 'vue';
import type {CatalogRecord,CatalogDetail,CatalogPage,IndexKind,PageQuery,EnrichmentReport,MigrationResult,ReviewItem} from '@syco23/mixsets-domain';
import {catalogApi} from './api';
import {migrateBrowserLibrary,type LocalStorageLike} from './migration';
import {fieldLabel} from './views';
export function enrichmentMessage(report:EnrichmentReport){return `Enrichment finished: ${report.applied.length?'added '+report.applied.map(fieldLabel).join(', '):'no new fields found'}${report.reviewed.length?' · '+report.reviewed.length+' claims sent to Review':''}${report.failures.length?' · '+[...new Set(report.failures.map(f=>f.provider))].join(', ')+' unavailable':''} · ${report.missing.length?report.missing.length+' fields still missing':'no missing fields'}`;}
export function createCatalogStore(api=catalogApi,storage?:LocalStorageLike){
 const state=shallowReactive({records:shallowReactive({} as Record<string,CatalogRecord>),details:shallowReactive({} as Record<string,CatalogDetail>),indexes:shallowReactive({} as Record<string,CatalogPage>),review:[] as ReviewItem[],authenticated:false,configured:true,requiresLogin:false,error:'',loading:false,migration:null as MigrationResult|null,reports:shallowReactive({} as Record<string,EnrichmentReport>)});
 async function perform<T>(operation:()=>Promise<T>):Promise<T>{try{const value=await operation();state.error='';return value;}catch(error){state.error=error instanceof Error?error.message:'Request failed';if((error as {status?:number}).status===401){state.authenticated=false;state.requiresLogin=true;}throw error;}}
 function rememberRecord(record:CatalogRecord){const current=state.records[record.id];if(!current||record.revision>=current.revision)state.records[record.id]=record;}
 function remember(detail:CatalogDetail){rememberRecord(detail.record);detail.related.forEach(rememberRecord);state.details[detail.record.id]=detail;return detail;}
 const store={state,
  async session(){const result=await perform(()=>api.session());state.authenticated=result.authenticated;state.configured=result.configured;return result;},
  async login(password:string){const result=await perform(()=>api.login(password));state.authenticated=result.authenticated;state.configured=result.configured;state.requiresLogin=false;return result;},
  async logout(){await perform(()=>api.logout());state.authenticated=false;state.review=[];state.details=shallowReactive({});state.records=shallowReactive({});state.indexes=shallowReactive({});},
  async loadIndex(kind:IndexKind,query:PageQuery={}){state.loading=true;try{const page=await perform(()=>api.index(kind,query));page.items.forEach(rememberRecord);page.related.forEach(rememberRecord);state.indexes[kind]=page;return page;}finally{state.loading=false;}},
  async loadDetail(id:string){const detail=remember(await perform(()=>api.detail(id)));if(id!==detail.record.id)state.details[id]=detail;return detail;},
  async importCandidate(candidate:Parameters<typeof api.import>[0]){const result=await perform(()=>api.import(candidate));remember(result.record);return result;},
  async enrichRecord(id:string){const result=await perform(()=>api.enrich(id));remember(result.record);state.reports[result.record.record.id]=result;if(state.authenticated)await store.loadReview();return result;},
  async updateRecord(id:string,fields:unknown,revision:number){return remember(await perform(()=>api.patch(id,fields,revision)));},
  async migrateLocalLibrary(){if(!storage)throw new Error('Browser migration is unavailable');state.migration=await perform(()=>migrateBrowserLibrary(storage,api.migrate));await store.loadIndex('mix');if(state.authenticated)await store.loadReview();return state.migration;},
  async loadReview(){state.review=await perform(()=>api.review());return state.review;},
  async decideReview(id:string,decision:'accept'|'reject',revision:number){const detail=remember(await perform(()=>api.decide(id,decision,revision)));await store.loadReview();return detail;},
  async mergeRecords(survivor:string,duplicate:string,revisions:[number,number]){const detail=remember(await perform(()=>api.merge(survivor,duplicate,revisions)));delete state.records[duplicate];state.details[duplicate]=detail;await store.loadReview();return detail;},
 };return store;
}
const shared=createCatalogStore(catalogApi,typeof window==='undefined'?undefined:window.localStorage);
export function useCatalogStore(){return shared;}
