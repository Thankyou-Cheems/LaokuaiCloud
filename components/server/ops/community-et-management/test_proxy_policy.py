"""Pure RPC-parser/temporary-ledger tests. No Unix listener, issuer, TUN or real key."""
import base64
import importlib.util
import os
from pathlib import Path
import struct
import sys
import tempfile
import types
import unittest
import uuid

# Windows can exercise the portable policy code; listener lifecycle remains in
# the Linux-only test_proxy.py suite. Never substitute a native lock operation.
saved_fcntl = sys.modules.get('fcntl')
if os.name == 'nt': sys.modules['fcntl'] = types.ModuleType('fcntl')
try:
    spec=importlib.util.spec_from_file_location('management_policy_fixture',Path(__file__).with_name('proxy.py'))
    p=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(p)
finally:
    if os.name == 'nt':
        if saved_fcntl is None: sys.modules.pop('fcntl',None)
        else: sys.modules['fcntl']=saved_fcntl

CREDENTIAL='33333333-3333-4333-8333-333333333333'
SECRET=base64.b64encode(bytes([7])*32)

def selector():
    parts=struct.unpack('>IIII',uuid.UUID(p.INSTANCE).bytes)
    return p.field(1,b''.join(p.field(i,v) for i,v in enumerate(parts,1)))

def payload(method,allow,extra=b''):
    if method==1:
        return b''.join([p.field(1,b'laokuai-member'),p.field(2,allow),p.field(4,300),p.field(5,CREDENTIAL.encode()),p.field(6,selector()),p.field(7,0),extra])
    return b''.join([p.field(1,CREDENTIAL.encode()),p.field(2,SECRET),p.field(3,b'laokuai-member'),p.field(4,allow),p.field(6,1300),p.field(7,0),p.field(8,selector()),extra])

def frame(method,body):
    descriptor=p.field(2,b'CredentialManageRpc')+p.field(3,b'CredentialManageRpc')+p.field(4,method)
    raw=b''.join([p.field(1,1),p.field(2,1),p.field(3,1),p.field(4,descriptor),p.field(5,p.field(2,body)+p.field(3,1000)),p.field(6,1),p.field(7,1),p.field(8,0),p.field(10,p.field(1,1))])
    header=bytearray(20);struct.pack_into('<III',header,0,len(raw)+16,1,1);header[12]=8;struct.pack_into('<I',header,16,len(raw))
    return bytes(header)+raw

class RelayPolicy(unittest.TestCase):
    def setUp(self):
        self.prior=p.MEMBER_RELAY_POLICY_VERSION
        p.MEMBER_RELAY_POLICY_VERSION='1'
        self.addCleanup(setattr,p,'MEMBER_RELAY_POLICY_VERSION',self.prior)

    def test_default_gate_rejects_true_create_and_renew_before_forwarding(self):
        for method in (1,4):
            with self.assertRaisesRegex(ValueError,'relay-v2-disabled'): p.request(frame(method,payload(method,1)))
            self.assertEqual(p.request(frame(method,payload(method,0)))[1],method)

    def test_v2_accepts_only_boolean_relay_and_preserves_proxy_reusable_guards(self):
        p.MEMBER_RELAY_POLICY_VERSION='2'
        for method in (1,4):
            self.assertEqual(p.request(frame(method,payload(method,1)))[1],method)
            with self.assertRaisesRegex(ValueError,'relay-v2-disabled'): p.request(frame(method,payload(method,2)))
        with self.assertRaises(ValueError):p.request(frame(4,payload(4,1,p.field(5,b'10.0.0.0/8'))))
        with self.assertRaises(ValueError):p.request(frame(4,payload(4,1,p.field(7,1))))

    def test_v2_ledger_same_key_false_true_false_and_old_records_default_false(self):
        with tempfile.TemporaryDirectory(prefix='lkc-relay-policy-') as temp:
            budget=p.Budget(Path(temp)/'ledger.json',clock=lambda:1000)
            q=p.request(frame(1,payload(1,0)))[2]
            budget.before('CredentialManageRpc',1,q)
            response=p.field(1,p.field(1,CREDENTIAL.encode())+p.field(2,SECRET)+p.field(3,1300))
            budget.after('CredentialManageRpc',1,response)
            self.assertFalse(budget.load()[CREDENTIAL]['allowRelay'])
            p.MEMBER_RELAY_POLICY_VERSION='2'
            q=p.request(frame(4,payload(4,1)))[2];budget.before('CredentialManageRpc',4,q)
            self.assertTrue(budget.load()[CREDENTIAL]['pendingAllowRelay'])
            budget.complete('CredentialManageRpc',4,q,p.field(1,p.field(1,1)))
            self.assertTrue(budget.load()[CREDENTIAL]['allowRelay']);self.assertEqual(budget.load()[CREDENTIAL]['policyVersion'],2)
            p.MEMBER_RELAY_POLICY_VERSION='1'
            q=p.request(frame(4,payload(4,0)))[2];budget.before('CredentialManageRpc',4,q)
            budget.complete('CredentialManageRpc',4,q,p.field(1,p.field(1,1)))
            self.assertFalse(budget.load()[CREDENTIAL]['allowRelay']);self.assertEqual(budget.load()[CREDENTIAL]['policyVersion'],1)
            state=budget.load();state[CREDENTIAL].pop('policyVersion');state[CREDENTIAL].pop('allowRelay');budget.save(state)
            budget.before('CredentialManageRpc',4,q)
            budget.complete('CredentialManageRpc',4,q,p.field(1,p.field(1,1)))
            self.assertFalse(budget.load()[CREDENTIAL]['allowRelay'])

    def test_changed_secret_or_unsafe_group_cannot_use_v2_qualification(self):
        p.MEMBER_RELAY_POLICY_VERSION='2'
        with tempfile.TemporaryDirectory(prefix='lkc-relay-policy-') as temp:
            budget=p.Budget(Path(temp)/'ledger.json',clock=lambda:1000)
            q=p.request(frame(1,payload(1,0)))[2];budget.before('CredentialManageRpc',1,q)
            budget.after('CredentialManageRpc',1,p.field(1,p.field(1,CREDENTIAL.encode())+p.field(2,SECRET)+p.field(3,1300)))
            q=p.request(frame(4,payload(4,1)))[2];q[2]=[base64.b64encode(bytes([8])*32)]
            with self.assertRaisesRegex(ValueError,'unsafe-renew'):budget.before('CredentialManageRpc',4,q)
            q=p.request(frame(4,payload(4,1)))[2];q[3]=[b'admin']
            with self.assertRaisesRegex(ValueError,'group'):budget.before('CredentialManageRpc',4,q)

if __name__=='__main__': unittest.main()
