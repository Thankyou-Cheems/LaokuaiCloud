"""Run one exact local image against disposable synthetic data, without host ports.

No pull/build/load, real data mount, account setup, production credentials or image
mutation. Only this script's exact labelled container is stopped/removed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import uuid

IMAGE = "sha256:e45e9c27fe391aa9281365745a54c34529b502f09fa79a2d8e68fcc5486d1eba"
SOURCE = "85ec3b9c60d49881ba9ad5cd48c9a17d59c1772d"
TREE = "96db8312488c4f399904192f3a932232cf6130ad"
LABEL = "local.laokuai.test-owner"
OWNER = "task6-offline-synthetic-control"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, help="New/empty owner-local evidence directory")
    parser.add_argument("--sfu-binary", required=True, help="Frozen exact SFU ELF, read only")
    args = parser.parse_args()
    sfu_binary = Path(args.sfu_binary).resolve()
    sfu_sha = hashlib.sha256(sfu_binary.read_bytes()).hexdigest()
    assert sfu_sha == "47378f28e35a4a9a95aced3c3d4f21f028e13e6552721e1a814ed7492203afb2"
    output = Path(args.output_dir).resolve()
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise RuntimeError("Evidence directory must be new or empty")
    output.mkdir(parents=True, exist_ok=True)
    fixture = Path(__file__).resolve().parent
    if os.name == "nt":
        import ctypes
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)
    docker = shutil.which("docker")
    if not docker:
        raise RuntimeError("Existing Docker CLI required; no automatic install/start")

    def cli(*commands, timeout=15, accept=(0,)):
        result = subprocess.run([docker, *commands], capture_output=True, text=True, timeout=timeout)
        if result.returncode not in accept:
            raise RuntimeError("Docker operation failed: " + commands[0] + ": " + result.stderr.strip()[:500])
        return result.stdout + result.stderr if commands[0] == "logs" else result.stdout

    image = json.loads(cli("image", "inspect", IMAGE))[0]
    assert image["Id"] == IMAGE
    assert image["Architecture"] == "amd64" and image["Os"] == "linux"
    assert image["Config"]["User"] == "gryt"
    assert image["Config"]["Labels"]["org.opencontainers.image.revision"] == SOURCE
    assert image["Config"]["Labels"]["local.laokuai.component-tree"] == TREE
    sfu_image = json.loads(cli("image", "inspect", "sha256:e0f67b7c7dc5985993d0edd17efd0ea52dd591cdff668f1a1fa342ca87d64db4"))[0]
    assert sfu_image["Config"]["Labels"]["org.opencontainers.image.revision"] == SOURCE
    assert sfu_image["Config"]["Labels"]["local.laokuai.component-tree"] == "24c3669c4ca13d39f8132225ae1cb4a450750729"
    name = "laokuai-task6-control-" + uuid.uuid4().hex[:12]
    container = None
    result = None
    receipt = {"schema": 1, "imageId": IMAGE, "candidateSourceCommit": SOURCE, "serverTree": TREE, "sfuElfSha256": sfu_sha, "sfuSourceTree": "24c3669c4ca13d39f8132225ae1cb4a450750729",
               "name": name, "passed": False, "productionTouched": False, "realCredentials": False,
               "scripts": {item.name: hashlib.sha256(item.read_bytes()).hexdigest()
                           for item in (fixture / "image-control.cjs", Path(__file__).resolve())}}

    def own_state():
        state = json.loads(cli("inspect", container))[0]
        assert state["Config"]["Labels"][LABEL] == OWNER
        assert state["Image"] == IMAGE
        return state

    try:
        container = cli("create", "--name", name, "--label", LABEL + "=" + OWNER,
                        "--network", "none", "--read-only", "--restart", "no",
                        "--cpus", "1", "--cpuset-cpus", "0", "--memory", "1g", "--memory-swap", "1g",
                        "--pids-limit", "96", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                        "--tmpfs", "/data:rw,nosuid,nodev,size=64m,uid=1001,gid=1001,mode=0700",
                        "--tmpfs", "/tmp:rw,nosuid,nodev,size=32m,uid=1001,gid=1001,mode=1777",
                        "--mount", "type=bind,src=" + str(fixture) + ",dst=/fixture,readonly",
                        "--mount", "type=bind,src=" + str(sfu_binary) + ",dst=/fixturebin/sfu,readonly",
                        IMAGE, "node", "/fixture/image-control.cjs").strip()
        assert len(container) == 64 and all(c in "0123456789abcdef" for c in container)
        state = own_state()
        config = state["HostConfig"]
        assert config["NetworkMode"] == "none" and not config.get("PortBindings")
        assert config["ReadonlyRootfs"] and config["NanoCpus"] == 1000000000
        assert config["Memory"] == 1073741824 and config["MemorySwap"] == 1073741824
        assert config["RestartPolicy"]["Name"] == "no"
        assert len(state["Mounts"]) == 2
        assert {mount["Destination"] for mount in state["Mounts"]} == {"/fixture", "/fixturebin/sfu"}
        assert all(not mount["RW"] and mount["Type"] == "bind" for mount in state["Mounts"])
        assert set(config["Tmpfs"]) == {"/data", "/tmp"}
        receipt["isolation"] = {"network": config["NetworkMode"], "portBindings": config.get("PortBindings"),
                                "readonlyRootfs": True, "readonlyFixtureAndExactSfuElfMountOnly": True,
                                "realDataMounts": 0, "cpuCount": 1, "memoryBytes": config["Memory"],
                                "persistentTestCredentials": False}
        receipt["containerId"] = container
        cli("start", container)
        deadline = time.monotonic() + 110
        samples = []
        while time.monotonic() < deadline:
            state = own_state()
            samples.append({"elapsedSeconds": round(110 - (deadline-time.monotonic()), 2),
                            "running": state["State"]["Running"], "networkNone": state["HostConfig"]["NetworkMode"] == "none",
                            "hostPortBindingsEmpty": not state["HostConfig"].get("PortBindings")})
            if not state["State"]["Running"]:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Own fixture exceeded external deadline")
        receipt["samples"] = samples
        logs = cli("logs", container)
        (output / "protocol.stdout.log").write_text(logs, encoding="utf-8")
        lines = [json.loads(line) for line in logs.splitlines() if line.startswith('{"passed"')]
        assert len(lines) == 1, "Exactly one fixture result required"
        result = lines[0]
        receipt["fixtureResult"] = result
        receipt["exitCode"] = state["State"]["ExitCode"]
        receipt["oomKilled"] = state["State"]["OOMKilled"]
        assert receipt["exitCode"] == 0 and not receipt["oomKilled"]
        assert result["passed"] is True
        receipt["passed"] = True
    except Exception as error:
        receipt["failure"] = str(error)
        if container:
            try:
                (output / "protocol.stdout.log").write_text(cli("logs", container), encoding="utf-8")
            except Exception:
                pass
    finally:
        if container:
            state = own_state()
            if state["State"]["Running"]:
                cli("stop", "--time", "8", container, timeout=15)
            state = own_state()
            assert not state["State"]["Running"]
            receipt["stoppedExitCode"] = state["State"]["ExitCode"]
            cli("rm", container)
            removed = subprocess.run([docker, "inspect", container], capture_output=True, text=True, timeout=15)
            assert removed.returncode != 0
            receipt["ownedContainerRemoved"] = True
            receipt["tmpfsDiscarded"] = True
        (output / "RESULT.json").write_text(json.dumps(receipt, indent=2)+"\n", encoding="utf-8")
    print(json.dumps({"passed": receipt["passed"], "result": str(output / "RESULT.json"),
                      "checks": len((result or {}).get("checks", [])), "cleanup": receipt.get("ownedContainerRemoved", False)}))
    return 0 if receipt["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
