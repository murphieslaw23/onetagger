import test from 'node:test';import assert from 'node:assert/strict';import {openCatalog} from './repository.js';import {actor} from './test-fixtures.js';
const module=await import('./migration.js').catch(()=>null);
const legacy={id:'legacy-real',title:'Live set',artists:['Kan10'],crews:[],durationMs:3600000,genres:[],styles:[],artwork:[{url:'https://i.ytimg.com/vi/vi5miMVpmuI/hqdefault.jpg',kind:'cover',source:'curator'}],sources:[{provider:'youtube',url:'https://www.youtube.com/watch?v=vi5miMVpmuI'}],candidates:[],provenance:[]};
test('migration preserves canonical originals across retries and skips demo/invalid records individually',()=>{
 assert.ok(module);const repo=openCatalog(':memory:');try{
 const first=module.migrateLegacyLibrary(repo,[legacy,{...legacy,id:'spiral-warehouse-2001'}, {...legacy,id:'broken',durationMs:-1}], 'batch-1',actor);
 assert.deepEqual(first.outcomes.map(o=>o.status),['imported','skipped','error']);const id=first.outcomes[0].recordId!;assert.equal(repo.getRecord('legacy-real')!.record.id,id);
 const repeated=module.migrateLegacyLibrary(repo,[legacy],'batch-1',actor);assert.deepEqual(repeated,first);
 const other=module.migrateLegacyLibrary(repo,[{...legacy,id:'second-browser'}],'batch-2',actor);assert.equal(other.outcomes[0].status,'existing');assert.equal(other.outcomes[0].recordId,id);assert.equal(repo.listIndex('mix',{}).total,1);assert.ok(repo.listClaims(id).some(c=>c.field==='artwork'&&c.evidence==='curated'));
 const collision=module.migrateLegacyLibrary(repo,[{...legacy,title:'Different',sources:[{provider:'youtube',url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'}]}],'batch-3',actor);assert.equal(collision.outcomes[0].status,'error');assert.equal(repo.listIndex('mix',{}).total,1);
 }finally{repo.close();}
});
test('manual browser waveforms and covers survive disk migration; a later cover becomes Review',async()=>{
 assert.ok(module);const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const dir=mkdtempSync(join(tmpdir(),'migrate-wave-'));let repo=openCatalog(join(dir,'catalog.sqlite'));
 try{const waveform={imageDataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0XcAAAAASUVORK5CYII=',analyzedAt:new Date().toISOString(),sourceUrl:'https://archive.freeteknomusic.org/mackitek/live.mp3'};
 const result=module.migrateLegacyLibrary(repo,[{...legacy,waveform}],'wave-batch',actor);assert.equal(result.outcomes[0].status,'imported');const id=result.outcomes[0].recordId!;repo.close();repo=openCatalog(join(dir,'catalog.sqlite'));const record=repo.loadRecord(id)!;assert.equal(record.category,'mix');if(record.category!=='mix')return;assert.match(record.waveform!.url,/\/api\/catalog\/media\//);
 module.migrateLegacyLibrary(repo,[{...legacy,id:'other-browser',artwork:[{url:'https://example.org/different.jpg',kind:'cover',source:'curator'}]}],'other-wave-batch',actor);assert.equal((repo.loadRecord(id) as typeof record).artwork[0].url,legacy.artwork[0].url);assert.ok(repo.listClaims(id).some(c=>c.field==='artwork'&&c.state==='pending'));
 }finally{repo.close();rmSync(dir,{recursive:true,force:true});}
});

test('legacy accepted and rejected review values keep their decisions',()=>{
 assert.ok(module);const repo=openCatalog(':memory:');try{const migrated=module.migrateLegacyLibrary(repo,[{...legacy,candidates:[{id:'accepted',provider:'youtube',fields:{description:'Curated accepted description'},state:'accepted',confidence:.9,reasons:['Curator review']},{id:'rejected',provider:'youtube',fields:{description:'Rejected description'},state:'rejected',confidence:.8,reasons:['Curator review']}]}],'decisions',actor);const id=migrated.outcomes[0].recordId!;assert.ok(repo.listClaims(id).some(c=>c.field==='description'&&c.value==='Rejected description'&&c.state==='rejected'));assert.equal((repo.loadRecord(id) as {description?:string}).description,'Curated accepted description');assert.equal(repo.db.prepare("SELECT COUNT(*) n FROM review_decisions WHERE decision LIKE 'migrated-%'").get()!.n,2);}finally{repo.close();}
});
