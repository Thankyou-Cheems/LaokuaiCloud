# EasyTier modern Windows native notices

This Windows test candidate has exactly four runtime files: source089b6182 core
20284928B/f716a113 and CLI6160896B/1ad46380, unchanged Wintun0.14.1 and
WinDivert2.2.2 SYS. Full hashes are in easytier-native-input-inventory.json.
Both matching EXE/PDBs and normal/delay imports were independently checked.
No Packet/wpcap/Npcap/pnet or dynamic CRT imports were found. Product17 features
and +crt-static remain; the Win7 thunk feature and unused Windows encoding
feature are disabled. Matching PDB/link evidence has no VC-LTL/YY objects.
These static results are not native, driver, game or network acceptance.

Exact native code source: 089b6182c603c8ab60044b673effe0cf614cc28a; component tree
25be11e0c9460bce1330cbd7964e4d6561f0bc14. Upstream8b7f1f01 production changes and
the two Cargo feature fixes are represented by cumulative code patch
490ffd127cc7c6a9d0d622ff161fe2086536e59be8b8281cf87e2f00e314aed5. Cargo.lock remains e3ee41507e7a8ef94470b70f4639140e67aadae646ada82dfd23b0beeb0e7fb2.
The exact private1277-file source archive contains unlinked historical Packet
assets and other prebuilt non-product assets. It is not a recipient/public source
export. The screened source draft excludes all15 prebuilt assets, retains exact
remaining code bytes and is labelled for Windows core/CLI only. Never ship the
old archival companion, raw Microsoft libraries or a whole historical delivery
ZIP as recipient source without the specific release review.

## Retain original license and modification materials

EasyTier is LGPL3 with incorporated GPL3 terms: retain licenses/EasyTier-LGPL-3.0.txt
and licenses/GPL-3.0.txt, modified code, build recipes and applicable combined-work
source/relink/installation information. The screened recipient kit with its separate
build-tool fix passed a fresh offline modified-library core/CLI rebuild. Its public
availability is separate; exact source locations are in SOURCE-OFFER.json. The
vendored modified Rust TUN wrapper is WTFPL2, not MIT:
retain licenses/rust-tun-WTFPL-2.0.txt and its source/provenance.

Wintun0.14.1 signed prebuilt binary uses its original separate redistribution
terms; preserve licenses/Wintun-0.14.1-LICENSE.txt and signed bytes, and use its
Permitted API without implying endorsement. WinDivert2.2.2 retains the original
LGPL3/GPL2 choice, licenses/WinDivert-v2.2.2-LICENSE.txt and the linked Rust/C
backend sources. Broadcast capability is retained; it has not been activated
for this build audit. No driver installation or maintenance entitlement is
created by a signed-file hash.

Current normal/build graph has504 packages. Its original license text bundle
is licenses/native-transitive/MODERN-NATIVE-THIRD-PARTY-LICENSES.txt (324 unique
texts); package identities/hashes are in modern-native-bom.json. The24 omissions
from the top-level scan map to the retained prior original evidence, with the
separate SeaHash CC0 and encoding_index_tests original provenance. Declared
Cargo SPDX/author fields are metadata, not newly invented license grants.
The historical506-package inventory/351-text bundle and original notices remain
preserved. Old VC-LTL/YY/encoding-utils obligations apply to their old artifacts;
they are not claimed as linked content in the new pair.

Standard MSVC14.44.35207/SDK10.0.26100.0 linker/library identities are recorded
in the build receipt; raw platform libraries are not supplied. Actual installed
Visual Studio/SDK terms still govern platform use and redistribution. Official
Microsoft runtime/REDIST references and response hashes are retained under
release/source-materials; they do not grant raw library or modified-CRT rights.

## Current test package

The owner authorized this member-device portable test build. It uses ordinary
Windows UAC for its owned EasyTier process, with no persistent elevated service.
The broker and automatic enrollment changes still require real UAC/TUN and
two-device tests. Historical one-shot native trials are not acceptance for this
application. A public binary release has not been authorized.

Source archives are separate from the executable; the package retains license
texts, copyright notices, source hashes and SOURCE-OFFER.json. The repository
is currently private while GitHub's retained pre-cleanup Npcap objects are
addressed. Public source access must not be claimed until verified. Historical
no-Npcap/five-file receipts remain preserved for their original artifacts.
