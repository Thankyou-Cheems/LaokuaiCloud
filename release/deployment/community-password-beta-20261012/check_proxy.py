"""Pure credential-policy check; no socket/core/service execution."""
import importlib.util,pathlib,tempfile,uuid,base64
spec=importlib.util.spec_from_file_location('proxy',pathlib.Path(__file__).with_name('proxy.py'))
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
clock=[1000]; checks=0
temp_root=pathlib.Path(__file__).resolve().parents[4]/'.tmp';temp_root.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(dir=temp_root) as directory:
    assert pathlib.Path(directory).resolve().is_relative_to(temp_root.resolve())
    budget=p.Budget(pathlib.Path(directory)/'ledger.json',lambda:clock[0])
    def create(key):
        credential=str(uuid.uuid4());q={1:[b'laokuai-member'],5:[credential.encode()]}
        budget.before('CredentialManageRpc',1,q)
        response=p.field(1,p.field(1,credential.encode())+p.field(2,key)+p.field(3,clock[0]+300))
        budget.after('CredentialManageRpc',1,response);return credential
    first=create(base64.b64encode(bytes([1])*32));second=create(base64.b64encode(bytes([2])*32));checks+=2
    for iteration in range(6):
        clock[0]+=180
        for credential,key in [(first,bytes([1])*32),(second,bytes([2])*32)]:
            q={1:[credential.encode()],2:[base64.b64encode(key)],3:[b'laokuai-member'],6:[clock[0]+300]}
            budget.before('CredentialManageRpc',4,q)
            budget.complete('CredentialManageRpc',4,q,p.field(1,p.field(1,1)));checks+=1
    for q in [ {1:[first.encode()],2:[base64.b64encode(bytes([9])*32)],3:[b'laokuai-member'],6:[clock[0]+300]},
               {1:[first.encode()],2:[base64.b64encode(bytes([1])*32)],3:[b'admin'],6:[clock[0]+300]},
               {1:[first.encode()],2:[base64.b64encode(bytes([1])*32)],3:[b'laokuai-member'],6:[clock[0]+3600]} ]:
        try: budget.before('CredentialManageRpc',4,q)
        except ValueError: checks+=1
        else: raise AssertionError('unsafe renewal admitted')
    q={1:[first.encode()]};budget.before('CredentialManageRpc',2,q);budget.complete('CredentialManageRpc',2,q,p.field(1,p.field(1,1)))
    assert first not in budget.load() and second in budget.load();checks+=1
    assert 'AQEBAQ' not in (pathlib.Path(directory)/'ledger.json').read_text();checks+=1
print({'passed':True,'checks':checks,'independentDevices':2,'renewalIterationsPerDevice':6,'runtimeOrNetworkExecuted':False})
