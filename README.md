# 唠蒯云 integration

This private repository is the one release integration source for the desktop
client, Voice SDK, application server, SFU and EasyTier provenance. Public forks
remain upstream contribution repositories. No production or public software
release is performed by creating this integration source.

Components retain their own source origins, licenses and frozen source commits.
The client is imported with its Git history; the SDK, server and SFU are frozen
source imports with exact upstream/delivery commit and file hashes recorded in
the release manifest. EasyTier is pinned to official v2.7.0 prerelease; the
Windows server/community adapter is integrated with configuration and permission
gates. Automatic authorized community provisioning and real network acceptance
remain pending. The fixed-base Windows compatibility source is imported as a
review checkpoint; its create-only correction passes static source review recorded
in `components/easytier/REVIEW.md`, while native build/acceptance remain pending. Official
Windows files are reference only; private final packaging requires reviewed
patch/build hashes from `components/easytier/provenance.json`.

The old local EasyTier network-upgrade project has core/game Git trees whose
remotes point to official public upstreams. No corresponding user private
integration repository was found in the authenticated account's metadata.
Those original trees and their uncommitted work are preserved. Existing product
integration moves forward here; private profiles, runtime configuration, raw
local investigation logs and credential material are not imported.

See `release/manifest.json` and `release/README.md` for the exact candidate and
the verification commands. `ready: false` is binding until outstanding acceptance
work is completed. Simulated protocol checks do not prove real media or networks.

Recipient engineering follow-up: original helper failed; the reviewed one-expression
environment-key removal supports the corrected fresh-target offline modified-library
core/CLI compile/link PASS (1288.6058461666s). See release/source-materials/RECIPIENT-RELINK-RESULT.md
and release/acceptance/recipient-modified-library-relink-pass.json.81 sealed owner
files and1262 source files reverified;33 pure environment assertions and1129 lock
checks pass. No marker edit/test EXE/product payload change or runtime execution.
The old tools/source-offer ZIPs stay immutable; repair is a separate supplement.
Actual recipient/source access/export/license/platform/native/media acceptance
remains pending; ready=false/finalPackage=null.

Lifecycle.3 is integrated locally on integration/lifecycle3-20261012 from3a6c794f.
Prior cb209bd eight-file equivalent is applied once;24 lifecycle source/vendor
paths match exact delivery. See release/acceptance/lifecycle3-local-integration.json
and release/LIFECYCLE3-BUILD-HANDOFF.md.8 guarded pure suites/14 script syntax
checks pass; full cloud build/soak are delivered summaries, not local Windows
acceptance. Parent assigns the sole next builder. No remote sync/build/product
launch/user config change by Task6; old packages/freeze preserved.

The b38566f lifecycle.3 internal portable3a8065e5 is now built;411 sealed files
readonly rehashed and141 payload files matched. Root verifier scope/inventory
expectations corrected with42 range+10 CLI positive/negative checks; ready flag
still blocks exit2. No component/product input change, no repack needed. Old
receipts/artifacts/failures stay frozen; real runtime/media and license/recipient
acceptance pending. See release/LIFECYCLE3-VERIFIER-REVIEW.md.
