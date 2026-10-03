import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { openCatalog } from './repository.js';
import { artist } from './test-fixtures.js';
const application=await import('../app.js').catch(()=>null);
const authentication=await import('../auth/curator.js').catch(()=>null);
const origin='https://mixsets.syco23.org';
test('catalog HTTP enforces curator access, origin, validation and record revisions',async()=>{
 assert.ok(application&&authentication);
 const repo=openCatalog(':memory:');repo.saveRecord(artist());
 const server=application.createApiServer({catalog:repo,passwordHash:authentication.hashPassword('disposable HTTP test password'),origins:[origin]});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
 try{
  assert.equal((await fetch(base+'/api/catalog/artist')).status,200);
  for(const path of ['/api/catalog/import','/api/jobs','/api/waveforms','/api/enrich'])assert.equal((await fetch(base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'})).status,401);
  assert.equal((await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status,403);
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'disposable HTTP test password'})});
  assert.equal(login.status,200);assert.equal(login.headers.get('access-control-allow-origin'),origin);assert.equal(login.headers.get('access-control-allow-credentials'),'true');
  const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const headers={Origin:origin,Cookie:cookie,'Content-Type':'application/json'};
  const patch=await fetch(base+'/api/catalog/records/artist',{method:'PATCH',headers,body:JSON.stringify({revision:1,fields:{country:'FR'}})});
  assert.equal(patch.status,200);
  assert.equal((await fetch(base+'/api/catalog/records/artist',{method:'PATCH',headers,body:JSON.stringify({revision:1,fields:{profile:'Stale'}})})).status,409);
  const revision=repo.getRecord('artist')!.record.revision;
  assert.equal((await fetch(base+'/api/catalog/records/artist',{method:'PATCH',headers,body:JSON.stringify({revision,fields:{country:'ZZ'}})})).status,400);
  assert.equal((await fetch(base+'/api/catalog/records/artist',{method:'PATCH',headers:{...headers,Origin:'https://evil.example'},body:JSON.stringify({revision,fields:{country:'DE'}})})).status,403);
  assert.equal((await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{invalid'})).status,400);
  assert.equal((await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'x'.repeat(2*1024*1024)})})).status,413);
  const preflight=await fetch(base+'/api/catalog/records/artist',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'PATCH'}});
  assert.equal(preflight.status,204);assert.match(preflight.headers.get('access-control-allow-methods')!,/PATCH/);
  await fetch(base+'/api/auth/logout',{method:'POST',headers,body:'{}'});
  assert.equal((await fetch(base+'/api/catalog/import',{method:'POST',headers,body:'{}'})).status,401);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));repo.close();}
});
