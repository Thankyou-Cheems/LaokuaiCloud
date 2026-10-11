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
remain pending.

The old local EasyTier network-upgrade project has core/game Git trees whose
remotes point to official public upstreams. No corresponding user private
integration repository was found in the authenticated account's metadata.
Those original trees and their uncommitted work are preserved. Existing product
integration moves forward here; private profiles, runtime configuration, raw
local investigation logs and credential material are not imported.

See `release/manifest.json` and `release/README.md` for the exact candidate and
the verification commands. `ready: false` is binding until outstanding acceptance
work is completed. Simulated protocol checks do not prove real media or networks.
