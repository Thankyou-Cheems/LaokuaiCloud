# Local integration candidate v2

The sole client integration branch preserves the complete original dirty-source
snapshot, then integrates voice-settings UI, packaging checks, member LAN
presentation, and the six-file Hybrid client delta in that order. No conflicts
occurred. The preceding frozen checkpoint `6e29f09` and its archives remain intact.

This candidate is incomplete. The client still references the old alias SDK;
its new Hybrid bridge requires the SDK owner's final `hybrid.integration.2`.
Do not build, distribute or use this candidate as a completed package before
updating the exact dependency and lock, installing the frozen package, and
checking semantic types. `hybrid.integration.1` is an immutable intermediate;
task-6 does not rebuild it or independently apply the closed-PC fix.

`manifest.json` records precise commits, source and package hashes, approved
EasyTier **v2.7.0 prerelease** tag commit and official Windows asset digests.
GitHub-provided asset digests are expected values, not a claim that task-6 has
downloaded or hashed the Windows ZIPs. The ET adapter owner must supply that
byte verification and the same version pin. No Tencent production upgrade occurs.
Official release: https://github.com/EasyTier/EasyTier/releases/tag/v2.7.0

The member LAN component requires fresh, scoped, authenticated adapter evidence.
Without a snapshot it displays unavailable; stale or ambiguous evidence cannot
become green. It does not create an EasyTier process, verify credentials or
infer voice transport from a LAN route. Voice path remains separately unknown.

Twenty-two lightweight checks passed at the recorded client code commit,
including 12 LAN scenarios, strict LAN model types and 13 selected-track registry
assertions. The registry runner uses the delivered assertions with TypeScript
transpilation in memory. Full client types await the final SDK. Real peer media,
forwarding pause/recovery, CPU, capacity, FEC, listening and physical direct
paths remain unverified. No Docker, listener, browser, native helper or real
profile was used by this integration task.

Server receive-recovery source remains in its separate repository boundary:
all 462 frozen archive source files were rehashed. Its owner history has a missing
older ancestor object; future remote import needs a healthy destination rather
than pretending the incomplete history is complete. SFU is unchanged.

Remote synchronization and private repository creation still require the parent's
destination decision. Existing client, Voice and EasyTier forks are public;
this whole history has not been cleared for public disclosure. Local inventories,
raw test logs, delivery ZIPs and real profile data are not imported into Git.

Run `node docs/releases/2026-10-11-v2/verify-release.cjs` for source consistency.
`--require-ready` must reject this unfinished candidate.
