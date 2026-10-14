"""Enable one existing Gryt capability; no image, SFU, ET or database changes."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

SERVER = 'laokuailiao-server'
SFU = 'laokuailiao-sfu'
SERVER_IMAGE = 'sha256:34cde4c1b3744568269bed640feec49706329da0ec8d1fb85a9feb1c8dea1425'
SFU_IMAGE = 'sha256:585f0a76df9420f228f7b47020c35247cb76524f63125ea7c5bf49bb8ee9cd7b'
ROOT = Path('/opt/stacks/gryt/voice-member-move-20261014-r1')
GATE = 'VOICE_ATOMIC_MOVE_ENABLED'

def run(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise RuntimeError('command-failed:' + Path(args[0]).name)
    return result.stdout

def inspect(name):
    return json.loads(run(['docker', 'inspect', name]))[0]

def environment(row):
    values = [item.split('=', 1) for item in row['Config']['Env']]
    result = dict(values)
    if len(result) != len(values):
        raise RuntimeError('duplicate-environment')
    return result

def compose(files, args):
    command = ['docker', 'compose', '-p', 'laokuailiao']
    for file in files:
        command += ['-f', str(file)]
    return run(command + args)

def config(files):
    return json.loads(compose(files, ['config', '--format', 'json']))

def assert_delta(before, after):
    expected = copy.deepcopy(before)
    expected['services']['server'].setdefault('environment', {})[GATE] = 'true'
    if expected != after:
        raise RuntimeError('delta-outside-voice-move-gate')

def shape(row):
    return {key: row['Config'].get(key) for key in ['Image', 'Cmd', 'Entrypoint', 'User', 'WorkingDir']} | {
        'environment': environment(row),
        'mounts': sorted(row['Mounts'], key=lambda entry: entry['Destination']),
        'host': {key: value for key, value in row['HostConfig'].items() if key != 'ContainerIDFile'},
    }

def peers():
    ids = run(['docker', 'ps', '-q']).split()
    rows = json.loads(run(['docker', 'inspect', *ids]))
    return {row['Name']: [row['Id'], row['Image'], row['State']['StartedAt']]
            for row in rows if row['Name'] != '/' + SERVER}

def proxy():
    return run(['systemctl', 'show', 'laokuai-community-et-management.service',
                '--property=ActiveState', '--property=MainPID', '--property=ExecMainStartTimestampMonotonic'])

def files_for(row):
    labels = row['Config']['Labels']
    if labels.get('com.docker.compose.project') != 'laokuailiao' or labels.get('com.docker.compose.service') != 'server':
        raise RuntimeError('unknown-compose-project')
    files = labels['com.docker.compose.project.config_files'].split(',')
    for file in files:
        path = Path(file)
        if not path.is_absolute() or not path.is_file() or not path.resolve().is_relative_to('/opt/stacks/gryt'):
            raise RuntimeError('unknown-compose-file')
    return files

def healthy(row):
    return row['State'].get('Health', {}).get('Status') == 'healthy'

def baseline():
    server, sfu = inspect(SERVER), inspect(SFU)
    values = environment(server)
    if server['Image'] != SERVER_IMAGE or sfu['Image'] != SFU_IMAGE or not healthy(server) or not healthy(sfu):
        raise RuntimeError('image-or-health-baseline-changed')
    if values.get('VOICE_MAX_USERS') != '12' or values.get('LAOKUAI_MEMBER_RELAY_POLICY_V2') != '1' or GATE in values:
        raise RuntimeError('policy-baseline-changed')
    files = files_for(server)
    before = config(files)
    if GATE in before['services']['server'].get('environment', {}):
        raise RuntimeError('compose-gate-already-present')
    return server, files, before

def save(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2)
    os.chmod(ROOT / name, 0o600)

def wait_healthy():
    for _ in range(45):
        row = inspect(SERVER)
        if healthy(row):
            return row
        time.sleep(1)
    raise RuntimeError('server-health-timeout')

def verify_saved_files(saved):
    for file, digest in saved['composeHashes'].items():
        if hashlib.sha256(Path(file).read_bytes()).hexdigest() != digest:
            raise RuntimeError('prior-compose-file-changed')

def unchanged_other_services(saved):
    if peers() != saved['peers'] or proxy() != saved['proxy']:
        raise RuntimeError('other-service-changed')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=['inspect', 'activate', 'rollback'])
    args = parser.parse_args()
    if args.phase == 'inspect':
        server, files, _ = baseline()
        print(json.dumps({'status': 'ready', 'serverImage': server['Image'], 'sfuImage': SFU_IMAGE,
                          'existingOverlays': len(files), 'gateBefore': 'unset', 'gateAfter': 'true',
                          'restartServices': ['server'], 'maxUsers': 12}))
        return
    if args.phase == 'rollback':
        saved = json.loads((ROOT / 'baseline.private.json').read_text())
        verify_saved_files(saved)
        live = inspect(SERVER)
        expected = copy.deepcopy(saved['shape'])
        expected['environment'][GATE] = 'true'
        if shape(live) != expected or files_for(live) != saved['files'] + [str(ROOT / 'activation.overlay.json')]:
            raise RuntimeError('rollback-live-state-changed')
        compose(saved['files'], ['up', '-d', '--no-deps', '--pull', 'never', '--force-recreate', 'server'])
        if shape(wait_healthy()) != saved['shape']:
            raise RuntimeError('rollback-shape-mismatch')
        unchanged_other_services(saved)
        print(json.dumps({'status': 'rolled-back', 'gate': 'unset', 'restartServices': ['server']}))
        return
    server, files, before = baseline()
    ROOT.mkdir(mode=0o700, exist_ok=False)
    saved = {'files': files, 'shape': shape(server), 'peers': peers(), 'proxy': proxy(),
             'composeHashes': {file: hashlib.sha256(Path(file).read_bytes()).hexdigest() for file in files}}
    save('baseline.private.json', saved)
    save('compose.before.private.json', before)
    save('activation.overlay.json', {'services': {'server': {'environment': {GATE: 'true'}}}})
    after_files = files + [str(ROOT / 'activation.overlay.json')]
    assert_delta(before, config(after_files))
    verify_saved_files(saved)
    try:
        compose(after_files, ['up', '-d', '--no-deps', '--pull', 'never', '--force-recreate', 'server'])
        expected = copy.deepcopy(saved['shape'])
        expected['environment'][GATE] = 'true'
        if shape(wait_healthy()) != expected:
            raise RuntimeError('live-shape-mismatch')
        unchanged_other_services(saved)
    except Exception:
        compose(files, ['up', '-d', '--no-deps', '--pull', 'never', '--force-recreate', 'server'])
        if shape(wait_healthy()) != saved['shape']:
            raise RuntimeError('activation-failed-and-rollback-unconfirmed')
        raise RuntimeError('activation-failed-rolled-back') from None
    result = {'status': 'enabled', 'gate': 'true', 'serverImage': SERVER_IMAGE, 'sfuImage': SFU_IMAGE,
              'restartServices': ['server'], 'existingOverlaysPreserved': len(files), 'maxUsers': 12,
              'allOtherEnvironmentPortsMountsPreserved': True, 'otherServicesUnchanged': True,
              'databaseModifiedByOperator': False, 'backupOnServerOnly': True}
    save('activation-receipt.json', result)
    print(json.dumps(result))

if __name__ == '__main__':
    main()
