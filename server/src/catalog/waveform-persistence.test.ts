import test from 'node:test';import assert from 'node:assert/strict';import {openCatalog} from './repository.js';import {WaveformQueue} from '../core/waveform.js';import {mix} from './test-fixtures.js';
test('interrupted audio analysis remains visible and retryable after worker restart',()=>{
 const repo=openCatalog(':memory:');try{repo.saveRecord(mix());new WaveformQueue(repo);repo.db.prepare('INSERT INTO waveform_jobs(id,record_id,job_json) VALUES(?,?,?)').run('interrupted','mix',JSON.stringify({id:'interrupted',mixId:'mix',sourceUrl:'https://archive.freeteknomusic.org/live.mp3',state:'running',progress:25}));const queue=new WaveformQueue(repo);assert.equal(queue.get('interrupted')!.state,'error');assert.match(queue.get('interrupted')!.error!,/interrupted/i);}finally{repo.close();}
});
