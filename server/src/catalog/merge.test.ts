import test from 'node:test';
import assert from 'node:assert/strict';
import { openCatalog } from './repository.js';
import { artist,mix,claim } from './test-fixtures.js';
const module=await import('./merge.js').catch(()=>null);
test('enrichment fills missing fields and protects selected profiles, countries and artwork',()=>{
 assert.ok(module);const repo=openCatalog(':memory:');
 try{
  repo.saveRecord({...artist(),profile:'Curated profile',country:'FR'});
  repo.saveRecord({...mix(),artwork:[{url:'https://example.org/cover.jpg',kind:'cover'}]});
  module.applyClaims(repo,[claim('artist','profile','Other profile'),claim('artist','country','DE')]);
  module.applyClaims(repo,[claim('mix','artwork',[{url:'https://example.org/other.jpg',kind:'cover'}]),claim('mix','description','Sourced description')]);
  const a=repo.getRecord('artist')!.record;assert.ok(a.category==='entity');assert.equal(a.profile,'Curated profile');assert.equal(a.country,'FR');
  const m=repo.getRecord('mix')!.record;assert.ok(m.category==='mix');assert.equal(m.artwork[0].url,'https://example.org/cover.jpg');assert.equal(m.description,'Sourced description');
  assert.equal(repo.listClaims('artist').filter(c=>c.state==='pending').length,2);
 }finally{repo.close();}
});
test('equivalent normalized values corroborate and repeated evidence creates one claim',()=>{
 assert.ok(module);const repo=openCatalog(':memory:');
 try{
  repo.saveRecord({...artist(),profile:'French artist'});
  module.applyClaims(repo,[claim('artist','profile','  French artist  ')]);
  module.applyClaims(repo,[claim('artist','profile','French artist')]);
  assert.equal(repo.listClaims('artist').length,1);
  assert.equal(repo.listClaims('artist')[0].state,'corroborated');
 }finally{repo.close();}
});
test('parsed facts remain review proposals even when the canonical field is missing',()=>{
 assert.ok(module);const repo=openCatalog(':memory:');
 try{
  repo.saveRecord(mix());
  module.applyClaims(repo,[{...claim('mix','location','France'),evidence:'parsed',match:'review'}]);
  const record=repo.getRecord('mix')!.record;assert.ok(record.category==='mix');assert.equal(record.location,undefined);
  assert.equal(repo.listClaims('mix')[0].state,'pending');
 }finally{repo.close();}
});
