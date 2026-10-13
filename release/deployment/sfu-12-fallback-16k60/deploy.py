"""Bounded operator phases for the 12-seat SFU fallback candidate.

This module is intended to be copied to the Tencent Cloud host and run by an
operator.  It does not print the merged Compose document, container
environment, or command stderr.  The pure tests import the validation helpers;
they never invoke Docker, a network, or a product process.

The candidate is deliberately scoped to two Compose services.  EasyTier and
all other services remain outside every command emitted here.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import time
from typing import Any, Iterable, Mapping, Sequence


PROJECT = "laokuailiao"
SERVICE_NAMES = ("server", "sfu")
CONTAINER_NAMES = {"server": "laokuailiao-server", "sfu": "laokuailiao-sfu"}

# These are the current operator inventory paths.  The order is part of the
# merged Compose identity and is checked before a stage is accepted.
COMPOSE_FILES = (
    Path("/opt/stacks/gryt/compose.yml"),
    Path("/opt/stacks/gryt/community-et-real-9db53f79/backend-sfu.override.json"),
    Path("/opt/stacks/gryt/community-et-real-9db53f79/server-release-version.override.json"),
    Path("/opt/stacks/gryt/community-password-beta-a5c557be/server-password.override.json"),
)
WORK = Path("/opt/stacks/gryt/sfu-12-fallback-16k60")
BASE_SERVER_IMAGE = "sha256:9ddd8f97831436c5b4cae46b04e4c0a9b9afb34961aab5ce4c7d0a9fc80dfc81"
BASE_SFU_IMAGE = "sha256:2b6afca88c4f7d6912c044d3b114d17af56104a4fce95ca7dc14cf0f04ec3a8f"
BASE_SFU_BUILD_REFERENCE = "local.laokuai/sfu-base-2b6afca8:current"

SERVER_ENV_DELTA = {"VOICE_MAX_USERS": "12"}
SFU_ENV_DELTA = {
    "MAX_PEERS": "12",
    "SFU_MICROPHONE_OPUS20": "true",
    "SFU_MICROPHONE_OPUS_MAX_AVERAGE_BITRATE_BPS": "16000",
    "SFU_MICROPHONE_OPUS_PTIME_MS": "60",
}

BUILD_RECEIPT = "BUILD.json"
STAGE_RECEIPT = "STAGED.json"
ACTIVATE_RECEIPT = "ACTIVATED.json"
ROLLBACK_RECEIPT = "ROLLED-BACK.json"
PRIVATE_COMPOSE = "compose.before.private.json"
OVERLAY = "activation.overlay.json"

HEX64 = re.compile(r"^[0-9a-f]{64}$")
HEX40 = re.compile(r"^[0-9a-f]{40}$")
SAFE_REF = re.compile(r"^[A-Za-z0-9._/@:+-]+$")


def stable_error(message: str) -> RuntimeError:
    return RuntimeError(message)


def run(args: Sequence[str], timeout: float = 45.0, optional: bool = False) -> subprocess.CompletedProcess[str]:
    """Run one direct operator command without exposing output or secrets."""

    try:
        result = subprocess.run(
            list(args), capture_output=True, text=True, timeout=timeout, check=False
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as error:
        if optional:
            return subprocess.CompletedProcess(list(args), 1, "", "")
        raise stable_error("operator-command-unavailable") from error
    if result.returncode != 0 and not optional:
        raise stable_error(f"operator-command-failed:{args[0]}:{result.returncode}")
    return result


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_hash(value: Any) -> str:
    return sha256_bytes(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8"))


def _ensure_regular(path: Path, label: str) -> None:
    if not path.is_file() or path.is_symlink():
        raise stable_error(f"{label}-must-be-regular-file")


def _ensure_linux_amd64_elf(path: Path) -> None:
    with path.open("rb") as source:
        header = source.read(20)
    # ELF64 little-endian x86-64.  This is a file-header check only; it does
    # not execute or load the cross-built binary.
    if len(header) < 20 or header[:4] != b"\x7fELF" or header[4] != 2 or header[5] != 1 or header[18:20] != b"\x3e\x00":
        raise stable_error("cross-built-sfu-binary-not-linux-amd64")


def _ensure_work() -> None:
    if WORK.exists() and not WORK.is_dir():
        raise stable_error("operation-directory-is-not-directory")
    WORK.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(WORK, 0o700)


def write_json(path: Path, value: Any, *, private: bool) -> None:
    """Atomically create a receipt; existing operator evidence is never replaced."""

    if path.exists() or path.is_symlink():
        raise stable_error("operation-evidence-already-exists")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    encoded = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    flags |= getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags, 0o600 if private else 0o640)
    try:
        with os.fdopen(descriptor, "wb") as target:
            target.write(encoded)
            target.flush()
            os.fsync(target.fileno())
    except Exception:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        raise
    os.chmod(path, 0o600 if private else 0o640)


def read_json(path: Path) -> Any:
    _ensure_regular(path, "receipt")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise stable_error("invalid-operation-evidence") from error


def docker_json(*args: str, timeout: float = 45.0) -> Any:
    result = run(("docker", *args), timeout=timeout)
    try:
        return json.loads(result.stdout)
    except ValueError as error:
        raise stable_error("operator-json-invalid") from error


def compose_command(extra_files: Iterable[Path] = (), operation: Sequence[str] = ("config", "--format", "json")) -> list[str]:
    args = ["docker", "compose", "-p", PROJECT]
    for compose_file in COMPOSE_FILES:
        args.extend(("-f", str(compose_file)))
    for compose_file in extra_files:
        args.extend(("-f", str(compose_file)))
    args.extend(operation)
    return args


def compose_json(extra_files: Iterable[Path] = (), operation: Sequence[str] = ("config", "--format", "json")) -> Any:
    result = run(compose_command(extra_files, operation), timeout=90.0)
    try:
        return json.loads(result.stdout)
    except ValueError as error:
        raise stable_error("compose-json-invalid") from error


def image_inspect(reference: str) -> dict[str, Any]:
    rows = docker_json("image", "inspect", reference)
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        raise stable_error("image-inspect-invalid")
    return rows[0]


def container_inspect(service: str) -> dict[str, Any]:
    if service not in SERVICE_NAMES:
        raise stable_error("service-outside-scope")
    rows = docker_json("inspect", CONTAINER_NAMES[service])
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        raise stable_error(f"container-inspect-invalid:{service}")
    row = rows[0]
    labels = row.get("Config", {}).get("Labels", {}) or {}
    if labels.get("com.docker.compose.project") != PROJECT or labels.get("com.docker.compose.service") != service:
        raise stable_error(f"wrong-compose-owner:{service}")
    return row


def optional_owned_container_inspect(service: str) -> dict[str, Any] | None:
    """Inspect the owned name for rollback; a missing name is recreated by Compose."""

    if service not in SERVICE_NAMES:
        raise stable_error("service-outside-scope")
    result = run(("docker", "inspect", CONTAINER_NAMES[service]), timeout=45.0, optional=True)
    if result.returncode != 0:
        return None
    try:
        rows = json.loads(result.stdout)
    except ValueError as error:
        raise stable_error(f"container-inspect-invalid:{service}") from error
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        raise stable_error(f"container-inspect-invalid:{service}")
    row = rows[0]
    labels = row.get("Config", {}).get("Labels", {}) or {}
    if labels.get("com.docker.compose.project") != PROJECT or labels.get("com.docker.compose.service") != service:
        raise stable_error(f"wrong-compose-owner:{service}")
    return row


def environment_map(values: Any) -> dict[str, str]:
    if values is None:
        return {}
    if isinstance(values, Mapping):
        return {str(key): str(value) for key, value in values.items() if value is not None}
    result: dict[str, str] = {}
    if isinstance(values, list):
        for item in values:
            if not isinstance(item, str) or "=" not in item:
                continue
            key, value = item.split("=", 1)
            result[key] = value
    return result


def compose_service_environment(service: Mapping[str, Any]) -> dict[str, str]:
    return environment_map(service.get("environment", {}))


def image_environment(image: Mapping[str, Any]) -> dict[str, str]:
    return environment_map(image.get("Config", {}).get("Env", []))


def expected_environment(service: Mapping[str, Any], image: Mapping[str, Any]) -> dict[str, str]:
    expected = image_environment(image)
    configured = service.get("environment", {})
    if isinstance(configured, Mapping):
        for key, value in configured.items():
            if value is None:
                expected.pop(str(key), None)
            else:
                expected[str(key)] = str(value)
    else:
        expected.update(compose_service_environment(service))
    return expected


def live_environment(row: Mapping[str, Any]) -> dict[str, str]:
    return environment_map(row.get("Config", {}).get("Env", []))


def validate_live_environment(service: str, base_service: Mapping[str, Any], row: Mapping[str, Any], image: Mapping[str, Any] | None = None) -> None:
    """Compare in memory only; values are never included in exceptions or output."""

    expected = expected_environment(base_service, image if image is not None else {"Config": {"Env": []}})
    if expected != live_environment(row):
        raise stable_error(f"live-environment-drift:{service}")


def _mount_shape(row: Mapping[str, Any]) -> list[dict[str, Any]]:
    mounts = row.get("Mounts", []) or []
    result = []
    for mount in mounts:
        result.append({
            "Type": mount.get("Type"), "Name": mount.get("Name"), "Source": mount.get("Source"),
            "Destination": mount.get("Destination"), "Driver": mount.get("Driver"),
            "RW": mount.get("RW"), "Propagation": mount.get("Propagation"),
        })
    return sorted(result, key=lambda item: (str(item.get("Destination")), str(item.get("Source"))))


def _network_shape(row: Mapping[str, Any]) -> dict[str, Any]:
    networks = row.get("NetworkSettings", {}).get("Networks", {}) or {}
    return {
        str(name): {
            "Aliases": sorted(value.get("Aliases") or []),
            "DriverOpts": value.get("DriverOpts"),
        }
        for name, value in sorted(networks.items())
    }


def container_shape(row: Mapping[str, Any]) -> dict[str, Any]:
    host = row.get("HostConfig", {}) or {}
    return {
        "mounts": _mount_shape(row),
        "ports": host.get("PortBindings") or {},
        "networkMode": host.get("NetworkMode"),
        "networks": _network_shape(row),
    }


def shape_hash(row: Mapping[str, Any]) -> str:
    return canonical_hash(container_shape(row))


def health(row: Mapping[str, Any]) -> str | None:
    return row.get("State", {}).get("Health", {}).get("Status")


def require_running_healthy(service: str, row: Mapping[str, Any]) -> None:
    if row.get("State", {}).get("Running") is not True or health(row) != "healthy":
        raise stable_error(f"service-not-healthy:{service}")


def file_fingerprints() -> dict[str, str]:
    result: dict[str, str] = {}
    for path in COMPOSE_FILES:
        _ensure_regular(path, "compose-file")
        result[str(path)] = sha256_file(path)
    return result


def validate_compose_files(expected: Mapping[str, str] | None = None) -> None:
    current = file_fingerprints()
    if expected is not None and current != dict(expected):
        raise stable_error("compose-files-changed-since-stage")


def _services(compose: Mapping[str, Any]) -> Mapping[str, Any]:
    services = compose.get("services")
    if not isinstance(services, Mapping) or not all(name in services for name in SERVICE_NAMES):
        raise stable_error("compose-services-incomplete")
    return services


def activation_overlay(candidate_reference: str) -> dict[str, Any]:
    if not SAFE_REF.fullmatch(candidate_reference):
        raise stable_error("candidate-reference-invalid")
    return {
        "services": {
            "server": {"environment": dict(SERVER_ENV_DELTA)},
            "sfu": {"image": candidate_reference, "environment": dict(SFU_ENV_DELTA)},
        }
    }


def expected_effective_compose(base: Mapping[str, Any], candidate_reference: str) -> dict[str, Any]:
    expected = copy.deepcopy(base)
    services = _services(expected)
    services["server"].setdefault("environment", {})
    services["server"]["environment"].update(SERVER_ENV_DELTA)
    services["sfu"]["image"] = candidate_reference
    services["sfu"].setdefault("environment", {})
    services["sfu"]["environment"].update(SFU_ENV_DELTA)
    return expected


def validate_compose_delta(base: Mapping[str, Any], effective: Mapping[str, Any], candidate_reference: str) -> None:
    expected = expected_effective_compose(base, candidate_reference)
    if expected != effective:
        raise stable_error("effective-compose-exceeded-allowlist")


def validate_base_state(base: Mapping[str, Any], rows: Mapping[str, Mapping[str, Any]]) -> None:
    services = _services(base)
    for service in SERVICE_NAMES:
        row = rows[service]
        expected_image = BASE_SERVER_IMAGE if service == "server" else BASE_SFU_IMAGE
        configured_reference = services[service].get("image")
        if not isinstance(configured_reference, str) or not configured_reference:
            raise stable_error(f"compose-image-missing:{service}")
        configured_image = image_inspect(configured_reference)
        if configured_image.get("Id") != expected_image:
            raise stable_error(f"production-compose-image-drift:{service}")
        if row.get("Image") != expected_image:
            raise stable_error(f"production-image-drift:{service}")
        require_running_healthy(service, row)
        validate_live_environment(service, services[service], row, configured_image)


def validate_candidate_image(reference: str, expected: Mapping[str, Any]) -> dict[str, Any]:
    image = image_inspect(reference)
    if image.get("Id") != expected.get("imageId"):
        raise stable_error("candidate-image-changed")
    labels = image.get("Config", {}).get("Labels", {}) or {}
    if labels.get("org.opencontainers.image.revision") != expected.get("sourceCommit"):
        raise stable_error("candidate-source-label-mismatch")
    if labels.get("local.laokuai.sfu.binary-sha256") != expected.get("binarySha256"):
        raise stable_error("candidate-binary-label-mismatch")
    if labels.get("local.laokuai.sfu.base-image") != BASE_SFU_IMAGE:
        raise stable_error("candidate-base-label-mismatch")
    return image


def build_candidate(binary: Path, binary_sha256: str, source_commit: str, candidate_reference: str) -> dict[str, Any]:
    if not HEX64.fullmatch(binary_sha256.lower()):
        raise stable_error("binary-sha256-invalid")
    if not HEX40.fullmatch(source_commit.lower()):
        raise stable_error("source-commit-invalid")
    if not SAFE_REF.fullmatch(candidate_reference):
        raise stable_error("candidate-reference-invalid")
    _ensure_regular(binary, "cross-built-sfu-binary")
    _ensure_linux_amd64_elf(binary)
    actual_sha = sha256_file(binary)
    if actual_sha != binary_sha256.lower():
        raise stable_error("binary-sha256-mismatch")
    if binary.stat().st_size <= 0:
        raise stable_error("cross-built-sfu-binary-empty")
    base = image_inspect(BASE_SFU_IMAGE)
    if base.get("Id") != BASE_SFU_IMAGE or base.get("Os") != "linux" or base.get("Architecture") != "amd64":
        raise stable_error("base-sfu-image-identity-mismatch")
    _ensure_work()
    context = WORK / "build-context"
    if context.exists():
        raise stable_error("build-context-already-exists")
    context.mkdir(mode=0o700)
    os.chmod(context, 0o700)
    staged_binary = context / "sfu"
    dockerfile = context / "Dockerfile"
    shutil.copyfile(binary, staged_binary)
    os.chmod(staged_binary, 0o755)
    dockerfile.write_text(
        "\n".join((
            f"FROM {BASE_SFU_BUILD_REFERENCE}",
            "ARG SFU_BINARY_SHA256",
            "ARG SOURCE_COMMIT",
            "COPY sfu /usr/local/bin/sfu",
            'LABEL org.opencontainers.image.revision="${SOURCE_COMMIT}"',
            'LABEL local.laokuai.sfu.binary-sha256="${SFU_BINARY_SHA256}"',
            f'LABEL local.laokuai.sfu.base-image="{BASE_SFU_IMAGE}"',
            "",
        )), encoding="utf-8", newline="\n"
    )
    try:
        # Dockerfile FROM accepts a local repository reference consistently;
        # create one from the verified immutable ID without pulling anything.
        run(("docker", "tag", BASE_SFU_IMAGE, BASE_SFU_BUILD_REFERENCE), timeout=30.0)
        run((
            "docker", "build", "--pull=false", "--network=none", "--no-cache",
            "--build-arg", f"SFU_BINARY_SHA256={binary_sha256.lower()}",
            "--build-arg", f"SOURCE_COMMIT={source_commit.lower()}",
            "--tag", candidate_reference, "--file", str(dockerfile), str(context),
        ), timeout=180.0)
        candidate = image_inspect(candidate_reference)
        labels = candidate.get("Config", {}).get("Labels", {}) or {}
        if candidate.get("Os") != "linux" or candidate.get("Architecture") != "amd64":
            raise stable_error("candidate-image-platform-mismatch")
        if labels.get("org.opencontainers.image.revision") != source_commit.lower() or labels.get("local.laokuai.sfu.binary-sha256") != binary_sha256.lower():
            raise stable_error("candidate-labels-not-pinned")
        if labels.get("local.laokuai.sfu.base-image") != BASE_SFU_IMAGE:
            raise stable_error("candidate-base-not-pinned")
        receipt = {
            "schema": 1,
            "candidateReference": candidate_reference,
            "imageId": candidate.get("Id"),
            "baseImageId": BASE_SFU_IMAGE,
            "baseBuildReference": BASE_SFU_BUILD_REFERENCE,
            "sourceCommit": source_commit.lower(),
            "binarySha256": binary_sha256.lower(),
            "binaryBytes": binary.stat().st_size,
            "dockerBuild": {"network": "none", "pull": False, "runInstructions": 0, "copiedFiles": ["sfu"]},
            "oldImageKept": True,
        }
        write_json(WORK / BUILD_RECEIPT, receipt, private=False)
        return receipt
    finally:
        shutil.rmtree(context, ignore_errors=True)


def load_build() -> dict[str, Any]:
    receipt = read_json(WORK / BUILD_RECEIPT)
    if not isinstance(receipt, dict) or receipt.get("schema") != 1:
        raise stable_error("build-receipt-invalid")
    validate_candidate_image(str(receipt.get("candidateReference", "")), receipt)
    return receipt


def stage() -> dict[str, Any]:
    build = load_build()
    _ensure_work()
    if (WORK / STAGE_RECEIPT).exists() or (WORK / PRIVATE_COMPOSE).exists() or (WORK / OVERLAY).exists():
        raise stable_error("stage-evidence-already-exists")
    validate_compose_files()
    base = compose_json()
    rows = {service: container_inspect(service) for service in SERVICE_NAMES}
    validate_base_state(base, rows)
    candidate_reference = str(build["candidateReference"])
    overlay = activation_overlay(candidate_reference)
    overlay_path = WORK / OVERLAY
    write_json(overlay_path, overlay, private=False)
    effective = compose_json((overlay_path,))
    validate_compose_delta(base, effective, candidate_reference)
    private_snapshot = WORK / PRIVATE_COMPOSE
    write_json(private_snapshot, base, private=True)
    receipt = {
        "schema": 1,
        "project": PROJECT,
        "services": list(SERVICE_NAMES),
        "composeFiles": file_fingerprints(),
        "baseComposeSha256": canonical_hash(base),
        "baseImages": {service: rows[service]["Image"] for service in SERVICE_NAMES},
        "baseContainerIds": {service: rows[service]["Id"] for service in SERVICE_NAMES},
        "baseShapeSha256": {service: shape_hash(rows[service]) for service in SERVICE_NAMES},
        "candidateReference": candidate_reference,
        "candidateImageId": build["imageId"],
        "sourceCommit": build["sourceCommit"],
        "binarySha256": build["binarySha256"],
        "overlaySha256": sha256_file(overlay_path),
        "privateSnapshotSha256": sha256_file(private_snapshot),
        "activationExecuted": False,
        "rollbackAvailable": True,
    }
    write_json(WORK / STAGE_RECEIPT, receipt, private=False)
    return receipt


def load_stage() -> dict[str, Any]:
    receipt = read_json(WORK / STAGE_RECEIPT)
    if not isinstance(receipt, dict) or receipt.get("schema") != 1:
        raise stable_error("stage-receipt-invalid")
    for key in ("composeFiles", "baseContainerIds", "baseShapeSha256"):
        if not isinstance(receipt.get(key), dict):
            raise stable_error("stage-receipt-incomplete")
    validate_compose_files(receipt["composeFiles"])
    snapshot = WORK / PRIVATE_COMPOSE
    if sha256_file(snapshot) != receipt.get("privateSnapshotSha256"):
        raise stable_error("private-compose-snapshot-changed")
    overlay = WORK / OVERLAY
    if sha256_file(overlay) != receipt.get("overlaySha256"):
        raise stable_error("activation-overlay-changed")
    build = load_build()
    if build.get("imageId") != receipt.get("candidateImageId") or build.get("candidateReference") != receipt.get("candidateReference"):
        raise stable_error("candidate-receipt-mismatch")
    return receipt


def validate_stage_current(stage_receipt: Mapping[str, Any], base: Mapping[str, Any], rows: Mapping[str, Mapping[str, Any]]) -> None:
    if canonical_hash(base) != stage_receipt.get("baseComposeSha256"):
        raise stable_error("base-compose-changed-since-stage")
    for service in SERVICE_NAMES:
        if rows[service].get("Id") != stage_receipt["baseContainerIds"].get(service):
            raise stable_error(f"container-replaced-since-stage:{service}")
        if rows[service].get("Image") != stage_receipt["baseImages"].get(service):
            raise stable_error(f"image-changed-since-stage:{service}")
        if shape_hash(rows[service]) != stage_receipt["baseShapeSha256"].get(service):
            raise stable_error(f"container-shape-changed-since-stage:{service}")
    validate_base_state(base, rows)


def inspect_phase() -> dict[str, Any]:
    validate_compose_files()
    base = compose_json()
    rows = {service: container_inspect(service) for service in SERVICE_NAMES}
    validate_base_state(base, rows)
    result: dict[str, Any] = {
        "phase": "inspect",
        "project": PROJECT,
        "services": list(SERVICE_NAMES),
        "baseComposeSha256": canonical_hash(base),
        "images": {service: rows[service]["Image"] for service in SERVICE_NAMES},
        "health": {service: health(rows[service]) for service in SERVICE_NAMES},
        "running": {service: rows[service].get("State", {}).get("Running") is True for service in SERVICE_NAMES},
        "shapePreservedCheck": True,
        "environmentComparedInMemory": True,
        "secretValuesPrinted": False,
        "etServiceTouched": False,
        "candidate": None,
        "staged": (WORK / STAGE_RECEIPT).exists(),
    }
    if (WORK / BUILD_RECEIPT).exists():
        build = load_build()
        result["candidate"] = {
            "reference": build["candidateReference"], "imageId": build["imageId"],
            "sourceCommit": build["sourceCommit"], "binarySha256": build["binarySha256"],
        }
    return result


def stop_owned(service: str, expected_images: set[str], timeout: float, *, allow_missing: bool = False) -> None:
    row = optional_owned_container_inspect(service) if allow_missing else container_inspect(service)
    if row is None:
        return
    if row.get("Image") not in expected_images:
        raise stable_error(f"foreign-image-no-stop:{service}")
    if row.get("State", {}).get("Running") is not True:
        return
    run(("docker", "kill", "--signal=TERM", row["Id"]), timeout=30.0)
    deadline = time.monotonic() + max(1.0, min(timeout, 60.0))
    while time.monotonic() < deadline:
        current = container_inspect(service)
        if current.get("State", {}).get("Running") is not True:
            return
        time.sleep(0.25)
    raise stable_error(f"graceful-stop-timeout:{service}")


def wait_healthy(service: str, timeout: float) -> dict[str, Any]:
    deadline = time.monotonic() + max(1.0, min(timeout, 120.0))
    while time.monotonic() < deadline:
        row = container_inspect(service)
        if row.get("State", {}).get("Running") is True and health(row) == "healthy":
            return row
        if row.get("State", {}).get("Running") is False and row.get("State", {}).get("ExitCode") not in (None, 0):
            raise stable_error(f"service-exited-before-health:{service}")
        time.sleep(0.5)
    raise stable_error(f"health-timeout:{service}")


def start_service(service: str, overlay: Path | None = None) -> None:
    if service not in SERVICE_NAMES:
        raise stable_error("service-outside-scope")
    extra = (overlay,) if overlay is not None else ()
    run(compose_command(extra, ("up", "-d", "--no-deps", "--no-build", "--pull", "never", service)), timeout=90.0)


def validate_post_state(
    base: Mapping[str, Any], stage_receipt: Mapping[str, Any], before: Mapping[str, Mapping[str, Any]],
    rows: Mapping[str, Mapping[str, Any]], effective: Mapping[str, Any], candidate_image: Mapping[str, Any],
) -> None:
    services = _services(effective)
    if rows["server"].get("Image") != BASE_SERVER_IMAGE or rows["sfu"].get("Image") != stage_receipt["candidateImageId"]:
        raise stable_error("activated-image-identity-mismatch")
    for service in SERVICE_NAMES:
        require_running_healthy(service, rows[service])
        if shape_hash(rows[service]) != shape_hash(before[service]):
            raise stable_error(f"activated-container-shape-changed:{service}")
        image = image_inspect(rows[service]["Image"])
        validate_live_environment(service, services[service], rows[service], image)
    # The candidate image must still advertise the exact binary/source pins.
    validate_candidate_image(str(stage_receipt["candidateReference"]), {
        "imageId": stage_receipt["candidateImageId"], "sourceCommit": stage_receipt["sourceCommit"],
        "binarySha256": stage_receipt["binarySha256"],
    })


def rollback_impl(stage_receipt: Mapping[str, Any], stop_timeout: float, health_timeout: float) -> dict[str, Any]:
    validate_compose_files(stage_receipt["composeFiles"])
    base = compose_json()
    if canonical_hash(base) != stage_receipt["baseComposeSha256"]:
        raise stable_error("base-compose-changed-no-rollback")
    rows = {service: optional_owned_container_inspect(service) for service in SERVICE_NAMES}
    allowed = {"server": {BASE_SERVER_IMAGE}, "sfu": {BASE_SFU_IMAGE, stage_receipt["candidateImageId"]}}
    for service in SERVICE_NAMES:
        if rows[service] is not None and rows[service].get("Image") not in allowed[service]:
            raise stable_error(f"foreign-image-no-rollback:{service}")
    for service in ("sfu", "server"):
        stop_owned(service, allowed[service], stop_timeout, allow_missing=True)
    for service in ("server", "sfu"):
        start_service(service)
        wait_healthy(service, health_timeout)
    restored = {service: container_inspect(service) for service in SERVICE_NAMES}
    validate_base_state(base, restored)
    result = {
        "schema": 1, "project": PROJECT, "services": list(SERVICE_NAMES),
        "baseImages": {service: restored[service]["Image"] for service in SERVICE_NAMES},
        "health": {service: health(restored[service]) for service in SERVICE_NAMES},
        "rollbackConfirmed": True, "oldImagesKept": True, "etServiceTouched": False,
        "secretValuesPrinted": False,
    }
    if not (WORK / ROLLBACK_RECEIPT).exists():
        write_json(WORK / ROLLBACK_RECEIPT, result, private=False)
    return result


def activate(stop_timeout: float, health_timeout: float) -> dict[str, Any]:
    stage_receipt = load_stage()
    base = compose_json()
    rows = {service: container_inspect(service) for service in SERVICE_NAMES}
    validate_stage_current(stage_receipt, base, rows)
    overlay = WORK / OVERLAY
    effective = compose_json((overlay,))
    validate_compose_delta(base, effective, str(stage_receipt["candidateReference"]))
    candidate = validate_candidate_image(str(stage_receipt["candidateReference"]), {
        "imageId": stage_receipt["candidateImageId"], "sourceCommit": stage_receipt["sourceCommit"],
        "binarySha256": stage_receipt["binarySha256"],
    })
    activation_started = False
    try:
        activation_started = True
        for service in ("sfu", "server"):
            stop_owned(service, {BASE_SERVER_IMAGE} if service == "server" else {BASE_SFU_IMAGE}, stop_timeout)
        for service in ("server", "sfu"):
            start_service(service, overlay)
            wait_healthy(service, health_timeout)
        after = {service: container_inspect(service) for service in SERVICE_NAMES}
        validate_post_state(base, stage_receipt, rows, after, effective, candidate)
        result = {
            "schema": 1, "project": PROJECT, "services": list(SERVICE_NAMES),
            "candidateImageId": stage_receipt["candidateImageId"], "serverImageId": after["server"]["Image"],
            "health": {service: health(after[service]) for service in SERVICE_NAMES},
            "shapePreserved": {service: shape_hash(after[service]) == stage_receipt["baseShapeSha256"][service] for service in SERVICE_NAMES},
            "serverVoiceMaxUsers": "12", "sfuMaxPeers": "12", "sfuMicrophoneBitrateBps": "16000", "sfuMicrophonePacketTimeMs": "60",
            "privateComposeSnapshot": PRIVATE_COMPOSE, "privateComposeSnapshotMode": "0600",
            "rollbackAvailable": True, "oldImagesKept": True, "etServiceTouched": False,
            "secretValuesPrinted": False,
        }
        write_json(WORK / ACTIVATE_RECEIPT, result, private=False)
        return result
    except Exception as error:
        if not activation_started:
            raise
        rollback_confirmed = False
        try:
            rollback_impl(stage_receipt, stop_timeout, health_timeout)
            rollback_confirmed = True
        except Exception:
            pass
        if rollback_confirmed:
            raise stable_error("activation-failed-rolled-back") from error
        raise stable_error("activation-failed-rollback-needs-operator") from error


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bounded SFU 12-seat fallback operator phases")
    parser.add_argument("--phase", choices=("build", "stage", "inspect", "activate", "rollback"), default="inspect")
    parser.add_argument("--binary", type=Path)
    parser.add_argument("--binary-sha256")
    parser.add_argument("--source-commit")
    parser.add_argument("--candidate-reference", default="local.laokuai/sfu-12-fallback-16k60:candidate")
    parser.add_argument("--stop-timeout", type=float, default=30.0)
    parser.add_argument("--health-timeout", type=float, default=60.0)
    return parser.parse_args()


def main(args: argparse.Namespace) -> dict[str, Any]:
    if args.phase == "build":
        if not args.binary or not args.binary_sha256 or not args.source_commit:
            raise stable_error("build-requires-binary-sha256-and-source-commit")
        return build_candidate(args.binary, args.binary_sha256, args.source_commit, args.candidate_reference)
    if args.phase == "stage":
        return stage()
    if args.phase == "inspect":
        return inspect_phase()
    if args.phase == "activate":
        return activate(args.stop_timeout, args.health_timeout)
    if args.phase == "rollback":
        return rollback_impl(load_stage(), args.stop_timeout, args.health_timeout)
    raise stable_error("invalid-phase")


if __name__ == "__main__":
    try:
        result = main(parse_args())
        print(json.dumps(result, sort_keys=True))
    except Exception as error:
        print(json.dumps({
            "failed": True,
            "safeError": str(error) if isinstance(error, RuntimeError) else type(error).__name__,
            "automaticDeletionOrForceKill": False,
            "secretValuesPrinted": False,
        }))
        raise SystemExit(1)
