import {test,expect,vi} from 'vitest';
const module=await import('./migration').catch(()=>null);
function storage(){const values=new Map<string,string>([['syco23.mixsets.library',JSON.stringify([{id:'real',title:'Real'},{id:'spiral-warehouse-2001',title:'Demo'}])]]);return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};}
test('migration retains local originals on partial failure and retries with the same batch',async()=>{
 expect(module).not.toBeNull();const local=storage();const send=vi.fn(async(records:unknown[],batchId:string)=>({batchId,outcomes:[{legacyId:'real',status:'error' as const,message:'Invalid record'}]}));await module!.migrateBrowserLibrary(local,send);await module!.migrateBrowserLibrary(local,send);expect(send.mock.calls[0][1]).toBe(send.mock.calls[1][1]);expect(send.mock.calls[0][0]).toHaveLength(1);expect(local.getItem('syco23.mixsets.library')).not.toBeNull();
});
