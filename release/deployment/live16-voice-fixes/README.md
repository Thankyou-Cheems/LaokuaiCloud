# .16 Gryt/SFU voice fixes

This update replaces the two existing service images with the reviewed voice
fixes. It preserves all current environment, ports, mounts, databases, the
12-person limit, SFU 16000 bit/s and 60ms policy, enabled member relay and member
move. It reuses the Compose/Docker helpers from `community-network-v2/operator.py`;
none of that older operator's activation or relay downgrade functions are used.

The Gryt fixes release an authenticated owner's old pair after its remote member
leaves and retain fixed SFU failure codes. The SFU fixes apply the same microphone
policy during initial negotiation, renegotiation and staged moves. These changes
do not establish real two-device recovery or sound-quality acceptance.

`prepare.ps1 -SourceCommit <40-hex application commit>` checks the server/SFU
source against that commit, exports its exact Git source, builds a Node22-targeted
Gryt bundle and uploads hash-pinned inputs to a new private directory. Deployment
scripts are separately hash-pinned when they are prepared after the application
commit. Existing evidence is never overwritten. This step only inspects production.

On the server, use `python3 -I <work>/operator.py <phase> --work <work>`.
`-I` prevents the filename `operator.py` from shadowing Python's standard module:

- `inspect`: read-only baseline check. The server's latest ordered Compose file
  list includes every overlay; the SFU's older list must be its prefix.
- `build-test`: pull the existing Dockerfile's Go toolchain family and record its
  immutable image ID. Only dependency download uses an isolated bridge container.
  Go tests and Linux amd64 build run with `--network none`, no published ports,
  no host network or production data, read-only source, dropped capabilities,
  two CPUs and 2GiB memory. Candidate images copy only the frozen bundle/binary
  over each exact current image; Docker builds use `--network=none --pull=false`.
- `stage`: verify unchanged production and all Compose hashes, compare the
  effective configuration for exactly two image changes, and make an online
  SQLite backup including WAL. It does not start production.
- `activate`: a separate reviewed action. Gracefully stop only these two owned
  services, start only `server sfu` with `--no-deps --no-build --pull never`, and
  check health, full runtime shape and unrelated container/proxy identities.
  A graceful-stop timeout does not force-kill. Activation failures attempt the
  pinned two-image rollback.
- `rollback`: keep all original overlays and restore both exact preceding,
  already V2-capable images. Preserve current database and ledger; do not restore
  an older database snapshot or downgrade relay credentials.

Private inspect documents, command/test logs, database backup and Go module cache
remain on the server or under local `.local/`. Publish only reviewed source and
sanitized receipts. `BUILD.json` and `STAGED.json` establish preparation only;
`ACTIVATED.json` plus measured post-update checks establish actual deployment.

The activation command and exact candidate/source hashes must be handed to the
coordinating agent for review. This preparation workflow never invokes activation
automatically.

## Actual .16 execution

Application source: `06708268dfda7e5021e145970c913968d190f40c`.
Preparation directory: `/opt/stacks/gryt/live16-voice-fixes-06708268dfda-r2`.
The coordinating agent performed the separate activation; its public deployment
receipt is `release/acceptance/live16-deployment-20261014.json`.

The first direct Go-proxy download made no progress. The actual build therefore
used `resume-offline.py`, not the original operator alone. Its SHA256 is
`8ea9ccb863fc50870bed79b528d03e3e6bd17fac7bc7de70933a99151025167e`.
The original r2 operator remains unchanged on the server, SHA256
`bb449d3e41d990ab76eed01a873de08aa56b146b5a733a91055d32b3044f6c5d`;
the imported existing helper is
`de751a95416aa16e7a24d18fcf23684b8181e2fa91e49900ee5cccdaa4aa0050`.

The wrapper applies only these preparation corrections:

- Import the four download-cache file kinds for public modules resolved by
  `components/sfu`'s `go list -m -json all`; do not copy a user cache or credentials.
  Supplement archive SHA256:
  `01e3759ac27edb820aa5efa1beca1ac32c08dba07384811ab72736945cd42ccf`.
  Manifest SHA256:
  `7459b363232a9da462b8a77d0997215e65e7be5b8698413f8d6f27ac6792615a`.
- Expand only imported/tested modules in a separate offline cache preparation
  container. Formal tests and compilation use source and cache read-only,
  `GOPROXY=off`, `GOSUMDB=off`, `-mod=readonly`, and the committed `go.sum`.
- Give `/tmp` explicit `exec` for container test binaries and preserve `HOME`.
  The preceding noexec failure logs remain private. The current source operator
  includes these future command corrections; it was not substituted into r2.
- Exclude only the two verified temporary cache-preparation container IDs from
  the unrelated-production inventory. The original baseline is retained intact.
  `baseline.production.private.json` records the resulting view; its SHA256 is
  `6294f15519050f72c21c6def5350aac7c1621d7c41c4c263a07b3c4620f2269d`.
  The original `baseline.private.json` SHA256 is
  `7c2b334c4948fb7fd65ee6c0d5d0e007935703cb138c1b72acfdb7fc2b9072c9`.

Allowed preparation IDs:
`6448082f1baf01008d573b802b493c6a461915198ee92268ce4a3942eea2c973` and
`9dab5ccf7588790966877a1425597b7691476e4177e5741b2f48061ed6d54cc9`.
Only the latter was present in the original baseline. Production EasyTier,
EasyTier Web, the private CheemsTier container and the management unit remained
in the before/after checks.

The actual runtime verification passed all six packages: `internal/svc`,
`internal/track`, `internal/room`, `internal/websocket`, `internal/webrtc`, and
`internal/config`. It used Go `1.25.14 linux/amd64`, tool image
`sha256:07d6e65bb14b257e518eb70088f0c6826c86ff6185538bdb946bcda8e211d03b`,
with no production network, ports or data. Pure command guards only check command
constraints; this six-package execution establishes test-binary executability.
The candidate SFU also passed `-h` in a read-only, network-none container, exiting
before configuration or listeners.

Final image IDs:

- Gryt: `sha256:cf83e3e70f5b4a649b3b65268ae9d2e81f39c7cea551a4ab2cc49624d65de23c`.
- SFU: `sha256:b4d3097e33f01ba79586fa87fa62f3d2d9ca3593e9c0100d7f943fcb90f0abca`.

For this already completed r2 deployment, any reviewed phase uses the exact
wrapper entry. `run-phase.ps1` supports `-UseOfflineWrapper`,
`-PreparationSuffix r2`, the manifest SHA256 above and
`-ExpectedWrapperSha256` above. It verifies the wrapper hash before executing
Python with `-I`. Use the explicit reviewed phase; do not use the original
operator's default entry against the corrected inventory.

The exact PowerShell 7 invocation used for activation was:

```powershell
$live16Phase = @{
    SourceCommit = '06708268dfda7e5021e145970c913968d190f40c'
    PreparationSuffix = 'r2'
    Phase = 'activate'
    UseOfflineWrapper = $true
    CacheManifestSha256 = '7459b363232a9da462b8a77d0997215e65e7be5b8698413f8d6f27ac6792615a'
    ExpectedWrapperSha256 = '8ea9ccb863fc50870bed79b528d03e3e6bd17fac7bc7de70933a99151025167e'
}
& 'D:/Dev/LaokuaiCloud/release/deployment/live16-voice-fixes/run-phase.ps1' @live16Phase
```

The same pinned entry uses `Phase = 'rollback'` only for a separately reviewed
rollback. It restores the preceding two images and keeps the current database.

Sanitized `BUILD.json`, `STAGED.json`, `OFFLINE-PRESTAGE.json` and
`PREPARATION-AUDIT.json` are retained locally under
`.local/live16-deployment/06708268dfda-r2/`. Private database, full baselines,
Compose documents and raw logs stay on the server. Earlier failed preparation
directories and both preceding images remain available.
