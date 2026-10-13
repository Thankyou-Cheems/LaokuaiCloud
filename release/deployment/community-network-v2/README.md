# Community network V2 deployment preparation

2026-10-13 follow-up: the user subsequently approved relay enablement. The separate
scoped operation is recorded in `release/acceptance/member-relay-enabled-20261013.json`.
Gryt now has gate1 and the upgraded management proxy gate2. This first-deployment
operator remains closed-only; its directory contains the permanent enablement marker.
Do not use its old-image rollback for the current deployment. Preserve the new
`/opt/stacks/gryt/member-relay-v2-20261013-r1/activation.overlay.json` as well as
all earlier Compose overlays. The original preparation and approval boundaries below
remain historical; current clients still need explicit device-local relay consent.

Prepared source only. No SSH, production update, proxy restart, native ET command,
true relay credential or relay gate enablement was performed while preparing this
operator. The first deployment is **Gryt only**, with both relay gates closed.
It enables the new invitation admission and DNS directory source in the backend.

`operator.py` discovers the current Gryt/SFU image IDs, container IDs and Compose
file set from the actual live container labels. Historical image IDs are not
assumed. Every existing Compose overlay (including the current member directory
and 12-seat SFU overlays) participates in the merged private snapshot. The candidate
copies only `bundle.js` over the discovered existing image; no RUN, package install,
network build or base-image pull occurs. Activation changes only the server image,
preserving all environment, ports, mounts, network settings, data and 12-person
capacity. SFU and the existing management proxy must retain their process epochs;
the operator issues no ET command. Raw config/inspect snapshots stay 0600 on-server.

## Local inputs

The local PowerShell helpers are private operator conveniences in
`D:/Dev/LaokuaiCloud/.local/community-network-v2/`:

```powershell
# Draft compile/hash: deployment is refused while the source is uncommitted.
pwsh -NoProfile -File .local/community-network-v2/prepare-server.ps1
# After the final source commit, compile and pin that exact clean server source.
pwsh -NoProfile -File .local/community-network-v2/prepare-server.ps1 -SourceCommit <40-character-current-HEAD>
```

The build uses the system Node 22 runtime, TypeScript, and esbuild with
`--platform=node --target=node22 --format=cjs --external:sharp --external:jsdom`.
`input.json` pins bundle bytes/SHA256, proxy bytes/SHA256, operator SHA256 and the
exact `source-input.json` SHA256. The source-input list pins the runtime source
files, dependency manifest/lock, compiler config, proxy source and operator source.
A draft records its base commit and dirty-working-tree state honestly; it cannot
pass remote `build`. No source archive, profile, credential or raw log is uploaded.

## Approved first server-only execution

After reviewing the concrete frozen inputs and obtaining deployment approval:

```powershell
pwsh -NoProfile -File .local/community-network-v2/remote-server.ps1 -Phase Stage
pwsh -NoProfile -File .local/community-network-v2/remote-server.ps1 -Phase Inspect
pwsh -NoProfile -File .local/community-network-v2/remote-server.ps1 -Phase Build
pwsh -NoProfile -File .local/community-network-v2/remote-server.ps1 -Phase Activate
# If needed, while this remains the closed-gate first deployment:
pwsh -NoProfile -File .local/community-network-v2/remote-server.ps1 -Phase Rollback
```

Default receipt directory:
`/opt/stacks/gryt/community-network-v2-20261013-r1`. Select a fresh suffix with
`-RemoteDirectory` if it already exists; do not overwrite failed attempts. Remote
equivalents are `python3 -I <directory>/operator.py <phase> --work <directory>`.
Inspect is read-only. Build does not start the application. Activate performs
`compose up --no-deps --no-build --pull never server`, checks health and exact
runtime shape, and automatically restores the discovered previous server image
if those checks fail. Raw command stdout/stderr and configuration values are never
printed. Receipts record whether runtime actually started.

## Independent proxy candidate

The Gryt-only update does not install proxy code. Optionally use `Stage -IncludeProxy`
and `ProxyStage` in a separate approved stage. `proxy-stage` verifies the frozen
candidate hash and Python syntax, saves a receipt, and **does not** replace the
existing file, change the unit, restart it or modify its ledger. Actual proxy
installation/restart needs its own concrete reviewed procedure and approval.

The backend rejects activation if `LAOKUAI_MEMBER_RELAY_POLICY_V2` is present with
anything other than `0`; absence is the unchanged default. The proxy's independent
`MEMBER_RELAY_POLICY_VERSION` must be absent or `1`. This operator never enables
either. In particular, new member forwarding is not accepted by deploying a
new Gryt bundle alone.

## Relay enablement and rollback boundary

Later relay enablement is a separate operation requiring approval of native budget
version, proxy/backend gates, credential qualification, local consent, and exact
rollback materials. That later operator must create
`RELAY-V2-EVER-ENABLED.json` in this deployment directory before enabling a gate;
this first-deployment rollback refuses that marker and any changed runtime shape.

Once true qualification has been issued, directly returning to an old backend is
invalid: older validators reject V2 sealed grants and mixed issuer policy. Follow
`components/server/COMMUNITY-RELAY-V2.md`: same-key false downgrade/readback for
all V2 credentials, V1-readable storage verification (including expired/offline
records and pending outcomes), then gates closed and ordinary renewal verified,
then the old image. Keep private database/ledger backups. A reviewed administrative
migration is still needed for scopes without an authenticated live device session;
this initial operator does not automate it or claim instant WAN cessation.

Local pure tests: `python -B -I release/deployment/community-network-v2/test_operator.py -v`.
They exercise source/operator restrictions through fixtures; no Docker or remote
execution occurs. Production health, invitation admission, DNS resolution and
dual-device behavior still require the approved deployment and product validation.
