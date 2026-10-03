import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {openCatalog} from './repository.js';import {artist,mix,claim,actor} from './test-fixtures.js';import {applyClaims} from './merge.js';import {decideReview} from './review.js';
const module=await import('./backup.js').catch(()=>null);
test('online backup and stopped-target restore retain links and review decisions',async()=>{
 assert.ok(module);const directory=mkdtempSync(join(tmpdir(),'mix-backup-')),repo=openCatalog(join(directory,'live.sqlite'));
 try{repo.saveRecord({...artist(),profile:'Selected'});repo.saveRecord({...mix(),artistIds:['artist']});applyClaims(repo,[claim('artist','profile','Conflicting')]);const pending=repo.listClaims('artist')[0];decideReview(repo,pending.id!,'reject',repo.loadRecord('artist')!.revision,actor);
 await module.backupCatalog(repo,join(directory,'backup.sqlite'));await module.restoreCatalog(join(directory,'backup.sqlite'),join(directory,'restored.sqlite'));const restored=openCatalog(join(directory,'restored.sqlite'));try{assert.equal(restored.getRecord('mix')!.related[0].id,'artist');assert.equal(restored.listClaims('artist')[0].state,'rejected');assert.equal(restored.db.prepare('SELECT COUNT(*) AS n FROM review_decisions').get()!.n,1);}finally{restored.close();}
 }finally{repo.close();rmSync(directory,{recursive:true,force:true});}
});
