import test from 'node:test';
import assert from 'node:assert/strict';
import { openCatalog } from './repository.js';
import { artist,mix,actor } from './test-fixtures.js';
import { ProviderRegistry } from '../core/registry.js';
const module=await import('./enrich.js').catch(()=>null);
test('confirmed Discogs IDs enrich one shared entity and structured relationships; failures remain isolated',async()=>{
 assert.ok(module);const repo=openCatalog(':memory:'),registry=new ProviderRegistry();registry.discovery.clear();
 repo.saveRecord({...artist(),sources:[{provider:'discogs',resourceType:'artist',externalId:'724857',url:'https://www.discogs.com/artist/724857'}]});
 repo.saveRecord({...mix('one'),artistIds:['artist']});repo.saveRecord({...mix('two'),artistIds:['artist']});
 registry.discogs.hydrateEntity=async()=>({resource:{provider:'discogs',resourceType:'artist',externalId:'724857',url:'https://www.discogs.com/artist/724857'},name:'Kan10',facts:{profile:'Artist profile',realName:'Artist Name',aliases:['Kantix']},relationships:[{name:'Mackitek',externalId:'12',resourceType:'artist',relation:'member-of'}]});
 try{
  const report=await module.enrichCatalogRecord(repo,registry,'artist',actor);
  const entity=repo.loadRecord('artist')!;assert.equal(entity.category,'entity');if(entity.category!=='entity')return;
  assert.equal(entity.profile,'Artist profile');assert.equal(entity.realName,'Artist Name');assert.deepEqual(entity.aliases,['Kantix']);assert.equal(entity.relationships.length,1);
  assert.equal(repo.getRecord('one')!.related.find(r=>r.id==='artist')?.category,'entity');assert.equal(repo.getRecord('two')!.related.find(r=>r.id==='artist')?.id,'artist');
  assert.ok(report.applied.includes('profile'));assert.equal(repo.db.prepare("SELECT state FROM enrichment_runs").get()!.state,'complete');
 }finally{repo.close();}
});
test('known recording providers refresh missing covers and preserve selected data despite another provider failure',async()=>{
 assert.ok(module);const repo=openCatalog(':memory:'),registry=new ProviderRegistry();registry.discovery.clear();
 repo.saveRecord({...mix(),description:'Curated text',durationMs:3600000,sources:[{provider:'soundcloud',resourceType:'track',externalId:'1',url:'https://soundcloud.com/kan10/live'}]});
 registry.soundcloud.lookupArtwork=async()=> 'https://i1.sndcdn.com/artworks-proof-large.jpg';
 registry.discovery.set('youtube',{id:'youtube',health:async()=>({id:'youtube',state:'ready',detail:'test',checkedAt:new Date().toISOString()}),search:async()=>{throw new Error('Unavailable provider');}});
 try{const report=await module.enrichCatalogRecord(repo,registry,'mix',actor);const r=repo.loadRecord('mix')!;assert.equal(r.category,'mix');if(r.category!=='mix')return;assert.equal(r.artwork.length,1);assert.equal(r.description,'Curated text');assert.equal(report.failures.length,1);assert.ok(report.attempted.includes('soundcloud'));assert.ok(report.missing.includes('recordedAt'));}finally{repo.close();}
});
test('same-name Discogs search is a Review proposal and does not overwrite an established profile',async()=>{
 assert.ok(module);const repo=openCatalog(':memory:'),registry=new ProviderRegistry();registry.discovery.clear();repo.saveRecord({...artist(),profile:'Protected'});
 registry.discogs.enrichEntity=async()=>[{kind:'artist',name:'Kan10',provider:'discogs',externalId:'724857',url:'https://www.discogs.com/artist/724857',profile:'Different'}];
 registry.discogs.hydrateEntity=async()=>({resource:{provider:'discogs',resourceType:'artist',externalId:'724857',url:'https://www.discogs.com/artist/724857'},name:'Kan10',facts:{profile:'Different'},relationships:[]});
 try{const report=await module.enrichCatalogRecord(repo,registry,'artist',actor);assert.equal((repo.loadRecord('artist') as ReturnType<typeof artist>).profile,'Protected');assert.equal(repo.loadRecord('artist')!.sources.length,0);assert.ok(report.reviewed.includes('sources'));assert.ok(report.reviewed.includes('profile'));}finally{repo.close();}
});

test('event facts extracted from recording descriptions stay in Review; a label mention is not a mix link',async()=>{
 assert.ok(module);const repo=openCatalog(':memory:'),registry=new ProviderRegistry();registry.discovery.clear();
 repo.saveRecord({id:'event',category:'event',name:'Koalisson III',revision:1,verification:'curator-confirmed',reviewState:'ready',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),sources:[],organizerIds:[]});
 registry.discovery.set('youtube',{id:'youtube',health:async()=>({id:'youtube',state:'ready',detail:'test',checkedAt:new Date().toISOString()}),search:async()=>[{provider:'youtube',title:'Koalisson III',artists:[],crews:[],description:'Event date: 2011-05-21\nVenue: Warehouse\nLocation: Lyon\nLabel: Test Label',source:{provider:'youtube',url:'https://www.youtube.com/watch?v=vi5miMVpmuI'},confidence:.9,reasons:[],raw:{}}]});
 try{const report=await module.enrichCatalogRecord(repo,registry,'event',actor);assert.ok(report.reviewed.includes('date'));assert.ok(report.reviewed.includes('venue'));assert.ok(report.missing.includes('date'));assert.equal(repo.listIndex('label',{}).total,0);}finally{repo.close();}
});
