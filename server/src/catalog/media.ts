import { createHash } from 'node:crypto';
import { dirname,join } from 'node:path';
import { mkdirSync,writeFileSync,renameSync,existsSync } from 'node:fs';
import type { CatalogRepository } from './repository.js';
import { FieldClaimSchema } from '@syco23/mixsets-domain';
import { applyClaims } from './merge.js';
export function waveformPath(repo:CatalogRepository,id:string):string{
 if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Invalid media identity');if(repo.path===':memory:')throw new Error('Persistent media requires a disk catalog');return join(dirname(repo.path),'media',id+'.png');
}
export function persistWaveform(repo:CatalogRepository,mixId:string,png:Uint8Array,sourceUrl:string){
 const data=Buffer.from(png),record=repo.loadRecord(mixId);if(record?.category!=='mix')throw new Error('Waveform requires an indexed mix');
 if(data.length>1024*1024||data.length<45||!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||data.toString('ascii',12,16)!=='IHDR'||data.readUInt32BE(16)<1||data.readUInt32BE(16)>10000||data.readUInt32BE(20)<1||data.readUInt32BE(20)>10000||data.toString('ascii',data.length-8,data.length-4)!=='IEND')throw new Error('Waveform must be a bounded PNG image');
 const id=createHash('sha256').update(record.id).update(data).digest('hex'),path=waveformPath(repo,id);mkdirSync(dirname(path),{recursive:true,mode:0o700});
 if(!existsSync(path)){const temp=path+'.'+process.pid+'.tmp';writeFileSync(temp,data,{mode:0o600,flag:'wx'});renameSync(temp,path);}
 applyClaims(repo,[FieldClaimSchema.parse({targetRecordId:record.id,field:'waveform',value:{url:'/api/catalog/media/'+id,kind:'waveform',source:'analysis',sourceUrl,analyzedAt:new Date().toISOString(),width:data.readUInt32BE(16),height:data.readUInt32BE(20)},provider:'analysis',sourceUrl,observedAt:new Date().toISOString(),evidence:'analysis',match:'confirmed',reason:'Computed waveform from the recording audio; an existing selected waveform is protected',confidence:1,state:'pending'})]);
 return repo.getRecord(record.id)!;
}
