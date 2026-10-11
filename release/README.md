# Reviewed private source checkpoint

`manifest.json` coordinates the unique private integration branch, component
trees, licensed source origins, exact SDK package and version-specific test state.
Task-6 is the sole writer. Public forks, previous frozen ZIPs/bundles, original
dirty client source and feature-owner histories remain preserved.

UI/pack/member/Hybrid client deltas and SDK `hybrid.integration.2` are integrated.
The SDK package/source remains frozen at `114a9ad0`; its closed-PC guard occurs
once. The parent now reports real two-peer direct RTP/PCM, actual SFU pause/mute
and fallback ACK/media ordering passed on `a7ffde09`, but restored-audio
controller-state mismatch still blocks acceptance. Await the SDK owner's repair
and new frozen-snapshot retest. This is parent-reported evidence, not task-6
runtime testing. Legacy `6e29f09 / opus20.alias.1` capacity evidence applies
only to its recorded SDK/server/SFU versions, not the current release.

ET owned-stop client delivery `30d2fc24` is integrated once at `7a9ba9dd`.
The Windows adapter requests graceful stop via its captured child stdin, waits for
closure and keeps forced/unconfirmed exits diagnostic. Private resource paths are
separate from the official reference archive: five runtime files plus
`laokuai-build.json`. The loader and package gate require exact downstream
manifest/source/patch/build hashes and reject official-core fallback.

The ET owner's fixed v2.7.0 native snapshot `1a44fb98` is imported as 1,232
exact licensed Git blobs; contributor runtime .env is excluded. The two-commit
snapshot history is independent of upstream; no upstream history is invented.
Review is **changes-required**: pinned rust-tun can open an existing adapter
before the requested GUID check. See [the review](../components/easytier/REVIEW.md)
and [isolated build inputs](../components/easytier/BUILD.md). Task-6 does not
duplicate the native owner's fix or compile/run the native core. Rust 1.95 and
x86_64-pc-windows-msvc are required; no compiled core hash has been measured.

Current app/desktop noEmit types, 11 changed code files' lint and 26 pure/type
suites pass; these include 36 lifecycle, 22 adapter and 13 registry assertions.
Eight static native source contracts and five package-gate scenarios also pass.
The actual private beforePack blocks before build/preparation. None of these
checks prove native adapter ownership, coexistence, route cleanup or networking.

The parent reported the capacity heavy slot released. Only the parent-designated
capacity owner schedules native compilation from a fresh frozen source copy.
Do not compile or mutate any owner tree, launch products/helpers/core/CLI/drivers,
change Tencent Linux nodes, firewall rules, profiles or existing ET processes.
Automatic authorized community configuration, authenticated peer bindings and
dynamic non-destructive multi-community RPC remain pending; current production
supports one community. Member path/RTT stays unknown without actual evidence.

All current UI changes require a static prototype and user preview approval
before final packaging. Member relay, server relay and physically verified direct
must be distinguished; a WebRTC peer over ET relay is not verified direct. The UI
contract is pending. Existing desktop packages stay unchanged.

`ready: false`, `finalPackage: null` and private-payload approval false are
binding. Verify the source using:

`node release/verify-release.cjs`

`node release/verify-release.cjs --require-ready` exits 2 while blocked.
Historical manifests below client docs describe earlier checkpoints. No public
push, software publication or production upgrade follows this private source
checkpoint. Profiles, credential material and raw local fixture logs are excluded.
