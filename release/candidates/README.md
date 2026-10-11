# Windows encoding feature option

`windows-service-manager-no-encoding.patch` is an unintegrated proposal against native dbaf0453. It changes only easytier/Cargo.toml: the original service-manager Git revision retains its defaults on non-Windows targets; Windows disables the optional default encoding feature. EasyTier uses its own Windows service backend. The candidate preserves all 17 no-Npcap product features, source code and Cargo.lock.

Isolated `cargo tree --locked --offline` with the fixed Windows normal/build graph passed for both source versions. The baseline has 506 unique packages; the proposal has 504, removing only encoding-utils 0.1.0 and codepage 0.1.3. No compile, new executable, service test or native run was performed. Non-Windows defaults are preserved by declaration, without a new cross-platform build claim.

Current exact binaries remain unchanged. The baseline builds encoding-utils, but stripped/LTO EXEs and matching PDBs did not establish whether any of its machine code remains. Treat it conservatively as a potential distributed dependency; absence of names/GetACP is not proof of exclusion. Its upstream declares MIT and author a632079; neither of its two commits supplies an original LICENSE/copyright file. No copyright owner/year or author permission was invented.

If the parent selects this option, the native owner must review and deliver a new source checkpoint and separately coordinated build. Refresh binary/import/source/BOM/resource identities and relevant regressions. Do not remove a notice question from the frozen binaries on the basis of this unbuilt patch. VC-LTL and recipient/relink issues are independent of this option.
