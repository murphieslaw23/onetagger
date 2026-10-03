import test from 'node:test';
import assert from 'node:assert/strict';
import { openCatalog } from './repository.js';
import { artist,mix,claim,actor } from './test-fixtures.js';
const merging=await import('./merge.js').catch(()=>null);
const reviewing=await import('./review.js').catch(()=>null);
test('rejecting a claim survives reruns while stale acceptance is blocked',()=>{
 assert.ok(merging&&reviewing);const repo=openCatalog(':memory:');
 try{
  repo.saveRecord({...artist(),profile:'Selected'});
  merging.applyClaims(repo,[claim('artist','profile','Different')]);
  const pending=repo.listClaims('artist')[0],revision=repo.getRecord('artist')!.record.revision;
  assert.throws(()=>reviewing.decideReview(repo,pending.id!,'accept',revision-1,actor),/revision/i);
  reviewing.decideReview(repo,pending.id!,'reject',revision,actor);
  merging.applyClaims(repo,[claim('artist','profile','Different')]);
  assert.equal(repo.listClaims('artist').length,1);assert.equal(repo.listClaims('artist')[0].state,'rejected');
 }finally{repo.close();}
});
test('confirmed duplicate merge retains links, source evidence and legacy URLs',()=>{
 assert.ok(merging&&reviewing);const repo=openCatalog(':memory:');
 try{
  repo.saveRecord({...artist('one'),profile:'Selected'});
  repo.saveRecord({...artist('two'),country:'FR',sources:[{provider:'discogs',resourceType:'artist',externalId:'724857',url:'https://www.discogs.com/artist/724857'}]});
  repo.saveRecord({...mix('live'),artistIds:['two']});
  merging.applyClaims(repo,[claim('two','profile','Different')]);
  const result=reviewing.mergeRecords(repo,'one','two',[repo.getRecord('one')!.record.revision,repo.getRecord('two')!.record.revision],actor);
  assert.equal(repo.getRecord('two')!.record.id,'one');
  const live=repo.getRecord('live')!.record;assert.ok(live.category==='mix');assert.deepEqual(live.artistIds,['one']);
  assert.equal(result.record.sources[0].externalId,'724857');assert.ok(result.claims.some(c=>c.value==='Different'));
  assert.ok(result.record.category==='entity');assert.equal(result.record.country,'FR');assert.equal(result.record.profile,'Selected');
 }finally{repo.close();}
});
test('duplicate merge preserves resolved identity decisions and evidence for filled fields',()=>{
 assert.ok(merging&&reviewing);const repo=openCatalog(':memory:');
 try{
  repo.saveRecord(artist('one'));repo.saveRecord({...artist('two'),country:'FR'});
  merging.applyClaims(repo,[{...claim('two','possibleDuplicate',{recordId:'one'}),evidence:'parsed',match:'review'}]);
  const pending=repo.listClaims('two')[0];reviewing.decideReview(repo,pending.id!,'reject',repo.getRecord('two')!.record.revision,actor);
  const result=reviewing.mergeRecords(repo,'one','two',[repo.getRecord('one')!.record.revision,repo.getRecord('two')!.record.revision],actor);
  assert.ok(result.claims.some(c=>c.field==='possibleDuplicate'&&c.state==='rejected'));
  assert.ok(result.claims.some(c=>c.field==='country'&&c.value==='FR'&&c.state==='selected'));
  assert.ok(Number(repo.db.prepare('SELECT count(*) AS n FROM review_decisions').get()!.n)>=1);
  repo.saveRecord({...mix('later'),artistIds:['two']});
  const later=repo.getRecord('later')!.record;assert.ok(later.category==='mix');assert.deepEqual(later.artistIds,['one']);
 }finally{repo.close();}
});
test('accepting one value corroborates matching pending evidence and keeps different claims pending',()=>{
 assert.ok(merging&&reviewing);const repo=openCatalog(':memory:');
 try{
  repo.saveRecord({...artist(),profile:'Selected'});
  merging.applyClaims(repo,[claim('artist','profile','New'),{...claim('artist','profile','New'),provider:'archiveorg',sourceUrl:'https://archive.org/details/kan10'},{...claim('artist','profile','Different'),provider:'hearthis',sourceUrl:'https://hearthis.at/kan10/live'}]);
  const first=repo.listClaims('artist').find(c=>c.provider==='discogs')!;
  reviewing.decideReview(repo,first.id!,'accept',repo.getRecord('artist')!.record.revision,actor);
  assert.equal(repo.listClaims('artist').find(c=>c.provider==='archiveorg')!.state,'corroborated');
  assert.equal(repo.listClaims('artist').filter(c=>c.state==='pending').length,1);
 }finally{repo.close();}
});
