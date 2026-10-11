# Frozen private source checkpoint

`manifest.json` coordinates the single private integration branch and exact
component trees, upstream commits, SDK package bytes and test state. The client
was imported with its complete reachable history after hydrating missing public
upstream objects into task-6's independent copy. No original tree was altered.

UI, packaging, member LAN presentation, Hybrid client wiring and the final
`hybrid.integration.2` SDK are integrated. SDK source commit is
`114a9ad0ba2d9e1e83b9a762a150dba6a54e0ee4`; its closed-PC guard is included once.
The installed 205-file package matches the frozen owner manifest. Server
receive-recovery source and unchanged SFU retain their own component licenses
and provenance. Two legacy selfhosted distribution/config files were excluded;
the server's 460 imported files match the verified source archive. SDK runtime
source is unchanged; one optional probe script now resolves its tool portably.

The ET layer is **implementation-incomplete**. The current main manager receives
`null`; native launch/CLI-protobuf transport, automatic authorized community
configuration, renderer lease events and UI subscriptions are missing. Its pure
runtime tests use injected ports. This is not an adapter whose only missing step
is permission or a toggle. The ET owner is delivering a separate concrete delta.
Target is official **v2.7.0 prerelease**, pinned to exact tag commit and Windows
asset digest. Local archive bytes/executable have not yet been independently
accepted. No official Web console or DB migration is in scope.

The user-facing goal is simple automatic joining without manually entering
nodes, secrets or subnets. Normal first-use UAC/driver prompts must be respected
and reported as needs-permission. A failed LAN connection must leave ordinary
SFU voice available. Current code does not yet deliver that complete experience.

Full client app/desktop noEmit types, targeted Hybrid/member/ET lint, 24 pure and
strict-type checks, and static source resource inventory passed. The ET suite
contains 36 mocked lifecycle scenarios; the member suite has 12 scenarios and
selected-track registry has 13 assertions. Real P2P, forwarding pause/fallback,
capacity, CPU, FEC, listening and physical-direct routes remain unverified.
No executable build, native helper, browser, Docker or network fixture was run.

The source candidate is reproducible and testable, but `ready: false` and
`finalPackage: null` remain binding. Do not call it a usable ET portable release.

Verify a checkout with:

```text
node release/verify-release.cjs
node release/verify-release.cjs --require-ready
```

The second command exits 2 until acceptance is complete. Tests use immutable
commits/archives. The older `6e29f09` capacity snapshot remains unchanged.
Client manifests under `components/client/docs/releases/` are historical
checkpoints; this root manifest is the current release authority.

Only the approved private repository receives integration source. Public forks
remain upstream PR sources. Legacy machine paths remain in preserved historical
commits; current source uses environment/project paths. The 69 SDK research
result files exactly match already-public upstream blobs; local private logs,
profiles, credentials and delivery ZIPs are excluded. No production upgrade or
software publication follows this checkpoint push.
