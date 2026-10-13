"""Pure deployment guards: no Docker, SSH, systemd, live database or network."""
import copy
from contextlib import ExitStack
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('friendly_dns_operator_fixture', Path(__file__).with_name('operator.py'))
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)

CANDIDATE = 'sha256:' + 'a' * 64
COMMIT = 'b' * 40
FILES = [
    '/opt/stacks/gryt/compose.yml',
    '/opt/stacks/gryt/member-relay-v2-20261013-r1/activation.overlay.json',
    '/opt/stacks/gryt/community-network-v2-20261013-r1/activation.overlay.json',
    '/opt/stacks/gryt/member-address-directory-20261013-r3/activation.overlay.json',
    '/opt/stacks/gryt/sfu-12-fallback-16k60/activation.overlay.json',
]


def container(image=operator.BASE_IMAGE):
    return {'Id': 'fixture-server', 'Image': image,
            'State': {'StartedAt': 'fixture-start', 'Health': {'Status': 'healthy'}},
            'Config': {'Env': ['LAOKUAI_MEMBER_RELAY_POLICY_V2=1', 'VOICE_MAX_USERS=12', 'FIXTURE=private'],
                       'Cmd': ['node', 'bundle.js'], 'Entrypoint': ['fixture-entry'], 'User': '1001', 'WorkingDir': '/app'},
            'Mounts': [{'Destination': '/app/data', 'Source': 'fixture-data'}],
            'HostConfig': {'ContainerIDFile': '', 'NetworkMode': 'fixture-network', 'PortBindings': {'5000/tcp': []}}}


def configuration(image='fixture-existing-v2-tag'):
    return {'services': {'server': {'image': image,
                                   'environment': {'LAOKUAI_MEMBER_RELAY_POLICY_V2': '1', 'VOICE_MAX_USERS': '12'},
                                   'volumes': ['fixture-data:/app/data']},
                         'sfu': {'image': 'fixture-sfu', 'environment': {'MAX_USERS': '12'}}}}


class OperatorChecks(unittest.TestCase):
    def setUp(self):
        # An accidentally unmocked external command must fail before execution.
        self.no_commands = patch.object(operator.b, 'run', side_effect=AssertionError('external-command-forbidden'))
        self.no_commands.start()
        self.addCleanup(self.no_commands.stop)

    def deployment(self, stack, work, current=None):
        old = container()
        metadata = {'active': 'active', 'pid': 'fixture-pid', 'started': 'fixture-time'}
        peers = {'/fixture-sfu': ['fixture-id', 'fixture-image', 'fixture-time']}
        documents = {
            'baseline.private.json': {'server': old, 'peers': peers, 'proxy': metadata},
            'compose.before.private.json': configuration(),
            'compose-files.json': FILES,
            'compose-hashes.json': {file: 'fixture-hash' for file in FILES},
            'BUILD.json': {'candidateImage': CANDIDATE, 'baseImage': operator.BASE_IMAGE},
        }
        stack.enter_context(patch.object(operator, 'WORK', work))
        stack.enter_context(patch.object(operator, 'read', side_effect=lambda name: copy.deepcopy(documents[name])))
        stack.enter_context(patch.object(operator, 'inputs', return_value={'sourceCommit': COMMIT}))
        stack.enter_context(patch.object(operator, 'peers', return_value=peers))
        stack.enter_context(patch.object(operator, 'proxy', return_value=metadata))
        stack.enter_context(patch.object(operator.b, 'digest', return_value='fixture-hash'))
        stack.enter_context(patch.object(operator.b, 'inspect', side_effect=lambda name:
                                           copy.deepcopy(current or old) if name == operator.b.SERVER else {'Id': operator.BASE_IMAGE}))

        def config(files):
            if files[-1].endswith('activation.overlay.json') and files[-1] not in FILES:
                return configuration(CANDIDATE)
            if files[-1].endswith('rollback.overlay.json'):
                return configuration(operator.BASE_IMAGE)
            return configuration()

        stack.enter_context(patch.object(operator.b, 'config', side_effect=config))
        compose = stack.enter_context(patch.object(operator.b, 'compose'))
        healthy = stack.enter_context(patch.object(operator.b, 'healthy', side_effect=lambda image: container(image)))
        save = stack.enter_context(patch.object(operator, 'save'))
        return documents, compose, healthy, save

    def test_strict_frozen_commit_and_source_provenance(self):
        with tempfile.TemporaryDirectory(prefix='lkc-friendly-input-test-') as temporary:
            work = Path(temporary)
            (work / 'bundle.js').write_bytes(b'fixture-bundle')
            value = {'sourceCommit': COMMIT, 'sourceWorkingTree': False, 'bundleBytes': 14,
                     'bundleSha256': 'fixture-hash', 'sourceInputSha256': 'fixture-hash',
                     'operatorSha256': 'fixture-hash', 'baseOperatorSha256': 'fixture-hash'}
            source = {'sourceCommit': COMMIT, 'workingTree': False}
            documents = {'input.json': value, 'source-input.json': source}
            with patch.object(operator, 'WORK', work), patch.object(operator, 'read', side_effect=lambda name: documents[name]), \
                    patch.object(operator.b, 'digest', return_value='fixture-hash'):
                self.assertEqual(operator.inputs(), value)
                for invalid in ['G' * 40, COMMIT.upper(), 'b' * 39, None]:
                    with self.subTest(commit=invalid):
                        value['sourceCommit'] = invalid
                        with self.assertRaisesRegex(RuntimeError, 'source-not-frozen'):
                            operator.inputs()
                value['sourceCommit'] = COMMIT
                for invalid in [0, None, [], '', True]:
                    with self.subTest(working_tree=invalid):
                        value['sourceWorkingTree'] = invalid
                        with self.assertRaisesRegex(RuntimeError, 'source-not-frozen'):
                            operator.inputs()
                value['sourceWorkingTree'] = False
                source['sourceCommit'] = 'c' * 40
                with self.assertRaisesRegex(RuntimeError, 'source-provenance-mismatch'):
                    operator.inputs()
                source['sourceCommit'] = COMMIT
                for invalid in [0, None, [], True]:
                    source['workingTree'] = invalid
                    with self.assertRaisesRegex(RuntimeError, 'source-provenance-mismatch'):
                        operator.inputs()
                source['workingTree'] = False
                with patch.object(operator.b, 'digest', return_value='tampered-hash'):
                    with self.assertRaisesRegex(RuntimeError, 'input-pin-mismatch'):
                        operator.inputs()
                value['bundleBytes'] = 99
                with self.assertRaisesRegex(RuntimeError, 'bundle-size-mismatch'):
                    operator.inputs()

    def test_baseline_requires_existing_v2_image_and_both_server_settings(self):
        with patch.object(operator.b, 'inspect', return_value={'Id': operator.BASE_IMAGE}):
            operator.require_baseline_config(configuration())
            for field, value in [('LAOKUAI_MEMBER_RELAY_POLICY_V2', '0'), ('VOICE_MAX_USERS', '20')]:
                changed = configuration()
                changed['services']['server']['environment'][field] = value
                with self.assertRaisesRegex(RuntimeError, 'compose-baseline-gates-mismatch'):
                    operator.require_baseline_config(changed)
        with patch.object(operator.b, 'inspect', return_value={'Id': 'fixture-pre-v2-image'}):
            with self.assertRaisesRegex(RuntimeError, 'compose-baseline-image-mismatch'):
                operator.require_baseline_config(configuration())

    def test_build_rejects_old_rollback_image_before_backup_or_any_mutation(self):
        with ExitStack() as stack:
            stack.enter_context(patch.object(operator, 'inputs', return_value={'sourceCommit': COMMIT}))
            stack.enter_context(patch.object(operator.b, 'inspect', side_effect=[container(), {'Id': 'fixture-pre-v2-image'}]))
            stack.enter_context(patch.object(operator.b, 'live_files', return_value=FILES))
            stack.enter_context(patch.object(operator.b, 'config', return_value=configuration()))
            save = stack.enter_context(patch.object(operator, 'save'))
            backup = stack.enter_context(patch.object(operator.sqlite3, 'connect'))
            compose = stack.enter_context(patch.object(operator.b, 'compose'))
            with self.assertRaisesRegex(RuntimeError, 'compose-baseline-image-mismatch'):
                operator.build()
            save.assert_not_called()
            backup.assert_not_called()
            compose.assert_not_called()

    def test_activation_and_rollback_reject_file_hash_drift_before_compose(self):
        for phase in ['activate', 'rollback']:
            with self.subTest(phase=phase), ExitStack() as stack:
                _, compose, healthy, _ = self.deployment(stack, Path('fixture-work'))
                stack.enter_context(patch.object(operator.b, 'digest', return_value='edited-overlay'))
                with self.assertRaisesRegex(RuntimeError, 'compose-drift'):
                    getattr(operator, phase)()
                compose.assert_not_called()
                healthy.assert_not_called()

    def test_activation_and_rollback_reject_merged_config_drift_before_compose(self):
        for phase in ['activate', 'rollback']:
            with self.subTest(phase=phase), ExitStack() as stack:
                _, compose, _, _ = self.deployment(stack, Path('fixture-work'))
                changed = configuration()
                changed['services']['server']['volumes'] = ['foreign-data:/app/data']
                stack.enter_context(patch.object(operator.b, 'config', return_value=changed))
                with self.assertRaisesRegex(RuntimeError, 'compose-baseline-drift'):
                    getattr(operator, phase)()
                compose.assert_not_called()

    def test_mutable_baseline_tag_retargeting_is_rejected_before_activation_or_rollback(self):
        for phase in ['activate', 'rollback']:
            with self.subTest(phase=phase), ExitStack() as stack:
                _, compose, _, _ = self.deployment(stack, Path('fixture-work'))
                stack.enter_context(patch.object(operator.b, 'inspect', side_effect=lambda name:
                                              container() if name == operator.b.SERVER else {'Id': 'fixture-pre-v2-image'}))
                with self.assertRaisesRegex(RuntimeError, 'compose-baseline-image-mismatch'):
                    getattr(operator, phase)()
                compose.assert_not_called()

    def test_rollback_preserves_all_live_overlays_and_uses_pinned_existing_v2_image(self):
        with ExitStack() as stack:
            _, compose, healthy, _ = self.deployment(stack, Path('fixture-work'), container(CANDIDATE))
            self.assertEqual(operator.rollback(), {'rolledBack': True, 'relayGatesPreserved': True})
            self.assertEqual(compose.call_args.args[0], FILES + [str(Path('fixture-work') / 'rollback.overlay.json')])
            self.assertEqual(compose.call_args.args[1],
                             ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--timeout', '20', 'server'])
            healthy.assert_called_once_with(operator.BASE_IMAGE)

    def test_tampered_rollback_overlay_cannot_change_environment_before_restart(self):
        with ExitStack() as stack:
            _, compose, _, _ = self.deployment(stack, Path('fixture-work'), container(CANDIDATE))

            def config(files):
                if files[-1].endswith('rollback.overlay.json'):
                    changed = configuration(operator.BASE_IMAGE)
                    changed['services']['server']['environment']['LAOKUAI_MEMBER_RELAY_POLICY_V2'] = '0'
                    return changed
                return configuration()

            stack.enter_context(patch.object(operator.b, 'config', side_effect=config))
            with self.assertRaisesRegex(RuntimeError, 'compose-delta-outside-server-image'):
                operator.rollback()
            compose.assert_not_called()

    def test_unrelated_proxy_or_peer_drift_is_rejected_before_restart(self):
        for field in ['proxy', 'peers']:
            with self.subTest(field=field), ExitStack() as stack:
                _, compose, _, _ = self.deployment(stack, Path('fixture-work'))
                stack.enter_context(patch.object(operator, field, return_value={'unexpected': 'fixture-change'}))
                with self.assertRaisesRegex(RuntimeError, 'unrelated-service-changed'):
                    operator.rollback()
                compose.assert_not_called()

    def test_failed_candidate_health_rolls_back_with_same_overlays_and_enabled_v2_gates(self):
        with ExitStack() as stack:
            _, compose, healthy, save = self.deployment(stack, Path('fixture-work'))
            healthy.side_effect = [RuntimeError('server-health-timeout'), container()]
            with self.assertRaisesRegex(RuntimeError, 'server-health-timeout'):
                operator.activate()
            self.assertEqual(compose.call_count, 2)
            self.assertEqual(compose.call_args_list[0].args[0], FILES + [str(Path('fixture-work') / 'activation.overlay.json')])
            self.assertEqual(compose.call_args_list[1].args[0], FILES + [str(Path('fixture-work') / 'rollback.overlay.json')])
            save.assert_called_once_with('AUTO-ROLLBACK.json', {'rolledBack': True, 'relayGatesPreserved': True})


if __name__ == '__main__':
    unittest.main()
