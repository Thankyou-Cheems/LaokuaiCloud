import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('operator_fixture', Path(__file__).with_name('deploy.py'))
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)

class ScopeTest(unittest.TestCase):
    def test_only_server_image(self):
        before = {'services': {'server': {'image':'old','environment':{'VOICE_MAX_USERS':'12'},'volumes':['/data:/data']}, 'sfu': {'image':'sfu','ports':['3478:3478/udp']}}}
        after = copy.deepcopy(before)
        after['services']['server']['image'] = 'new'
        operator.only_image_delta(before, after, 'new')
        for field, value in [('environment',{}),('volumes',[]),('ports',['5000:5000'])]:
            mutated = copy.deepcopy(after)
            mutated['services']['server'][field] = value
            with self.assertRaises(RuntimeError): operator.only_image_delta(before, mutated, 'new')
        after['services']['sfu']['image'] = 'changed'
        with self.assertRaises(RuntimeError): operator.only_image_delta(before, after, 'new')
    def test_prior_overlay_kept(self):
        self.assertIn('/opt/stacks/gryt/sfu-12-fallback-16k60/activation.overlay.json', operator.FILES)
    def test_environment_order_only(self):
        a = {'Config':{'Env':['VOICE_MAX_USERS=12','TEST_KEY=value=one']}}
        b = {'Config':{'Env':['TEST_KEY=value=one','VOICE_MAX_USERS=12']}}
        self.assertEqual(operator.environment(a),operator.environment(b))
        b['Config']['Env'][1]='VOICE_MAX_USERS=13'
        self.assertNotEqual(operator.environment(a),operator.environment(b))
        b['Config']['Env'].append('VOICE_MAX_USERS=12')
        with self.assertRaises(RuntimeError): operator.environment(b)
    def test_mount_order_only(self):
        a={'HostConfig':{},'Mounts':[{'Destination':'/data','Source':'/test/data','RW':True},{'Destination':'/run/example','Source':'/run/example','RW':False}],
           'Config':{'Env':[],'Cmd':[],'Entrypoint':None,'User':'1001','WorkingDir':'/app'}}
        b=copy.deepcopy(a); b['Mounts'].reverse()
        self.assertEqual(operator.shape(a),operator.shape(b))
        b['Mounts'][0]['RW']=True
        self.assertNotEqual(operator.shape(a),operator.shape(b))

if __name__ == '__main__': unittest.main()
