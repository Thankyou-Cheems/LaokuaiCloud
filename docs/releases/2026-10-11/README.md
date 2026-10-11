# Frozen integration candidate

The client source at `b3456983698d2fdfe2e87391f1a48bfb4654b42d` includes the
complete existing opus20/Squad snapshot, followed by the delivered UI and packaging
changes. Both cherry-picks were conflict-free. The original dirty client tree was
not changed. This is a local source candidate; the final binary is not built.

| Component | Destination evidence | Frozen state |
| --- | --- | --- |
| Client | Public fork `Thankyou-Cheems/gryt-client-i18n`, parent `Gryt-chat/client` | Integrated source commit in manifest |
| Voice SDK | Public fork `Thankyou-Cheems/voice`, parent `Gryt-chat/voice` | Client vendor SHA fixed; Hybrid delivery pending |
| Server | Local origin chain points to public `Gryt-chat/server` | Hybrid checkpoint recorded; user fork not confirmed |
| SFU | Hybrid checkout has no remote; earlier origin chain points to public `Gryt-chat/sfu` | Hybrid checkpoint recorded; user fork not confirmed |
| EasyTier | Public fork `Thankyou-Cheems/EasyTier`, parent `EasyTier/EasyTier` | Application/local source pin pending |

These identities and visibility were checked through read-only GitHub metadata on
2026-10-11. Existing user ownership does not approve putting private development
history into a public fork. No repository was created or remotely written.

## Source sequence

1. Original client HEAD: `552dc88f3413b83ee29bdb4ab350286e7c9ad2d0`.
2. Complete snapshot: `2b9f02076051e3a445bfa99e79d1fc7ac421e19f`, a direct child
   of that HEAD. All 24 tracked modifications match; all six untracked blobs match
   snapshot objects. The source tree was neither staged nor committed here.
3. UI delivery `f4680c9e7eacc050b96f4e5419be53484d52622c` became
   `d16ce70e17d991e4384aa8262397a4ea96725ba6` through `cherry-pick -x`.
4. Packaging delivery `7882fc40a6fb498e7861677aac21a1ca32da4f84` became
   `b3456983698d2fdfe2e87391f1a48bfb4654b42d` through `cherry-pick -x`.

The manifest pins this code commit, and the later documentation commit coordinates
it without changing build inputs. A final builder must use the pinned source commit
and package hash, create a fresh helper receipt, then record final payload hashes.
Do not treat an older binary or a source-only inventory as a final build receipt.

## Checks and review

Nineteen client pure/VM/static checks passed on the integrated source, including
the delivered UI callback cases, package audit, synthetic profile upgrade,
startup/tray logic, key-list UI, translations and transport intent. Source-only
package inventory passed. Runtime was Node 22.23.2 / TypeScript 5.9.3. Two first-run
checks needed the already-installed pure `js-yaml` dependency copied into this
isolated checkout; those checks and the inventory passed on retry. Full client
semantic typecheck and final build were not run. No native module was executed.

The closed-PC SDK guard is included as a reviewable source-only patch, not as an
activated client dependency. Its frozen base file is identical at SDK commits
`ed7cd1e767ac788caefe98b83c1a255b2dc46e50` and
`8a39c5783d8c50c7a95be873a3033b8b8ca2ed1a`, blob
`cabdbddf284435fb6bc3396439eae9c82ec2e369`. It applies to the exported frozen
file and passes five pure cleanup scenarios. It only skips `removeTrack` when
`signalingState` is `closed`; existing resource teardown and other error reporting
remain covered. No resource leak was demonstrated by the reported caught error.

The delivered original patch concatenates the next file header after `}` without
a newline. The reviewed patch preserves the original guard but omits the candidate
package version change and fixes the patch format. Both hashes are recorded. The
SDK owner has not confirmed compatibility with their forthcoming auth/fallback
delivery; integrating the patch or activating its tarball remains pending.

Capacity acceptance is blocked: the full 20-client browser fixture did not reach
a stable measurement window because of WebAudio/PID constraints. The 2x10 layout
and proposed lighter Pion fixture were not run. Connection counts are not stable
receiver counts. All seven test-owner containers were reported cleaned up; this
integration task did not operate them.

## Continue from this candidate

The additional EasyTier/member UI requirements are recorded as design only. Joining
a server/community should join that community's EasyTier network. Voice rooms
control audio subscriptions; changing rooms or leaving voice must not reconnect or
leave EasyTier, and must not create multiple sets of server processes. The right
member list should show EasyTier membership and local-to-member `direct`, `relay`
or `unknown`. Voice media path must be shown separately. A peer without an auth-user
binding must not be presented as trusted. Native-owner verification of official
concepts and SDK-owner coordination are pending. The manifest separately records
design, unconfirmed pure-simulation evidence and unverified real integration.
No network or permission settings were added by this task.

Run `node docs/releases/2026-10-11/verify-release.cjs` to validate local pins and
unchanged build inputs. `--require-ready` deliberately rejects this pending release.
The local handoff has the exact checkout, code and coordination commits plus an
incremental Git bundle; its base prerequisite is the complete snapshot above.
The checkout copied source objects but still has a historical Git alternates path.
Preserve that source object store; the frozen current-source archive is independent.

The single integration writer accepts the SDK owner's immutable Hybrid delivery,
coordinates cleanup, pins the final SDK source and package receipt, then updates
client adapter/dependency changes together. Server/SFU remain separate repositories;
accept their delivered commits and test them from frozen snapshots. Resolve EasyTier
application/source provenance before claiming a complete deployment manifest.

The parent must approve the exact remote destination and public disclosure scope
before remote synchronization. Existing snapshot history includes local evidence
and requires that review. Final build, final source-to-binary correspondence,
Hybrid behavior and capacity acceptance are outstanding.
