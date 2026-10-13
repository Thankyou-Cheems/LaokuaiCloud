"""Prepare/activate one Gryt image, or independently stage the existing proxy.
No SSH transport, credential export, ET command, SFU restart or relay enablement.
All live baseline identities/configuration are discovered on the target host.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import time

PROJECT='laokuailiao'
SERVER='laokuailiao-server'
SFU='laokuailiao-sfu'
PROXY_UNIT='laokuai-community-et-management.service'
PROXY_FILE=Path('/usr/local/libexec/laokuai-community-et-management/proxy.py')
WORK=None

def run(args,timeout=60):
    result=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
    if result.returncode:raise RuntimeError('command-failed:'+Path(args[0]).name)
    return result.stdout
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def read(name):return json.loads((WORK/name).read_text(encoding='utf-8'))
def save(name,value):
    with (WORK/name).open('x',encoding='utf-8') as output:json.dump(value,output,indent=2)
    os.chmod(WORK/name,0o600)
def inspect(name):return json.loads(run(['docker','inspect',name]))[0]
def env(row):
    pairs=[value.split('=',1) for value in row['Config']['Env']]
    if len(dict(pairs))!=len(pairs):raise RuntimeError('duplicate-environment-key')
    return dict(pairs)
def shape(row):
    mounts=row['Mounts']
    if len({m['Destination'] for m in mounts})!=len(mounts):raise RuntimeError('duplicate-mount-target')
    host={k:v for k,v in row['HostConfig'].items() if k!='ContainerIDFile'}
    return {'host':host,'mounts':sorted(mounts,key=lambda m:m['Destination']),
        'environment':env(row),'cmd':row['Config']['Cmd'],'entrypoint':row['Config']['Entrypoint'],
        'user':row['Config']['User'],'workdir':row['Config']['WorkingDir']}
def compose(files,command):
    args=['docker','compose','-p',PROJECT]
    for file in files:args+=['-f',str(file)]
    return run(args+command,120)
def config(files):return json.loads(compose(files,['config','--format','json']))
def live_files(row):
    labels=row['Config'].get('Labels') or {}
    if labels.get('com.docker.compose.project')!=PROJECT or labels.get('com.docker.compose.service')!='server':raise RuntimeError('unexpected-server-project')
    files=labels.get('com.docker.compose.project.config_files','').split(',')
    if not files or any(not Path(f).is_absolute() or not Path(f).is_file() or not str(Path(f).resolve()).startswith('/opt/stacks/gryt/') for f in files):raise RuntimeError('unknown-live-compose-files')
    return files
def only_image_delta(before,after,image):
    expected=copy.deepcopy(before);expected['services']['server']['image']=image
    if expected!=after:raise RuntimeError('compose-delta-outside-server-image')
def relay_backend_closed(row):
    if env(row).get('LAOKUAI_MEMBER_RELAY_POLICY_V2') not in (None,'0'):raise RuntimeError('backend-relay-gate-not-closed')
def proxy_metadata():
    # Capture only configured environment for policy inspection; never print it.
    fields=run(['systemctl','show',PROXY_UNIT,'--property=Environment','--property=ActiveState','--property=MainPID','--property=ExecMainStartTimestampMonotonic'])
    values=dict(line.split('=',1) for line in fields.splitlines() if '=' in line)
    pairs=[part.split('=',1) for part in shlex.split(values.get('Environment','')) if '=' in part]
    environment=dict(pairs)
    if len(environment)!=len(pairs):raise RuntimeError('duplicate-proxy-environment')
    if environment.get('MEMBER_RELAY_POLICY_VERSION') not in (None,'1'):raise RuntimeError('proxy-relay-gate-not-closed')
    return {'active':values.get('ActiveState'),'pid':values.get('MainPID'),'started':values.get('ExecMainStartTimestampMonotonic'),
        'relayGate':'closed','sourceSha256':digest(PROXY_FILE) if PROXY_FILE.is_file() else None}
def unchanged_peers():
    before=read('baseline.private.json')['sfu'];after=inspect(SFU)
    if any(after[k]!=before[k] for k in ('Id','Image')) or after['State']['StartedAt']!=before['State']['StartedAt']:raise RuntimeError('sfu-changed')
    # No ET command is issued. Preserve the existing management process for a
    # server-only update; it is the independent boundary available on this host.
    if proxy_metadata()!=read('proxy.before.json'):raise RuntimeError('management-proxy-changed')
def input_spec():
    spec=read('input.json');commit=spec.get('sourceCommit')
    if not isinstance(commit,str) or len(commit)!=40 or any(c not in '0123456789abcdef' for c in commit) or spec.get('sourceWorkingTree') is not False:raise RuntimeError('source-not-frozen')
    source=read('source-input.json')
    if source.get('sourceCommit')!=commit or source.get('workingTree') is not False or digest(WORK/'source-input.json')!=spec['sourceInputSha256']:raise RuntimeError('source-input-pin-mismatch')
    if digest(WORK/'bundle.js')!=spec['bundleSha256'] or (WORK/'bundle.js').stat().st_size!=spec['bundleBytes']:raise RuntimeError('bundle-pin-mismatch')
    if digest(Path(__file__))!=spec['operatorSha256']:raise RuntimeError('operator-pin-mismatch')
    return spec
def discover():
    row=inspect(SERVER);sfu=inspect(SFU);relay_backend_closed(row)
    if row['Config']['WorkingDir']!='/app' or row['Config']['Cmd']!=['node','bundle.js']:raise RuntimeError('unknown-server-entrypoint')
    if row['State'].get('Health',{}).get('Status')!='healthy' or sfu['State'].get('Health',{}).get('Status')!='healthy':raise RuntimeError('baseline-not-healthy')
    files=live_files(row);merged=config(files)
    if env(row).get('VOICE_MAX_USERS')!='12' or merged['services']['server']['environment'].get('VOICE_MAX_USERS')!='12':raise RuntimeError('voice-cap-not-12')
    proxy=proxy_metadata()
    return row,sfu,files,merged,proxy
def inspect_phase():
    row,sfu,files,merged,proxy=discover()
    return {'readOnly':True,'serverImage':row['Image'],'serverContainer':row['Id'],'sfuImage':sfu['Image'],'sfuContainer':sfu['Id'],
        'composeFiles':files,'voiceMaxUsers':12,'backendRelayGate':'closed','proxyRelayGate':proxy['relayGate'],
        'configurationValuesPrinted':False,'runtimeStarted':False}
def build():
    spec=input_spec();row,sfu,files,merged,proxy=discover()
    save('baseline.private.json',{'server':row,'sfu':sfu});save('compose.before.private.json',merged)
    save('compose-files.json',files);save('compose.hashes.json',{f:digest(f) for f in files});save('proxy.before.json',proxy)
    base=row['Image'];base_tag='local.laokuai/community-network-v2-base:'+spec['sourceCommit'][:12]
    run(['docker','tag',base,base_tag])
    dockerfile='FROM '+base_tag+'\nCOPY --chown=1001:1001 bundle.js /app/bundle.js\nLABEL org.opencontainers.image.revision="'+spec['sourceCommit']+'"\n'
    (WORK/'Dockerfile').write_text(dockerfile,encoding='utf-8');(WORK/'.dockerignore').write_text('*\n!Dockerfile\n!bundle.js\n',encoding='utf-8')
    tag='local.laokuai/community-network-v2:'+spec['sourceCommit'][:12]
    run(['docker','build','--network=none','--pull=false','-t',tag,str(WORK)],180)
    image=inspect(tag)['Id'];overlay={'services':{'server':{'image':image}}};save('activation.overlay.json',overlay)
    only_image_delta(merged,config(files+[str(WORK/'activation.overlay.json')]),image)
    receipt={'sourceCommit':spec['sourceCommit'],'sourceInputSha256':spec['sourceInputSha256'],'bundleBytes':spec['bundleBytes'],
        'bundleSha256':spec['bundleSha256'],'baseImage':base,'candidateImage':image,'onlyServerImageChanges':True,
        'relayGates':'closed','network':'none','runtimeStarted':False,'sfuRestarted':False,'etTouched':False,'proxyTouched':False}
    save('BUILD.json',receipt);return receipt
def healthy(image):
    deadline=time.monotonic()+65
    while time.monotonic()<deadline:
        row=inspect(SERVER)
        if row['Image']==image and row['State'].get('Health',{}).get('Status')=='healthy':return row
        time.sleep(1)
    raise RuntimeError('server-health-timeout')
def rollback(automatic=False):
    # This operator only activates closed gates. An enabled V2 deployment must
    # complete COMMUNITY-RELAY-V2.md prerequisites before any older-image rollback.
    current=inspect(SERVER);relay_backend_closed(current);proxy_metadata()
    original=read('baseline.private.json')['server']
    if (WORK/'RELAY-V2-EVER-ENABLED.json').exists():raise RuntimeError('enabled-v2-requires-reviewed-downgrade-first')
    if current['Image'] not in (original['Image'],read('BUILD.json')['candidateImage']) or (not automatic and shape(current)!=shape(original)):raise RuntimeError('rollback-live-state-outside-initial-deployment')
    compose([WORK/'compose.before.private.json'],['up','-d','--no-deps','--no-build','--pull','never','server'])
    restored=healthy(original['Image']);unchanged_peers()
    if shape(restored)!=shape(original):raise RuntimeError('rollback-runtime-drift')
    return {'rolledBack':True,'serverImage':original['Image'],'relayGates':'closed','sfuRestarted':False,'etTouched':False,'proxyTouched':False}
def activate():
    built=read('BUILD.json');input_spec();old=read('baseline.private.json')['server'];current=inspect(SERVER)
    if current['Id']!=old['Id'] or current['Image']!=old['Image']:raise RuntimeError('live-server-changed')
    relay_backend_closed(current);unchanged_peers()
    if any(digest(path)!=sha for path,sha in read('compose.hashes.json').items()):raise RuntimeError('compose-changed')
    files=read('compose-files.json');only_image_delta(read('compose.before.private.json'),config(files+[str(WORK/'activation.overlay.json')]),built['candidateImage'])
    try:
        compose(files+[str(WORK/'activation.overlay.json')],['up','-d','--no-deps','--no-build','--pull','never','--timeout','20','server'])
        now=healthy(built['candidateImage']);relay_backend_closed(now)
        if shape(now)!=shape(old):
            save('runtime-drift.private.json',{'before':shape(old),'after':shape(now)});raise RuntimeError('runtime-config-drift')
        unchanged_peers()
        receipt={**built,'runtimeStarted':True,'activated':True,'serverHealth':'healthy','dataPreserved':True,'configurationPreserved':True,
            'portsChanged':False,'mountsChanged':False,'environmentChanged':False,'voiceMaxUsers':12,'oldImageKept':True,'rollbackAvailable':True}
        save('ACTIVATED.json',receipt);return receipt
    except Exception:
        result=rollback(automatic=True);save('AUTO-ROLLBACK.json',result);raise
def proxy_stage():
    spec=input_spec();metadata=proxy_metadata()
    if not PROXY_FILE.is_file() or digest(WORK/'proxy.py')!=spec['proxySha256'] or (WORK/'proxy.py').stat().st_size!=spec['proxyBytes']:raise RuntimeError('proxy-pin-mismatch')
    # Independent preparation only; no install, restart, ledger or unit mutation.
    run(['python3','-I','-c','import ast,pathlib,sys;ast.parse(pathlib.Path(sys.argv[1]).read_text())',str(WORK/'proxy.py')])
    save('PROXY-STAGED.json',{'sourceCommit':spec['sourceCommit'],'candidateProxySha256':spec['proxySha256'],'baselineProxySha256':metadata['sourceSha256'],
        'relayGate':'closed','installed':False,'unitChanged':False,'restarted':False})
    return read('PROXY-STAGED.json')

if __name__=='__main__':
    os.umask(0o077)
    parser=argparse.ArgumentParser();parser.add_argument('phase',choices=['inspect','build','activate','rollback','proxy-stage'])
    parser.add_argument('--work',required=True,type=Path);arguments=parser.parse_args();WORK=arguments.work.resolve()
    try:
        if not str(WORK).startswith('/opt/stacks/gryt/community-network-v2-') or not WORK.is_dir():raise RuntimeError('invalid-work-directory')
        print(json.dumps({'inspect':inspect_phase,'build':build,'activate':activate,'rollback':rollback,'proxy-stage':proxy_stage}[arguments.phase]()))
    except Exception as error:
        # Never emit command stdout/stderr, Docker inspect, environment or logs.
        print(json.dumps({'failed':True,'reason':str(error) if isinstance(error,RuntimeError) else type(error).__name__}));raise SystemExit(1)
