#!/usr/bin/env python3
"""Configure curator access privately on VPS-L; store only a scrypt hash."""
import getpass
import hashlib
import secrets
import subprocess
from setup_providers import save_env, ENV_FILE, ROOT, COMPOSE_FILE

def main():
    password = getpass.getpass('New curator password (at least 12 characters): ')
    if not 12 <= len(password) <= 1024 or password != getpass.getpass('Confirm password: '):
        raise SystemExit('Password length or confirmation is invalid; nothing was saved.')
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64).hex()
    save_env(ENV_FILE, {'CURATOR_PASSWORD_HASH': f'scrypt:{salt}:{digest}'})
    subprocess.run(['docker','compose','--env-file',str(ENV_FILE),'-f',str(COMPOSE_FILE),'up','-d','--no-deps','--force-recreate','api'], cwd=ROOT, check=True)
    print('Curator password hash saved. Log in at https://mixsets.syco23.org/login.')

if __name__ == '__main__':
    main()
