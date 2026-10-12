"""Pure operator guards; no Docker, network, real profiles or credentials."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('cutover', Path(__file__).with_name('cutover.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class CutoverScopeTests(unittest.TestCase):
    def setUp(self):
        self.ids = {k: v['config'] for k, v in module.NEW.items()}
        self.base = {'name': module.PROJECT, 'services': {
            'server': {'image': module.OLD['server'], 'environment': {'JWT_SECRET': 'unusable-public-test-marker'},
                       'volumes': [{'type': 'bind', 'source': str(module.DATA), 'target': '/data', 'bind': {'create_host_path': True}}]},
            'sfu': {'image': module.OLD['sfu'], 'environment': {'SFU_METRICS_PORT': '0'},
                    'ports': [{'target': 3478, 'published': '3478', 'protocol': 'udp'}]},
            'unrelated': {'image': 'preserved'}}, 'networks': {'existing': {'external': True}}}
        self.effective = copy.deepcopy(self.base)
        for k in self.ids:
            self.effective['services'][k]['image'] = self.ids[k]
            self.effective['services'][k]['environment'].update(module.FLAGS[k])
        self.effective['services']['server']['volumes'][0]['source'] = str(module.COPY)
    def test_exact_two_service_delta(self):
        module.validate_delta(self.base, self.effective, self.ids)
    def test_secret_change_refused(self):
        self.effective['services']['server']['environment']['JWT_SECRET'] = 'wrong-marker'
        with self.assertRaises(RuntimeError): module.validate_delta(self.base, self.effective, self.ids)
    def test_extra_port_refused(self):
        self.effective['services']['sfu']['ports'].append({'target': 9092, 'published': '9092'})
        with self.assertRaises(RuntimeError): module.validate_delta(self.base, self.effective, self.ids)
    def test_other_service_refused(self):
        self.effective['services']['unrelated']['image'] = 'changed'
        with self.assertRaises(RuntimeError): module.validate_delta(self.base, self.effective, self.ids)
    def test_original_write_bind_refused(self):
        self.effective['services']['server']['volumes'][0]['source'] = str(module.DATA)
        with self.assertRaises(RuntimeError): module.validate_delta(self.base, self.effective, self.ids)
    def test_overlay_preserves_bind_options(self):
        value = module.overlay(self.ids, True, self.base)
        self.assertEqual(value['services']['server']['volumes'][0]['bind'], {'create_host_path': True})
        self.assertNotIn('JWT_SECRET', value['services']['server']['environment'])
    def test_current_environment_matches_image_and_base(self):
        module.validate_inherited_environment({'environment': {'TOKEN': 'unusable-marker'}},
            {'Config': {'Env': ['PATH=/bin', 'TOKEN=unusable-marker']}}, {'Config': {'Env': ['PATH=/bin']}})
    def test_environment_drift_refused(self):
        with self.assertRaises(RuntimeError):
            module.validate_inherited_environment({'environment': {'TOKEN': 'unusable-marker'}},
                {'Config': {'Env': ['PATH=/bin', 'TOKEN=wrong-marker']}}, {'Config': {'Env': ['PATH=/bin']}})

if __name__ == '__main__': unittest.main()
