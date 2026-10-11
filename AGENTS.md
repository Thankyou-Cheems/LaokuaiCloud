# Integration ownership

This checkout is the client integration branch `codex/laokuai-integration-20261011`.
Task-6 is its sole Git writer. Feature owners deliver immutable commits or patches
from their own branches. Test owners use a frozen commit/archive and report results;
they do not modify this branch or the feature owners' working trees.

Preserve repository boundaries for client, Voice SDK, server, SFU and EasyTier.
The release manifest at `docs/releases/2026-10-11/manifest.json` coordinates exact
source commits, package SHA256 values, delivery state and acceptance limits.
Uncommitted Hybrid work is pending; never copy it as a completed SDK delivery.
Review the closed-PC patch with the SDK owner before adding it to their delivery.

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
