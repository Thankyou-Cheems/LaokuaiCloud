# Exact backend/SFU offline control contract

```powershell
python release/tests/offline-backend/run-image-control.py --output-dir C:/owner-local/new-empty-control-evidence --sfu-binary C:/owner-local/frozen-artifacts/sfu-linux-amd64
```

Existing Docker Engine/CLI, the fixed backend and SFU OCI images and frozen SFU ELF are required. No install/start/pull/load/build or tag resolution occurs. Backend image/source/tree and SFU source/tree labels are inspected; the actual backend bundle and readonly ELF SHA256 are checked before execution. The runner uses the original backend image and mounts the exact static SFU ELF read-only. CGO0 ELF executes in the backend image's Linux environment as a child, so this test does not qualify the SFU container's original ENTRYPOINT/PID1 shutdown behavior.

One disposable network=none container is limited to one CPU/1GiB, read-only rootfs, capability-drop ALL, no-new-privileges, no restart and no host port bindings. Only readonly fixture scripts and the hash-pinned ELF are mounted; synthetic data/keys are tmpfs only. Original tmpfs noexec settings remain. Only the exact labelled owned container is removed. Original images, tags, source, databases and other containers are untouched.

The fixture runs the unchanged backend bundle, the unchanged SFU ELF, and an in-container loopback WebSocket proxy. Real server_register/probe/hybrid commands and real SFU ACKs flow through the proxy. Fault injection drops/delays actual hybrid_result frames; it does not manufacture supported/applied results. Synthetic members sign local certificates, perform actual legacy Socket.IO join and room requests without a Hybrid declaration, and make explicit test voice/publication announcements. They are not physical WebRTC peers.

Thirty real process/wire assertions cover control registration, supported probe, legacy SFU room grants, identity/connection/channel/session/epoch/publication/operation rejection, pause/resume failure ACKs without physical peers, actual 5s backend ACK timeout, late-result correlation, disconnection/unsupported fallback and continued login-token refresh. No PeerConnection, RTP, microphone, ET or external account is used. A successful real media pause/resume ACK cannot be produced without the physical-peer/publication requirements, which the fixture preserves.

The companion existing source tests qualify the successful state contracts separately:

```text
Node --test with network/DNS/fetch-prohibiting guard and installed ts-node:
  components/server/src/socket/handlers/voiceHybrid.test.ts
  components/server/src/sfu/hybridProtocol.test.ts

GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local, with an owner-local GOCACHE:
  go test -v components/sfu/internal/svc/audio_lease_state.go components/sfu/internal/svc/audio_lease_test.go
```

The 13 Node tests use actual JWT/database/handlers and SFUClient with mock transports/ACKs. The one Go test compiles the exact lease state plus its test using only the standard library; it tests pause/restore, stale revisions, authority/pair conflicts, bounded expiry and counters without PC/socket/media. These are not deployed-media evidence. Full commands/runtime/source hashes are bound in `release/acceptance/backend-sfu-control-contract.json`; scoped report is `release/BACKEND-SFU-CONTROL-REVIEW.md`.
