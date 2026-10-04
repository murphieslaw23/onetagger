import type {MigrationResult} from '@syco23/mixsets-domain';
export interface LocalStorageLike {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
const demos=new Set(['spiral-warehouse-2001','metek-aniane-98','novabase-live-tech','gotek-roma-2007']);
export function browserRecords(storage:LocalStorageLike):unknown[]{const saved=storage.getItem('syco23.mixsets.library');if(!saved)return [];const value:unknown=JSON.parse(saved);if(!Array.isArray(value))throw new Error('The browser library is unreadable; its original data has been retained');return value.filter(item=>item&&typeof item==='object'&&!demos.has(String(item.id)));}
export async function migrateBrowserLibrary(storage:LocalStorageLike,send:(records:unknown[],batchId:string)=>Promise<MigrationResult>):Promise<MigrationResult>{
 const records=browserRecords(storage);let batchId=storage.getItem('syco23.mixsets.migrationBatch');if(!batchId){batchId=crypto.randomUUID();storage.setItem('syco23.mixsets.migrationBatch',batchId);}
 const result=await send(records,batchId);storage.setItem('syco23.mixsets.migrationResult',JSON.stringify(result));return result;
}
