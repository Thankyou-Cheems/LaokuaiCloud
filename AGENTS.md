# Sole integration ownership

Task-6 is the only writer of this release integration branch. Component owners
work on independent feature trees and deliver immutable commits/patches/packages.
Testing uses frozen snapshots and must not mutate owners' branches.

Preserve component boundaries and license/provenance records. Client source is
in `components/client`; Voice SDK, server and SFU each have their own directories.
`release/manifest.json` is the repository-wide coordination authority. Client
manifests under its docs preserve earlier checkpoints, not current global state.

The user approved this private integration repository and necessary product
code/brand assets. Confirm `origin` is PRIVATE before each push. Never push this
integration history to public forks. Do not import secrets, real profiles,
user chats, local diagnostics or source delivery ZIPs. Do not rewrite old history,
force push, delete old trees, change production, or publish software automatically.

EasyTier must use approved v2.7.0 prerelease as the fixed upstream base. The ET
owner delivers the minimal downstream Windows compatibility patch; task-6 reviews
and integrates it once. Official Windows binaries are reference only, never the
private patched payload. Track patchset and private build/resource hashes under
components/easytier. Do not change Tencent Linux public nodes.
Joining a server/community owns ET lifetime independently of voice rooms. LAN
membership does not authorize cross-room media; LAN direct does not prove voice
or screen physical-direct transport. Actual network acceptance is pending.

Lightweight static/type/pure checks are allowed. The user subsequently authorized
one candidate application build/portable package without launching any product,
helper, ET core/CLI or driver. Queue that heavy build until the capacity owner
explicitly releases the heavy-run slot. No Docker, listeners, browser or native
runtime execution by task-6. Bilingual Conventional Commits use the existing
valid author identity.

The compatibility source is a review checkpoint; ET-OWNERSHIP-001 blocks payload
approval/activation until the native owner delivers a create-only fix. Task-6
must not duplicate that native patch. Only the parent-designated capacity owner
performs the isolated Rust build. All current UI changes require user prototype
preview approval before final packaging. Keep existing desktop packages unchanged.
Await the SDK owner's controller-state repair and frozen-snapshot retest before
final release freeze. A WebRTC peer over ET relay is not proven physical direct.
