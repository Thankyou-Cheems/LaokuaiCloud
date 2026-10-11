# Exact recipient rebuild and release work

The internal app candidate is freeze84292bf / native source089b6182. Its portable
is129121178 bytes, SHA2563cff0c00f1a8441e98af909424081d4b74be08e9aba44d745eaa80d0f0062619.
Task6 independently rehashed298 sealed owner files. Owner run2 passed hidden
empty-profile/offline bootstrap; run1 remains observations-only because of the
monitor's unknown exit row. No core/CLI/driver, actual call or NSIS wrapper ran.
This candidate is complete; do not request another UI/package build merely to
close the separate source-material question.

## What the existing source kit already proves

`screened-recipient-source-materials-private-draft.zip` SHA256
`bad7e5e4b3a666d63876eaa5910cf6e3aaafc927330521682adb5a80267c6205`
contains1262 unchanged native files,865 original crate archives,7 current Git
source snapshots and944 index files. It excludes15 historical prebuilt assets,
including6 Packet DLL/LIB files. Exact offline source restoration and the504
target graph passed.1129 lock-record versions/checksums are unchanged; six Git
transports relocate to verified local paths. It now passed one fresh-target offline modified-library core/CLI compile/link
with the corrected helper described below. The original helper attempt failed;
its failure is preserved. This engineering proof does not establish external
recipient delivery or runtime acceptance. The earlier producer used the
full1277-file archive/private companion and already compiled successfully.

The old `build-modern-native.ps1` expects a different1277-file receipt/lock and
must not be applied to this kit. This follow-up supplies a dedicated
`verify-recipient-build-input.cjs` and `build-screened-recipient-native.ps1`.
They do not alter the native product tree, candidate or old source ZIP. Supply
both beside the existing tools and modern-recipient metadata in the extracted
kit. The verification helper rejects drift, prebuilt reinsertion, altered
versions/checksums and an existing target.

## Completed engineering validation and retained recipient recipe

The assigned builder completed the corrected run in1288.6058461666 seconds
(exit0), after an original-helper failure in12.1583468914 seconds (exit1).
See [the exact result](RECIPIENT-RELINK-RESULT.md). No further build is requested.
The frozen tools ZIP24879c3a retains the original helper. Before any separately
authorized future recipient build, supply the fixed helper supplement
SHA25687d32e98f56009e36932593159aa181940e38839a22cba97a459e401a92e1782
(3461 bytes), or this private commit's exact helper. Verify original helper
SHA256d735e365db413bb2600cd5ee92a9df1d5e8c6a582721c9870a490e8e72242503
and fixed helper
SHA256f9e9e459e93917d392f5780e01c6ce0ca99dd0807c59ac1f8c1c94a24373c78a.
Replace only the extracted tools/build-screened-recipient-native.ps1; do not
reapply to fixed bytes or silently accept other versions. Retain old sealed ZIPs
and failed/successful targets. The following is a recipient recipe, not a new
execution authorization. Use a fresh extracted kit and fresh restoration,
without private Git, producer Cargo cache or the old companion. Install tools
lawfully: Windows10/11 x64, VS2022 x64 development environment with
MSVC14.44.35207 and Windows SDK10.0.26100.0, Rust1.95.0 MSVC target,
Node24.10.0, CMake4.4.4 and protoc36.0. Pin protoc executable SHA256
`9a4fe52db00facbf858dc5af9addb50b551429004044e8a24f137de38c5b209f`.
These generally available tools are separate prerequisites, not files copied
from the producer's proprietary installed libraries. No VC-LTL/YY inputs.

From extracted MATERIALS, restore and prepare in a dedicated fresh directory:

```powershell
node tools/restore-screened-recipient-source.cjs . C:/dedicated/recipient-native-1
node tools/verify-recipient-build-input.cjs C:/dedicated/recipient-native-1 --check
```

From an initialized VS2022 x64 shell, run within the parent's hidden,
BelowNormal, two-CPU Job, with one Cargo/build job and owned-child cleanup:

```powershell
& ./tools/build-screened-recipient-native.ps1 `
  -RestoredDirectory C:/dedicated/recipient-native-1 `
  -ProtocExecutable C:/dedicated/protoc.exe `
  -ModifiedLibraryProbe
```

The test-only edit changes exactly the LGPL EasyTier library's
`easytier/src/common/constants.rs` version string to
`2.7.0-laokuai-recipient-relink-probe-1`. Both core and CLI link this constant.
It exercises a modified library in a single fresh compile/link of both bins;
there is no need for a second expensive unmodified baseline build. Source,
original/relocated lock,17 features,+crt-static and empty thunk/service feature
checks precede compilation. Offline build is exactly:

```text
cargo +1.95.0 build --locked --offline --release -p easytier
  --bin easytier-core --bin easytier-cli --target x86_64-pc-windows-msvc
  --no-default-features --features <the pinned17-feature list> -j1
```

Pass evidence: fresh kit/archive hashes; actual tool versions and licensed
installation provenance;1260 unchanged native files plus the one recorded
version edit and one transport-only Cargo.lock; saved original lock and six transport-only changes;504 target
packages and empty thunk/service features; exit0; both AMD64 EXE/PDB hashes and
matching GUID/age; marker present in both binaries; normal/delay import and
actual final linker/PDB input audit with no Packet/Npcap/pnet/
encoding-utils/codepage/VC-LTL/YY inputs (encoding_rs remains retained). Preserve all failures. Do not assert byte-identical output: the version
is deliberately changed and paths/tool details can affect reproducibility.
No executable launch, TUN, network, driver, microphone, account, UI/package
rebuild or deployment is part of this validation. The compile/link receipt can
close `screened material supports recipient modified-library rebuilding`.
It does not prove that a real external recipient has received anything.

## Release obligations: separate, concrete delivery work

The following are requirements of the intended distribution arrangement to
review against the exact licenses; a successful internal test is evidence, not
a replacement for supplying source/rights/notices. A special native runtime
acceptance or a requirement that every recipient actually rebuild is not added
by these license texts.

| Item | Already held | Concrete next action / completion evidence |
| --- | --- | --- |
| EasyTier/native LGPL/GPL corresponding source and relink form |1262 preferred files, exact dependencies,504 BOM,324 original text units, prior24 supplemental cases | Attach the kit plus fixed build/install instructions to the intended binary delivery; choose a permitted source-delivery method. Record actual recipient-access/download test against the supplied artifact SHA, not access to our PRIVATE repo. The corrected-helper modified-library compile/link passed; include that receipt and corrected instructions. Retain modification notices and GPL/LGPL texts. |
| Modified binary installation information | Source and hash-pinned loader are available in PRIVATE integration checkout | Document standalone rebuilt core/CLI placement and prerequisites. Bundled app enforces exact native profile/receipt/hash identity; a drop-in changed EXE is rejected. For an app-integrated modified version, also provide permitted client loader/build source and instructions to update the local receipt/profile/asset pins and rebuild, without changing production permissions or using our secrets. Determine whether GPL6 installation-information conditions apply to the intended delivery; no bypass test/TUN is required here. |
| Full app/Voice AGPL preferred source | Exact app/SDK/native source in private Git and build-source archive; licenses retained | Prepare an export specifically for the delivered app and SDK commit, including preferred TS/Rust/C++ source, helper and build scripts, lock/package pins, SDK preferred source, notices and required third-party source routes. Screen history/private materials. The native-only kit does not supply client/Voice source. The existing3554-file private archive includes historical Packet assets and is not the approved public export. For network use covered by AGPL13, retain the appropriate source-access offer. |
| Source acquisition versus producer caches |865 native crates and7 Git source snapshots included | Native source kit is designed for offline build once external tools are installed. Full-app source export must specify locked Yarn/Electron/helper input acquisition or supply lawfully redistributable caches. Fully offline app rebuild is not a universal licensing requirement; accessible dependencies and working build scripts still need an executable acquisition recipe. |
| Standard MSVC/SDK runtime terms | Matching standard-static link evidence,17 installed inputs and official redist references | Record the actual producer's licensed tool edition/terms and match selected static libraries to applicable VS/SDK redistribution lists. Supply required notices. No generic request for an extra Microsoft grant, and no recurrence of historical VC-LTL/YY source work for this modern pair. Installation signatures/cache-only trust do not establish the applicable grant. |
| Signed Wintun0.14.1 | Exact unmodified signed DLL and its distinct prebuilt-binary license | Verify the application uses the permitted API, retains notices and redistributes the unmodified DLL alongside such software under the included exception. Do not characterize the signed DLL as blanket GPL2 or redistribute it as an unrelated standalone asset. |
| WinDivert2.2.2 / modified TUN | Exact SYS, LGPL3-or-GPL2 original notices, Rust/C source references and retained WTFPL2 TUN source | Fix the chosen applicable WinDivert licensing route and source-access artifact/URL for the exact driver release; retain original notices. Include the modified vendored TUN source. Driver signing/runtime operation is a separate acceptance issue. |
| Exact release inventory | Internal package141 files, current source and native BOM, SDK/RNN/Signalsmith notices | Audit the final exported app's Electron/Chromium,JS/native/helper inventory against the actual141-file payload and dependency lock; retain notices/source routes as each license requires. This is not another audio or UI fixture. |

References: [LGPL3 sections0/4](https://spdx.org/licenses/LGPL-3.0-only.html),
[GPL3 sections1/6](https://spdx.org/licenses/GPL-3.0-only.html),
[AGPL3 sections6/13](https://spdx.org/licenses/AGPL-3.0-only.html),
[official Wintun signed-binary distinction](https://www.wintun.net/),
[Microsoft redistribution guidance](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files?view=msvc-170).
Use the project's included original texts for actual variant/version decisions.
No legal clearance or public export is inferred from metadata alone.

## Product acceptance / authorization, independent of licensing

New payload TUN scope/human approval is blocked by the parent-reported reviewer
rejection; old schema6/a071/dbaf approvals cannot run the new pair. Actual
Windows function/coexistence/cleanup remains untested. Actual login, device,
bidirectional listening,game load,20 complete SDKs/FEC and NSIS wrapper remain
separate tests for parent scheduling. They are not tests required to establish
the source kit's compile/link suitability. No new native/app permission is
requested or executed by this material follow-up. ready=false/finalPackage=null.
