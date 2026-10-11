# Reviewed source with intermediate UI awaiting acceptance

`manifest.json` is the authority for the sole private integration branch. UI,
packaging, member status, Hybrid client wiring, SDK/server/SFU and ET retain
their source origins, licenses and exact source/package hashes. Original dirty
client snapshot/history, public forks and previous frozen ZIPs/bundles remain.

ET create-only source `dbaf0453` is integrated at `026c55c1`. The static
ET-OWNERSHIP-001 gap is resolved: no existing-alias open fallback on the owned
branch, actual OS LUID/GUID before address/session setup, case-insensitive Windows
preflight. Source import preserves 1,277 exact Git blobs (contributor .env omitted),
WTFPL vendor notices, fixed upstream and the pinned local TUN override. Versions
and ordinary dependency lists remain locked. Ten source contracts and 22 mocked
adapter checks pass; the owner reports five compiled pure Rust helper tests.
This does not prove native compilation/coexistence/Drop/routes/networking.

The parent authorized its capacity owner to compile the frozen native bundle with
Rust 1.95/MSVC, exact Cargo.lock/default features/+crt-static and explicit PROTOC.
Normal official-registry fetch of locked missing dependencies is allowed. See
[BUILD.md](../components/easytier/BUILD.md) and [REVIEW.md](../components/easytier/REVIEW.md).
Task-6 has not compiled or run core/CLI/helper/driver/TUN/product. The direct build
information message was rejected by automatic approval review; human send approval
is pending. Do not treat that attempt as delivered or a started build.

SDK `hybrid.integration.3` at `6d710f34` is integrated by a nine-file delta,
then exact local TGZ/dependency lock pin. Old integration.2 bytes stay unchanged;
the closed-PC guard remains included once. All 300 owner source ZIP hashes and
205 tar/installed packed hashes match; source import retains one existing portable
optional-probe override. The controller now receives actual verified recovered SFU
track/revision and avoids redundant unbound restore; scoped old pair cleanup and
auth-generation fences are retained. Server `e84e1ca5` and SFU `a6bf86ad`
are unchanged. Default audio/AGC/bitrate/PTT/Squad policy is unchanged.

The second UI candidate `c8c08179` is integrated at `a8db5d91` as an intermediate
checkpoint, without conflicts. The 14-file cumulative delta preserves current-room
members, allows other-room roster expansion without joining, scopes path badges
to actual same-room media membership and wraps narrow nicknames. Six distinct
connection geometries retain unknown/stale states. Only four check-script import
orders differ from the owner delivery.

Task-6 passed 6 room renderer, 17 path, 13 LAN and 6 icon scenarios; all 12 changed
code files pass lint, 3,544 translation keys match, full app/desktop types and all
26 existing pure/type suites pass. Actual browser geometry, runtime roster
permissions, current SDK/ET telemetry and media acceptance are not established.
The passive path provider is deliberately unmounted: absent authenticated scoped
selection/full-route evidence displays path pending. Connection details remain
prototype-only; no actual transport is inferred from presence or the first ET hop.

The user requested third-version omissions: bottom expanded adjustment access and
sidebar free-mic/PTT/Squad temporary-mute indications. Existing VoiceAudioControls,
HoverAudioControl, VoiceModeControl and manual-muted/PTT-idle/Squad-suppressed
presence implementations are unchanged; their original pure checks pass. Preserve
hover/click menus when implementing the approved design. The UI owner is preparing
the third prototype and actual implementation matrix. The second prototype's seven
VM checks are owner-reported; task-6 has not rendered it. Final design is unapproved.
No final product package is included.

The separately user-approved, deployed landing page is archived under
`components/landing` from the final create-only delivery. All six owner source
files and the unchanged embedded illustration match their frozen hashes. The
HTML is 2,141,608 bytes, SHA-256
`519faa9074d5331efae9642f010973ef86b51e7e81abeb40420b3c3a6b65e139`,
with title “唠蒯云 · 来唠嗑吧” and no download link. Copy/fallback/content checks
and 18 pure route cases pass. `deployment-record.json` retains owner-reported
HTTPS/hash and protocol regressions while omitting private machine paths, shared
configuration and raw diagnostics. The scoped reviewed Caddy fragment is not a
replacement for the full shared configuration. Task-6 did not redeploy or probe
production. Landing approval does not accept the desktop UI or final package.

The immutable `78513ba4` ZIP/bundle remains the capacity owner's SDK3 media test
input. Reviewed native `dbaf0453` remains approved for isolated compilation by
that owner. UI revision/design approval does not delay those independent checks.

Task-6 independently passed 129 pure auth/media-selection assertions (1/3 simulated
remotes), full app/desktop noEmit types and 26 client pure/strict-type suites with
the exact installed SDK. The initial offline install lacked locked cache entries;
normal locked public-dependency fetch with every lifecycle script disabled filled
the cache, then frozen/offline/ignore-scripts verification passed. Only the SDK
entry changed in yarn.lock. No helper/product execution occurred.

Previous integration.2 real two-peer evidence is version-specific: parent reported
actual RTP/PCM/SFU pause/fallback passed but controller state remained wrong after
auth recovery. It does not accept integration.3. After the ET build, capacity owner
must retest a fresh immutable unified snapshot for actual auth restore ACK/fresh
RTP/PCM, controller selected track/revision, room generation, 1/3 remotes and closed
PC behavior. Raw logs remain outside Git. Task-6 actual peers/Docker/listeners are 0.

Member assistance settings/policies/experiments are deferred. Prioritize current
voice P2P/SFU fallback, basic ET, truthful state and reliability. Existing public
ET relay configuration stays unchanged. All current UI changes require user
prototype preview approval before final packaging; member relay/server relay/
physically verified direct must be distinguished. ET relay under a WebRTC peer
does not prove physical direct. Dynamic non-destructive multi-community RPC,
automatic authorized community provisioning and authenticated peer binding remain
pending; production CLI supports one community.

`ready=false`, `finalPackage=null` and private payload approval false remain.
No current downstream core hash/build receipt or final portable package exists.
Verify with `node release/verify-release.cjs`; `--require-ready` exits 2 until
all acceptance gates pass. No desktop package replacement/public push/publication
or production upgrade follows a private source checkpoint.
