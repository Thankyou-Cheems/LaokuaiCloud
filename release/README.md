# Current private integration source

`manifest.json` is the single authority for the private integration branch.
Current code commit: `0c5a194ff11cd469c0d5fe4cbf77c5bcd08e8fe2`.
Original client dirty snapshot/history and every previous frozen delivery remain.
Component owners work independently; task-6 alone writes the integration branch.

The exact approved deployed landing source is integrated at `6f8b8916` with a
sanitized deployment record. Six source hashes and the original embedded image
match; copy/fallback/content and 18 route model cases pass. No redeployment or
production probes were performed by task-6. This approval is independent of the
unapproved desktop UI design.

UI v3 `385793c5` is integrated by its incremental patch at `31cec3c6`. Member mode
text is below the nickname, PTT idle/active/manual mute/confirmed Squad suppression
are distinct, and the existing audio-menu trigger is larger. Hover/click callbacks,
authenticated seq/6s TTL and protected speech behavior remain. 216 localized mode
renders, 6 mode, 6 room, 17 path, 13 LAN and 6 icon cases pass. The prototype's 14
checks are owner-reported; task-6 did not render it. Final user design approval is
pending. Runtime path provider and production connection details are not complete.

The private product Hybrid bootstrap is now connected through main metadata,
preload and the renderer to VoiceProvider. Ordinary desktop/i18n/browser paths do
not receive this opt-in. The bridge inherits the current authenticated SFU PC ICE
configuration, preserving explicit host overrides and SDK authorization fences.
It does not start ET or capture, disconnect shared sockets or stop publication.
Full app/desktop types, targeted lint and actual bridge/policy VM checks pass;
complete real product bootstrap/sinks/prior-registry acceptance still needs testing.

Standard source requests are now SFU48/P2P64 kbps, Opus20/mono/VBR/DTX/FEC. Explicit
custom presets and server caps remain; AGC/DSP are unchanged. Profile/migration/cap
checks and 26 existing pure/type suites pass. The settings search suite exposed an
outdated English alias, which was corrected and rechecked (5,328 bilingual cases).
These are configuration checks, not observed new codec/media/quality acceptance.

SDK3 remains exactly `6d710f34`, TGZ `29f858d9...`; server `e84e1ca5` and SFU
`a6bf86ad` are unchanged. Capacity owner passed real two/four-SDK factory loopback
at24k using immutable `78513ba4`, including controller/PCM auth recovery, room
generations, explicit closed-PC recovery and differing roster orders. See
[acceptance/sdk3-loopback.json](acceptance/sdk3-loopback.json). This does not accept
the new48/64 profiles, full app, database revocation/new auth socket, WAN/ET,
15–20 encoders, FEC loss recovery or real-device listening. Raw logs stay outside Git.

Reviewed ET native `dbaf0453` release compilation passed with Rust1.95/MSVC,
locked/offline/default features/+crt-static in888.978s. Task-6 independently checked
source/lock/receipt/bundle and AMD64 PE32+ bytes: core SHA256
`28248cf281690d95afa6550769452dc803338ee016d1f52e1150d12cda661eae`.
The private core plus unchanged pinned official companions are prepared as ignored
static build inputs, with tracked normalized provenance/receipts. Input ZIP SHA256
`4c57e56ec2973d18216afe1e896e95f33b1441c8f8f18cc1eea14a3534de68b6`.
No core/CLI/helper/driver/TUN was run. Complete companion/driver notices and runtime
coexistence/cleanup/activation are pending; payload approval remains false.
Static import inspection of the exact `28248cf2` core additionally confirms
`packet.dll`. Its redistribution permission and ordinary-user driver prerequisites
are unresolved; this blocks final packaging. ET owner is auditing whether optional
pcap support can be removed while preserving normal TUN/voice. Do not substitute a
DLL or make every user install Npcap. Frozen core/build inputs remain diagnostic
preparation, not an approved distributable payload.
Run `node release/verify-build-inputs.cjs` for the prepared local bytes.

[Path wiring owner tasks](path-wiring-owner-tasks.md) gives precise parallel SDK,
ET and UI file scopes, available APIs, missing fields and acceptance checks.
Task-6 consumes frozen contracts for independent scope/epoch/provider integration.
The subsequent `ca8290cf` candidate mounts the one passive provider with independent
authenticated connection scopes, receive-only compatibility, exact opaque token
epochs, retirement leases and TTL. Sixteen new store/bridge scenarios and seventeen
existing path scenarios pass, as do app/desktop types, targeted lint, integration
and Hybrid bootstrap checks. SDK observations are still absent; the new code does
not change the `a36adcab` media test input. See
[Provider contract](path-provider-contract.md) for precise interface requirements.
UI connection-details candidate `8157d7fc` is hash/forward-apply verified and awaits
the owner's provider compatibility followup before being applied; see
[candidate receipt](acceptance/ui-connection-details-candidate.json).
These code tasks do not wait for appearance approval; native safety confirmation
blocks actual activation only. Member assistance settings/policies/experiments
remain deferred; existing public ET relay configuration remains unchanged.

`ready=false` and `finalPackage=null`. Run `node release/verify-release.cjs`;
`--require-ready` exits2 until acceptance gates pass. No final portable package,
user installation replacement, public push, release publication or production
upgrade follows this private development-source checkpoint.
