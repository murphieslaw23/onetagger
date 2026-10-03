import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path:string):DatabaseSync {
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const db=new DatabaseSync(path);
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 if(path!==':memory:')db.exec('PRAGMA journal_mode=WAL;');
 try {
  db.exec('BEGIN IMMEDIATE');
  db.exec(readFileSync(new URL('./migrations/001-catalog.sql',import.meta.url),'utf8'));
  db.exec("UPDATE enrichment_runs SET state='interrupted',completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE state='running'");
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');db.close();throw error;}
 return db;
}
