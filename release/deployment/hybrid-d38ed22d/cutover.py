"""Exact two-service operator helper. Task6 has not executed Docker/production phases.

Default inspect is read-only. Stage image tars separately; load does no product start.
Activate creates a stopped consistent data fork, never changes the original data.
Secrets from inspect/compose stay in memory and are never printed or exported.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

BASE = Path('/opt/stacks/gryt/compose.yml')
PROJECT = 'laokuailiao'
WORK = Path('/opt/stacks/gryt/hybrid-upgrade-d38ed22d')
DATA = Path('/opt/stacks/gryt/data')
COPY = WORK / 'data-candidate'
OLD = {'server': 'sha256:b6f4bf5db57493a06307e1cfaefd1c92d6c90ccc26e46c9ba05a8fab53d093e8',
       'sfu': 'sha256:33babe9b71475b123d5bb0e8482f0da5ae2b92c0fbe0e59a00957d89faea6eef'}
NEW = {
 'server': {'manifest': 'sha256:e45e9c27fe391aa9281365745a54c34529b502f09fa79a2d8e68fcc5486d1eba',
            'config': 'sha256:e8747cede11f23df31cb9c190362a63dcf2873c12d7162926934a67e32372367',
            'source': '85ec3b9c60d49881ba9ad5cd48c9a17d59c1772d', 'tree': '96db8312488c4f399904192f3a932232cf6130ad',
            'tar': 'server-85ec3b9c-linux-amd64.docker.tar', 'tar_sha256': '9dde30f81c4daf6cffa0e5d63a98b37951b55e55f5d19fda76fda17bda944453'},
 'sfu': {'manifest': 'sha256:d38ed22ddbed419661ba20b2c0bf008b18d07e05446c0c813c05a022883aafc6',
         'config': 'sha256:2b6afca88c4f7d6912c044d3b114d17af56104a4fce95ca7dc14cf0f04ec3a8f',
         'source': '011f12b92af2732cc6a86a088c5f753dfd5c1a14', 'tree': '3d64d5904681d59590be940870ce045e5c1577ff',
         'tar': 'sfu-011f12b9-linux-amd64.docker.tar', 'tar_sha256': '102fba9de73bb8eb9cb5e47171e5938330635a9dc827e27085ea800a632ceaaf'},
}
FLAGS = {'server': {'VOICE_HYBRID_ENABLED': 'true', 'SERVER_VERSION': '1.0.76-laokuai.hybrid.85ec3b9c'},
         'sfu': {'SFU_HYBRID_ENABLED': 'true', 'SFU_AUDIO_ONLY': 'true', 'SFU_REQUIRE_CLIENT_TOKEN': 'true',
                 'SFU_CONTROL_PORT': '9092', 'SFU_METRICS_PORT': '0', 'ICE_UDP_MUX_PORT': '3478'}}

def run(args, timeout=45, optional=False):
    r = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    if r.returncode and not optional:
        raise RuntimeError('operator-command-failed:' + args[0] + ':' + str(r.returncode))
    return r

def docker_json(*args):
    return json.loads(run(['docker', *args]).stdout)

def compose(extra=(), operation=('config', '--format', 'json')):
    return run(['docker', 'compose', '-p', PROJECT, '-f', str(BASE), *extra, *operation])

def candidate_image(service):
    pin = NEW[service]
    for ref in [pin['manifest'], pin['config']]:
        r = run(['docker', 'image', 'inspect', ref], optional=True)
        if r.returncode:
            continue
        x = json.loads(r.stdout)[0]
        labels = x.get('Config', {}).get('Labels', {}) or {}
        if x['Id'] not in [pin['manifest'], pin['config']] or x.get('Os') != 'linux' or x.get('Architecture') != 'amd64':
            raise RuntimeError('candidate-image-identity-mismatch:' + service)
        if labels.get('org.opencontainers.image.revision') != pin['source'] or labels.get('local.laokuai.component-tree') != pin['tree']:
            raise RuntimeError('candidate-source-label-mismatch:' + service)
        return x['Id']
    raise RuntimeError('exact-candidate-not-loaded:' + service)

def volume_source(service, data):
    volumes = service.get('volumes', [])
    matches = [v for v in volumes if v.get('target') == '/data']
    if len(matches) != 1 or matches[0].get('type') != 'bind' or matches[0].get('source') != str(data):
        raise RuntimeError('data-bind-mismatch')

def validate_delta(base, effective, ids):
    expected = copy.deepcopy(base)
    for name in ['server', 'sfu']:
        s = expected['services'][name]
        s['image'] = ids[name]
        s.setdefault('environment', {}).update(FLAGS[name])
    volume_source(expected['services']['server'], DATA)
    for v in expected['services']['server']['volumes']:
        if v.get('target') == '/data':
            v['source'] = str(COPY)
    # Compose config file locations are metadata, not runtime changes.
    if expected != effective:
        raise RuntimeError('effective-compose-exceeded-two-service-allowlist')

def overlay(ids, activate, base=None):
    s = {name: {'image': ids[name]} for name in ['server', 'sfu']}
    v = copy.deepcopy(next(v for v in base['services']['server']['volumes'] if v['target'] == '/data')) if base else {
        'type': 'bind', 'source': str(DATA), 'target': '/data', 'bind': {'propagation': 'rprivate'}}
    v['source'] = str(COPY if activate else DATA)
    s['server']['volumes'] = [v]
    if activate:
        for name in s:
            s[name]['environment'] = FLAGS[name]
    return {'services': s}

def write_private(file, value):
    with open(file, 'x', encoding='utf-8') as f:
        os.chmod(file, 0o600)
        json.dump(value, f, indent=2)

def current(service):
    x = docker_json('inspect', 'laokuailiao-' + service)[0]
    labels = x.get('Config', {}).get('Labels', {}) or {}
    if labels.get('com.docker.compose.project') != PROJECT or labels.get('com.docker.compose.service') != service:
        raise RuntimeError('wrong-compose-owner:' + service)
    return x

def validate_inherited_environment(base_service, live, image):
    def env_list(values):
        return dict(x.split('=', 1) for x in values or [] if '=' in x)
    expected = env_list(image.get('Config', {}).get('Env'))
    for k, v in base_service.get('environment', {}).items():
        if v is None:
            expected.pop(k, None)
        else:
            expected[k] = str(v)
    if expected != env_list(live.get('Config', {}).get('Env')):
        raise RuntimeError('base-compose-not-current-environment-no-cutover')

def stop_owned(service, expected_image):
    x = current(service)
    if x['Image'] != expected_image:
        raise RuntimeError('unexpected-current-image:' + service)
    if not x['State']['Running']:
        return
    run(['docker', 'kill', '--signal=TERM', x['Id']])
    end = time.monotonic() + 20
    while time.monotonic() < end:
        if not docker_json('inspect', x['Id'])[0]['State']['Running']:
            return
        time.sleep(0.25)
    raise RuntimeError('graceful-stop-timeout-no-force:' + service)

def tree_hash(directory):
    entries = []
    for p in sorted(directory.rglob('*')):
        if p.is_symlink():
            raise RuntimeError('data-symlink-needs-operator-review')
        if p.is_file():
            entries.append([str(p.relative_to(directory)), p.stat().st_size, hashlib.sha256(p.read_bytes()).hexdigest()])
    return {'files': len(entries), 'bytes': sum(x[1] for x in entries),
            'treeSha256': hashlib.sha256(json.dumps(entries, separators=(',', ':')).encode()).hexdigest()}

def main(args):
    if args.phase == 'load':
        # Operator stages only exact public/product image archives, not data or credentials.
        for pin in NEW.values():
            file = Path(args.tar_directory) / pin['tar']
            if hashlib.sha256(file.read_bytes()).hexdigest() != pin['tar_sha256']:
                raise RuntimeError('image-tar-hash-mismatch')
            run(['docker', 'load', '--input', str(file)], timeout=180)
        print(json.dumps({'imagesLoaded': {s: candidate_image(s) for s in NEW}, 'productStarted': False}))
        return
    if args.phase == 'rollback':
        receipt = json.loads((WORK / 'operation.json').read_text())
        if hashlib.sha256(BASE.read_bytes()).hexdigest() != receipt['baseComposeSha256']:
            raise RuntimeError('base-compose-drift-no-rollback')
        if tree_hash(DATA) != receipt['originalData']:
            raise RuntimeError('original-data-drift-no-automatic-rollback')
        for name in ['server', 'sfu']:
            x = current(name)
            if x['Image'] not in [OLD[name], receipt['images'][name]]:
                raise RuntimeError('foreign-container-no-rollback')
            stop_owned(name, x['Image'])
        for name in ['sfu', 'server']:
            compose(['-f', str(WORK / 'rollback.json')], ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', name])
        print(json.dumps({'rollbackStarted': True, 'candidateDataPreserved': True, 'realAccountVoiceAcceptance': False}))
        return
    base = json.loads(compose().stdout)
    ids = {name: candidate_image(name) for name in NEW}
    for name in OLD:
        x = current(name)
        if x['Image'] != OLD[name] or not x['State']['Running'] or x.get('State', {}).get('Health', {}).get('Status') != 'healthy':
            raise RuntimeError('production-baseline-drift:' + name)
        validate_inherited_environment(base['services'][name], x, docker_json('image', 'inspect', OLD[name])[0])
        if name == 'server':
            if x['HostConfig'].get('PortBindings') or len([v for v in x['Mounts'] if v['Destination'] == '/data' and v['Source'] == str(DATA) and v['RW']]) != 1:
                raise RuntimeError('production-data-or-port-drift')
        else:
            if x['HostConfig'].get('PortBindings') != {'3478/udp': [{'HostIp': '0.0.0.0', 'HostPort': '3478'}]}:
                raise RuntimeError('production-sfu-port-drift')
    volume_source(base['services']['server'], DATA)
    summary = {'images': ids, 'services': ['server', 'sfu'], 'hostPortsAdded': [], 'etOrTun': False,
               'expectedInterruptionSeconds': [60, 120], 'maintenanceBudgetSeconds': 300}
    if args.phase == 'inspect':
        print(json.dumps(summary))
        return
    if WORK.exists():
        raise RuntimeError('operation-directory-exists-no-overwrite')
    WORK.mkdir(mode=0o700)
    write_private(WORK / 'activate.json', overlay(ids, True, base))
    write_private(WORK / 'rollback.json', overlay(OLD, False, base))
    effective = json.loads(compose(['-f', str(WORK / 'activate.json')]).stdout)
    validate_delta(base, effective, ids)
    # Only after all identity/config checks. Original source never receives new writes.
    stop_owned('server', OLD['server'])
    original = tree_hash(DATA)
    run(['cp', '-a', '--', str(DATA), str(COPY)])
    if tree_hash(COPY) != original:
        raise RuntimeError('stopped-copy-byte-mismatch')
    write_private(WORK / 'operation.json', {'schema': 1, 'images': ids, 'originalData': original, 'copySource': str(DATA),
                                         'baseComposeSha256': hashlib.sha256(BASE.read_bytes()).hexdigest()})
    stop_owned('sfu', OLD['sfu'])
    for name in ['sfu', 'server']:
        compose(['-f', str(WORK / 'activate.json')], ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', name])
    print(json.dumps({**summary, 'started': True, 'originalDataRetained': True, 'healthAndRealClientChecksPending': True}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--phase', choices=['inspect', 'load', 'activate', 'rollback'], default='inspect')
    parser.add_argument('--tar-directory', default='.')
    try:
        main(parser.parse_args())
    except Exception as e:
        # Never print compose config, env, DB rows, private keys or process stderr.
        print(json.dumps({'failed': True, 'safeError': str(e) if isinstance(e, RuntimeError) else type(e).__name__,
                          'automaticDeletionOrForceKill': False}))
        raise SystemExit(1)
