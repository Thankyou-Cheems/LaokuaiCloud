"""Frozen Gryt/SFU image update; preparation never activates production."""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import tarfile
import time

PROJECT = "laokuailiao"
NAMES = {"server": "laokuailiao-server", "sfu": "laokuailiao-sfu"}
BASE_IMAGES = {
    "server": "sha256:34cde4c1b3744568269bed640feec49706329da0ec8d1fb85a9feb1c8dea1425",
    "sfu": "sha256:585f0a76df9420f228f7b47020c35247cb76524f63125ea7c5bf49bb8ee9cd7b",
}
REQUIRED_OVERLAYS = [
    "sfu-12-fallback-16k60", "member-address-directory-20261013-r3",
    "community-network-v2-20261013-r1", "member-relay-v2-20261013-r1",
    "friendly-dns-20261013-r1", "voice-member-move-20261014-r1",
]
PROXY_UNIT = "laokuai-community-et-management.service"
GO_MOD_CACHE = Path("/opt/stacks/gryt/live16-voice-fixes-build-cache/go-mod-cache")
WORK = None
base_path = Path(__file__).with_name("base_operator.py")
if not base_path.is_file():
    base_path = Path(__file__).parent.parent / "community-network-v2/operator.py"
base_spec = importlib.util.spec_from_file_location("live16_existing_deployment_helpers", base_path)
b = importlib.util.module_from_spec(base_spec)
base_spec.loader.exec_module(b)


def run(args, timeout=90):
    try:
        value = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    except (subprocess.TimeoutExpired, FileNotFoundError) as error:
        raise RuntimeError("operator-command-unavailable") from error
    if value.returncode:
        # Docker output and test stderr may contain identities; keep them private.
        if WORK and WORK.is_dir():
            path = WORK / ("command-failure-" + str(time.time_ns()) + ".private.log")
            path.write_text(value.stdout + value.stderr, encoding="utf-8")
            path.chmod(0o600)
        raise RuntimeError("operator-command-failed:" + Path(args[0]).name)
    return value.stdout


def save(name, value):
    with (WORK / name).open("x", encoding="utf-8") as target:
        json.dump(value, target, indent=2, sort_keys=True)
        target.write("\n")
    (WORK / name).chmod(0o600)


def read(name):
    return json.loads((WORK / name).read_text(encoding="utf-8"))


b.run = run
digest, inspect, environment, shape = b.digest, b.inspect, b.env, b.shape
compose, config = b.compose, b.config


def healthy(row):
    return row["State"].get("Running") is True and row["State"].get("Health", {}).get("Status") == "healthy"


def files_for(row, service):
    labels = row["Config"]["Labels"]
    if labels.get("com.docker.compose.project") != PROJECT or labels.get("com.docker.compose.service") != service:
        raise RuntimeError("wrong-compose-owner")
    files = labels["com.docker.compose.project.config_files"].split(",")
    if len(set(files)) != len(files):
        raise RuntimeError("duplicate-compose-file")
    for item in files:
        path = Path(item)
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to("/opt/stacks/gryt"):
            raise RuntimeError("compose-file-outside-stack")
    return files


def all_files(rows):
    server = files_for(rows["server"], "server")
    sfu = files_for(rows["sfu"], "sfu")
    if server[:len(sfu)] != sfu:
        raise RuntimeError("compose-overlay-order-conflict")
    for required in REQUIRED_OVERLAYS:
        if not any(Path(item).parent.name == required and Path(item).name == "activation.overlay.json" for item in server):
            raise RuntimeError("required-overlay-missing")
    return server


def only_images(before, after, images):
    expected = copy.deepcopy(before)
    for service in NAMES:
        expected["services"][service]["image"] = images[service]
    if expected != after:
        raise RuntimeError("delta-outside-two-images")


def require_flags(rows):
    server, sfu = environment(rows["server"]), environment(rows["sfu"])
    expected_server = {"VOICE_MAX_USERS": "12", "VOICE_HYBRID_ENABLED": "true",
                       "VOICE_ATOMIC_MOVE_ENABLED": "true", "LAOKUAI_MEMBER_RELAY_POLICY_V2": "1"}
    expected_sfu = {"MAX_PEERS": "12", "SFU_HYBRID_ENABLED": "true", "SFU_AUDIO_ONLY": "true",
                    "SFU_REQUIRE_CLIENT_TOKEN": "true", "SFU_MICROPHONE_OPUS20": "true",
                    "SFU_MICROPHONE_OPUS_MAX_AVERAGE_BITRATE_BPS": "16000", "SFU_MICROPHONE_OPUS_PTIME_MS": "60"}
    if any(server.get(k) != v for k, v in expected_server.items()) or any(sfu.get(k) != v for k, v in expected_sfu.items()):
        raise RuntimeError("baseline-voice-policy-changed")


def peers():
    ids = run(["docker", "ps", "-q"]).split()
    if not ids:
        raise RuntimeError("running-container-inventory-empty")
    return {row["Name"]: [row["Id"], row["Image"], row["State"]["StartedAt"]]
            for row in json.loads(run(["docker", "inspect", *ids]))
            if row["Name"].lstrip("/") not in NAMES.values()}


def proxy():
    return run(["systemctl", "show", PROXY_UNIT, "--property=ActiveState", "--property=MainPID",
                "--property=ExecMainStartTimestampMonotonic"])


def baseline():
    rows = {service: inspect(name) for service, name in NAMES.items()}
    if any(row["Image"] != BASE_IMAGES[service] or not healthy(row) for service, row in rows.items()):
        raise RuntimeError("image-or-health-baseline-changed")
    require_flags(rows)
    files = all_files(rows)
    before = config(files)
    if any(inspect(before["services"][service]["image"])["Id"] != row["Image"] for service, row in rows.items()):
        raise RuntimeError("compose-runtime-image-mismatch")
    return rows, files, before


def inputs():
    value = read("input.json")
    if not re.fullmatch("[0-9a-f]{40}", value.get("sourceCommit", "")) or value.get("sourceWorkingTree") is not False:
        raise RuntimeError("source-not-frozen")
    for name in ["source.tar", "bundle.js", "operator.py", "base_operator.py"]:
        expected = value["artifacts"][name]
        if digest(WORK / name) != expected["sha256"] or (WORK / name).stat().st_size != expected["bytes"]:
            raise RuntimeError("input-pin-mismatch")
    return value


def extract_source():
    destination = WORK / "source"
    destination.mkdir(mode=0o700)
    with tarfile.open(WORK / "source.tar") as archive:
        for entry in archive.getmembers():
            if entry.issym() or entry.islnk() or not (entry.isfile() or entry.isdir()):
                raise RuntimeError("source-archive-special-file")
            component_root = entry.isdir() and entry.name.rstrip("/") == "components"
            if not (destination / entry.name).resolve().is_relative_to(destination.resolve()) or not (component_root or entry.name.startswith("components/")):
                raise RuntimeError("source-archive-outside-components")
        archive.extractall(destination, filter="data")


def go_command(image, network, writable_output=False):
    args = ["docker", "run", "--rm", "--network", network, "--cpus", "2", "--memory", "2g",
            "--pids-limit", "512", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=1024m", "--workdir", "/src",
            "--mount", f"type=bind,source={WORK / 'source/components/sfu'},target=/src,readonly",
            "--mount", f"type=bind,source={GO_MOD_CACHE},target=/gomod" + (",readonly" if network == "none" else ""),
            "-e", "GOTOOLCHAIN=local", "-e", "CGO_ENABLED=0", "-e", "GOMODCACHE=/gomod",
            "-e", "GOCACHE=/tmp/go-cache"]
    if writable_output:
        args += ["--mount", f"type=bind,source={WORK / 'binary'},target=/out"]
    return args + [image, "go"]


def build_test():
    value = inputs()
    rows, files, before = baseline()
    saved = {"rows": rows, "files": files, "compose": before,
             "composeHashes": {p: digest(p) for p in files}, "peers": peers(), "proxy": proxy()}
    save("baseline.private.json", saved)
    extract_source()
    (WORK / "binary").mkdir(mode=0o700)
    GO_MOD_CACHE.mkdir(mode=0o700, parents=True, exist_ok=True)
    tool_reference = "golang:1.25-alpine"
    run(["docker", "pull", tool_reference], 600)
    tool = inspect(tool_reference)
    tool_id = tool["Id"]
    run(go_command(tool_id, "bridge") + ["mod", "download"], 900)
    output = run(go_command(tool_id, "none") + ["test", "-count=1", "-timeout=90s",
                 "./internal/svc", "./internal/track", "./internal/room", "./internal/websocket", "./internal/webrtc", "./internal/config"], 900)
    (WORK / "go-tests.private.log").write_text(output, encoding="utf-8")
    (WORK / "go-tests.private.log").chmod(0o600)
    version = "1.0.0-laokuai.live16." + value["sourceCommit"][:12]
    run(go_command(tool_id, "none", True) + ["build", "-trimpath", "-ldflags", "-s -w -X main.Version=" + version,
                                           "-o", "/out/sfu", "./cmd/sfu"], 900)
    binary = WORK / "binary/sfu"
    head = binary.read_bytes()[:20]
    if head[:4] != b"\x7fELF" or head[4:6] != b"\x02\x01" or head[18:20] != b"\x3e\x00":
        raise RuntimeError("sfu-not-linux-amd64-elf")
    candidate_images = {}
    for service in NAMES:
        folder = WORK / ("image-" + service)
        folder.mkdir(mode=0o700)
        artifact = WORK / "bundle.js" if service == "server" else binary
        target = "/app/bundle.js" if service == "server" else "/usr/local/bin/sfu"
        data = artifact.read_bytes()
        (folder / "artifact").write_bytes(data)
        (folder / "artifact").chmod(0o755 if service == "sfu" else 0o644)
        artifact_sha = hashlib.sha256(data).hexdigest()
        base_tag = "local.laokuai/live16-base-" + service + ":" + value["sourceCommit"][:12]
        run(["docker", "tag", rows[service]["Image"], base_tag])
        (folder / "Dockerfile").write_text(f"FROM {base_tag}\nCOPY --chown=1001:1001 artifact {target}\n"
            f'LABEL org.opencontainers.image.revision="{value["sourceCommit"]}" laokuai.artifact.sha256="{artifact_sha}"\n', encoding="utf-8")
        tag = "local.laokuai/live16-" + service + ":" + value["sourceCommit"][:12]
        run(["docker", "build", "--network=none", "--pull=false", "-t", tag, str(folder)], 300)
        candidate_images[service] = inspect(tag)["Id"]
        if service == "sfu":
            # Standard flag help exits before configuration/listeners; there is no --version flag.
            run(["docker", "run", "--rm", "--network=none", "--read-only", "--cap-drop=ALL",
                 "--security-opt=no-new-privileges", candidate_images[service], "-h"])
    save("activation.overlay.json", {"services": {s: {"image": i} for s, i in candidate_images.items()}})
    save("rollback.overlay.json", {"services": {s: {"image": i} for s, i in BASE_IMAGES.items()}})
    only_images(before, config(files + [str(WORK / "activation.overlay.json")]), candidate_images)
    verify_baseline(saved)
    result = {"sourceCommit": value["sourceCommit"], "images": candidate_images, "baseImages": BASE_IMAGES,
              "bundleSha256": digest(WORK / "bundle.js"), "sfuSha256": digest(binary), "sourceArchiveSha256": digest(WORK / "source.tar"),
              "goToolchainImage": tool_id, "goToolchainRepoDigests": tool.get("RepoDigests", []),
              "goVersion": run(go_command(tool_id, "none") + ["version"]).strip(),
              "isolatedGoTestsPassed": True, "testsNetwork": "none", "productionStarted": False,
              "composeFiles": files, "environmentDelta": {}, "voiceMaxUsers": 12, "sfuBitrate": 16000, "sfuPacketTimeMs": 60}
    save("BUILD.json", result)
    return result


def verify_baseline(saved):
    if any(digest(p) != h for p, h in saved["composeHashes"].items()) or config(saved["files"]) != saved["compose"]:
        raise RuntimeError("compose-baseline-drift")
    if peers() != saved["peers"] or proxy() != saved["proxy"]:
        raise RuntimeError("unrelated-service-drift")
    for service, old in saved["rows"].items():
        now = inspect(NAMES[service])
        if now["Id"] != old["Id"] or now["Image"] != old["Image"] or shape(now) != shape(old) or not healthy(now):
            raise RuntimeError("production-baseline-drift")


def stage():
    inputs()
    saved, built = read("baseline.private.json"), read("BUILD.json")
    verify_baseline(saved)
    only_images(saved["compose"], config(saved["files"] + [str(WORK / "activation.overlay.json")]), built["images"])
    with sqlite3.connect("file:/opt/stacks/gryt/data/gryt.db?mode=ro", uri=True) as source, sqlite3.connect(WORK / "gryt.before.private.db") as target:
        source.backup(target)
    (WORK / "gryt.before.private.db").chmod(0o600)
    result = {"sourceCommit": built["sourceCommit"], "images": built["images"],
              "overlaySha256": digest(WORK / "activation.overlay.json"), "rollbackSha256": digest(WORK / "rollback.overlay.json"),
              "databaseBackupSha256": digest(WORK / "gryt.before.private.db"), "productionStarted": False}
    save("STAGED.json", result)
    return result


def wait_healthy(service, image):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        row = inspect(NAMES[service])
        if row["Image"] == image and healthy(row):
            return row
        time.sleep(0.5)
    raise RuntimeError("service-health-timeout:" + service)


def stop_owned(service, allowed):
    row = inspect(NAMES[service])
    if row["Image"] not in allowed:
        raise RuntimeError("foreign-image-no-stop")
    if not row["State"].get("Running"):
        return
    run(["docker", "kill", "--signal=TERM", row["Id"]])
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if not inspect(NAMES[service])["State"].get("Running"):
            return
        time.sleep(0.25)
    raise RuntimeError("graceful-stop-timeout-no-force-kill")


def guards_for_restart(saved):
    if any(digest(p) != h for p, h in saved["composeHashes"].items()) or config(saved["files"]) != saved["compose"]:
        raise RuntimeError("compose-baseline-drift")
    if peers() != saved["peers"] or proxy() != saved["proxy"]:
        raise RuntimeError("unrelated-service-drift")


def apply_overlay(saved, images, overlay):
    guards_for_restart(saved)
    files = saved["files"] + [str(WORK / overlay)]
    only_images(saved["compose"], config(files), images)
    for service in ["sfu", "server"]:
        stop_owned(service, {BASE_IMAGES[service], read("BUILD.json")["images"][service]})
    compose(files, ["up", "-d", "--no-deps", "--no-build", "--pull", "never", "server", "sfu"])
    for service in NAMES:
        row = wait_healthy(service, images[service])
        if shape(row) != shape(saved["rows"][service]):
            raise RuntimeError("live-environment-ports-mounts-drift")
    guards_for_restart(saved)


def rollback():
    inputs()
    saved, staged = read("baseline.private.json"), read("STAGED.json")
    if digest(WORK / "rollback.overlay.json") != staged["rollbackSha256"]:
        raise RuntimeError("rollback-overlay-drift")
    apply_overlay(saved, BASE_IMAGES, "rollback.overlay.json")
    result = {"rolledBack": True, "images": BASE_IMAGES, "allPriorOverlaysPreserved": True, "databaseRestored": False}
    save("ROLLED-BACK.json", result)
    return result


def activate():
    inputs()
    saved, staged, built = read("baseline.private.json"), read("STAGED.json"), read("BUILD.json")
    verify_baseline(saved)
    if staged["images"] != built["images"] or digest(WORK / "activation.overlay.json") != staged["overlaySha256"]:
        raise RuntimeError("staged-candidate-drift")
    try:
        apply_overlay(saved, built["images"], "activation.overlay.json")
        result = {**built, "activated": True, "productionStarted": True, "environmentPortsMountsPreserved": True,
                  "allPriorOverlaysPreserved": True, "etProxyOtherContainersUnchanged": True, "oldImagesKept": True}
        save("ACTIVATED.json", result)
        return result
    except Exception as error:
        try:
            rollback()
        except Exception:
            raise RuntimeError("activation-failed-rollback-needs-operator") from error
        raise RuntimeError("activation-failed-rolled-back") from error


def main():
    global WORK
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["inspect", "build-test", "stage", "activate", "rollback"])
    parser.add_argument("--work", required=True, type=Path)
    args = parser.parse_args()
    WORK = args.work.resolve()
    if WORK.parent != Path("/opt/stacks/gryt") or not re.fullmatch("live16-voice-fixes-[0-9a-f]{12}(?:-r[1-9][0-9]*)?", WORK.name) or not WORK.is_dir():
        raise RuntimeError("invalid-work-directory")
    if args.phase == "inspect":
        rows, files, _ = baseline()
        return {"images": {s: r["Image"] for s, r in rows.items()}, "composeFiles": files, "productionStarted": False}
    return {"build-test": build_test, "stage": stage, "activate": activate, "rollback": rollback}[args.phase]()


if __name__ == "__main__":
    os.umask(0o077)
    try:
        print(json.dumps(main(), sort_keys=True))
    except Exception as error:
        print(json.dumps({"failed": True, "safeError": str(error) if isinstance(error, RuntimeError) else type(error).__name__}))
        raise SystemExit(1)
