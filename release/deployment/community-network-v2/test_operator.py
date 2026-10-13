"""Pure operator checks: no SSH, Docker, systemd, credentials or live state."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('network_operator_fixture',Path(__file__).with_name('operator.py'))
operator=importlib.util.module_from_spec(spec);spec.loader.exec_module(operator)

def container():
    return {'Id':'discovered-container','Image':'sha256:discovered-live-image','State':{'StartedAt':'fixture-epoch','Health':{'Status':'healthy'}},
        'Config':{'Env':['VOICE_MAX_USERS=12','FIXTURE=private-value'],'Cmd':['node','bundle.js'],'Entrypoint':['fixture-entry'],'User':'1001','WorkingDir':'/app'},
        'Mounts':[{'Destination':'/app/data','Source':'fixture-data'}],'HostConfig':{'ContainerIDFile':'','NetworkMode':'fixture-network','PortBindings':{'5000/tcp':[]}}}

class OperatorChecks(unittest.TestCase):
    def test_only_server_image_changes_and_settings_are_not_removed(self):
        before={'services':{'server':{'image':'live','environment':{'VOICE_MAX_USERS':'12','PRIVATE':'fixture'}},'sfu':{'image':'untouched'}}}
        after=copy.deepcopy(before);after['services']['server']['image']='candidate'
        operator.only_image_delta(before,after,'candidate')
        after['services']['server']['environment']['VOICE_MAX_USERS']='20'
        with self.assertRaisesRegex(RuntimeError,'compose-delta'):operator.only_image_delta(before,after,'candidate')

    def test_closed_gate_rejects_enabled_and_configuration_shape_ignores_environment_order(self):
        a=container();operator.relay_backend_closed(a)
        b=copy.deepcopy(a);b['Config']['Env'].reverse();self.assertEqual(operator.shape(a),operator.shape(b))
        b['Config']['Env'].append('LAOKUAI_MEMBER_RELAY_POLICY_V2=1')
        with self.assertRaisesRegex(RuntimeError,'gate-not-closed'):operator.relay_backend_closed(b)

    def test_discovery_uses_current_live_image_instead_of_historical_sha(self):
        row=container();sfu=copy.deepcopy(row);sfu['Id']='actual-sfu';sfu['Image']='sha256:actual-sfu-image'
        with patch.object(operator,'inspect',side_effect=[row,sfu]),patch.object(operator,'live_files',return_value=['discovered-overlay']),\
            patch.object(operator,'config',return_value={'services':{'server':{'environment':{'VOICE_MAX_USERS':'12'}}}}),\
            patch.object(operator,'proxy_metadata',return_value={'relayGate':'closed'}):
            result=operator.inspect_phase()
        self.assertEqual(result['serverImage'],'sha256:discovered-live-image')
        self.assertEqual(result['sfuImage'],'sha256:actual-sfu-image');self.assertFalse(result['runtimeStarted'])

    def test_duplicate_environment_or_mount_targets_fail_closed(self):
        row=container();row['Config']['Env'].append('VOICE_MAX_USERS=12')
        with self.assertRaisesRegex(RuntimeError,'duplicate-environment'):operator.shape(row)
        row=container();row['Mounts'].append(copy.deepcopy(row['Mounts'][0]))
        with self.assertRaisesRegex(RuntimeError,'duplicate-mount'):operator.shape(row)

    def test_enabled_v2_marker_blocks_direct_old_image_rollback(self):
        with tempfile.TemporaryDirectory(prefix='lkc-operator-test-') as temporary:
            work=Path(temporary);(work/'RELAY-V2-EVER-ENABLED.json').write_text('{}')
            with patch.object(operator,'WORK',work),patch.object(operator,'inspect',return_value=container()),\
                patch.object(operator,'proxy_metadata',return_value={'relayGate':'closed'}),\
                patch.object(operator,'read',return_value={'server':container()}),patch.object(operator,'compose') as compose:
                with self.assertRaisesRegex(RuntimeError,'reviewed-downgrade'):operator.rollback()
                compose.assert_not_called()

if __name__=='__main__':unittest.main()
