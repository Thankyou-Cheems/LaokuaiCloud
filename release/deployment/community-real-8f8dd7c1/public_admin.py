"""Existing public service only. Private ET is never queried.
Inputs are reviewed helper/service bytes, not keys. Secrets are generated/stored
on the user's cloud host; only public fingerprints/status leave this program.
"""
import base64, hashlib, ipaddress, json, os, pathlib, subprocess, sys, time
INSTANCE='e2a5bd9d-47bb-4120-8589-e6898112ae85'
CORE_SHA='f55f7b2116afc6ebe18f86ebf37802ce9991e71fd0053978522932c45218aec5'
NATIVE=pathlib.Path('/etc/easytier-cheemsp2p')
STAGE=pathlib.Path('/opt/stacks/gryt/community-et-real-8f8dd7c1')
CONFIG=NATIVE/'laokuai-community-admin.toml'
STORE=NATIVE/'laokuai-community-credentials.json'
OVERRIDE=STAGE/'public-admin.override.json'
UNIT=pathlib.Path('/etc/systemd/system/laokuai-community-et-management.service')
PROGRAM=pathlib.Path('/usr/local/libexec/laokuai-community-et-management/proxy.py')
EXPECTED_VERSION='easytier-core 2.7.0-8b7f1f01'
def run(args,input=None,timeout=30):
 r=subprocess.run(args,input=input,capture_output=True,timeout=timeout)
 if r.returncode: raise RuntimeError('command-failed:'+pathlib.Path(args[0]).name)
 return r.stdout
def sha(data):return hashlib.sha256(data).hexdigest()
def write_new(file,data,mode=0o600):
 if isinstance(data,str):data=data.encode()
 fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 with os.fdopen(fd,'wb') as out:out.write(data);out.flush();os.fsync(out.fileno())
def inspect():return json.loads(run(['docker','inspect','cheems-p2p']))[0]
def actual_core():
 rows=run(['docker','top','cheems-p2p','-eo','pid,comm']).decode().splitlines()[1:]
 pids=[int(r.split()[0]) for r in rows if len(r.split())==2 and r.split()[1]=='easytier-core']
 if len(pids)!=1:raise RuntimeError('public-core-identity')
 pid=pids[0];file=pathlib.Path('/proc/'+str(pid)+'/exe');digest=sha(file.read_bytes())
 version=run([str(file),'--version']).decode().strip()
 if digest!=CORE_SHA or version!=EXPECTED_VERSION:raise RuntimeError('public-core-incompatible')
 return {'pid':pid,'sha256':digest,'version':version,'startTicks':int(pathlib.Path('/proc/'+str(pid)+'/stat').read_text().rsplit(')',1)[1].split()[19])}
def args_without_logging(args):
 if not isinstance(args,list) or not args or not all(isinstance(x,str) for x in args):raise RuntimeError('public-command-shape')
 if '--config-file' in args or any(x.startswith('--config-file=') for x in args):raise RuntimeError('existing-public-config-requires-review')
 out=[];i=0
 while i<len(args):
  a=args[i]
  if a in ['--console-log-level','--file-log-level']:i+=2;continue
  if a.startswith('--console-log-level=') or a.startswith('--file-log-level='):i+=1;continue
  out.append(a);i+=1
 return out+['--console-log-level','off','--file-log-level','off','--config-file','/root/laokuai-community-admin.toml']
def public_nodes():
 v=json.loads(run(['docker','exec','cheems-p2p','/usr/local/bin/easytier-cli','-p','127.0.0.1:15890','-o','json','peer','ipv6']))
 rows=v.get('nodes',[]) if isinstance(v,dict) else v
 return [r for r in rows if r.get('inst_id')==INSTANCE]
def listener_check(pid):
 lines=run(['ss','-lntup']).decode().splitlines();owned=[x for x in lines if 'pid='+str(pid)+',' in x]
 portal=[x for x in owned if ':15890 ' in x]
 if len(portal)!=1 or '127.0.0.1' not in portal[0] or not any(':11014 ' in x and x.startswith('tcp') for x in owned) or not any(':11014 ' in x and x.startswith('udp') for x in owned):raise RuntimeError('public-listener-mismatch')
 return {'tcpUdp11014':True,'managementLoopback15890':True}
def prepare(payload):
 if os.getuid()!=0:raise RuntimeError('root-required-for-approved-provision')
 d=inspect();core=actual_core();listener_check(core['pid'])
 if d['HostConfig']['NetworkMode']!='host' or not public_nodes():raise RuntimeError('public-scope-mismatch')
 if not any(m['Source']==str(NATIVE) and m['Destination']=='/root' and m['RW'] for m in d['Mounts']):raise RuntimeError('public-persistent-mount')
 routes=json.loads(run(['ip','-j','-4','route','show','table','all']))
 candidate=ipaddress.ip_network('10.203.217.0/24')
 if any(candidate.overlaps(ipaddress.ip_network(r['dst'],strict=False)) for r in routes if r.get('dst') and r['dst']!='default'):raise RuntimeError('virtual-subnet-conflict')
 for f in [STAGE,CONFIG,STORE,UNIT,PROGRAM,pathlib.Path('/run/laokuai-community-et/public-management.sock')]:
  if os.path.lexists(f):raise RuntimeError('existing-owned-target-requires-reconciliation')
 helper=base64.b64decode(payload['proxyB64'],validate=True);unit=base64.b64decode(payload['unitB64'],validate=True)
 if sha(helper)!=payload['proxySha256'] or sha(unit)!=payload['unitSha256']:raise RuntimeError('reviewed-input-hash')
 run(['openssl','version']);STAGE.mkdir(mode=0o700)
 # Back up only this public container's config/command, never private ET/compose.
 write_new(STAGE/'public-before.private.json',json.dumps(d))
 private=run(['openssl','genpkey','-algorithm','X25519','-outform','DER'])
 if len(private)!=48 or private[:16]!=bytes.fromhex('302e020100300506032b656e04220420'):raise RuntimeError('x25519-private-format')
 public=run(['openssl','pkey','-inform','DER','-pubout','-outform','DER'],input=private)
 if len(public)!=44 or public[:12]!=bytes.fromhex('302a300506032b656e032100'):raise RuntimeError('x25519-public-format')
 secret=base64.b64encode(private[16:]).decode();public_b64=base64.b64encode(public[12:]).decode()
 # CLI still supplies the existing public network secret. One explicit file is
 # merged into that same instance. Never print config/command/private DER.
 config='instance_id = '+json.dumps(INSTANCE)+'\ncredential_file = "/root/laokuai-community-credentials.json"\n[network_identity]\nnetwork_name = "CheemsP2P"\n[secure_mode]\nenabled = true\nlocal_private_key = '+json.dumps(secret)+'\nlocal_public_key = '+json.dumps(public_b64)+'\n'
 write_new(CONFIG,config)
 command=args_without_logging(d['Config']['Cmd'])
 write_new(OVERRIDE,json.dumps({'services':{'cheems-p2p':{'command':command}}},indent=2))
 PROGRAM.parent.mkdir(parents=True,exist_ok=True,mode=0o755)
 if PROGRAM.parent.is_symlink():raise RuntimeError('unsafe-program-directory')
 os.chmod(PROGRAM.parent,0o755);write_new(PROGRAM,helper,0o644);write_new(UNIT,unit,0o644)
 # Validate only the reviewed Python syntax/unit; no helper listener yet.
 compile(helper,str(PROGRAM),'exec');run(['systemd-analyze','verify',str(UNIT)])
 receipt={'prepared':True,'activated':False,'instanceId':INSTANCE,'coreBefore':core,'publicKeyB64':public_b64,'publicKeySha256':sha(public[12:]),'configSha256':sha(config.encode()),'configMode':oct(CONFIG.stat().st_mode&0o777),'proxySha256':sha(helper),'unitSha256':sha(unit),'overrideSha256':sha(OVERRIDE.read_bytes()),'privateEtRead':False,'privateEtChanged':False}
 write_new(STAGE/'PREPARATION.json',json.dumps(receipt,indent=2));return receipt
def canonical_mounts(container):
 return sorted([(m['Type'],m['Source'],m['Destination'],m['RW'],m.get('Propagation')) for m in container['Mounts']],key=lambda m:m[2])
def activate(continue_only=False):
 receipt=json.loads((STAGE/'PREPARATION.json').read_text())
 if sha(CONFIG.read_bytes())!=receipt['configSha256'] or sha(PROGRAM.read_bytes())!=receipt['proxySha256'] or sha(UNIT.read_bytes())!=receipt['unitSha256'] or sha(OVERRIDE.read_bytes())!=receipt['overrideSha256']:raise RuntimeError('prepared-source-drift')
 before=json.loads((STAGE/'public-before.private.json').read_text());d=inspect()
 expected_command=json.loads(OVERRIDE.read_text())['services']['cheems-p2p']['command']
 if continue_only:
  if d['Id']==before['Id'] or d['Config']['Cmd']!=expected_command:raise RuntimeError('approved-activation-not-observed')
 else:
  if d['Id']!=before['Id'] or d['State']['Pid']!=before['State']['Pid']:raise RuntimeError('public-changed-since-prepare')
  run(['docker','compose','-p','homelab','-f','/opt/docker-compose.yml','-f',str(OVERRIDE),'up','-d','--no-deps','--no-build','--pull','never','--force-recreate','cheems-p2p'],timeout=60)
 deadline=time.monotonic()+20
 while True:
  try: core=actual_core();listeners=listener_check(core['pid']);nodes=public_nodes();assert len(nodes)==1;break
  except Exception:
   if time.monotonic()>deadline:raise RuntimeError('public-startup-health-failed')
   time.sleep(.5)
 d=inspect()
 # Core/image/mount/host permissions retained. No queries to private containers.
 if d['Image']!=before['Image'] or d['HostConfig']['NetworkMode']!=before['HostConfig']['NetworkMode'] or canonical_mounts(d)!=canonical_mounts(before) or sorted(d['Config']['Env'])!=sorted(before['Config']['Env']) or d['Config']['Entrypoint']!=before['Config']['Entrypoint'] or d['Config']['Cmd']!=expected_command or sorted(d['HostConfig']['CapAdd'])!=sorted(before['HostConfig']['CapAdd']) or d['HostConfig']['Devices']!=before['HostConfig']['Devices']:raise RuntimeError('public-runtime-scope-drift')
 run(['systemctl','daemon-reload']);run(['systemctl','start','laokuai-community-et-management.service'])
 socket_file=pathlib.Path('/run/laokuai-community-et/public-management.sock');deadline=time.monotonic()+5
 while not socket_file.exists():
  if time.monotonic()>deadline:raise RuntimeError('management-socket-not-ready')
  time.sleep(.1)
 info=socket_file.stat()
 if info.st_uid!=1001 or info.st_gid!=1001 or (info.st_mode&0o777)!=0o600:raise RuntimeError('management-permissions')
 result={**receipt,'activated':True,'containerId':d['Id'],'coreAfter':core,'listeners':listeners,'nativeRuntimeGeneration':core['startTicks'],'publicKeyPersistentConfigured':True,'credentialStoreConfigured':True,'managementSocket':str(socket_file),'socketUid':info.st_uid,'socketGid':info.st_gid,'socketMode':'0600','socketInode':info.st_ino,'managementServiceActive':True,'credentialWritesPerformed':False}
 write_new(STAGE/'ACTIVATION.json',json.dumps(result,indent=2));return result
try:
 payload=json.load(sys.stdin)
 if payload['mode']=='prepare':result=prepare(payload)
 elif payload['mode']=='activate':result=activate()
 elif payload['mode']=='continue':result=activate(True)
 else:raise RuntimeError('unsupported-operation')
 print(json.dumps(result))
except Exception as error:
 # Only fixed operator errors; never subprocess/config/key exception text.
 message=str(error) if type(error) is RuntimeError else 'operator-validation-failed'
 print(json.dumps({'passed':False,'stableError':message}),file=sys.stderr);sys.exit(1)
