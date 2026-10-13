# Integration ownership

This directory is the client component of the private `LaokuaiCloud` repository.
Task-6 is its sole Git writer. Feature owners deliver immutable commits or patches
from their own branches. Test owners use a frozen commit/archive and report results;
they do not modify this branch or the feature owners' working trees.

Preserve repository boundaries for client, Voice SDK, server, SFU and EasyTier.
The repository-wide authority is `../../release/manifest.json`.
Client manifests in `docs/releases/` preserve earlier local checkpoints.
Final Hybrid SDK integration.2 is pinned; integration.1 is intermediate only.
The SDK owner incorporated the closed-PC guard exactly once in final delivery.
EasyTier packaging must pin the approved v2.7.0 prerelease commit and asset hash.

The user authorized private integration branch pushes to
`https://github.com/Thankyou-Cheems/LaokuaiCloud`, after confirming it is private.
Public fork pushes, publication, force push, history rewrites and deleting old
worktrees are not authorized. Follow the root AGENTS.md for global ownership.

Do not import credentials, real profiles, raw private research/test logs or delivery
ZIPs. Retain local inventories outside tracked source. Lightweight static/VM/pure
checks are permitted. Docker, listeners, browsers, helpers, native execution and
large builds are outside this stage. Do not change AGC, bitrate defaults, production
settings or permissions.

Commits use the existing English/Chinese Conventional Commit format.
