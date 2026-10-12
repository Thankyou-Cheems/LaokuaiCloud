import base64, importlib.util, pathlib, struct, tempfile, unittest, uuid, sys
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('proxy',pathlib.Path(__file__).with_name('proxy.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
def select(identity=p.INSTANCE):
 raw=uuid.UUID(identity).bytes
 return p.field(1,b''.join(p.field(i+1,struct.unpack_from('>I',raw,i*4)[0]) for i in range(4)))
def frame(service,index,body):
 d=p.field(2,service.encode())+p.field(3,service.encode())+p.field(4,index)
 raw=p.field(1,1)+p.field(2,1)+p.field(3,1)+p.field(4,d)+p.field(5,p.field(2,body)+p.field(3,1000))+p.field(6,1)+p.field(7,1)+p.field(10,p.field(1,1)+p.field(2,1))
 header=bytearray(20);struct.pack_into('<III',header,0,len(raw)+16,1,1);header[12]=8;header[14]=1;struct.pack_into('<I',header,16,len(raw))
 return bytes(header)+raw
def create(identity=p.INSTANCE,ttl=300,relay=0):
 return p.field(1,b'members')+p.field(2,relay)+p.field(4,ttl)+p.field(5,b'owned-grant')+p.field(6,select(identity))+p.field(7,0)
class Pure(unittest.TestCase):
 def test_allowed_fixed_methods(self):
  for service,index,body in [('PeerManageRpc',i,p.field(1,select())) for i in (1,3,7)]+[('CredentialManageRpc',3,p.field(1,select())),('CredentialManageRpc',1,create()),('CredentialManageRpc',2,p.field(1,b'owned-grant')+p.field(2,select()))]:
   self.assertEqual(p.request(frame(service,index,body))[:2],(service,index))
 def test_wrong_uuid_before_network(self):
  with self.assertRaises(ValueError):p.request(frame('CredentialManageRpc',1,create('11111111-1111-4111-8111-111111111111')))
 def test_no_other_methods(self):
  for service,index in [('PeerManageRpc',8),('InstanceManageRpc',1),('CredentialManageRpc',5)]:
   with self.assertRaises(ValueError):p.request(frame(service,index,p.field(1,select())))
 def test_bounded_privilege_ttl(self):
  for ttl,relay in [(301,0),(299,0),(300,1)]:
   with self.assertRaises(ValueError):p.request(frame('CredentialManageRpc',1,create(ttl=ttl,relay=relay)))
 def test_no_proxy_or_reuse(self):
  for extra in [p.field(3,b'10.0.0.0/8'),p.field(7,1)]:
   with self.assertRaises(ValueError):p.request(frame('CredentialManageRpc',1,create()+extra))
 def test_frame_bound_and_truncation(self):
  valid=frame('CredentialManageRpc',1,create())
  for bad in [valid[:-1],bytes(2005),b'']:
   with self.assertRaises(ValueError):p.request(bad)
 def test_admin_config_never_forwarded(self):
  secret=b'ADMIN_SECRET_MUST_NOT_LEAVE_HOST'
  node=p.field(1,7)+p.field(6,p.INSTANCE.encode())+p.field(8,secret)+p.field(9,b'2.7.0-8b7f1f01')
  cleaned=p.sanitize(p.field(1,p.field(1,node)),('PeerManageRpc',7))
  self.assertNotIn(secret,cleaned);self.assertIn(p.INSTANCE.encode(),cleaned)
 def test_error_text_not_forwarded(self):
  secret=b'secret-native-error'
  self.assertNotIn(secret,p.sanitize(p.field(2,p.field(7,secret)),('CredentialManageRpc',1)))
 def test_one_create_one_same_key_renew_survives_reopen(self):
  with tempfile.TemporaryDirectory(dir=pathlib.Path.cwd()) as directory:
   file=pathlib.Path(directory)/'budget.json';clock=[1000];b=p.Budget(file,lambda:clock[0]);key=base64.b64encode(bytes(range(32)))
   _,_,q,_=p.request(frame('CredentialManageRpc',1,create()));b.before('CredentialManageRpc',1,q)
   with self.assertRaises(ValueError):p.Budget(file,lambda:1001).before('CredentialManageRpc',1,q)
   b.after('CredentialManageRpc',1,p.field(1,p.field(1,b'owned-grant')+p.field(2,key)+p.field(3,1300)))
   self.assertNotIn(key,file.read_bytes())
   clock[0]=1180
   renew=p.field(1,b'owned-grant')+p.field(2,key)+p.field(4,0)+p.field(6,1480)+p.field(7,0)+p.field(8,select())
   _,_,r,_=p.request(frame('CredentialManageRpc',4,renew));b.before('CredentialManageRpc',4,r)
   with self.assertRaises(ValueError):p.Budget(file,lambda:1181).before('CredentialManageRpc',4,r)
   with self.assertRaises(ValueError):b.before('CredentialManageRpc',2,{1:[b'other-grant']})
   b.before('CredentialManageRpc',2,{1:[b'owned-grant']})
 def test_renew_absolute_deadline_and_secret(self):
  with tempfile.TemporaryDirectory(dir=pathlib.Path.cwd()) as directory:
   b=p.Budget(pathlib.Path(directory)/'budget.json',lambda:1180);b.save({'credentialId':'owned-grant','firstRequestUnix':1000,'renewAttempted':False,'secretDigest':'0'*64})
   for expiry in (1601,1100):
    with self.assertRaises(ValueError):b.before('CredentialManageRpc',4,{1:[b'owned-grant'],2:[base64.b64encode(bytes(32))],6:[expiry]})
if __name__=='__main__':unittest.main()
