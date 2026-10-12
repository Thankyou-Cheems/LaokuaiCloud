"""Exact existing public community follow-up. Never output env/DB/keys."""
import base64,copy,hashlib,json,os,pathlib,sqlite3,stat,subprocess,sys,time,urllib.request
os.umask(0o077)
ROOT=pathlib.Path('/opt/stacks/gryt/community-password-beta-a5c557be')
SERVER='laokuailiao-server';OLD='sha256:3c11acf9c0c76a44793e42513574c0de7a6ff182b333d4071e8927a91769acfc'
COMMIT='a5c557be693520ade66dd896150327252716e561'
PROXY=pathlib.Path('/usr/local/libexec/laokuai-community-et-management/proxy.py')
OLD_PROXY='78229920c6fa5b8332ed508cada8ab00b78b871c7c3f4bd96bbf0d34643f0182'
DATA=pathlib.Path('/opt/stacks/gryt/data');POLICY=DATA/'community-et-deployment.json'
FILES=['/opt/stacks/gryt/compose.yml','/opt/stacks/gryt/community-et-real-9db53f79/backend-sfu.override.json','/opt/stacks/gryt/community-et-real-9db53f79/server-release-version.override.json']
VERSION='1.10.58-laokuai.beta.a5c557be'
def run(args,timeout=30):
 r=subprocess.run(args,capture_output=True,timeout=timeout)
 if r.returncode:raise RuntimeError('command-failed:'+pathlib.Path(args[0]).name)
 return r.stdout
def sha(b):return hashlib.sha256(b).hexdigest()
def inspect(name):return json.loads(run(['docker','inspect',name]))[0]
def save(file,value):
 b=value if isinstance(value,bytes) else json.dumps(value,indent=2).encode()
 fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
def compose(extra=(),operation=('config','--format','json')):
 args=['docker','compose','-p','laokuailiao']
 for f in [*FILES,*extra]:args+=['-f',f]
 return run([*args,*operation],60)
def core():
 p=pathlib.Path('/proc/1457878');fields=(p/'stat').read_text().split()
 assert int(fields[21])==134118291
 assert sha((p/'exe').read_bytes())=='f55f7b2116afc6ebe18f86ebf37802ce9991e71fd0053978522932c45218aec5'
 return {'pid':1457878,'generation':int(fields[21])}
def prepare(payload):
 assert not ROOT.exists(),'stage-already-exists'
 assert inspect(SERVER)['Id']=='4882f01da6ce9d0f0424c0a72714efc90bb8d2d24e8c1ed1f9a786c372779ba1'
 assert inspect(SERVER)['Image']==OLD and inspect(SERVER)['State']['Running']
 assert inspect(SERVER)['Config']['Labels']['com.docker.compose.project.config_files'].split(',')==FILES
 assert sha(PROXY.read_bytes())==OLD_PROXY
 bundle=base64.b64decode(payload['bundleB64'],validate=True);proxy=base64.b64decode(payload['proxyB64'],validate=True)
 assert len(bundle)<4000000 and sha(bundle)==payload['bundleSha256']
 assert len(proxy)<65536 and sha(proxy)==payload['proxySha256']
 # Resolve/require only the external libraries the source references; no app entry.
 js="for(const n of ['jose','undici','@gryt/crypto/mls-device-certificate','ts-mls/message.js','ts-mls/keyPackage.js','@gryt/crypto/mls-person-key','@gryt/crypto/dm-key-binding'])require(n);console.log('module-contract-pass');"
 assert run(['docker','exec',SERVER,'node','-e',js],15).strip()==b'module-contract-pass'
 ROOT.mkdir(mode=0o700);save(ROOT/'bundle.js',bundle);save(ROOT/'proxy.py',proxy);save(ROOT/'proxy-before.py',PROXY.read_bytes())
 save(ROOT/'policy-before.private.json',POLICY.read_bytes())
 before=json.loads(compose());save(ROOT/'compose-before.private.json',before)
 save(ROOT/'Dockerfile',('FROM local.laokuai/server-base-9db53f79:fixed\nCOPY --chown=1001:1001 bundle.js /app/bundle.js\nENV SERVER_VERSION='+VERSION+'\nLABEL org.opencontainers.image.revision="'+COMMIT+'" local.laokuai.component-tree="0adb89e04744e970ed40f9da4b4aa195cf853639" local.laokuai.base-image="'+OLD+'" local.laokuai.bundle-sha256="'+payload['bundleSha256']+'"\n').encode())
 run(['docker','tag',OLD,'local.laokuai/server-base-9db53f79:fixed'])
 run(['docker','build','--network=none','--pull=false','--cpuset-cpus=0,1','-t','local.laokuai/server-password-a5c557be:fixed',str(ROOT)],120)
 image=inspect('local.laokuai/server-password-a5c557be:fixed')['Id']
 overlay={'services':{'server':{'image':image,'environment':{'SERVER_VERSION':VERSION}}}}
 save(ROOT/'server-password.override.json',overlay)
 effective=json.loads(compose([str(ROOT/'server-password.override.json')]));expected=copy.deepcopy(before)
 expected['services']['server']['image']=image;expected['services']['server']['environment']['SERVER_VERSION']=VERSION
 assert effective==expected,'compose-scope-drift'
 receipt={'prepared':True,'sourceCommit':COMMIT,'image':image,'baseImage':OLD,'bundleSha256':sha(bundle),'proxySha256':sha(proxy),'core':core(),'sfuId':inspect('laokuailiao-sfu')['Id'],'serverId':inspect(SERVER)['Id'],'configFilesSha256':{f:sha(pathlib.Path(f).read_bytes()) for f in FILES},'newPorts':[],'newDependenciesInstalled':False,'activated':False}
 save(ROOT/'PREPARED.json',receipt);return receipt
def stopped(container):
 run(['docker','kill','--signal=TERM',container])
 deadline=time.monotonic()+20
 while inspect(container)['State']['Running']:
  assert time.monotonic()<deadline,'graceful-stop-timeout';time.sleep(.2)
def install():
 prepared=json.loads((ROOT/'PREPARED.json').read_text());before=json.loads((ROOT/'compose-before.private.json').read_text())
 assert inspect(SERVER)['Id']==prepared['serverId'] and inspect(SERVER)['Image']==OLD
 assert sha(PROXY.read_bytes())==OLD_PROXY and core()==prepared['core']
 assert all(sha(pathlib.Path(f).read_bytes())==h for f,h in prepared['configFilesSha256'].items())
 stopped(prepared['serverId']);db=sqlite3.connect(DATA/'gryt.db')
 snapshot=db.execute('SELECT id,owner_gryt_user_id,token_version,join_policy,lan_open,password_hash FROM server_config').fetchall()
 assert len(snapshot)==1 and snapshot[0][1],'existing-owner-required'
 save(ROOT/'admission-before.json',{'id':snapshot[0][0],'join_policy':snapshot[0][3],'lan_open':snapshot[0][4]})
 backup=sqlite3.connect(ROOT/'database-before.private.sqlite');db.backup(backup);backup.close();os.chmod(ROOT/'database-before.private.sqlite',0o600)
 db.execute("UPDATE server_config SET join_policy='password',lan_open=0 WHERE id=?",(snapshot[0][0],));db.commit()
 after=db.execute('SELECT id,owner_gryt_user_id,token_version,join_policy,lan_open,password_hash FROM server_config').fetchall()
 assert after[0][:3]==snapshot[0][:3] and after[0][5]==snapshot[0][5];db.close()
 cfg=json.loads(POLICY.read_text());assert cfg['service']['communityId']=='老蒯聊_5000_default' and cfg['nativeRuntimeGeneration']==134118291
 cfg.update(schemaVersion=2,expiresAtUnixMs=None,credentialWritesApproved=True)
 cfg['service']['virtualIpPool']=['10.203.217.'+str(i) for i in range(2,255)]
 assert cfg['service']['ttlSeconds']==300 and cfg['managementSocketPath']=='/run/laokuai-community-et/public-management.sock'
 save(ROOT/'policy-persistent.json',cfg);temp=POLICY.with_suffix('.beta-next');save(temp,cfg);os.chown(temp,1001,1001);os.replace(temp,POLICY)
 replacement=PROXY.with_suffix('.beta-next');save(replacement,(ROOT/'proxy.py').read_bytes());os.chmod(replacement,0o755);os.replace(replacement,PROXY)
 run(['systemctl','restart','laokuai-community-et-management.service'])
 deadline=time.monotonic()+8;socket=pathlib.Path('/run/laokuai-community-et/public-management.sock')
 while not socket.exists():
  assert time.monotonic()<deadline,'management-socket-not-ready';time.sleep(.1)
 info=socket.stat();assert stat.S_ISSOCK(info.st_mode) and info.st_uid==1001 and stat.S_IMODE(info.st_mode)==0o600
 compose([str(ROOT/'server-password.override.json')],['up','-d','--no-deps','--no-build','--pull','never','server'])
 deadline=time.monotonic()+45;public=None
 while time.monotonic()<deadline:
  try:
   with urllib.request.urlopen('https://voice.ruikang.wang/info',timeout=3) as response:public=json.loads(response.read(131072))
   if inspect(SERVER)['Image']==prepared['image'] and inspect(SERVER)['State']['Running']:break
  except Exception:pass
  time.sleep(.5)
 assert public is not None,'new-server-health-not-confirmed'
 assert VERSION==dict(e.split('=',1) for e in inspect(SERVER)['Config']['Env'])['SERVER_VERSION']
 assert run(['docker','exec',SERVER,'node','-e',"fetch('http://127.0.0.1:5000/health').then(r=>{if(!r.ok)process.exit(1);console.log('health-pass')}).catch(()=>process.exit(1))"]).strip()==b'health-pass'
 current=inspect(SERVER);assert current['Image']==prepared['image'] and current['State']['Running']
 assert inspect('laokuailiao-sfu')['Id']==prepared['sfuId'] and core()==prepared['core']
 receipt={**prepared,'activated':True,'serverContainerId':current['Id'],'serverVersion':VERSION,'joinPolicy':'password','passwordConfigured':bool(snapshot[0][5]),'passwordWrittenByOperator':False,'ownerAndTokenVersionPreserved':True,'persistentApprovedMemberDevices':True,'grantTtlSeconds':300,'virtualIpPoolAddresses':253,'productDeviceQuotaAdded':False,'proxySocketUid':1001,'proxySocketMode':'0600','privateEtTouched':False,'sfuRestarted':False,'publicCoreRestarted':False,'fullDeviceAcceptance':False}
 save(ROOT/'DEPLOYED.json',receipt);return receipt
def rollback():
 before=json.loads((ROOT/'compose-before.private.json').read_text())
 current=inspect(SERVER)
 assert current['Image'] in (OLD,json.loads((ROOT/'PREPARED.json').read_text())['image'])
 if current['State']['Running']:stopped(current['Id'])
 if (ROOT/'admission-before.json').exists():
  prior=json.loads((ROOT/'admission-before.json').read_text());db=sqlite3.connect(DATA/'gryt.db')
  db.execute('UPDATE server_config SET join_policy=?,lan_open=? WHERE id=?',(prior['join_policy'],prior['lan_open'],prior['id']));db.commit();db.close()
 temp=POLICY.with_suffix('.rollback-next');save(temp,(ROOT/'policy-before.private.json').read_bytes());os.chown(temp,1001,1001);os.replace(temp,POLICY)
 temp=PROXY.with_suffix('.rollback-next');save(temp,(ROOT/'proxy-before.py').read_bytes());os.chmod(temp,0o755);os.replace(temp,PROXY)
 run(['systemctl','restart','laokuai-community-et-management.service'])
 env=before['services']['server']['environment']
 save(ROOT/'server-rollback.override.json',{'services':{'server':{'image':OLD,'environment':{'SERVER_VERSION':env['SERVER_VERSION']}}}})
 compose([str(ROOT/'server-rollback.override.json')],['up','-d','--no-deps','--no-build','--pull','never','server'])
 return inspect(SERVER)['Image']==OLD and inspect(SERVER)['State']['Running']
payload=json.load(sys.stdin)
try:
 result=prepare(payload) if payload['mode']=='prepare' else install() if payload['mode']=='install' else None
 if result is None:raise RuntimeError('invalid-mode')
 print(json.dumps(result))
except Exception as error:
 recovered=False
 if payload.get('mode')=='install':
  try:recovered=rollback()
  except Exception:pass
 print(json.dumps({'passed':False,'mode':payload.get('mode'),'stableError':str(error) if isinstance(error,AssertionError) else type(error).__name__,'rollbackConfirmed':recovered,'manualRecoveryMayBeRequired':payload.get('mode')=='install' and not recovered}));sys.exit(1)
