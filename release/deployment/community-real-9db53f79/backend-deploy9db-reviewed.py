"""Approved real server+fixed SFU deployment, using original real data in place.
No private ET query, identity minting, credential export or public image push.
"""
import copy,hashlib,json,os,pathlib,subprocess,sys,time,urllib.request
os.umask(0o077)
STAGE=pathlib.Path('/opt/stacks/gryt/community-et-real-9db53f79')
PUBLIC_STAGE=pathlib.Path('/opt/stacks/gryt/community-et-real-8f8dd7c1')
BASE=pathlib.Path('/opt/stacks/gryt/compose.yml')
DATA=pathlib.Path('/opt/stacks/gryt/data')
SOCKET_DIR='/run/laokuai-community-et'
NEW={
 'server':{'manifest':'sha256:a7719c6938fbbdcb6970ae1825326dfd7f3ca5b0ff27f5f96d02c09c31f69700','config':'sha256:3c11acf9c0c76a44793e42513574c0de7a6ff182b333d4071e8927a91769acfc','source':'9db53f79ec1cbf9408b51e0733e6071b00f192a1','tree':'33c7d06425607a5f93e4ed3d41453cb3f9ff8c10','tar':'server-9db53f79-linux-amd64.docker.tar','sha':'0f24c25814743f682577f65bcba45640eaf839ce7d05a333056a2f9054209164'},
 'sfu':{'manifest':'sha256:d38ed22ddbed419661ba20b2c0bf008b18d07e05446c0c813c05a022883aafc6','config':'sha256:2b6afca88c4f7d6912c044d3b114d17af56104a4fce95ca7dc14cf0f04ec3a8f','source':'011f12b92af2732cc6a86a088c5f753dfd5c1a14','tree':'3d64d5904681d59590be940870ce045e5c1577ff','tar':'sfu-011f12b9-linux-amd64.docker.tar','sha':'102fba9de73bb8eb9cb5e47171e5938330635a9dc827e27085ea800a632ceaaf'}}
FLAGS={'server':{'VOICE_HYBRID_ENABLED':'true','SERVER_VERSION':'1.0.76-laokuai.community.9db53f79'},'sfu':{'SFU_HYBRID_ENABLED':'true','SFU_AUDIO_ONLY':'true','SFU_REQUIRE_CLIENT_TOKEN':'true','SFU_CONTROL_PORT':'9092','SFU_METRICS_PORT':'0','ICE_UDP_MUX_PORT':'3478'}}
def run(args,timeout=30):
 r=subprocess.run(args,capture_output=True,timeout=timeout)
 if r.returncode:raise RuntimeError('command-failed:'+pathlib.Path(args[0]).name)
 return r.stdout
def sha(data):return hashlib.sha256(data).hexdigest()
def write_new(file,data):
 if not isinstance(data,bytes):data=json.dumps(data,indent=2).encode()
 fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as out:out.write(data);out.flush();os.fsync(out.fileno())
def inspect(ref):return json.loads(run(['docker','inspect',ref]))[0]
def compose(extra=(),op=('config','--format','json')):return run(['docker','compose','-p','laokuailiao','-f',str(BASE),*extra,*op],timeout=60)
def info():
 with urllib.request.urlopen('https://voice.ruikang.wang/info',timeout=8) as response:
  data=response.read(131073)
 if len(data)>131072:raise RuntimeError('info-bound')
 v=json.loads(data);server_id=v.get('serverId') or v.get('server_id') or v.get('server_info',{}).get('server_id')
 if server_id is not None and not isinstance(server_id,str):raise RuntimeError('invalid-discovery-hint')
 return {'serverId':server_id,'version':v.get('version') or v.get('server_info',{}).get('version')}
EXPECTED_SCOPE='老蒯聊_5000_default'
def runtime_identity(container):
 # Execute only the existing runtime getter algorithm and its three nonsecret
 # inputs inside the actual existing/new server, without any JWT/profile read.
 js='const inputs={serverName:process.env.SERVER_NAME??null,port:process.env.PORT??null,instanceId:process.env.SERVER_INSTANCE_ID??null};const n=(inputs.serverName||"unknown_server").replace(/\\s+/g,"_").toLowerCase();const p=inputs.port??"5000";const i=inputs.instanceId||"default";console.log(JSON.stringify({inputs,serverId:n+"_"+p+"_"+i}));'
 v=json.loads(run(['docker','exec',container,'node','-e',js],timeout=8))
 if v.get('serverId')!=EXPECTED_SCOPE:raise RuntimeError('existing-runtime-namespace-mismatch')
 return v
def candidate(name):
 pin=NEW[name]
 for ref in (pin['manifest'],pin['config']):
  try:d=inspect(ref)
  except RuntimeError:continue
  labels=d['Config'].get('Labels') or {}
  if d['Id'] not in (pin['manifest'],pin['config']) or d.get('Os')!='linux' or d.get('Architecture')!='amd64' or labels.get('org.opencontainers.image.revision')!=pin['source'] or labels.get('local.laokuai.component-tree')!=pin['tree']:raise RuntimeError('candidate-source-identity')
  return d['Id']
 raise RuntimeError('candidate-not-loaded')
def load():
 for name,pin in NEW.items():
  if name=='sfu':candidate(name);continue
  file=STAGE/pin['tar']
  if sha(file.read_bytes())!=pin['sha']:raise RuntimeError('tar-sha-mismatch')
  run(['docker','load','--input',str(file)],timeout=180)
 result={'loaded':{name:candidate(name) for name in NEW},'productStarted':False,'tarHashesMatched':True}
 write_new(STAGE/'IMAGES-LOADED.json',result);return result
def prepare():
 loaded={n:candidate(n) for n in NEW};base=json.loads(compose());public=info();activation=json.loads((PUBLIC_STAGE/'ACTIVATION.json').read_text());runtime=runtime_identity('laokuailiao-server')
 if not activation['activated'] or activation['socketUid']!=1001:raise RuntimeError('management-not-active')
 before={n:inspect('laokuailiao-'+n) for n in NEW}
 for n,d in before.items():
  labels=d['Config'].get('Labels') or {}
  if labels.get('com.docker.compose.project')!='laokuailiao' or labels.get('com.docker.compose.service')!=n:raise RuntimeError('wrong-real-stack')
 mounts=[m for m in before['server']['Mounts'] if m['Destination']=='/data']
 if len(mounts)!=1 or mounts[0]['Source']!=str(DATA) or not mounts[0]['RW']:raise RuntimeError('real-data-mount-mismatch')
 overlay={'services':{n:{'image':loaded[n],'environment':FLAGS[n]} for n in NEW}}
 overlay['services']['server']['volumes']=[{'type':'bind','source':SOCKET_DIR,'target':SOCKET_DIR,'read_only':True}]
 file=STAGE/'backend-sfu.override.json';write_new(file,overlay)
 effective=json.loads(compose(['-f',str(file)]));expected=copy.deepcopy(base)
 for n in NEW:expected['services'][n]['image']=loaded[n];expected['services'][n].setdefault('environment',{}).update(FLAGS[n])
 # Compose normalizes bind metadata. Compare added socket mount after removing
 # it; every pre-existing service/data/port/environment definition remains exact.
 server=effective['services']['server'];socket_mounts=[v for v in server.get('volumes',[]) if v.get('target')==SOCKET_DIR]
 if len(socket_mounts)!=1 or socket_mounts[0].get('source')!=SOCKET_DIR or socket_mounts[0].get('read_only') is not True:raise RuntimeError('socket-mount-drift')
 effective_without=copy.deepcopy(effective);effective_without['services']['server']['volumes']=[v for v in server['volumes'] if v.get('target')!=SOCKET_DIR]
 if effective_without!=expected:raise RuntimeError('compose-exceeded-exact-allowlist')
 rollback={'services':{n:{'image':before[n]['Image'],'environment':base['services'][n].get('environment',{})} for n in NEW}}
 write_new(STAGE/'backend-before.private.json',before);write_new(STAGE/'backend-sfu.rollback.json',rollback)
 # Public deployment parameters only; existing JWT/SQLite remain in place.
 sid=runtime['serverId'];config={'schemaVersion':1,'approved':True,'expiresAtUnixMs':int(time.time()*1000)+3600000,'credentialWritesApproved':False,'trustedServerOrigin':'https://voice.ruikang.wang','nativeRuntimeGeneration':activation['nativeRuntimeGeneration'],
  'service':{'serverInstanceId':sid,'communityId':sid,'networkName':'CheemsP2P','networkRevision':1,'bootstrapProfileId':'laokuai-public270-9db53f79','virtualIpPool':['10.203.217.2'],'authority':{'adminInstanceId':activation['instanceId'],'upstreamCommit':'8b7f1f0196edb5b580829ed5f135050fb5853478','groups':['laokuai-member']},'ttlSeconds':300},
  'provider':{'adminInstanceId':activation['instanceId'],'expectedVersion':'2.7.0-8b7f1f01','endpoint':{'host':'127.0.0.1','port':15890,'timeoutMs':1000}},'managementSocketPath':activation['managementSocket']}
 target=DATA/'community-et-deployment.json'
 if os.path.lexists(target):raise RuntimeError('existing-et-deployment-requires-review')
 # Activation writes this file only after the stopped consistent data backup.
 write_new(STAGE/'community-et-deployment.proposed.json',config)
 result={'prepared':True,'activated':False,'imageIds':loaded,'realServerId':sid,'runtimeIdentityBefore':runtime,'publicInfoBefore':public,'baseComposeSha256':sha(BASE.read_bytes()),'overlaySha256':sha(file.read_bytes()),'newPublicPorts':[],'dataInPlace':True,'credentialWritesEnabled':False,'managementMountReadOnly':True,'beforeIds':{n:d['Id'] for n,d in before.items()}}
 write_new(STAGE/'BACKEND-PREPARATION.json',result);return result
def activate():
 r=json.loads((STAGE/'BACKEND-PREPARATION.json').read_text());before=json.loads((STAGE/'backend-before.private.json').read_text())
 if sha(BASE.read_bytes())!=r['baseComposeSha256'] or sha((STAGE/'backend-sfu.override.json').read_bytes())!=r['overlaySha256']:raise RuntimeError('prepared-compose-changed')
 for n,d in before.items():
  now=inspect('laokuailiao-'+n)
  if now['Id']!=d['Id'] or now['Image']!=d['Image']:raise RuntimeError('real-stack-changed-since-prepare')
 # Graceful TERM only, never kill9 or a name-based unknown process.
 started=time.monotonic()
 for n in ['server','sfu']:
  d=before[n]
  if d['State']['Running']:run(['docker','kill','--signal=TERM',d['Id']])
 for n,d in before.items():
  deadline=time.monotonic()+20
  while inspect(d['Id'])['State']['Running']:
   if time.monotonic()>deadline:raise RuntimeError('graceful-stop-timeout')
   time.sleep(.2)
 # Backup stays root0600 on this same user host, never exported or copied into
 # a test environment. New services use the original real DATA directory.
 backup=STAGE/'real-data-before.private.tar'
 if backup.exists():raise RuntimeError('existing-data-backup')
 run(['tar','-cf',str(backup),'-C',str(DATA),'.'],timeout=120);os.chmod(backup,0o600)
 config=json.loads((STAGE/'community-et-deployment.proposed.json').read_text())
 write_new(DATA/'community-et-deployment.json',config);os.chown(DATA/'community-et-deployment.json',1001,1001)
 compose(['-f',str(STAGE/'backend-sfu.override.json')],['up','-d','--no-deps','--no-build','--pull','never','sfu','server'])
 deadline=time.monotonic()+45
 while True:
  try:
   public=info();runtime=runtime_identity('laokuailiao-server');assert runtime==r['runtimeIdentityBefore'];break
  except Exception:
   if time.monotonic()>deadline:raise RuntimeError('new-real-backend-health-failed')
   time.sleep(.5)
 now={n:inspect('laokuailiao-'+n) for n in NEW}
 for n,d in now.items():
  if d['Image']!=r['imageIds'][n] or not d['State']['Running']:raise RuntimeError('new-real-image-identity')
  env=dict(x.split('=',1) for x in d['Config'].get('Env',[]) if '=' in x)
  prior_env=dict(x.split('=',1) for x in before[n]['Config'].get('Env',[]) if '=' in x)
  if any(env.get(k)!=v for k,v in FLAGS[n].items()) or any(env.get(k)!=prior_env.get(k) for k in ['JWT_SECRET','SERVER_PASSWORD','SERVER_NAME','PORT','SERVER_INSTANCE_ID']):raise RuntimeError('new-real-config-identity')
 sm=[m for m in now['server']['Mounts'] if m['Destination']==SOCKET_DIR]
 dm=[m for m in now['server']['Mounts'] if m['Destination']=='/data']
 if len(sm)!=1 or sm[0]['RW'] or len(dm)!=1 or dm[0]['Source']!=str(DATA):raise RuntimeError('new-real-mount-identity')
 result={**r,'activated':True,'containers':{n:{'id':d['Id'],'imageId':d['Image'],'running':d['State']['Running']} for n,d in now.items()},'publicInfoAfter':public,'runtimeIdentityAfter':runtime,'versionConfigVerified':'1.0.76-laokuai.community.9db53f79','publicVersionHiddenForNonmemberAsDesigned':public['version'] is None,'jwtSecretPreserved':True,'elapsedSeconds':round(time.monotonic()-started,3),'originalRealDataRetained':True,'consistentBackupMade':True,'credentialWritesEnabled':False,'windowsNativeStarted':False,'privateEtQueried':False}
 write_new(STAGE/'BACKEND-ACTIVATION.json',result);return result
if __name__ == "__main__":
 try:
  mode=json.load(sys.stdin)['mode']
  result=load() if mode=='load' else prepare() if mode=='prepare' else activate() if mode=='activate' else None
  if result is None:raise RuntimeError('invalid-mode')
  print(json.dumps(result))
 except Exception as error:
  print(json.dumps({'passed':False,'stableError':str(error) if type(error) is RuntimeError else 'operator-validation-failed'}),file=sys.stderr);sys.exit(1)
