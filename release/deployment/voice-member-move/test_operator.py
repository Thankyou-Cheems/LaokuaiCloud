"""Pure merged-config boundary checks. No Docker, SSH or production execution."""
import copy
import unittest
from importlib.util import spec_from_file_location, module_from_spec
from pathlib import Path

spec = spec_from_file_location('move_gate_operator', Path(__file__).with_name('operator.py'))
op = module_from_spec(spec)
spec.loader.exec_module(op)

class GateDelta(unittest.TestCase):
    def setUp(self):
        self.before = {'services': {
            'server': {'image': 'fixed-server', 'environment': {'VOICE_MAX_USERS': '12', 'OTHER': 'fixture'},
                       'ports': ['5000:5000'], 'volumes': ['data:/app/data']},
            'sfu': {'image': 'fixed-sfu', 'environment': {'MAX_PEERS': '12'}}}}
        self.after = copy.deepcopy(self.before)
        self.after['services']['server']['environment'][op.GATE] = 'true'

    def test_only_gate(self):
        op.assert_delta(self.before, self.after)
        self.assertNotIn(op.GATE, self.before['services']['server']['environment'])

    def test_reject_unrelated_changes(self):
        for mutate in [
            lambda v: v['services']['server']['environment'].update(VOICE_MAX_USERS='20'),
            lambda v: v['services']['server'].update(image='different'),
            lambda v: v['services']['server'].update(ports=['6000:5000']),
            lambda v: v['services']['server'].update(volumes=[]),
            lambda v: v['services']['sfu'].update(image='different'),
            lambda v: v['services']['server']['environment'].pop('OTHER'),
            lambda v: v['services']['server']['environment'].update(VOICE_ATOMIC_MOVE_ENABLED=True),
        ]:
            with self.subTest(mutate=mutate):
                wrong = copy.deepcopy(self.after)
                mutate(wrong)
                with self.assertRaisesRegex(RuntimeError, 'delta-outside'):
                    op.assert_delta(self.before, wrong)

    def test_environment_rejects_duplicate_keys(self):
        with self.assertRaisesRegex(RuntimeError, 'duplicate-environment'):
            op.environment({'Config': {'Env': ['A=1', 'A=2']}})

if __name__ == '__main__':
    unittest.main()
