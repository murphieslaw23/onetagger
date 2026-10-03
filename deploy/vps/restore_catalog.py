#!/usr/bin/env python3
"""Verify and restore a catalog bundle while the worker is stopped."""
import argparse
import json
import subprocess
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source',type=Path)
    args = parser.parse_args()
    source = args.source.resolve()
    if json.loads((source/'manifest.json').read_text()).get('format') != 1:
        raise SystemExit('Unsupported backup format')
    state = subprocess.check_output(['docker','inspect','--format','{{.State.Running}}','syco23-mixsets-api'],text=True).strip()
    if state != 'false':
        raise SystemExit('Stop the worker before restoring; the live catalog was not changed.')
    image = subprocess.check_output(['docker','inspect','--format','{{.Config.Image}}','syco23-mixsets-api'],text=True).strip()
    code = "import {DatabaseSync} from 'node:sqlite';import {copyFileSync,cpSync,existsSync,rmSync,chownSync,readdirSync} from 'node:fs'; const db=new DatabaseSync('/backup/catalog.sqlite',{readOnly:true});if(Object.values(db.prepare('PRAGMA integrity_check').get())[0]!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Invalid backup');db.close();for(const suffix of ['','-wal','-shm'])rmSync('/data/catalog.sqlite'+suffix,{force:true});copyFileSync('/backup/catalog.sqlite','/data/catalog.sqlite');if(existsSync('/backup/media'))cpSync('/backup/media','/data/media',{recursive:true});function own(path){chownSync(path,1000,1000);for(const entry of readdirSync(path,{withFileTypes:true})){const child=path+'/'+entry.name;if(entry.isDirectory())own(child);else chownSync(child,1000,1000);}}own('/data');"
    subprocess.run(['docker','run','--rm','--network','none','--user','0','-v','syco23-mixsets-catalog:/data','-v',str(source)+':/backup:ro',image,'node','--input-type=module','-e',code],check=True)
    print('Verified catalog and media restored. Start the worker and verify its health.')

if __name__ == '__main__':
    main()
