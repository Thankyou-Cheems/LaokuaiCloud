# Frozen native CRT units and remaining source scope

This review applies to the unchanged core `d4f100ace0ae50b5270af10f579a2ccf7b2991731f05b82920eefba60055d49a` and CLI `b84fa350b9c8036649df3cdc8ee728c364ea81075d82fd3783cdeede3b9ddccd`. Their matching PDB identities are retained in `encoding-utils-build-evidence.json`. No compiler, linker or native executable was run for this review.

The new `native-crt-unit-correspondence.json` examines all PDB DBI section-contribution records and C13 SHA256 source checksums. The earlier first-contribution receipt remains unchanged. Positive sections establish participation; an entry without a positive section does not establish complete exclusion after compiler/linker optimizations.

| Exact binary | VC-LTL entries | Positive implementation-code entries | Positive data-only entries | System import records | Entries with no positive section |
| --- | ---: | ---: | ---: | ---: | ---: |
| core | 52 | 33 | 3 | 3 | 13 |
| CLI | 35 | 19 | 2 | 3 | 11 |

Twenty-four implementation files match fixed VC-LTL source commit `19f302fcf2b4dfb05f86405dbf58437b0ee4166a` after only LF-to-CRLF checkout conversion. Archive SHA256 is `557f4647faf5498fdbba8ae0d3d321182717a65f97a5b5aaa1ec87d4a1e42337`. This includes upstream UCRT/VCRuntime implementation files and project adapters. Exact per-object source/checksum correspondence is in the JSON receipt; basename similarity alone was not accepted.

Twelve positively contributing implementation files remain missing from that archive and the specifically checked installed SDK/MSVC source directories: `_fenvutils.cpp`, `_norm.c`, `_scale.c`, `_test.cpp`, `_unscale.c`, `_values.c`, `cbrt.c`, `fegetenv.cpp`, `feholdexcept.c`, `fesetenv.cpp`, `round.c`, and `softmemtag.cpp`. Their compiled SHA256 checksums, objects and binaries are recorded. We did not copy proprietary installed SDK source into Git.

The fixed `Tools/6.0.6000.0/x64/Build_libucrt_shared.cmd` copies Windows SDK 10.0.19041.0 `libucrt.lib`, removes selected members and retains Microsoft math/FENV objects. `Tools/VCRuntime/x64/LibInfo.props` extracts `softmemtag.obj` from MSVC `vcruntime.lib`. These original recipes explain the object origins; they do not establish the precise producing SDK/VC release or a new distribution grant.

The original root EPL-2.0 text, embedded Microsoft SDK license and original SDK third-party RTF are preserved. Microsoft headers remain Microsoft-origin inputs; the project root EPL notice alone does not establish their distribution permission. No affirmative secondary grant outside the generic EPL template was found. The SDK notice list does not establish that every library mentioned in it was linked.

The SDK license's own REDIST link was followed to the [official Microsoft Windows SDK redistribution page](https://learn.microsoft.com/en-us/legal/windows-sdk/redist). The fixed response SHA256 is `b68b0992d384930e19530cf4a61dc25c8d7f61b231cb5762a91546af467b36c9` (38,643 bytes); its original HTML and redirect receipt are retained. The page lists static libraries under the SDK `Lib/<version>/ucrt/x64` directory for unmodified use built into a program, subject to the licensed SDK and its terms. The directory coverage question is therefore resolved. This current official page does not by itself clear modified/reassembled VC-LTL libraries, redistribution of Microsoft implementation source, or the SDK license's excluded-license restriction. It also does not identify the historical producer's exact VC grant.

Positive CRT code/data, emitted import thunks and `YY_Thunks_for_Win7.obj` are runtime inputs. MSVC/compiler/linker, SDK tools, CMake, protoc, library assembly tools, VC-LTL build props/scripts and the `thunk-rs` build-script implementation are build tools. A tool's emitted runtime objects retain their own obligations. OS-provided `msvcrt.dll` and API DLLs remain imports; they are not copied into the product.

Concrete materials still needed are the twelve checksum-matching sources and their producing SDK/VC release identity, the permitted modified-CRT/source distribution scope, and an intended-recipient rebuild/relink result with lawfully obtained SDK/runtime inputs. The private custody archive supplies reproducibility inputs, not a permission grant to redistribute raw Microsoft LIBs or compiler installations.

The current Windows-only service dependency change removes `encoding-utils` from the next target graph; the frozen old binaries still contain the old graph. That change does not remove or clear the CRT units described here.

Parent decision after this review: retain the current Windows 7 VC-LTL compatibility target while resolving the specific source/grant scope, or commission a reviewed modern-Windows standard-runtime configuration. The latter changes OS compatibility/deployment and requires a coordinated build and regression review; it is not an automatic legal clearance. No compatibility target was changed here. Public distribution, recipient-source acceptance and final release remain false.
