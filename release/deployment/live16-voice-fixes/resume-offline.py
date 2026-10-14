"""Resume this preparation after an unavailable Go proxy, without repinning r2."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tarfile

TOOL_IMAGE = "sha256:07d6e65bb14b257e518eb70088f0c6826c86ff6185538bdb946bcda8e211d03b"
PREPARATION_IDS = {"6448082f1baf01008d573b802b493c6a461915198ee92268ce4a3942eea2c973",
                   "9dab5ccf7588790966877a1425597b7691476e4177e5741b2f48061ed6d54cc9"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--work", required=True, type=Path)
    parser.add_argument("--cache-manifest-sha256", required=True)
    parser.add_argument("--phase", choices=["build-test", "stage", "activate", "rollback"], default="build-test")
    args = parser.parse_args()
    work = args.work.resolve()
    if work.parent != Path("/opt/stacks/gryt") or work.name != "live16-voice-fixes-06708268dfda-r2":
        raise RuntimeError("wrong-offline-recovery-directory")
    spec = importlib.util.spec_from_file_location("frozen_live16_r2", work / "operator.py")
    op = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(op)
    op.WORK = work
    inputs = op.inputs()
    saved = op.read("baseline.private.json")
    # The original snapshot includes the separately authorized cache warmer.
    # Exclude only its two already verified/stopped IDs, retaining original evidence.
    saved["peers"] = {name: row for name, row in saved["peers"].items() if row[0] not in PREPARATION_IDS}
    original_peers, original_read = op.peers, op.read
    op.peers = lambda: {name: row for name, row in original_peers().items() if row[0] not in PREPARATION_IDS}
    op.read = lambda name: saved if name == "baseline.private.json" else original_read(name)
    if args.phase != "build-test":
        if op.digest(work / "go-download-cache-input.json") != args.cache_manifest_sha256:
            raise RuntimeError("module-cache-manifest-pin-mismatch")
        return {"stage": op.stage, "activate": op.activate, "rollback": op.rollback}[args.phase]()
    op.verify_baseline(saved)
    if (work / "BUILD.json").exists() or op.inspect("golang:1.25-alpine")["Id"] != TOOL_IMAGE:
        raise RuntimeError("candidate-already-built-or-tool-image-drift")
    manifest_path = work / "go-download-cache-input.json"
    if op.digest(manifest_path) != args.cache_manifest_sha256:
        raise RuntimeError("module-cache-manifest-pin-mismatch")
    cache = json.loads(manifest_path.read_text())
    if cache["sourceCommit"] != inputs["sourceCommit"] or cache.get("onlyResolvedPublicModuleCacheFiles") is not True:
        raise RuntimeError("module-cache-provenance-invalid")
    archive = work / "go-download-cache.tar.gz"
    if op.digest(archive) != cache["archiveSha256"]:
        raise RuntimeError("module-cache-archive-pin-mismatch")
    files = {row["path"]: row for row in cache["files"]}
    with tarfile.open(archive) as source:
        for member in source.getmembers():
            if not member.isfile() or member.name not in files or not member.name.startswith("cache/download/"):
                raise RuntimeError("module-cache-member-outside-manifest")
            if not (op.GO_MOD_CACHE / member.name).resolve().is_relative_to(op.GO_MOD_CACHE):
                raise RuntimeError("module-cache-member-outside-cache")
            data = source.extractfile(member).read()
            if hashlib.sha256(data).hexdigest() != files[member.name]["sha256"] or len(data) != files[member.name]["bytes"]:
                raise RuntimeError("module-cache-file-pin-mismatch")
        source.extractall(op.GO_MOD_CACHE, filter="data")
    # The r2 source directory already came from its pinned Git archive. Recheck
    # every source file before reusing it; never replace original evidence.
    with tarfile.open(work / "source.tar") as source:
        for member in source.getmembers():
            if member.isfile():
                current = work / "source" / member.name
                if hashlib.sha256(source.extractfile(member).read()).hexdigest() != op.digest(current):
                    raise RuntimeError("extracted-frozen-source-drift")
    binary = work / "binary"
    if binary.exists():
        if list(binary.iterdir()):
            raise RuntimeError("unexpected-existing-binary-output")
        binary.rmdir()  # Empty preparation directory only; no artifact is removed.
    original_save, original_run, original_go = op.save, op.run, op.go_command

    def save(name, value):
        if name == "baseline.private.json":
            op.verify_baseline(saved)
            return
        original_save(name, value)

    cache_writable = True

    def go(image, network, writable_output=False):
        command = original_go(image, "none", writable_output)
        command = [part.replace("/tmp:rw,nosuid,nodev,size=1024m", "/tmp:rw,exec,nosuid,nodev,size=1024m") for part in command]
        if "HOME=/tmp" in command:
            position = command.index("HOME=/tmp")
            del command[position - 1:position + 1]
        # Cache expands only public zip inputs; source and go.mod remain read-only.
        if cache_writable:
            command = [part.replace("target=/gomod,readonly", "target=/gomod") for part in command]
        position = command.index(image)
        command[position:position] = ["-e", "GOPROXY=off", "-e", "GOSUMDB=off", "-e", "GOFLAGS=-mod=readonly"]
        return command

    def run(command, timeout=90):
        if command[:2] == ["docker", "pull"] or command[-3:] == ["go", "mod", "download"]:
            return "offline-module-inputs-pinned"
        return original_run(command, timeout)

    op.save, op.go_command, op.run = save, go, run
    op.b.run = run
    op.extract_source = lambda: None
    # Expand only imported/tested packages offline before formal read-only cache use.
    original_run(go(TOOL_IMAGE, "none") + ["list", "-deps", "-test", "./cmd/sfu", "./internal/svc", "./internal/track",
                                          "./internal/room", "./internal/websocket", "./internal/webrtc", "./internal/config"], 300)
    cache_writable = False
    result = op.build_test()
    supplement = {"sourceCommit": inputs["sourceCommit"], "moduleCacheArchiveSha256": cache["archiveSha256"],
                  "moduleCacheManifestSha256": args.cache_manifest_sha256,
                  "wrapperSha256": op.digest(Path(__file__)), "goProxy": "off", "goSumDb": "off",
                  "goFlags": "-mod=readonly", "homeOverridden": False, "productionStarted": False}
    original_save("OFFLINE-PRESTAGE.json", supplement)
    return {**result, "offlineSupplement": supplement}


if __name__ == "__main__":
    os.umask(0o077)
    try:
        print(json.dumps(main(), sort_keys=True))
    except Exception as error:
        print(json.dumps({"failed": True, "safeError": str(error) if isinstance(error, RuntimeError) else type(error).__name__}))
        raise SystemExit(1)
