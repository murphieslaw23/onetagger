import {FieldClaimSchema,type CuratorActor} from '@syco23/mixsets-domain';
import {CatalogRepository,RevisionConflict} from './repository.js';
import type {ProviderRegistry} from '../core/registry.js';
import {recordingRef} from './identity.js';
import {applyClaims} from './merge.js';
export async function linkPublicCover(repo:CatalogRepository,registry:ProviderRegistry,id:string,provider:'soundcloud'|'youtube'|'hearthis',sourceUrl:string,revision:number,actor:CuratorActor){
 if(!actor.sessionId)throw new Error('Curator login required');const source=recordingRef({provider,url:sourceUrl}),resolver=provider==='youtube'?registry.youtube:provider==='hearthis'?registry.hearthis:registry.soundcloud;
 const url=await resolver.lookupArtwork(source.url);if(!url)throw new Error('This recording has no usable cover');
 return repo.transaction(tx=>{const record=tx.loadRecord(id);if(record?.category!=='mix')throw new Error('Mix not found');if(record.revision!==revision)throw new RevisionConflict();if(record.artwork.length)throw new Error('This mix already has selected cover artwork');
  const base={targetRecordId:record.id,provider:'curator',sourceUrl:source.url,resource:source,observedAt:new Date().toISOString(),evidence:'curated',match:'confirmed',confidence:1,state:'pending',reason:'Curator confirmed this public recording link and its previewed cover'};
  applyClaims(tx,[FieldClaimSchema.parse({...base,field:'sources',value:[source]}),FieldClaimSchema.parse({...base,field:'artwork',value:[{url,kind:'cover',source:provider,sourceUrl:source.url}]})]);return tx.getRecord(record.id)!;
 });
}
