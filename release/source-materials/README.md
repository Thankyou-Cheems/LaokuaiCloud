# Native source recovery

This is private recovery preparation for native source dbaf04531024f4201e73ec0bc5ba6a7a6d8d3b49 and the unchanged Windows no-Npcap core/CLI. It does not authorize public product source disclosure, a native run, or a new application release.

The external `native-source-materials` archive contains 1277 exact preferred source files, 865 original checksum-pinned registry crates, 1108 locked-version index records, five dependency Git bundles, both required C-source submodule bundles, original WinDivert 2.2.2 source, VC-LTL/YY-Thunks preferred source and exact original link-input archives, Rust 1.95.0 library source and original notices. The private Git branch retains small manifests, bundles, review records and the restoration tool; large crate/runtime/source archives are not imported into Git.

Use a new dedicated destination outside the material directory:

```powershell
node release/source-materials/restore-native-source.cjs C:/dedicated/native-source-materials C:/dedicated/native-restore --verify-only
node release/source-materials/restore-native-source.cjs C:/dedicated/native-source-materials C:/dedicated/native-restore --metadata
```

The tool verifies every source/archive/index checksum before copying, creates only its dedicated Cargo home and source checkouts, restores pinned submodules, and uses offline locked Cargo metadata when requested. It does not download, build, execute build scripts, install dependencies, run native code or write an owner's cache. It requires Git, Node and an already installed Rust 1.95.0 toolchain for `--metadata`. The raw local metadata output stays outside Git because it contains local paths. Source equivalence was independently checked across all 886 normalized package/feature/dependency/license nodes. The metadata test is not a native rebuild or successful LGPL relink.

The 865 archives cover workspace manifests needed for this fixed graph, not every inactive lockfile package or hypothetical new feature. The original 506-package active native inventory remains a historical receipt; this companion does not silently change its source or licenses. Native preferred source omits only the unrelated contributor runtime `.env`. Its VCS database is not included. The existing fixed runtime version remains `2.7.0-laokuai`; the unused upstream build-version macro has an existing Cargo-version fallback. A future rebuild must record its actual version/provenance and hashes rather than promise byte-identical reproduction.

Build prerequisites are an appropriately licensed Visual Studio 2022 C++ x64 toolchain/Windows SDK, Rust 1.95.0 with x86_64-pc-windows-msvc target, CMake, and protoc. Exact MSVC/SDK/CMake/protoc subversions are not asserted here without a separate build receipt. Do not redistribute proprietary compiler/SDK installations. Extract the exact VC-LTL 5.2.2 7z and YY-Thunks 1.1.7 object ZIP using a trusted archive tool. Set `VC_LTL` to its `VC-LTL-5.2.2` directory and `YY_THUNKS` to `YY-Thunks-1.1.7`. Their selected paths are `TargetPlatform/6.0.6000.0/lib/x64` and `objs/x64/YY_Thunks_for_Win7.obj`. Explicit paths are essential: Cargo `--offline` alone does not stop thunk-rs from invoking its download fallback.

`build-restored-native.ps1` records the original build command and is provided for a separately coordinated heavy build. Do not run it as part of source recovery. All 17 approved no-default features and static CRT flags are preserved. Any rebuilt native package needs fresh exact core/CLI hashes, normal/delay PE imports, feature/functionality tests, resource manifest and effective notices; native runtime and TUN acceptance are separate.

The unchanged WinDivert SYS matches the official 2.2.2 binary exactly; its tagged source differs from the separately pinned user-mode vendor C source. Both identities are retained. Driver rebuilding, signing and installation were not performed. Wintun's original prebuilt exception and its notice remain in the existing native legal inputs.

Before any recipient/public source export, pin a dedicated export recipe that preserves all corresponding product/native/dependency source, build instructions and notices while excluding non-corresponding host-specific trial/snapshot guards, historical unlinked Packet.dll/Packet.lib, real profiles, credentials and raw local logs. Do not expose private integration Git history as a public source companion. Actual recipient access, installation information and relink acceptance remain open.
