import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {openCatalog} from './repository.js';import {mix} from './test-fixtures.js';
const module=await import('./media.js').catch(()=>null);
export const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0XcAAAAASUVORK5CYII=','base64');
test('validated waveform files and evidence survive reopening; invalid data cannot become an asset',()=>{
 assert.ok(module);const directory=mkdtempSync(join(tmpdir(),'mix-media-')),path=join(directory,'catalog.sqlite');let repo=openCatalog(path);repo.saveRecord(mix());
 try{assert.throws(()=>module.persistWaveform(repo,'mix',Buffer.from('not PNG'),'https://archive.freeteknomusic.org/mackitek/live.mp3'));assert.throws(()=>module.persistWaveform(repo,'mix',Buffer.alloc(1024*1024+1),'https://archive.freeteknomusic.org/mackitek/live.mp3'));
 const detail=module.persistWaveform(repo,'mix',png,'https://archive.freeteknomusic.org/mackitek/live.mp3');const record=detail.record;assert.equal(record.category,'mix');if(record.category!=='mix')return;const url=record.waveform!.url;assert.match(url,/^\/api\/catalog\/media\/[a-z0-9-]+$/);assert.deepEqual(readFileSync(module.waveformPath(repo,url.split('/').pop()!)),png);assert.throws(()=>module.waveformPath(repo,'../../escape'));
 repo.close();repo=openCatalog(path);assert.equal((repo.loadRecord('mix') as typeof record).waveform!.url,url);assert.equal(repo.listClaims('mix').find(c=>c.field==='waveform')!.state,'selected');}finally{repo.close();rmSync(directory,{recursive:true,force:true});}
});
