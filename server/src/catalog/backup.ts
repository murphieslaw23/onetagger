import { DatabaseSync,backup } from 'node:sqlite';
import { mkdir,rename,copyFile,access,rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CatalogRepository } from './repository.js';
function verify(path:string){const db=new DatabaseSync(path,{readOnly:true});try{const row=db.prepare('PRAGMA integrity_check').get();if(!row||Object.values(row)[0]!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Backup integrity verification failed');db.prepare('SELECT version FROM schema_migrations').get();}finally{db.close();}}
export async function backupCatalog(repo:CatalogRepository,destination:string):Promise<void>{await mkdir(dirname(destination),{recursive:true,mode:0o700});const temporary=destination+'.tmp';try{await backup(repo.db,temporary);verify(temporary);await rename(temporary,destination);}finally{await rm(temporary,{force:true});}}
export async function restoreCatalog(source:string,destination:string):Promise<void>{
 verify(source);try{await access(destination);throw new Error('Restore target exists; stop the service and move the previous database aside');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 await mkdir(dirname(destination),{recursive:true,mode:0o700});const temporary=destination+'.tmp';try{await copyFile(source,temporary);verify(temporary);await rename(temporary,destination);}finally{await rm(temporary,{force:true});}
}
