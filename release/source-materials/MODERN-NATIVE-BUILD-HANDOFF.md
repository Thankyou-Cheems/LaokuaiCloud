# Modern Windows native candidate build handoff

The parent selected standard static CRT for Windows 10/11. Source commit
`089b6182c603c8ab60044b673effe0cf614cc28a` removes only EasyTier's `win7`
thunk feature, retaining workspace `default-features=false`, the prior Windows
service-manager no-encoding fix, the unchanged lock and all 17 product features.
It does not substitute a `win10` compatibility feature. The target graph has
504 packages, thunk-rs features `[]` and service-manager features `[]`.
The pinned thunk implementation returns before VC-LTL/YY setup/downloads.

Preserve 817 and its source/material/evidence files. Its owner stopped before
compilation after the old restore helper timed out at 60s during first registry
unpack. No old native build occurred. The new helper uses a 600s timeout for each
restore/metadata/tree subprocess and requires a fresh destination. Do not retry
817 or replace its receipt. Task6 runs no compiler or native executable.

```powershell
# Exact new integration checkout; a dedicated new owner directory.
node release/source-materials/restore-modern-native-source.cjs C:/dedicated/materials C:/dedicated/modern-native --metadata
# Assigned sole heavy builder, VS2022 x64 developer shell, hidden/BelowNormal/2 CPU Job:
./release/source-materials/build-modern-native.ps1 -RestoredDirectory C:/dedicated/modern-native -ProtocExecutable C:/dedicated/protoc.exe
```

The immutable companion remains 201908868 bytes, SHA256
`6656e48e28b22b231aebc99ae5c4563b25ad0ecf5e3fc47ff29943eb119eec86`.
The helper first verifies/restores all 1277 baseline preferred-source files,
865 registry archives and seven Git/submodule bundles; then applies exactly one
final Cargo.toml overlay. Both historical fixes occupy that same file. It pins
Cargo.lock `e3ee41507e7a8ef94470b70f4639140e67aadae646ada82dfd23b0beeb0e7fb2`.
No downloads, global cache writes or build scripts occur during metadata.
Workspace metadata's aggregate `win7` from unrelated GUI/FFI is not a core/CLI
feature proof; the target-specific `-p easytier --edges normal,build` check is.

The build script clears inherited VC_LTL/YY_THUNKS and uses a fresh target,
Rust1.95.0, x86_64-pc-windows-msvc, `-C target-feature=+crt-static`, one job and
both core/CLI. It does not require the old compatibility binary archives.
Their bytes/notices and old PDB evidence stay historical. Record actual VS/SDK,
protoc, Rust and linker versions. Freeze EXE/PDB hashes; verify normal/delay
imports have no added non-system runtime DLL requirement; inspect matching
PDB/link inputs for zero VC-LTL libraries/YY-Thunks objects and real official
MSVC/SDK provenance. Build success alone does not prove these assertions.
No new core/CLI is staged into production by this handoff, and no TUN run is
approved. Current schema6/a071 UDP scope still pins the old dbaf/d4f payload;
a newly built payload requires its own exact reviewed scope and human approval.

Microsoft runtime references, checked 2026-10-11:
- [Visual C++ redistribution and licensing](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files?view=msvc-170): use the actual licensed Visual Studio product terms and REDIST list.
- [Official /MT static-runtime semantics](https://learn.microsoft.com/en-us/cpp/build/reference/md-mt-ld-use-run-time-library?view=msvc-170).
- [Windows SDK distributable static-library directories](https://learn.microsoft.com/en-us/legal/windows-sdk/redist); existing original reference/receipt and SDK notices remain retained.

The new candidate need not wait for missing modified VC-LTL implementation
sources if matching new link evidence confirms their absence. This does not
clear old binaries' license/source obligations, promise a smaller EXE, authorize
raw Microsoft library redistribution, or establish final recipient/public-release
acceptance. Supply the new source ZIP plus immutable dependency companion and
lawfully obtained standard platform tools; freeze all actual new outputs before
an independent build/functional review.

Official VS2022 REDIST list: https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution . Exact fetched original response hashes are retained in MICROSOFT-STANDARD-RUNTIME-REFERENCES.json; original HTML responses accompany the private handoff. They do not replace the actual licensed Build Tools terms.
