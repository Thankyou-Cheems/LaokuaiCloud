"""Server-only native voice activation; private baselines and pinned rollback."""
import argparse
import copy
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import time

WORK = None
SERVER = "laokuailiao-server"
PROXY = "laokuai-community-et-management.service"
helper = Path(__file__).with_name("base_operator.py")
if not helper.exists():
    helper = Path(__file__).parent.parent / "community-network-v2/operator.py"
spec = importlib.util.spec_from_file_location("deployment_helpers", helper)
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


def run(args, timeout=90):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        p = WORK / (str(time.time_ns()) + ".private.log")
        p.write_text(result.stdout + result.stderr, encoding="utf-8")
        p.chmod(0o600)
        raise RuntimeError("command-failed:" + Path(args[0]).name)
    return result.stdout


b.run = run


def save(name, value):
    with (WORK / name).open("x", encoding="utf-8") as f:
        json.dump(value, f, indent=2)
    (WORK / name).chmod(0o600)


def read(name):
    return json.loads((WORK / name).read_text(encoding="utf-8"))


def peers():
    result = {}
    for container in run(["docker", "ps", "-q"]).split():
        row = b.inspect(container)
        if row["Name"].lstrip("/") != SERVER:
            result[row["Name"]] = [row["Id"], row["Image"], row["State"]["StartedAt"]]
    return result


def proxy():
    return run(["systemctl", "show", PROXY, "--property=ActiveState",
                "--property=MainPID", "--property=ExecMainStartTimestampMonotonic"])


def frozen():
    data = read("input.json")
    commit = data["sourceCommit"]
    if len(commit) != 40 or any(c not in "0123456789abcdef" for c in commit):
        raise RuntimeError("invalid-source-pin")
    for name, item in data["artifacts"].items():
        if Path(name).name != name or b.digest(WORK / name) != item["sha256"] or (WORK / name).stat().st_size != item["bytes"]:
            raise RuntimeError("frozen-input-mismatch")
    return data


def discover():
    row = b.inspect(SERVER)
    files = b.live_files(row)
    config = b.config(files)
    env = b.env(row)
    if row["State"].get("Health", {}).get("Status") != "healthy":
        raise RuntimeError("baseline-unhealthy")
    if env.get("VOICE_MAX_USERS") != "12" or env.get("LAOKUAI_MEMBER_RELAY_POLICY_V2") != "1":
        raise RuntimeError("unexpected-cap-or-relay-policy")
    if row["Config"]["Cmd"] != ["node", "bundle.js"] or row["Config"]["WorkingDir"] != "/app":
        raise RuntimeError("unexpected-entrypoint")
    return dict(server=row, files=files, config=config, hashes={p:b.digest(p) for p in files}, peers=peers(), proxy=proxy())


def inspect_phase():
    state = discover()
    return {"readOnly": True, "serverImage": state["server"]["Image"],
            "nativeMode": b.env(state["server"]).get("NATIVE_LAN_VOICE_ENABLED", "false"),
            "voiceMaxUsers": 12, "memberRelayEnabled": True, "otherContainers": len(state["peers"])}


def guard(check_peers=True):
    before = read("baseline.private.json")
    if any(b.digest(p) != h for p,h in before["hashes"].items()) or b.config(before["files"]) != before["config"]:
        raise RuntimeError("baseline-config-changed")
    if check_peers and (peers() != before["peers"] or proxy() != before["proxy"]):
        raise RuntimeError("independent-service-changed")
    return before


def smoke(image):
    name = "laokuai-native-smoke-" + frozen()["sourceCommit"][:12]
    run(["docker", "run", "-d", "--name", name, "--network=none", "--read-only",
         "--tmpfs", "/tmp:rw,nosuid,nodev", "--tmpfs", "/app/data:rw,uid=1001,gid=1001",
         "-e", "NATIVE_LAN_VOICE_ENABLED=true", "-e", "DISABLE_S3=true", "-e", "DATA_DIR=/app/data",
         "-e", "NODE_ENV=development", "-e", "PORT=5000", image])
    try:
        deadline = time.monotonic() + 55
        while time.monotonic() < deadline:
            row = b.inspect(name)
            if not row["State"]["Running"]:
                run(["docker", "logs", name])
                raise RuntimeError("isolated-startup-exited")
            check = subprocess.run(["docker", "exec", name, "node", "-e",
                "fetch('http://127.0.0.1:5000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], capture_output=True)
            if check.returncode == 0:
                return
            time.sleep(1)
        raise RuntimeError("isolated-health-timeout")
    finally:
        log = WORK / "smoke.private.log"
        log.write_text(run(["docker", "logs", name]), encoding="utf-8")
        log.chmod(0o600)
        run(["docker", "rm", "-f", name])


def build():
    data = frozen()
    before = discover()
    # The same server-only flow also upgrades an already enabled native server.
    # Rollback keeps the baseline's existing flag via its original Compose stack.
    save("baseline.private.json", before)
    base = before["server"]["Image"]
    prefix = "local.laokuai/native-lan-voice"
    base_tag = prefix + "-rollback:" + data["sourceCommit"][:12]
    run(["docker", "tag", base, base_tag])
    (WORK / "Dockerfile").write_text('FROM '+base_tag+'\nCOPY --chown=1001:1001 bundle.js /app/bundle.js\nLABEL org.opencontainers.image.revision="'+data["sourceCommit"]+'"\n', encoding="utf-8")
    (WORK / ".dockerignore").write_text("*\n!Dockerfile\n!bundle.js\n", encoding="utf-8")
    tag = prefix + ":" + data["sourceCommit"][:12]
    run(["docker", "build", "--network=none", "--pull=false", "-t", tag, str(WORK)], 180)
    image = b.inspect(tag)["Id"]
    smoke(image)
    guard()
    overlay = {"services":{"server":{"image":image,"environment":{"NATIVE_LAN_VOICE_ENABLED":"true"}}}}
    save("activation.overlay.json", overlay)
    after = b.config(before["files"] + [str(WORK / "activation.overlay.json")])
    expected = copy.deepcopy(before["config"])
    expected["services"]["server"]["image"] = image
    expected["services"]["server"]["environment"]["NATIVE_LAN_VOICE_ENABLED"] = "true"
    if after != expected:
        raise RuntimeError("compose-delta-outside-server-image-and-native-flag")
    save("rollback.overlay.json", {"services":{"server":{"image":base}}})
    result = dict(sourceCommit=data["sourceCommit"], baseImage=base, candidateImage=image,
                  bundleSha256=data["artifacts"]["bundle.js"]["sha256"], isolatedHealthPassed=True,
                  overlaySha256=b.digest(WORK / "activation.overlay.json"), productionStarted=False)
    save("BUILD.json", result)
    return result


def wait_health(image):
    deadline = time.monotonic() + 55
    while time.monotonic() < deadline:
        row = b.inspect(SERVER)
        if row["Image"] == image and row["State"].get("Health", {}).get("Status") == "healthy":
            return row
        time.sleep(1)
    raise RuntimeError("production-health-timeout")


def stop_server():
    # Do not force-kill production. An unresponsive process stops the deployment.
    row = b.inspect(SERVER)
    if not row["State"]["Running"]:
        return
    run(["docker", "kill", "--signal=TERM", SERVER])
    for _ in range(30):
        if not b.inspect(SERVER)["State"]["Running"]:
            return
        time.sleep(1)
    raise RuntimeError("server-did-not-stop-gracefully")


def rollback():
    # Unrelated services may restart independently; this must not prevent
    # restoring Gryt. Never change those services to reproduce the baseline.
    before = guard(check_peers=False)
    if b.inspect(SERVER)["Image"] not in (before["server"]["Image"], read("BUILD.json")["candidateImage"]):
        raise RuntimeError("unrecognized-current-image")
    stop_server()
    b.compose(before["files"] + [str(WORK / "rollback.overlay.json")], ["up", "-d", "--no-deps", "--no-build", "--pull", "never", "server"])
    restored = wait_health(before["server"]["Image"])
    guard(check_peers=False)
    if b.shape(restored) != b.shape(before["server"]):
        raise RuntimeError("rollback-runtime-drift")
    return {"rolledBack": True, "serverImage": restored["Image"],
            "independentServicesUnchanged": peers() == before["peers"] and proxy() == before["proxy"]}


def activate():
    frozen()
    build = read("BUILD.json")
    before = guard()
    if b.inspect(SERVER)["Id"] != before["server"]["Id"]:
        raise RuntimeError("server-changed-after-build")
    if b.digest(WORK / "activation.overlay.json") != build["overlaySha256"]:
        raise RuntimeError("activation-overlay-changed")
    if b.env(before["server"]).get("DATA_DIR") != "/data" or not any(
        m["Destination"] == "/data" and m["Source"] == "/opt/stacks/gryt/data"
        and m["Type"] == "bind" for m in before["server"]["Mounts"]):
        raise RuntimeError("database-backup-does-not-match-live-mount")
    with sqlite3.connect("file:/opt/stacks/gryt/data/gryt.db?mode=ro", uri=True) as source:
        with sqlite3.connect(WORK / "gryt.before.private.db") as target:
            source.backup(target)
            if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("database-backup-integrity")
    (WORK / "gryt.before.private.db").chmod(0o600)
    stop_server()
    try:
        b.compose(before["files"] + [str(WORK / "activation.overlay.json")], ["up", "-d", "--no-deps", "--no-build", "--pull", "never", "server"])
        row = wait_health(build["candidateImage"])
        expected = b.shape(before["server"])
        expected["environment"]["NATIVE_LAN_VOICE_ENABLED"] = "true"
        if b.shape(row) != expected:
            save("runtime-drift.private.json", {"expected": expected, "actual": b.shape(row)})
            raise RuntimeError("production-runtime-drift")
        guard()
    except Exception:
        save("automatic-rollback.json", rollback())
        raise
    result = dict(sourceCommit=build["sourceCommit"], serverImage=row["Image"], oldServerImage=before["server"]["Image"],
                  nativeMode=True, healthy=True, voiceMaxUsers=12, memberRelayEnabled=True,
                  independentContainersUnchanged=True, managementProxyUnchanged=True,
                  databaseBackupVerified=True, databaseRestored=False, twoDeviceVoiceVerified=False)
    save("ACTIVATION.json", result)
    return result


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("phase", choices=["inspect", "build", "activate", "rollback"])
    p.add_argument("--work", required=True)
    a = p.parse_args()
    WORK = Path(a.work).resolve()
    if not WORK.is_relative_to("/opt/stacks/gryt") or not WORK.is_dir():
        raise RuntimeError("invalid-private-work-directory")
    os.umask(0o077)
    print(json.dumps({"inspect":inspect_phase,"build":build,"activate":activate,"rollback":rollback}[a.phase](), indent=2))
