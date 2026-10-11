# EasyTier native runtime notices and release provenance

This is a source-backed notice/provenance handoff, not a release authorization or a completed license audit of every Rust dependency. Preserve these notices and the unmodified license texts when preparing the product. The private Electron main layer and the native runtime are separate components; do not label the customized native core an unmodified official binary.

## Frozen source and current inputs

The downstream native source is `dbaf04531024f4201e73ec0bc5ba6a7a6d8d3b49`, tree `e58f64a219c204cdaf364fc95466cf03acfb7c21`, based on EasyTier upstream `8b7f1f0196edb5b580829ed5f135050fb5853478`. Its cumulative code patch SHA-256 is `eb30fab089422c82256a8c8db9cb7a15d3c41b8b972a05729f63ebfbac7e8cad`; Cargo.lock SHA-256 is `e3ee41507e7a8ef94470b70f4639140e67aadae646ada82dfd23b0beeb0e7fb2`. Modified owned-TUN creation, owned-stop/host-policy behavior and Windows game broadcast compatibility are included. The existing source bundle SHA-256 is `71c09f9ba90cb87dcc3eb3d828477c21d5761a74c0fd049f965fa90b54d8425e`. Preserve that bundle and build recipe alongside the corresponding resulting binaries.

The historical five fixed runtime inputs, their complete hashes and provenance are in `easytier-native-input-inventory.json`. The official EasyTier input archive is [v2.7.0 Windows x86_64](https://github.com/EasyTier/EasyTier/releases/download/v2.7.0/easytier-windows-x86_64-v2.7.0.zip), 39,616,733 bytes, SHA-256 `790fd9be347b00753570ac2b65f874a591ede9427603fe34e74a86b2b084847f`; the custom core replaces its core. The old compiled custom core and official CLI both statically import Npcap Packet.dll. They are historical candidates and cannot be described as the final no-Npcap product.

## EasyTier and modified rust-tun

EasyTier's frozen source package license is LGPL version 3. Include [EasyTier-LGPL-3.0.txt](licenses/EasyTier-LGPL-3.0.txt) and its incorporated [GPL-3.0.txt](licenses/GPL-3.0.txt), copyright/provenance notices, modification description, corresponding source and instructions needed to rebuild the delivered version. A web link or private Git bundle alone does not establish that end users receive the required corresponding source or other applicable combined-work materials. Release owner must choose and verify a compliant source/relinking delivery method for the actual distributed work. No proprietary license exemption is asserted here.

The owned-TUN dependency is vendored from [EasyTier/rust-tun](https://github.com/EasyTier/rust-tun/tree/12378839e7985283df0e4fb536b7137230356db5), exact upstream `12378839e7985283df0e4fb536b7137230356db5`, modified in `vendor/rust-tun`. Both its frozen Cargo metadata and LICENSE state WTFPL version 2, **not MIT**. Preserve the exact [rust-tun-WTFPL-2.0.txt](licenses/rust-tun-WTFPL-2.0.txt) and modified source. This refers to the Rust wrapper, not the Wintun driver binary's separate license.

## Wintun

`wintun.dll` is the unchanged official amd64 Wintun 0.14.1 binary. Its SHA-256 matches the amd64 ZIP entry byte-for-byte. [Official Wintun](https://www.wintun.net/) identifies its signed ZIP and distinguishes the source GPL 2 license from the prebuilt binaries' separate license. The reference ZIP SHA-256 is `07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51`.

Include the exact [Wintun-0.14.1-LICENSE.txt](licenses/Wintun-0.14.1-LICENSE.txt) from that ZIP. Its redistribution exception concerns distribution alongside software using the Permitted API; preserve the signed binary and proprietary notices and do not imply WireGuard endorsement. Actual native use must remain within that API. These signed prebuilt terms must not be replaced with a generic GPL or MIT label. Distribution rights and driver activation permission are separate questions.

## WinDivert

`WinDivert64.sys` is byte-for-byte equal to both WinDivert64.sys entries in the [official WinDivert 2.2.2 A ZIP](https://reqrypt.org/download/WinDivert-2.2.2-A.zip), linked by the [official project](https://reqrypt.org/windivert.html). The exact ZIP's LICENSE matches the [v2.2.2 source LICENSE](https://github.com/basil00/WinDivert/blob/v2.2.2/LICENSE); include [WinDivert-v2.2.2-LICENSE.txt](licenses/WinDivert-v2.2.2-LICENSE.txt), which provides the LGPL 3 / GPL 2 choice and the referenced GNU texts. The WinDivert user-mode backend is statically incorporated through the pinned windivert/windivert-sys source; treat its applicable source/relinking requirements together with the actual linked binaries, rather than treating the SYS notice alone as complete.

Provide the exact [WinDivert 2.2.2 source](https://reqrypt.org/download/WinDivert-2.2.2-Source.zip), the pinned Rust wrapper source (`adcc56d1550f7b5377ec2b3429f413ee24a77375`) and build instructions with the release's corresponding source delivery. This handoff does not claim those complete linked sources are already packaged for end users. WinDivert remains part of the current Windows game broadcast capture backend; removing FakeTCP does not remove it or its driver-loading capability.

## Npcap: historical input, no redistribution authorization supplied

The old `Packet.dll` metadata identifies Npcap 1.79, Insecure.Com LLC, and the historical CLI/core have mandatory imports of it. The [official Npcap OEM redistribution page](https://npcap.com/oem/redist) distinguishes free/demo use from external product redistribution. No applicable OEM redistribution license or version-specific license artifact was supplied here, so this handoff does not authorize shipping this DLL and does not invent an OEM entitlement. Existing machine installation is not evidence of product redistribution rights. Preserve this pending status if the old five-file candidate is retained for internal investigation.

The planned no-Npcap profile removes only the official FakeTCP feature and its pnet dependency. It rebuilds **both** core and CLI, retains ordinary TCP/UDP, TCP hole punching and the Windows broadcast code, and omits Packet.dll from the final inventory. Source/locked graph evidence passed; compilation, final hashes and PE normal/delay-import absence remain capacity-owner deliverables. Never carry the old official CLI into that package. FakeTCP and its secondary interface-enumeration fallback become unavailable and must be disclosed. The profile and exact build command are in [EASYTIER-WINDOWS-FEATURES.md](../scripts/EASYTIER-WINDOWS-FEATURES.md).

## Remaining release inputs

The JSON distinguishes five historical inputs from four planned final inputs; no fabricated final hashes or release entitlement are included. Before release, owner must verify final core/CLI provenance and imports, update the runtime manifest/file inventory and installer/driver capability disclosure together, include these license texts/notices in the actual distributed package, and finish the active locked transitive dependency inventory plus applicable source/relinking delivery. This document and source handoff are ready to integrate; network, driver and live game acceptance remain behind the final concrete activation gate.
