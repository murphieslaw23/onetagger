#!/usr/bin/env python3
"""Create a private online SQLite backup and copy persistent media."""
import argparse
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

CONTAINER = 'syco23-mixsets-api'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    destination = args.destination.resolve()
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    code = "import {DatabaseSync} from 'node:sqlite'; import {backupCatalog} from './dist/catalog/backup.js'; const db=new DatabaseSync('/app/data/catalog.sqlite',{readOnly:true}); try{await backupCatalog({db},'/tmp/catalog-backup.sqlite');}finally{db.close();}"
    subprocess.run(['docker','exec',CONTAINER,'node','--input-type=module','-e',code],check=True)
    subprocess.run(['docker','cp',CONTAINER+':/tmp/catalog-backup.sqlite',str(destination/'catalog.sqlite')],check=True)
    subprocess.run(['docker','exec',CONTAINER,'rm','/tmp/catalog-backup.sqlite'],check=True)
    check = subprocess.run(['docker','exec',CONTAINER,'test','-d','/app/data/media'])
    if check.returncode == 0:
        subprocess.run(['docker','cp',CONTAINER+':/app/data/media',str(destination/'media')],check=True)
    (destination/'manifest.json').write_text(json.dumps({'format':1,'createdAt':datetime.now(timezone.utc).isoformat(),'database':'catalog.sqlite','media':'media'},indent=2))
    for directory, _, files in os.walk(destination):
        os.chmod(directory,0o700)
        for name in files:
            os.chmod(Path(directory)/name,0o600)
    print(f'Catalog and media backed up to {destination}')

if __name__ == '__main__':
    main()
