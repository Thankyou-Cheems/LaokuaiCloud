# Modern native corresponding-source preparation

This is a prepared private recipient-source draft, not proof that an end user
received it, rebuilt/relinked it or accepted installation information. No public
export or native activation is approved. Actual new binaries are from source
089b6182 / full private source tree25be11e0. The full1277-file historical archive
contains unlinked Packet binaries and must stay private.

The screened source archive retains1262 original code/workspace files and
excludes15 prebuilt assets: all six Packet DLL/LIB files across three architectures,
six signed runtime driver companions and three unrelated Go/OH prebuilt assets.
Exclusion list and every retained original hash are in modern-recipient/screened-native-source.json.
It is scoped to Windows x64 core/CLI; it is not a complete Go/GUI/OH product source
archive. No retained production source code was edited for screening.

Dependency material has494 exact registry archives in the actual504-package
Windows target graph. Cargo's preserved multi-member workspace resolver also
needs371 other registry source archives; they are labelled resolution-only, not
new runtime dependencies. All865 original archives plus944 index files/1108
locked records are pinned. Seven fixed current Git/submodule source ZIP exports
contain source snapshots rather than history. No raw installed Microsoft LIB,
old VC-LTL/YY precompiled link archive, native Git history or user profile/log is
in this source draft. Original registry crates retain their interface libraries
and fixtures with original checksums;51 binary-named members in target crates
are catalogued, not all claimed as linked or necessary. Native Packet DLL/LIB
filename screening remains separate from ordinary source references to Packet.

First494-only fresh restoration failed on missing asn1-rs0.7.2 required by full
workspace resolution. Its destination/log are preserved. Adding the exact371
resolution-source archives succeeded in a second fresh destination, without
fetching or changing any dependency version.

`restore-screened-recipient-source.cjs MATERIALS FRESH_DEST` verifies the
source/archive manifests, expands the seven source exports and recreates an
isolated offline registry. External Cargo config patches six Git packages to
verified local paths; only the draft Cargo.lock transport IDs change, with the
original producer lock preserved alongside it. A first offline Cargo tree
resolves local transports, then a locked offline tree verifies exactly504 target
packages. Source restoration and relocation are not native compilation.
The independent lock check additionally verifies all1129 lock-record versions/registry checksums
unchanged and empty thunk/service features. See modern-recipient/restoration.json
and lock-and-feature-check.json. Use Cargo's documented Git path overrides:
https://doc.rust-lang.org/cargo/reference/overriding-dependencies.html .

For a future parent-assigned recipient relink test, after verified restoration
and lawfully supplied VS2022 x64/SDK/protoc/Rust1.95 tools, use its isolated
CARGO_HOME, a fresh CARGO_TARGET_DIR, +crt-static, --offline --locked --release
-p easytier --bin easytier-core --bin easytier-cli --target x86_64-pc-windows-msvc
--no-default-features and the same17 features in the product profile. Clear
inherited compatibility paths/compiler wrappers as in build-modern-native.ps1.
The old build helper expects the exact1277 producer inventory; do not apply that
helper's source-count contract to this1262-file relocation draft. No relink was
performed by Task6 and bit-identical output is not promised.

Retain EasyTier LGPL3/GPL3, modified TUN WTFPL2, WinDivert original terms/C/Rust
source, Wintun's distinct signed-binary terms and all current original license
texts/notices. Standard platform redistribution still uses actual licensed
VS/SDK terms and original Microsoft references. The24 top-level text omissions
have corresponding retained prior evidence, not an invented license grant.
Actual recipient transfer, relink/installation and distribution-specific review
remain pending. Historical modified-CRT obligations stay with old artifacts and
do not block this new pair after matching link evidence excludes them.
