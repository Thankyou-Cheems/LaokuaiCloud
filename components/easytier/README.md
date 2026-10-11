# Fixed EasyTier Windows compatibility component

The immutable upstream base is v2.7.0 prerelease
`8b7f1f0196edb5b580829ed5f135050fb5853478`. The ET owner delivered native
snapshot `dbaf04531024f4201e73ec0bc5ba6a7a6d8d3b49` / tree `e58f64a219c204cdaf364fc95466cf03acfb7c21`.
This snapshot has an independent snapshot source history, not upstream history.
Task-6 imported 1,277 exact Git blobs under `source`, excluding the contributor
runtime `easytier-contrib/easytier-uptime/.env`. Licenses remain in source.
Delivered patches are byte-for-byte preserved under `patches`.

Review status is **accepted for the static source contract**: see [REVIEW.md](REVIEW.md).
The corrective vendored TUN path creates only, with no open fallback; it checks actual
LUID/GUID before address configuration or session start. No native executable
was built or run by task-6; no Windows adapter, firewall or profile was changed.
The native owner delivered the ownership fix independently; it is integrated once.
Native build, driver/coexistence and cleanup acceptance remain pending. [BUILD.md](BUILD.md) records exact isolated build inputs.

The client now requests bounded graceful stop through its own newly spawned child
stdin, waits for closure and preserves diagnostic uncertainty. Only the captured
owned handle may be force-stopped after timeout. Main-only GUID/LUID/index receipts
are diagnostic evidence, never authority for deleting adapters or configurations.
Real native stop, OS route cleanup and coexistence acceptance remain pending.

Downstream resources use `community-lan/product/2.7.0-laokuai`: five runtime files
plus a release-owned `laokuai-build.json`. The template's null core hash is
deliberately invalid. Official Windows binaries stay reference-only. Private build,
resource, receipt and package hashes remain empty until actual approved evidence.
The loader has no official-core fallback and beforePack rejects this pending payload.

`provenance.json` locks native source, patches and review state. The root
`release/manifest.json` remains the release authority. Joining a community owns
ET lifetime independently of voice; LAN membership does not authorize cross-room
audio or prove physical-direct voice/screen transport. No Tencent Linux node change.
