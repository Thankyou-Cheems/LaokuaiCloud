"""Pure guards for deploy.py; no Docker, network, credentials, or product start."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest


DEPLOY = Path(__file__).resolve().parents[1] / "deploy.py"
SPEC = importlib.util.spec_from_file_location("sfu_fallback_deploy", DEPLOY)
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


def base_compose() -> dict:
    return {
        "name": module.PROJECT,
        "services": {
            "server": {
                "image": "local.laokuai/server:current",
                "environment": {"JWT_SECRET": "private-marker", "VOICE_MAX_USERS": "6"},
                "volumes": [{"type": "bind", "source": "/srv/gryt/data", "target": "/data"}],
                "networks": ["voice"],
            },
            "sfu": {
                "image": "local.laokuai/sfu:current",
                "environment": {"SFU_HYBRID_ENABLED": "true", "SFU_AUDIO_ONLY": "true", "MAX_PEERS": "6"},
                "ports": [{"target": 3478, "published": "3478", "protocol": "udp"}],
                "volumes": [{"type": "bind", "source": "/srv/gryt/sfu", "target": "/state"}],
                "networks": ["voice"],
            },
            "easytier": {
                "image": "private/et:current",
                "environment": {"ET_MARKER": "preserve"},
                "networks": ["voice"],
            },
        },
        "networks": {"voice": {"external": True}},
    }


def container(image: str, env: list[str], shape: dict) -> dict:
    return {
        "Id": f"container-{image}", "Image": image,
        "Config": {"Env": env},
        "State": {"Running": True, "Health": {"Status": "healthy"}},
        "Mounts": shape.get("mounts", []),
        "HostConfig": {"PortBindings": shape.get("ports", {}), "NetworkMode": shape.get("networkMode")},
        "NetworkSettings": {"Networks": shape.get("networks", {})},
    }


class DeployPureTests(unittest.TestCase):
    def test_exact_allowlist_preserves_et_mounts_ports_and_networks(self) -> None:
        base = base_compose()
        effective = module.expected_effective_compose(base, "local.laokuai/sfu:candidate")
        module.validate_compose_delta(base, effective, "local.laokuai/sfu:candidate")
        self.assertEqual(effective["services"]["easytier"], base["services"]["easytier"])
        self.assertEqual(effective["services"]["server"]["volumes"], base["services"]["server"]["volumes"])
        self.assertEqual(effective["services"]["sfu"]["ports"], base["services"]["sfu"]["ports"])

    def test_unrelated_compose_changes_are_rejected(self) -> None:
        base = base_compose()
        for mutate in (
            lambda value: value["services"]["server"].update(image="server:new"),
            lambda value: value["services"]["server"]["environment"].update(JWT_SECRET="changed"),
            lambda value: value["services"]["sfu"]["ports"].append({"target": 9092, "published": "9092"}),
            lambda value: value["services"]["easytier"].update(image="private/et:new"),
            lambda value: value["networks"].update(extra={}),
        ):
            effective = module.expected_effective_compose(base, "local.laokuai/sfu:candidate")
            mutate(effective)
            with self.assertRaisesRegex(RuntimeError, "effective-compose-exceeded-allowlist"):
                module.validate_compose_delta(base, effective, "local.laokuai/sfu:candidate")

    def test_overlay_contains_only_two_services_and_no_secret(self) -> None:
        overlay = module.activation_overlay("local.laokuai/sfu:candidate")
        self.assertEqual(set(overlay["services"]), {"server", "sfu"})
        self.assertNotIn("JWT_SECRET", json.dumps(overlay))
        self.assertEqual(overlay["services"]["server"]["environment"], {"VOICE_MAX_USERS": "12"})
        self.assertEqual(overlay["services"]["sfu"]["environment"]["MAX_PEERS"], "12")
        self.assertEqual(overlay["services"]["sfu"]["environment"]["SFU_MICROPHONE_OPUS_PTIME_MS"], "60")

    def test_live_environment_is_compared_in_memory_without_secret_error(self) -> None:
        service = {"environment": {"JWT_SECRET": "private-marker", "VOICE_MAX_USERS": "6"}}
        image = {"Config": {"Env": ["PATH=/bin", "JWT_SECRET=private-marker"]}}
        row = {"Config": {"Env": ["PATH=/bin", "JWT_SECRET=private-marker", "VOICE_MAX_USERS=6"]}}
        module.validate_live_environment("server", service, row, image)
        bad = copy.deepcopy(row)
        bad["Config"]["Env"][-1] = "VOICE_MAX_USERS=7"
        with self.assertRaisesRegex(RuntimeError, "live-environment-drift:server") as caught:
            module.validate_live_environment("server", service, bad, image)
        self.assertNotIn("private-marker", str(caught.exception))

    def test_base_state_requires_compose_image_to_resolve_to_pinned_digest(self) -> None:
        base = base_compose()
        rows = {
            "server": container(module.BASE_SERVER_IMAGE, ["JWT_SECRET=private-marker", "VOICE_MAX_USERS=6"], {}),
            "sfu": container(module.BASE_SFU_IMAGE, ["SFU_HYBRID_ENABLED=true", "SFU_AUDIO_ONLY=true", "MAX_PEERS=6"], {}),
        }
        base["services"]["server"]["image"] = "local.laokuai/server:drift"
        old_inspect = module.image_inspect

        def fake_inspect(reference):
            if reference == "local.laokuai/server:drift":
                return {"Id": "sha256:foreign", "Config": {"Env": []}}
            return {"Id": reference, "Config": {"Env": []}}

        module.image_inspect = fake_inspect
        try:
            with self.assertRaisesRegex(RuntimeError, "production-compose-image-drift:server"):
                module.validate_base_state(base, rows)
        finally:
            module.image_inspect = old_inspect

    def test_container_shape_fingerprint_covers_mounts_ports_and_networks(self) -> None:
        shape = {"mounts": [{"Type": "bind", "Source": "/srv/data", "Destination": "/data", "RW": True}],
                 "ports": {"3478/udp": [{"HostPort": "3478"}]}, "networkMode": "project_voice",
                 "networks": {"voice": {"Aliases": ["sfu"], "DriverOpts": None}}}
        row = container("sha256:base", ["A=B"], shape)
        original = module.shape_hash(row)
        for mutate in (
            lambda value: value["Mounts"].append({"Type": "bind", "Source": "/srv/other", "Destination": "/other", "RW": False}),
            lambda value: value["HostConfig"]["PortBindings"].update({"9092/tcp": [{"HostPort": "9092"}]}),
            lambda value: value["NetworkSettings"]["Networks"].update({"other": {"Aliases": [], "DriverOpts": None}}),
        ):
            changed = copy.deepcopy(row)
            mutate(changed)
            self.assertNotEqual(original, module.shape_hash(changed))

    def test_build_command_is_offline_copy_only_and_pins_inputs(self) -> None:
        calls = []
        dockerfiles = []
        old_run = module.run
        old_inspect = module.image_inspect
        old_work = module.WORK
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            module.WORK = root / "work"
            binary = root / "sfu"
            header = bytearray(b"\x7fELF") + bytearray([2, 1, 1, 0]) + bytearray(8) + b"\x02\x00\x3e\x00"
            binary.write_bytes(bytes(header) + b"fixture-linux-amd64")
            digest = hashlib.sha256(binary.read_bytes()).hexdigest()
            source_commit = "a" * 40

            def fake_inspect(reference):
                if reference == module.BASE_SFU_IMAGE:
                    return {"Id": module.BASE_SFU_IMAGE, "Os": "linux", "Architecture": "amd64", "Config": {"Labels": {}}}
                return {"Id": "sha256:candidate", "Os": "linux", "Architecture": "amd64", "Config": {"Labels": {
                    "org.opencontainers.image.revision": source_commit,
                    "local.laokuai.sfu.binary-sha256": digest,
                    "local.laokuai.sfu.base-image": module.BASE_SFU_IMAGE,
                }}}

            module.image_inspect = fake_inspect

            def fake_run(args, **kwargs):
                command = list(args)
                calls.append(command)
                if "build" in command:
                    dockerfiles.append(Path(command[command.index("--file") + 1]).read_text(encoding="utf-8"))

            module.run = fake_run
            try:
                receipt = module.build_candidate(binary, digest, source_commit, "local.laokuai/sfu:candidate")
            finally:
                module.run = old_run
                module.image_inspect = old_inspect
                module.WORK = old_work
            self.assertEqual(receipt["imageId"], "sha256:candidate")
            self.assertEqual(calls[0][:3], ["docker", "tag", module.BASE_SFU_IMAGE])
            command = next(call for call in calls if "build" in call)
            self.assertIn("--pull=false", command)
            self.assertIn("--network=none", command)
            self.assertIn("--build-arg", command)
            self.assertIn(f"SFU_BINARY_SHA256={digest}", command)
            self.assertIn(f"SOURCE_COMMIT={source_commit}", command)
            self.assertNotIn("RUN", " ".join(command))
            self.assertNotIn("pull", " ".join(command).lower().replace("--pull=false", ""))
            self.assertEqual(len(dockerfiles), 1)
            self.assertEqual(dockerfiles[0].count("COPY sfu /usr/local/bin/sfu"), 1)
            self.assertNotIn("\nRUN ", dockerfiles[0])

    def test_private_snapshot_is_mode600(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "compose.before.private.json"
            chmod_calls = []
            old_chmod = module.os.chmod
            module.os.chmod = lambda target, mode: (chmod_calls.append((os.fspath(target), mode)), old_chmod(target, mode))[1]
            try:
                module.write_json(path, {"services": {"server": {"environment": {"JWT_SECRET": "private"}}}}, private=True)
            finally:
                module.os.chmod = old_chmod
            self.assertIn((os.fspath(path), 0o600), chmod_calls)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["services"]["server"]["environment"]["JWT_SECRET"], "private")

    def test_service_start_command_is_no_deps_and_never_et(self) -> None:
        calls = []
        old_run = module.run
        try:
            module.run = lambda args, **kwargs: calls.append(list(args))
            module.start_service("sfu", Path("/remote/activation.overlay.json"))
        finally:
            module.run = old_run
        command = calls[0]
        self.assertIn("--no-deps", command)
        self.assertIn("--pull", command)
        self.assertIn("never", command)
        self.assertEqual(command[-1], "sfu")
        self.assertNotIn("easytier", command)

    def test_rollback_container_probe_allows_missing_but_rejects_foreign_image(self) -> None:
        old_run = module.run
        try:
            module.run = lambda args, **kwargs: module.subprocess.CompletedProcess(list(args), 1, "", "")
            self.assertIsNone(module.optional_owned_container_inspect("server"))

            owned_labels = {
                "com.docker.compose.project": module.PROJECT,
                "com.docker.compose.service": "server",
            }
            foreign = json.dumps([{
                "Id": "container-foreign",
                "Image": "sha256:foreign",
                "Config": {"Labels": owned_labels},
                "State": {"Running": False},
            }])
            module.run = lambda args, **kwargs: module.subprocess.CompletedProcess(list(args), 0, foreign, "")
            with self.assertRaisesRegex(RuntimeError, "foreign-image-no-stop:server"):
                module.stop_owned("server", {module.BASE_SERVER_IMAGE}, 1.0, allow_missing=True)
        finally:
            module.run = old_run


if __name__ == "__main__":
    unittest.main()
