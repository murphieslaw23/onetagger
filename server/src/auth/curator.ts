import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { CuratorActor } from '@syco23/mixsets-domain';
import type { CatalogRepository } from '../catalog/repository.js';
import { HttpError } from '../http.js';
export function hashPassword(password:string){
 if(password.length<12||password.length>1024)throw new Error('Curator password must contain 12–1024 characters');
 const salt=randomBytes(16).toString('hex');return 'scrypt:'+salt+':'+scryptSync(password,salt,64).toString('hex');
}
export interface CuratorAuth { login(password:string,address?:string):{header:string}; authenticate(req:IncomingMessage):CuratorActor|undefined; logout(req:IncomingMessage):void; clearCookie:string; configured:boolean }
export function createCuratorAuth(repo:CatalogRepository,passwordHash:string,secure=true):CuratorAuth{
 const name=secure?'__Host-mixsets-curator':'mixsets-curator',attributes=`; Path=/; HttpOnly; SameSite=Lax${secure?'; Secure':''}`;
 const attempts=new Map<string,{count:number,until:number}>(),lifetime=12*60*60;
 const tokenHash=(req:IncomingMessage)=>{const token=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1);return token&&/^[A-Za-z0-9_-]{43}$/.test(token)?createHash('sha256').update(token).digest('hex'):undefined;};
 return {
 configured:!!passwordHash,clearCookie:name+'='+attributes+'; Max-Age=0',
 login(password,address='local'){
  if(!passwordHash)throw new HttpError(503,'Curator access has not been configured');
  const now=Date.now();for(const [key,value]of attempts)if(value.until<now)attempts.delete(key);
  const attempt=attempts.get(address);if(attempt&&attempt.count>=5)throw new HttpError(429,'Too many login attempts; try again later');
  const [format,salt,expected]=passwordHash.split(':');let valid=false;
  if(format==='scrypt'&&/^[a-f0-9]{32}$/.test(salt||'')&&/^[a-f0-9]{128}$/.test(expected||'')&&password.length<=1024){valid=timingSafeEqual(scryptSync(password,salt,64),Buffer.from(expected,'hex'));}
  if(!valid){if(attempts.size>=10000)attempts.delete(attempts.keys().next().value!);attempts.set(address,{count:(attempt?.count||0)+1,until:attempt?.until||now+600000});throw new HttpError(401,'Password is incorrect');}
  attempts.delete(address);repo.db.prepare('DELETE FROM curator_sessions WHERE expires_at<=?').run(now);
  const token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');
  repo.db.prepare('INSERT INTO curator_sessions(token_hash,expires_at,created_at) VALUES(?,?,?)').run(hash,now+lifetime*1000,now);
  return {header:name+'='+token+attributes+'; Max-Age='+lifetime};
 },
 authenticate(req){const hash=tokenHash(req);if(!hash)return;const session=repo.db.prepare('SELECT expires_at FROM curator_sessions WHERE token_hash=?').get(hash) as {expires_at:number}|undefined;if(!session)return;if(session.expires_at<=Date.now()){repo.db.prepare('DELETE FROM curator_sessions WHERE token_hash=?').run(hash);return;}return {sessionId:hash};},
 logout(req){const hash=tokenHash(req);if(hash)repo.db.prepare('DELETE FROM curator_sessions WHERE token_hash=?').run(hash);}
 };
}
