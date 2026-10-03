import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EntityRecordSchema, MixRecordSchema } from '@syco23/mixsets-domain';
const module = await import('./repository.js').catch(()=>null);
const stamp='2026-10-03T10:00:00.000Z';
const base={revision:1,verification:'source-confirmed',reviewState:'ready',createdAt:stamp,updatedAt:stamp,sources:[]};
function entity(id:string,roles:string[]=['artist'], verification='source-confirmed'){return EntityRecordSchema.parse({...base,id,category:'entity',displayName:'Kan10',roles,aliases:[],websites:[],relationships:[],verification});}
function mix(id:string,artistIds:string[]=[]){return MixRecordSchema.parse({...base,id,category:'mix',title:'Koalisson III',artistIds,crewIds:[],labelIds:[],eventIds:[],genres:[],styles:[],artwork:[]});}
test('catalog data, source identity and selected evidence survive reopen',()=>{
 assert.ok(module);
 const dir=mkdtempSync(join(tmpdir(),'mixsets-catalog-')); const path=join(dir,'catalog.sqlite');
 let repo=module.openCatalog(path);
 try {
  repo.transaction(tx=>{
   tx.saveRecord({...entity('kan10'),profile:'French artist'});
   tx.saveRecord({...mix('mix-1',['kan10']),sources:[{provider:'freeteknomusic',resourceType:'audio',url:'https://freeteknomusic.org/mp3/Kan10.mp3'}]});
   const claim=tx.saveClaim({targetRecordId:'kan10',field:'profile',value:'French artist',provider:'discogs',sourceUrl:'https://www.discogs.com/artist/724857',observedAt:stamp,evidence:'direct',match:'confirmed',reason:'Confirmed entity',confidence:1,state:'selected'});
   tx.selectEvidence('kan10','profile',claim.id!);
  });
  repo.close();repo=module.openCatalog(path);
  assert.deepEqual(repo.getRecord('mix-1')?.related.map(r=>r.id),['kan10']);
  assert.equal(repo.getRecord('kan10')?.claims[0].value,'French artist');
  assert.equal(repo.findBySource({provider:'freeteknomusic',resourceType:'audio',url:'https://freeteknomusic.org/mp3/Kan10.mp3'}),'mix-1');
 } finally {repo.close();rmSync(dir,{recursive:true,force:true});}
});
test('external identity uniqueness is scoped to provider and resource type',()=>{
 assert.ok(module);const repo=module.openCatalog(':memory:');
 try {
  repo.transaction(tx=>{
   tx.saveRecord({...entity('artist'),sources:[{provider:'discogs',resourceType:'artist',externalId:'123',url:'https://www.discogs.com/artist/123'}]});
   tx.saveRecord({...entity('label',['label']),sources:[{provider:'discogs',resourceType:'label',externalId:'123',url:'https://www.discogs.com/label/123'}]});
   tx.saveRecord({...mix('hearthis'),sources:[{provider:'hearthis',resourceType:'track',externalId:'123',url:'https://hearthis.at/artist/live'}]});
  });
  assert.throws(()=>repo.transaction(tx=>tx.saveRecord({...entity('duplicate'),sources:[{provider:'discogs',resourceType:'artist',externalId:'123',url:'https://www.discogs.com/artist/123'}]})));
  assert.equal(repo.getRecord('duplicate'),undefined);
  assert.equal(repo.listIndex('label',{}).total,1);
 }finally{repo.close();}
});
test('dangling or incorrectly typed links are rejected transactionally',()=>{
 assert.ok(module);const repo=module.openCatalog(':memory:');
 try{
  repo.transaction(tx=>tx.saveRecord(entity('label',['label'])));
  assert.throws(()=>repo.transaction(tx=>tx.saveRecord(mix('bad',['missing']))));
  assert.throws(()=>repo.transaction(tx=>tx.saveRecord(mix('bad',['label']))));
  assert.equal(repo.getRecord('bad'),undefined);
 }finally{repo.close();}
});
test('proposed entities are available for review but excluded from public indexes',()=>{
 assert.ok(module);const repo=module.openCatalog(':memory:');
 try{
  repo.transaction(tx=>{tx.saveRecord(entity('confirmed'));tx.saveRecord(entity('guess',['artist'],'proposed'));});
  assert.equal(repo.listIndex('artist',{}).total,1);
  assert.equal(repo.listIndex('artist',{includeProposed:true}).total,2);
  assert.equal(repo.findNameCandidates('artist','KAN10').length,2);
 }finally{repo.close();}
});
test('record revisions reject stale writes instead of replacing selected metadata',()=>{
 assert.ok(module);const repo=module.openCatalog(':memory:');
 try{
  repo.transaction(tx=>tx.saveRecord(entity('artist')));
  repo.transaction(tx=>tx.saveRecord({...entity('artist'),profile:'Curated',revision:2},1));
  assert.throws(()=>repo.transaction(tx=>tx.saveRecord({...entity('artist'),profile:'Stale',revision:2},1)),/revision/i);
  const record=repo.getRecord('artist')!.record;assert.ok(record.category==='entity');assert.equal(record.profile,'Curated');
 }finally{repo.close();}
});
test('a duplicate URL cannot hide an external identity owned by another record',()=>{
 assert.ok(module);const repo=module.openCatalog(':memory:');
 try {
  const own={provider:'hearthis' as const,resourceType:'track' as const,externalId:'1',url:'https://hearthis.at/artist/live'};
  repo.transaction(tx=>{tx.saveRecord({...mix('one'),sources:[own]});tx.saveRecord({...mix('two'),sources:[{...own,externalId:'2',url:'https://hearthis.at/artist/other'}]});});
  assert.throws(()=>repo.transaction(tx=>tx.saveRecord({...mix('one'),sources:[own,{...own,externalId:'2'}]})),/identity/i);
  assert.equal(repo.findByProvider({...own,externalId:'2',url:'https://hearthis.at/artist/other'}),'two');
 } finally {repo.close();}
});
test('removing a role required by an existing mix is rejected',()=>{
 assert.ok(module);const repo=module.openCatalog(':memory:');
 try{
  repo.transaction(tx=>{tx.saveRecord(entity('artist'));tx.saveRecord(mix('live',['artist']));});
  assert.throws(()=>repo.transaction(tx=>tx.saveRecord(entity('artist',['crew']))),/role/i);
  assert.equal(repo.listIndex('artist',{}).total,1);
 }finally{repo.close();}
});
test('one external identity retains multiple legitimate source URL aliases',()=>{
 assert.ok(module);const repo=module.openCatalog(':memory:');
 try{
  const ref={provider:'hearthis' as const,resourceType:'track' as const,externalId:'123',url:'https://hearthis.at/artist/live'};
  repo.transaction(tx=>tx.saveRecord({...mix('live'),sources:[ref,{...ref,url:'https://hearthis.at/artist/renamed-live'}]}));
  assert.equal(repo.getRecord('live')!.record.sources.length,2);
  assert.equal(repo.findBySource({...ref,url:'https://hearthis.at/artist/renamed-live'}),'live');
 }finally{repo.close();}
});
