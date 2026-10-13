"""One-service update; no credential export, ET command or SFU restart."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

WORK = Path('/opt/stacks/gryt/member-address-directory-20261013')
BASE = 'sha256:9ddd8f97831436c5b4cae46b04e4c0a9b9afb34961aab5ce4c7d0a9fc80dfc81'
SFU = 'sha256:585f0a76df9420f228f7b47020c35247cb76524f63125ea7c5bf49bb8ee9cd7b'
FILES = ['/opt/stacks/gryt/compose.yml',
 '/opt/stacks/gryt/community-et-real-9db53f79/backend-sfu.override.json',
 '/opt/stacks/gryt/community-et-real-9db53f79/server-release-version.override.json',
 '/opt/stacks/gryt/community-password-beta-a5c557be/server-password.override.json',
 '/opt/stacks/gryt/sfu-12-fallback-16k60/activation.overlay.json']
TAG = 'local.laokuai/member-address-directory:20261013'

def run(args, timeout=60):
    value = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if value.returncode: raise RuntimeError('command-failed:' + args[0])
    return value.stdout

def digest(file): return hashlib.sha256(Path(file).read_bytes()).hexdigest()
def read(name): return json.loads((WORK/name).read_text())
def save(name, value):
    with (WORK/name).open('x', encoding='utf-8') as file:
        json.dump(value, file, indent=2)
    os.chmod(WORK/name, 0o600)
def inspect(name): return json.loads(run(['docker','inspect',name]))[0]
def compose(extra, command):
    args = ['docker','compose','-p','laokuailiao']
    for file in FILES + extra: args += ['-f', str(file)]
    return run(args + command, 120)
def config(extra=()): return json.loads(compose(list(extra), ['config','--format','json']))
def shape(row):
    return {key: row[key] for key in ['HostConfig','Mounts']} | {
        'env': row['Config']['Env'], 'cmd': row['Config']['Cmd'],
        'entrypoint': row['Config']['Entrypoint'], 'user': row['Config']['User'],
        'workdir': row['Config']['WorkingDir']}

def only_image_delta(before, after, image):
    expected = copy.deepcopy(before)
    expected['services']['server']['image'] = image
    if expected != after: raise RuntimeError('compose-delta-outside-server-image')

def build():
    spec = read('input.json')
    if not len(spec['sourceCommit']) == 40 or any(c not in '0123456789abcdef' for c in spec['sourceCommit']): raise RuntimeError('bad-source-pin')
    if digest(WORK/'bundle.js') != spec['sha256']: raise RuntimeError('bundle-hash-mismatch')
    row = inspect('laokuailiao-server')
    sfu = inspect('laokuailiao-sfu')
    if row['Image'] != BASE or sfu['Image'] != SFU: raise RuntimeError('base-image-changed')
    if row['Config']['WorkingDir'] != '/app' or row['Config']['Cmd'] != ['node','bundle.js']: raise RuntimeError('unknown-server-entrypoint')
    if row['Config']['Labels'].get('com.docker.compose.project.config_files') != ','.join(FILES): raise RuntimeError('compose-files-changed')
    original = config()
    if original['services']['server']['environment'].get('VOICE_MAX_USERS') != '12': raise RuntimeError('capacity-config-changed')
    save('compose.before.private.json', original)
    save('containers.before.private.json', {'server': row, 'sfu': sfu})
    save('compose.hashes.json', {file: digest(file) for file in FILES})
    # Reuse the pinned image and native dependencies; no RUN, downloads or installs.
    run(['docker','tag',BASE,'local.laokuai/member-directory-base:20261013'])
    dockerfile = ('FROM local.laokuai/member-directory-base:20261013\n'
      'COPY --chown=1001:1001 bundle.js /app/bundle.js\n'
      'LABEL org.opencontainers.image.revision="' + spec['sourceCommit'] + '"\n')
    (WORK/'Dockerfile').write_text(dockerfile)
    (WORK/'.dockerignore').write_text('*\n!Dockerfile\n!bundle.js\n')
    run(['docker','build','--network=none','--pull=false','-t',TAG,str(WORK)], 180)
    image = inspect(TAG)['Id']
    save('activation.overlay.json', {'services': {'server': {'image': image}}})
    only_image_delta(original, config([WORK/'activation.overlay.json']), image)
    receipt = {'sourceCommit':spec['sourceCommit'], 'bundleSha256':spec['sha256'], 'base':BASE,
       'candidate':image, 'runtimeStarted':False, 'network':'none', 'onlyServerImageChanges':True}
    save('BUILD.json', receipt)
    return receipt

def healthy(image, timeout=65):
    deadline = time.monotonic()+timeout
    while time.monotonic() < deadline:
        row = inspect('laokuailiao-server')
        if row['Image'] == image and row['State'].get('Health',{}).get('Status') == 'healthy': return row
        time.sleep(1)
    raise RuntimeError('server-health-timeout')

def unchanged_sfu():
    old = read('containers.before.private.json')['sfu']
    now = inspect('laokuailiao-sfu')
    if now['Id'] != old['Id'] or now['Image'] != old['Image'] or now['State']['StartedAt'] != old['State']['StartedAt']: raise RuntimeError('sfu-changed')

def rollback():
    # Original merged Compose stays private on this same machine.
    run(['docker','compose','-p','laokuailiao','-f',str(WORK/'compose.before.private.json'),
       'up','-d','--no-deps','--no-build','--pull','never','server'], 120)
    healthy(BASE)
    unchanged_sfu()
    return {'rolledBack':True,'serverImage':BASE,'sfuRestarted':False,'etTouched':False}

def activate():
    built = read('BUILD.json')
    old = read('containers.before.private.json')['server']
    now = inspect('laokuailiao-server')
    if now['Id'] != old['Id'] or now['Image'] != BASE: raise RuntimeError('live-server-changed')
    if any(digest(file) != sha for file, sha in read('compose.hashes.json').items()): raise RuntimeError('live-compose-changed')
    only_image_delta(read('compose.before.private.json'),config([WORK/'activation.overlay.json']),built['candidate'])
    try:
        compose([WORK/'activation.overlay.json'], ['up','-d','--no-deps','--no-build','--pull','never','--timeout','20','server'])
        current = healthy(built['candidate'])
        # Compose metadata changes by design; all runtime env/ports/mounts persist.
        a, b = shape(old), shape(current)
        for item in (a,b):
            item['HostConfig'] = {k:v for k,v in item['HostConfig'].items() if k not in ['ContainerIDFile']}
        if a != b: raise RuntimeError('runtime-config-drift')
        unchanged_sfu()
        receipt = {**built, 'activated':True,'serverHealth':'healthy','sfuRestarted':False,
          'etTouched':False,'portsChanged':False,'mountsChanged':False,'environmentChanged':False,
          'dataPreserved':True,'oldImageKept':True,'rollbackAvailable':True}
        save('ACTIVATED.json', receipt)
        return receipt
    except Exception:
        result = rollback()
        save('AUTO-ROLLBACK.json',result)
        raise

if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=['build','activate','rollback'])
    mode = parser.parse_args().phase
    try: print(json.dumps({'build':build,'activate':activate,'rollback':rollback}[mode]()))
    except Exception as error:
        print(json.dumps({'failed':True,'reason':str(error) if isinstance(error,RuntimeError) else type(error).__name__}))
        raise SystemExit(1)
