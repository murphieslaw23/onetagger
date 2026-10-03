import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { openCatalog } from '../catalog/repository.js';
const module=await import('./curator.js').catch(()=>null);
const password='disposable test curator password 2026';
test('curator sessions use a protected cookie and store only a token hash',()=>{
 assert.ok(module);const repo=openCatalog(':memory:');
 try{
  const auth=module.createCuratorAuth(repo,module.hashPassword(password));
  assert.throws(()=>auth.login('wrong'));
  const cookie=auth.login(password);
  assert.match(cookie.header,/HttpOnly/);assert.match(cookie.header,/Secure/);assert.match(cookie.header,/SameSite=Lax/);
  const req={headers:{cookie:cookie.header.split(';')[0]}} as IncomingMessage;
  const actor=auth.authenticate(req);assert.ok(actor);
  const stored=repo.db.prepare('SELECT token_hash FROM curator_sessions').get()!;
  assert.notEqual(stored.token_hash,cookie.header.split(';')[0].split('=')[1]);
  auth.logout(req);assert.equal(auth.authenticate(req),undefined);
 }finally{repo.close();}
});
test('failed login attempts are bounded and expired sessions cannot authenticate',()=>{
 assert.ok(module);const repo=openCatalog(':memory:');
 try{
  const auth=module.createCuratorAuth(repo,module.hashPassword(password));
  for(let i=0;i<5;i++)assert.throws(()=>auth.login('wrong','address'));
  assert.throws(()=>auth.login(password,'address'),error=>(error as {status?:number}).status===429);
  const cookie=auth.login(password,'another-address');
  repo.db.prepare('UPDATE curator_sessions SET expires_at=0').run();
  assert.equal(auth.authenticate({headers:{cookie:cookie.header.split(';')[0]}} as IncomingMessage),undefined);
 }finally{repo.close();}
});
