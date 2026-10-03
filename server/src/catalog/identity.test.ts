import test from 'node:test';
import assert from 'node:assert/strict';
import { openCatalog } from './repository.js';
import { artist,actor } from './test-fixtures.js';
const module=await import('./identity.js').catch(()=>null);
const candidate={provider:'freeteknomusic' as const,title:'Live',artists:['Kan10'],crews:[],source:{provider:'freeteknomusic' as const,url:'https://freeteknomusic.org/mp3/Kan10.mp3'},confidence:.8,reasons:[],raw:{}};
test('repeated imports return one mix and preserve canonical source identity',()=>{
 assert.ok(module);const repo=openCatalog(':memory:');
 try{
  const a=module.importCandidate(repo,candidate,actor),b=module.importCandidate(repo,candidate,actor);
  assert.equal(a.record.record.id,b.record.record.id);assert.equal(b.created,false);assert.equal(repo.listIndex('mix',{}).total,1);
 }finally{repo.close();}
});
test('equal names suggest duplicate entities without merging unrelated people',()=>{
 assert.ok(module);const repo=openCatalog(':memory:');
 try{
  repo.saveRecord(artist('existing'));
  const result=module.resolveEntity(repo,'Kan10','artist',{provider:'freeteknomusic',resourceType:'audio',url:candidate.source.url},false);
  assert.notEqual(result.id,'existing');assert.equal(result.verification,'proposed');
  assert.equal(repo.listIndex('artist',{}).total,1);
  assert.ok(repo.listClaims(result.id).some(c=>c.field==='possibleDuplicate'&&c.state==='pending'));
 }finally{repo.close();}
});
test('event names alone never collapse different dated or incomplete event instances',()=>{
 assert.ok(module);assert.equal(typeof module.resolveEvent,'function');const repo=openCatalog(':memory:');
 try{
  const source={provider:'web' as const,resourceType:'page' as const,url:'https://example.org/koalisson'};
  const a=module.resolveEvent(repo,'Koalisson',source,{date:{value:'2024',precision:'year'}},false);
  const b=module.resolveEvent(repo,'Koalisson',source,{date:{value:'2025',precision:'year'}},false);
  assert.notEqual(a.id,b.id);assert.equal(a.verification,'proposed');assert.equal(b.verification,'proposed');assert.equal(repo.listIndex('event',{}).total,0);
 }finally{repo.close();}
});
