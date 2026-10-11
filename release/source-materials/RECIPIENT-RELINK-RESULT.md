# Modified-library recipient compile/link result

Status: PASS-modified-library-recipient-compile-and-link-only, conditional on
the reviewed helper repair. Source089b6182 / integration inputad219385 / app
freeze84292bf remain pinned. Original helper failed in12.1583468914s (exit1);
corrected fresh-target offline compile/link passed in1288.6058461666s (exit0).
No producer compiled cache was reused. The version marker is a test-only source
edit; neither this edit nor either resulting EXE is imported into the product.

The one helper expression removes11 environment keys instead of leaving empty
overrides on the observed PowerShell7.6.6/.NET10.0.12 runtime. Environment key
names, guards, Cargo offline/locked command,17 features and payload are unchanged.
Task6 independently verified81 sealed files/42422281 bytes,1262 restored source
files (1260 unchanged, one marker edit, one transport-only lock), and15 excluded
prebuilt files absent. Both test EXEs contain the marker once. Pure helper AST
parsing and33 child-environment absence assertions passed.1129 lock record
versions/checksums remain identical; only six Git transport references relocate.
Task6 ran no build or native executable.

Owner evidence verifies865 archives,513 extracted packages/23792 member files,
7 Git snapshots,504 target packages, matching AMD64 PE/PDB, two final links,
static CRT fingerprints and standard platform input provenance. No capture or
dynamic CRT imports, compatibility inputs, pnet, encoding-utils or codepage
inputs; encoding_rs is retained. Deleted LTO temporary bytes are not claimed
to have been independently compared. Raw machine paths/logs remain owner-only.

Exact hashes, first failure and successful run qualifications are in
[the sanitized receipt](../acceptance/recipient-modified-library-relink-pass.json).
The old tools ZIP24879c3a is immutable. A separate4-entry repair supplement
(3461 bytes, SHA25687d32e98f56009e36932593159aa181940e38839a22cba97a459e401a92e1782)
supplies the exact fixed helper and patch/instructions. The main sealed source
offer and its28-file manifest remain unchanged; the repair supplement is an
additional artifact and has not been transferred to an external recipient.

Production coref716a113/CLI1ad46380 and portable3cff0c00 retain their exact bytes.
No app rebuild, executable launch, TUN or network test occurred in this proof.
Concrete recipient selection/delivery/access, permitted external export,
installation information and license/platform/final app inventory review remain
open. Modern native and real device/media/game/coexistence acceptance are
separately pending; old dbaf approval does not apply. ready=false/finalPackage=null.
