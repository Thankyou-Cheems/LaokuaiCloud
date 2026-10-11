# Modern Windows native product build profile

The source089b6182 Windows10/11 pair was compiled by the sole designated owner
from integration33a166dd. Exact runtime input is four files with modern core
f716a113 and CLI1ad46380, unchanged Wintun/WinDivert. The profile JSON and native
input inventory carry full hashes and source/tree/lock correspondence.

Keep17 explicit product features, --no-default-features and +crt-static. Remove
only FakeTCP/pnet support, unused Windows command encoding and the win7 thunk
feature. Do not substitute win10 compatibility features. Ordinary TCP/UDP/QUIC,
TCP hole punching and Windows broadcast backend remain source capabilities;
actual behavior is still unaccepted. Current Windows target graph504 packages,
thunk/service features[], real producer compile and independent EXE/PDB/import
checks passed. No VC-LTL/YY inputs, Npcap or dynamic CRT imports were found.

The exact build recipe is release/source-materials/MODERN-NATIVE-BUILD-HANDOFF.md
in the unified repository. Do not run another compiler without the parent's
sole heavy slot assignment. Metadata and license text custody do not imply
actual recipient relink, native/TUN/coexistence or public-release acceptance.
Schema6 remains locked to dbaf and cannot run the new pair. Production payload
and license gates remain false. Historical profile and evidence are retained.
