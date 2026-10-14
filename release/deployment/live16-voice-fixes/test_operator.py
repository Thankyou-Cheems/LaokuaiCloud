"""Pure deployment guards; no Docker, SSH, Go process or live database."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import tarfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("live16_operator_fixture", Path(__file__).with_name("operator.py"))
op = importlib.util.module_from_spec(spec)
spec.loader.exec_module(op)
COMMIT = "a" * 40
FILES = ["/opt/stacks/gryt/compose.yml"] + [f"/opt/stacks/gryt/{name}/activation.overlay.json" for name in op.REQUIRED_OVERLAYS]
CANDIDATES = {"server": "sha256:" + "b" * 64, "sfu": "sha256:" + "c" * 64}


class DeploymentGuards(unittest.TestCase):
    def setUp(self):
        self.commands = patch.object(op.b, "run", side_effect=AssertionError("external-command-forbidden"))
        self.commands.start()
        self.addCleanup(self.commands.stop)

    def test_only_two_images_may_change(self):
        before = {"services": {"server": {"image": "old-server", "environment": {"relay": "1"}},
                               "sfu": {"image": "old-sfu", "ports": ["5005:5005"], "environment": {"ptime": "60"}},
                               "et": {"image": "old-et"}}}
        after = copy.deepcopy(before)
        for service, image in CANDIDATES.items():
            after["services"][service]["image"] = image
        op.only_images(before, after, CANDIDATES)
        for service, field, value in [("server", "environment", {"relay": "0"}), ("sfu", "ports", ["0:5005"]),
                                       ("sfu", "environment", {"ptime": "20"}), ("et", "image", "new-et")]:
            changed = copy.deepcopy(after)
            changed["services"][service][field] = value
            with self.assertRaisesRegex(RuntimeError, "delta-outside-two-images"):
                op.only_images(before, changed, CANDIDATES)

    def test_git_archive_components_directory_is_valid_but_traversal_is_rejected(self):
        for invalid in [False, True]:
            with tempfile.TemporaryDirectory(prefix="lkc-live16-tar-") as temporary:
                work = Path(temporary)
                with tarfile.open(work / "source.tar", "w") as archive:
                    root = tarfile.TarInfo("components")
                    root.type = tarfile.DIRTYPE
                    archive.addfile(root)
                    child = tarfile.TarInfo("../outside" if invalid else "components/sfu")
                    child.type = tarfile.DIRTYPE
                    archive.addfile(child)
                with patch.object(op, "WORK", work):
                    if invalid:
                        with self.assertRaisesRegex(RuntimeError, "source-archive-outside-components"):
                            op.extract_source()
                    else:
                        op.extract_source()
                        self.assertTrue((work / "source/components/sfu").is_dir())

    def test_latest_server_overlays_include_old_sfu_sequence(self):
        rows = {"server": {"service": "server"}, "sfu": {"service": "sfu"}}
        with patch.object(op, "files_for", side_effect=lambda row, name: FILES if name == "server" else FILES[:2]):
            self.assertEqual(op.all_files(rows), FILES)
        with patch.object(op, "files_for", side_effect=lambda row, name: FILES if name == "server" else FILES[1:]):
            with self.assertRaisesRegex(RuntimeError, "compose-overlay-order-conflict"):
                op.all_files(rows)
        with patch.object(op, "files_for", return_value=FILES[:-1]):
            with self.assertRaisesRegex(RuntimeError, "required-overlay-missing"):
                op.all_files(rows)

    def test_frozen_inputs_and_every_artifact_are_pinned(self):
        with tempfile.TemporaryDirectory(prefix="lkc-live16-input-") as temporary:
            work = Path(temporary)
            artifacts = {}
            for name in ["bundle.js", "operator.py", "base_operator.py", "source.tar"]:
                path = work / name
                path.write_bytes(name.encode())
                artifacts[name] = {"sha256": op.digest(path), "bytes": path.stat().st_size}
            value = {"sourceCommit": COMMIT, "sourceWorkingTree": False, "artifacts": artifacts}
            (work / "input.json").write_text(json.dumps(value))
            with patch.object(op, "WORK", work):
                self.assertEqual(op.inputs(), value)
                for working in [True, 0, None, ""]:
                    value["sourceWorkingTree"] = working
                    (work / "input.json").write_text(json.dumps(value))
                    with self.assertRaisesRegex(RuntimeError, "source-not-frozen"):
                        op.inputs()
                value["sourceWorkingTree"] = False
                (work / "input.json").write_text(json.dumps(value))
                (work / "bundle.js").write_bytes(b"edited")
                with self.assertRaisesRegex(RuntimeError, "input-pin-mismatch"):
                    op.inputs()

    def test_go_tests_have_no_host_network_ports_or_production_data(self):
        with patch.object(op, "WORK", Path("/opt/stacks/gryt/live16-voice-fixes-" + COMMIT[:12])):
            command = op.go_command("sha256:" + "d" * 64, "none")
            self.assertEqual(command[command.index("--network") + 1], "none")
            self.assertIn("--read-only", command)
            self.assertIn("/tmp:rw,exec,nosuid,nodev,size=1024m", command)
            self.assertNotIn("--publish", command)
            self.assertNotIn("-p", command)
            self.assertNotIn("host", command)
            self.assertNotIn("privileged", " ".join(command))
            self.assertNotIn("/opt/stacks/gryt/data", " ".join(command))
            self.assertTrue(any("target=/src,readonly" in arg for arg in command))
            self.assertTrue(any("target=/gomod,readonly" in arg for arg in command))

    def test_foreign_container_image_is_never_stopped(self):
        with patch.object(op, "inspect", return_value={"Image": "foreign", "State": {"Running": True}}), patch.object(op, "run") as commands:
            with self.assertRaisesRegex(RuntimeError, "foreign-image-no-stop"):
                op.stop_owned("server", {op.BASE_IMAGES["server"]})
            commands.assert_not_called()

    def test_unrelated_service_or_compose_drift_blocks_restart(self):
        saved = {"composeHashes": {"fixture-file": "fixture-hash"}, "files": FILES, "compose": {"services": {}},
                 "peers": {"et": ["identity", "image", "time"]}, "proxy": "active"}
        with patch.object(op, "digest", return_value="edited"):
            with self.assertRaisesRegex(RuntimeError, "compose-baseline-drift"):
                op.guards_for_restart(saved)
        with patch.object(op, "digest", return_value="fixture-hash"), patch.object(op, "config", return_value=saved["compose"]), \
                patch.object(op, "peers", return_value={}), patch.object(op, "proxy", return_value="active"):
            with self.assertRaisesRegex(RuntimeError, "unrelated-service-drift"):
                op.guards_for_restart(saved)

    def test_restart_command_is_limited_to_two_services_and_saved_overlays(self):
        saved = {"files": FILES, "compose": {}, "rows": {"server": {}, "sfu": {}}}
        with patch.object(op, "WORK", Path("fixture")), patch.object(op, "guards_for_restart"), \
                patch.object(op, "config", return_value={}), patch.object(op, "only_images"), \
                patch.object(op, "read", return_value={"images": CANDIDATES}), patch.object(op, "shape", return_value={}), \
                patch.object(op, "stop_owned") as stopped, patch.object(op, "wait_healthy", return_value={}), \
                patch.object(op, "compose") as compose:
            op.apply_overlay(saved, CANDIDATES, "activation.overlay.json")
            self.assertEqual([call.args[0] for call in stopped.call_args_list], ["sfu", "server"])
            self.assertEqual(compose.call_args.args[0], FILES + [str(Path("fixture/activation.overlay.json"))])
            self.assertEqual(compose.call_args.args[1], ["up", "-d", "--no-deps", "--no-build", "--pull", "never", "server", "sfu"])


if __name__ == "__main__":
    unittest.main()
