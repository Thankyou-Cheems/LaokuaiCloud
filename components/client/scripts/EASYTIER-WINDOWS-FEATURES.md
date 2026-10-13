# Modern Windows native product build profile

The native subtree at monorepo commit10b76471 was compiled by the sole
designated owner. Exact runtime input is four files with core d1634bf0 and
CLI1638d7f1, unchanged Wintun/WinDivert. The profile JSON and native
input inventory carry full hashes and source/tree/lock correspondence.

Keep17 explicit product features, --no-default-features and +crt-static. Remove
only FakeTCP/pnet support, unused Windows command encoding and the win7 thunk
feature. Do not substitute win10 compatibility features. Ordinary TCP/UDP/QUIC,
TCP hole punching and Windows broadcast backend remain source capabilities;
actual behavior is still unaccepted. Current Windows target graph504 packages,
thunk/service features[], real producer compile and independent EXE/PDB/import
checks passed. No VC-LTL/YY inputs, Npcap or dynamic CRT imports were found.

The exact source update and build recipe is documented in docs/SOURCE-ACCESS.md,
using the retained six source attachments and exact preferred source snapshot.
The ordered two-patch index is an attestation, not a single cumulative patch.
Profile JSON5dbf82 changes source/evidence bindings while retaining the same
17 features, target, dependency lock and static CRT flags. Do not run another compiler without the parent's
sole heavy slot assignment. Metadata and license text custody do not imply
actual recipient relink, native/TUN/coexistence or public-release acceptance.
Old fixed recipient helpers cannot accept the new source file set. The current
package gate verifies source supplements and the new four-file hashes; native
runtime and network acceptance remain false. Historical profile and evidence are retained.
