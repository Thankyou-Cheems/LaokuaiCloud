# Existing Hybrid backend/SFU upgrade and rollback preparation

Preparation only. No deployment, real media, firewall, ET, new credential or service operation was executed. Images are not built yet; the final replacement approval must bind the two produced image SHA256 IDs after build. Neither a tag nor this template is permission to cut over.

## Exact source inputs

Source commit 85ec3b9c60d49881ba9ad5cd48c9a17d59c1772d; server tree 96db8312488c4f399904192f3a932232cf6130ad; SFU tree 24c3669c4ca13d39f8132225ae1cb4a450750729. Client tree fdba7f4b377933411a5adb2c932e389ca8ec0d0e is unchanged from UI/logo freeze5e605d67; that separate UI build remains owned by its builder. Voice lifecycle.3 vendor SHA256897b597926cad23447f057e2b45e95f47806ddfba2f6808e6beb32f80eec49ae remains unchanged. Only server/Dockerfile runtime install frozen-lock flag and one SFUClient pure protocol regression file were added after5e. No protocol implementation, auth key format or codec policy was changed here.

Build each component from its Git-stored files at this commit, not a dirty tree. Server context components/server; SFU context components/sfu. The server Dockerfile uses locked Yarn1 dependencies in both builder/runtime stages; runtime lifecycle scripts are retained for native modules. The SFU uses locked go.mod/go.sum, Go1.25 target and CGO_ENABLED=0 linux/amd64. Local Go1.27 pure test results are not a Go1.25 production build. Before building, the designated builder must record exact base-image digests for node:22-bookworm-slim, node:22-bookworm, golang:1.25-alpine and alpine:3 and substitute those digest references in generated build-input Dockerfiles. Keep the original tracked Dockerfiles and record the generated copies/hash in build evidence; never resolve floating tags silently or rebuild on production.

Prepared build commands, on the assigned isolated Linux builder only, after digest-pinned input Dockerfiles are generated:

    docker buildx build --platform linux/amd64 --load -f server.Dockerfile.pinned --build-arg VERSION=1.0.76-laokuai.hybrid.85ec3b9c --label org.opencontainers.image.revision=85ec3b9c60d49881ba9ad5cd48c9a17d59c1772d --label local.laokuai.component-tree=96db8312488c4f399904192f3a932232cf6130ad --tag laokuai-hybrid-server:85ec3b9c SERVER_GIT_CONTEXT
    docker buildx build --platform linux/amd64 --load -f sfu.Dockerfile.pinned --build-arg VERSION=laokuai.hybrid.85ec3b9c --label org.opencontainers.image.revision=85ec3b9c60d49881ba9ad5cd48c9a17d59c1772d --label local.laokuai.component-tree=24c3669c4ca13d39f8132225ae1cb4a450750729 --tag laokuai-hybrid-sfu:85ec3b9c SFU_GIT_CONTEXT

Tags are temporary build handles, not deployment pins. Record image IDs, LinuxAMD64, base digests, locks, artifact tar SHA256 and compiled bundle/binary hashes. Assert backend markers voice:hybrid:* and hybrid_command/result, SFU feature markers and component/source labels. Do not start product/real media merely to inspect version. Queue heavy build after parent assignment; no simultaneous UI/backend heavy build by Task6.

## Current production facts, read-only2026-10-12

Compose project laokuailiao, file /opt/stacks/gryt/compose.yml, services server and sfu. Current containers laokuailiao-server/ec639ef7e7ab and laokuailiao-sfu/8ff6fed7e5fe.

- backend image sha256:b6f4bf5db57493a06307e1cfaefd1c92d6c90ccc26e46c9ba05a8fab53d093e8; actual bundle1350981826a74691d94942ea46f7ebbea862efee79ae810adc2a87e17b01f5f9; configured/process version1.10.58 is not a verified Git version.
- SFU image sha256:33babe9b71475b123d5bb0e8482f0da5ae2b92c0fbe0e59a00957d89faea6eef; binarya78b0c0c9b25161bac3f7bcca61e71a480fe0ccb3443f160cc15b14bd4154f68; no version/revision label. Both old images must stay loaded, with no prune/delete.
- backend data bind /opt/stacks/gryt/data → /data, RW/rprivate,3053502 bytes; SFU has no mounts. Preserve original directory, ownership, secrets, identity/member/config data and complete WAL/SHM state. Do not copy secrets into Git, evidence or operator stdout.
- network gryt-voice; backend aliases laokuailiao-server/server, observed172.19.0.3; SFU aliases laokuailiao-sfu/sfu, observed172.19.0.2. Base Compose retains network/aliases; IPs are dynamic, clients use names. Do not introduce a dependency on either observed IP.
- backend PORT5000, no host publish. SFU main5005, control9092; existing SFU_WS_HOST=ws://laokuailiao-sfu:9092. Published port remains 0.0.0.0:3478/udp only, ICE_UDP_MUX_PORT3478. Metrics remains0/disabled. No new host port, DNS, Caddy, TLS, public ET node or firewall change.
- both user gryt, restart unless-stopped, no added capabilities/security options, read-only rootfsfalse. Inherit base Compose and existing credentials, not a newly constructed environment.

Activation overrides add VOICE_HYBRID_ENABLED=true, SFU_HYBRID_ENABLED=true and SFU_AUDIO_ONLY=true; keep SFU_REQUIRE_CLIENT_TOKEN=true. Backend version metadata becomes explicit integrated-source1.0.76-laokuai.hybrid.85ec3b9c; historical1.10.58 is not reused as false source provenance. Existing SFU_MICROPHONE_OPUS20 is absent and remains absent: this rollout does not raise media bitrate or enable a new encoder policy. No ET activation receipt/config is manufactured. Before execution, render effective Compose privately and verify only the two image IDs, approved flags/version and server/data-candidate source changed; preserve all other environment/mount/port/alias settings. Do not print complete rendered config.

## Data-aware cutover, approval required; not executed

Use /opt/stacks/gryt/hybrid-upgrade-85ec3b9c for the two reviewed overlays and candidate data. Original compose.yml and its env/secrets remain unchanged. activate.yml is generated from activate.yml.template only after NEW_BACKEND_IMAGE/NEW_SFU_IMAGE are exact sha256 IDs with verified source labels; reject anything else. rollback.yml already pins both current image IDs and original data bind. Do not run compose down or delete/prune volumes/images. Use --no-deps and --pull never to target only server/sfu.

1. Recheck current image IDs, healthy state, source pins and effective settings before change; fail closed on drift. Stage built image tars/digests and rollback overlay, confirm disk space and that candidate directory does not exist.
2. Gracefully stop backend before making a consistent full data copy. This source has additive/destructive role migrations and a one-shot token reissue; an image-only rollback is insufficient. No production database contents were inspected in this preparation.

    docker kill --signal=TERM laokuailiao-server
    docker inspect --format '{{.State.Running}}' laokuailiao-server

Poll at most20s for false. If still running, abort, report and do not copy a live directory or hard-kill. If stopping caused trouble, docker start laokuailiao-server restores the unchanged image/data. After confirmed stop:

    install -d -m 700 /opt/stacks/gryt/hybrid-upgrade-85ec3b9c
    test ! -e /opt/stacks/gryt/hybrid-upgrade-85ec3b9c/data-candidate
    cp -a -- /opt/stacks/gryt/data /opt/stacks/gryt/hybrid-upgrade-85ec3b9c/data-candidate

Copy all files including SQLite WAL/SHM, preserving existing UID/GID/mode. No recursive deletion or modification of original data.

3. Gracefully TERM old SFU and confirm stopped within20s; no hard-kill on timeout. Create/start only new sfu then server using the reviewed activation overlay:

    docker compose -p laokuailiao -f /opt/stacks/gryt/compose.yml -f /opt/stacks/gryt/hybrid-upgrade-85ec3b9c/activate.yml up -d --no-deps --pull never sfu
    docker compose -p laokuailiao -f /opt/stacks/gryt/compose.yml -f /opt/stacks/gryt/hybrid-upgrade-85ec3b9c/activate.yml up -d --no-deps --pull never server

Original data remains untouched; migrations/writes occur only in candidate copy. Compose recreates these two service containers; it does not preserve their original container IDs. Image IDs/data/config are the rollback authority. Record newly created container IDs before any failure handling.

## Health and failure rollback

Poll each direct health endpoint for up to45s, then verify container healthy status and the public route. These checks do not prove P2P:

    docker exec laokuailiao-sfu wget -qO- http://127.0.0.1:5005/health
    docker exec laokuailiao-server node -e 'fetch("http://127.0.0.1:5000/health").then(async r=>{const b=await r.json();if(!r.ok||b.status!=="healthy")process.exit(1);console.log(JSON.stringify({status:b.status,service:b.service}))}).catch(()=>process.exit(1))'
    docker inspect --format '{{.State.Health.Status}}' laokuailiao-server laokuailiao-sfu
    curl --fail --max-time 5 https://voice.ruikang.wang/health

Abort/rollback on unhealthy startup, server registration/control failure, wrong image/source labels, different host ports, identity mismatch, schema migration error, or ordinary-client auth regression. Capture only safe error categories and preserved candidate directory; do not dump env/tokens/chat. HTTP200 is not acceptance of Hybrid support. A real Hybrid probe must run through the current authenticated backend→SFU connection; creating another fake registered server or ACK is forbidden. Authentic room/media test is a subsequent bounded action with the freshly built UI/client.

Rollback from any partially started candidate: verify current container IDs/images against this operation; TERM only those exact new candidates and wait at most20s for stopped. If a candidate cannot exit, pause and report before any force action; no blanket kill or other-service stop. Then:

    docker compose -p laokuailiao -f /opt/stacks/gryt/compose.yml -f /opt/stacks/gryt/hybrid-upgrade-85ec3b9c/rollback.yml up -d --no-deps --pull never sfu
    docker compose -p laokuailiao -f /opt/stacks/gryt/compose.yml -f /opt/stacks/gryt/hybrid-upgrade-85ec3b9c/rollback.yml up -d --no-deps --pull never server

Re-run direct/public health and confirm old image IDs, data mount and port settings. Because activation overlay is omitted, original base environment returns; it must still match the captured preflight. Retain candidate data and new artifacts for review, never merge candidate schema automatically into old data. New messages/uploads/config changes accepted during the candidate interval remain in candidate data but may be absent from restored old service until separately reconciled. This is reversible source/service state, not a promised zero-loss database rollback.

## Old-client behavior and finite impact

Ordinary microphone SFU remains the default route for clients that never send Hybrid events. Pause is per authenticated source→receiver edge and has ≤10s expiry; old clients do not request it. Keep existing signing key/identity/refresh tokens via original env and consistent data copy; no new password or account. Six pure token migration tests prove one-shot retirement and fresh access-token minting from existing refresh tokens, not every historical client UI's reconnect behavior. Some old access tokens may require normal refresh/re-auth. AudioOnly deliberately rejects old screen/video requests; screen remains unavailable, with no SFU/TURN/ET-relay fallback. Real old-client microphone/auth behavior still needs bounded post-upgrade validation.

Build and artifact staging happen before downtime. With current3.05MB data, plan60–120s interruption for both sockets/voice and reconnect; this is an estimate, not a measured guarantee. Abort new startup at45s per service; reserve a five-minute maintenance window including rollback. Existing calls can disconnect and need room rejoin. Never quit desktop apps, restart core/TUN, modify other communities/shared nodes, or open firewall rules.

Minimum final approval: deploy the two built sha256 IDs from source85ec3b9c60d49881ba9ad5cd48c9a17d59c1772d to exactly Compose laokuailiao/server+sfu, add only the stated Hybrid/AudioOnly/version settings, preserve host3478UDP and existing internal5000/5005/9092 with metrics0, stop/start/recreate only those two containers, create candidate data copy under the exact new directory while leaving original data/images intact, allow health checks and automatic rollback within this five-minute window. No grant/credential issuance, device/native/TUN, real media or third-service action is included. New image IDs/base digests are still pending build; do not seek final replacement approval before they exist.

## Validation and deferred risk

Local backend9 Hybrid JWT/database/permission cases,4 new real SFUClient fake-transport ACK/replay/timeout/disconnect cases,6 existing token upgrade cases passed under no-network guards. Full backend219-root no-emit types including new test:0 errors; focused test lint0/0. Go stdlib-only lease state and microphone cap suites passed offline/-p1; no Pion PC, socket, listener or real media. No Linux image was built, no deployment validation or media proof. New test and Docker lock tweak are the only runtime-component delta.

Astra Secure Mode direction is reviewed separately in EASYTIER-SECURE-MODE-API-REVIEW.md; no grant system is implemented here. The frozen core base lacks the reported#2658 multithread fix: record risk, do not upgrade or enable multi_thread here. Electron interface enumeration does not prove ICE uses TUN. p2p_only does not by itself prove screen zero-relay; screen stays unavailable.
