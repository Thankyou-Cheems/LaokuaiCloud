# Integration ownership

This checkout is the client integration branch `codex/laokuai-integration-20261011`.
Task-6 is its sole Git writer. Feature owners deliver immutable commits or patches
from their own branches. Test owners use a frozen commit/archive and report results;
they do not modify this branch or the feature owners' working trees.

Preserve repository boundaries for client, Voice SDK, server, SFU and EasyTier.
The current candidate manifest is `docs/releases/2026-10-11-v2/manifest.json`.
It coordinates exact source commits, package hashes and acceptance limits.
The preceding `docs/releases/2026-10-11/manifest.json` is a preserved checkpoint.
Final Hybrid SDK integration.2 is pending; integration.1 is intermediate only.
The SDK owner alone incorporates the closed-PC guard before final delivery.
EasyTier packaging must pin the approved v2.7.0 prerelease commit and asset hash.

No push, public-main merge, PR, publishing, force push, history rewrite or deleting
existing worktrees is authorized in this stage. Push URLs are disabled locally.
The discovered client, Voice and EasyTier forks are public. Confirm destination
and disclosure boundaries with the parent before remote synchronization.

Do not import credentials, real profiles, raw private research/test logs or delivery
ZIPs. Retain local inventories outside tracked source. Lightweight static/VM/pure
checks are permitted. Docker, listeners, browsers, helpers, native execution and
large builds are outside this stage. Do not change AGC, bitrate defaults, production
settings or permissions.

Commits use the existing English/Chinese Conventional Commit format.
