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

if __name__ == '__main__': unittest.main()
