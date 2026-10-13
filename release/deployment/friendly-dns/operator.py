"""Gryt-only friendly-DNS update. Preserve enabled relay gates and all live overlays."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3

WORK = None
BASE_IMAGE = 'sha256:fe151bbd8361bc492d74c9349610aad1e25c382fe11d850f49d7674fd242f590'
PROXY_SHA = '0b1af8c5dcf0c018d0351e002b07e11f5f2a9b46851a22d5d416b1d71dc26591'
base_path = Path(__file__).with_name('base_operator.py')
if not base_path.is_file():
    base_path = Path(__file__).parent.parent / 'community-network-v2' / 'operator.py'
spec = importlib.util.spec_from_file_location('dns_deployment_base', base_path)
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

def save(name, value):
    with (WORK / name).open('x', encoding='utf-8') as output:
        json.dump(value, output, indent=2)
    os.chmod(WORK / name, 0o600)

def read(name):
    return json.loads((WORK / name).read_text())

def peers():
    ids = b.run(['docker', 'ps', '-q']).split()
    rows = json.loads(b.run(['docker', 'inspect', *ids]))
    return {row['Name']: [row['Id'], row['Image'], row['State']['StartedAt']]
            for row in rows if row['Name'] != '/' + b.SERVER}

def proxy():
    values = dict(line.split('=', 1) for line in b.run(['systemctl', 'show', b.PROXY_UNIT,
        '--property=ActiveState', '--property=MainPID', '--property=ExecMainStartTimestampMonotonic']).splitlines())
    if values['ActiveState'] != 'active' or int(values['MainPID']) <= 0 or b.digest(b.PROXY_FILE) != PROXY_SHA:
        raise RuntimeError('proxy-baseline-mismatch')
    # Inspect only the known policy field; never emit the process environment.
    environment = dict(part.split(b'=', 1) for part in Path('/proc/' + values['MainPID'] + '/environ').read_bytes().split(b'\0') if b'=' in part)
    if environment.get(b'MEMBER_RELAY_POLICY_VERSION') != b'2':
        raise RuntimeError('proxy-relay-gate-mismatch')
    return values

def require_server(row):
    environment = b.env(row)
    if environment.get('LAOKUAI_MEMBER_RELAY_POLICY_V2') != '1' or environment.get('VOICE_MAX_USERS') != '12':
        raise RuntimeError('server-config-mismatch')

def inputs():
    value = read('input.json')
    if not isinstance(value.get('sourceCommit'), str) or not re.fullmatch('[0-9a-f]{40}', value['sourceCommit']) or value.get('sourceWorkingTree') is not False:
        raise RuntimeError('source-not-frozen')
    for file, key in [('bundle.js', 'bundleSha256'), ('source-input.json', 'sourceInputSha256'),
                      ('operator.py', 'operatorSha256'), ('base_operator.py', 'baseOperatorSha256')]:
        if b.digest(WORK / file) != value[key]:
            raise RuntimeError('input-pin-mismatch')
    if (WORK / 'bundle.js').stat().st_size != value['bundleBytes']:
        raise RuntimeError('bundle-size-mismatch')
    source = read('source-input.json')
    if source.get('sourceCommit') != value['sourceCommit'] or source.get('workingTree') is not False:
        raise RuntimeError('source-provenance-mismatch')
    return value

def require_baseline_config(config):
    server = config['services']['server']
    if b.inspect(server['image'])['Id'] != BASE_IMAGE:
        raise RuntimeError('compose-baseline-image-mismatch')
    environment = server.get('environment', {})
    if str(environment.get('LAOKUAI_MEMBER_RELAY_POLICY_V2')) != '1' or str(environment.get('VOICE_MAX_USERS')) != '12':
        raise RuntimeError('compose-baseline-gates-mismatch')

def baseline_files():
    files = read('compose-files.json')
    if any(b.digest(path) != digest for path, digest in read('compose-hashes.json').items()):
        raise RuntimeError('compose-drift')
    current = b.config(files)
    if current != read('compose.before.private.json'):
        raise RuntimeError('compose-baseline-drift')
    require_baseline_config(current)
    return files

def inspect_phase():
    row = b.inspect(b.SERVER)
    require_server(row)
    proxy()
    return {'image': row['Image'], 'healthy': row['State'].get('Health', {}).get('Status') == 'healthy',
            'backendRelayGate': '1', 'proxyRelayGate': '2', 'composeFileCount': len(b.live_files(row)), 'runtimeChanged': False}

def build():
    value = inputs()
    row = b.inspect(b.SERVER)
    require_server(row)
    if row['Image'] != BASE_IMAGE or row['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('server-baseline-mismatch')
    files = b.live_files(row)
    merged = b.config(files)
    require_baseline_config(merged)
    save('baseline.private.json', {'server': row, 'peers': peers(), 'proxy': proxy()})
    save('compose.before.private.json', merged)
    save('compose-files.json', files)
    save('compose-hashes.json', {file: b.digest(file) for file in files})
    # SQLite's online backup includes WAL and does not change the running database.
    with sqlite3.connect('file:/opt/stacks/gryt/data/gryt.db?mode=ro', uri=True) as source, sqlite3.connect(WORK / 'gryt.before.private.db') as target:
        source.backup(target)
    os.chmod(WORK / 'gryt.before.private.db', 0o600)
    base_tag = 'local.laokuai/friendly-dns-base:' + value['sourceCommit'][:12]
    b.run(['docker', 'tag', row['Image'], base_tag])
    (WORK / 'Dockerfile').write_text('FROM ' + base_tag + '\nCOPY --chown=1001:1001 bundle.js /app/bundle.js\nLABEL org.opencontainers.image.revision="' + value['sourceCommit'] + '"\n')
    (WORK / '.dockerignore').write_text('*\n!Dockerfile\n!bundle.js\n')
    tag = 'local.laokuai/friendly-dns:' + value['sourceCommit'][:12]
    b.run(['docker', 'build', '--network=none', '--pull=false', '-t', tag, str(WORK)], 180)
    image = b.inspect(tag)['Id']
    save('activation.overlay.json', {'services': {'server': {'image': image}}})
    save('rollback.overlay.json', {'services': {'server': {'image': BASE_IMAGE}}})
    b.only_image_delta(read('compose.before.private.json'), b.config(files + [str(WORK / 'activation.overlay.json')]), image)
    result = {'sourceCommit': value['sourceCommit'], 'bundleSha256': value['bundleSha256'], 'candidateImage': image,
              'baseImage': row['Image'], 'runtimeStarted': False, 'onlyServerImageChanges': True,
              'backendRelayGate': '1', 'proxyRelayGate': '2', 'databaseBackedUp': True}
    save('BUILD.json', result)
    return result

def unchanged():
    baseline = read('baseline.private.json')
    if peers() != baseline['peers'] or proxy() != baseline['proxy']:
        raise RuntimeError('unrelated-service-changed')

def rollback():
    # Previous image is already V2-capable; no credential downgrade is involved.
    baseline = read('baseline.private.json')['server']
    current = b.inspect(b.SERVER)
    if current['Image'] not in (baseline['Image'], read('BUILD.json')['candidateImage']):
        raise RuntimeError('unexpected-current-image')
    require_server(current)
    unchanged()
    files = baseline_files() + [str(WORK / 'rollback.overlay.json')]
    b.only_image_delta(read('compose.before.private.json'), b.config(files), BASE_IMAGE)
    b.compose(files, ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--timeout', '20', 'server'])
    restored = b.healthy(baseline['Image'])
    if b.shape(restored) != b.shape(baseline):
        raise RuntimeError('rollback-shape-mismatch')
    unchanged()
    return {'rolledBack': True, 'relayGatesPreserved': True}

def activate():
    inputs()
    built = read('BUILD.json')
    old = read('baseline.private.json')['server']
    current = b.inspect(b.SERVER)
    if current['Id'] != old['Id'] or b.shape(current) != b.shape(old):
        raise RuntimeError('server-drift')
    require_server(current)
    unchanged()
    files = baseline_files() + [str(WORK / 'activation.overlay.json')]
    b.only_image_delta(read('compose.before.private.json'), b.config(files), built['candidateImage'])
    try:
        b.compose(files, ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--timeout', '20', 'server'])
        now = b.healthy(built['candidateImage'])
        require_server(now)
        if b.shape(now) != b.shape(old):
            raise RuntimeError('runtime-shape-mismatch')
        unchanged()
        result = {**built, 'activated': True, 'runtimeStarted': True, 'healthy': True,
                  'environmentPortsMountsPreserved': True, 'sfuEtProxyUntouched': True, 'oldImageKept': True}
        save('ACTIVATED.json', result)
        return result
    except Exception:
        save('AUTO-ROLLBACK.json', rollback())
        raise

if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=['inspect', 'build', 'activate', 'rollback'])
    parser.add_argument('--work', required=True, type=Path)
    args = parser.parse_args()
    WORK = args.work.resolve()
    if WORK.parent != Path('/opt/stacks/gryt') or not WORK.name.startswith('friendly-dns-') or not WORK.is_dir():
        raise SystemExit('invalid-work-directory')
    try:
        print(json.dumps({'inspect': inspect_phase, 'build': build, 'activate': activate, 'rollback': rollback}[args.phase]()))
    except Exception as error:
        print(json.dumps({'failed': True, 'reason': str(error) if isinstance(error, RuntimeError) else type(error).__name__}))
        raise SystemExit(1)
