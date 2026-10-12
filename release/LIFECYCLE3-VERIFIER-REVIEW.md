# lifecycle.3 release verifier correction

The b38566f Windows internal portable remains129121577 bytes, SHA256
3a8065e5ebc3ada52b7de8d62971071c2893c777cb0520ca9b4b1db35704c606.
Task6 rehashed all411 sealed owner files (943675640 bytes) and recorded
[the build receipt](acceptance/lifecycle3-internal-build.json).141 payload files
match the build-owner win-unpacked inventory; SDK212 installed files/170 rebuilt
dist and exact archive reproduction are reported in that hash-verified handoff.
No artifact or build-owner source/evidence was edited.

The verifier failures were stale expectations: new archive count packedFiles
versus installedPackedFiles; immutable old SDK/Provider and842 acceptance tied
to current lifecycle source; old recipient command-preparation expected current
helper/plan bytes and still required compile/relink=false after the separately
verified repair and build. Corrected checks validate both inventory schemas
strictly, bind old receipts to their exact baseline Git manifest/tree/package
and assert they do not accept current lifecycle media, verify the new build
separately, and validate historical preparation plus current helper/relink proof
without erasing the first failure. Hash/tree/inventory/source drift, native/
permission/license/ready and historical actual-runtime scope checks remain.
Success output now occurs after every assertion, including the late checks.

42 range/identity cases plus10 real verifier CLI cases pass; bad inventory,
version, saved history, Provider/relink hashes, current plan, old-media promotion
and current-runtime promotion fail. --require-ready returns2 as intended. The
CLI mutations are in-memory test overlays, not edits to the real manifest.
See [the regression receipt](acceptance/lifecycle3-verifier-regressions.json).

No product defect was detected by this verifier investigation. No Windows
repackage is required: git diff b38566f -- components is empty, and only root
release tools/tests/metadata/docs changed. The EXE stays pinned to b38566f; a
new root verification commit does not retroactively rename its source freeze.
Existing source ZIPs and original failing verifier logs remain immutable.
Future source delivery can include these corrected tools without claiming the
old frozen archive already contains them. No app, helper, TUN, listener/network
trial or user configuration was activated.

Windows startup, actual accounts/room recovery/two-way listening/devices/native
coexistence and recipient/license distribution work remain pending.
ready=false/finalPackage=null; no public release or remote push.
