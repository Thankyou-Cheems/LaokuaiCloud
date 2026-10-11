# Windows service-manager encoding dependency review

This is an integrated ordinary source change for the next native rebuild, not a
change to the frozen dbaf/83/5d executables or their effective notices.

The normal dependency chain is `easytier -> service-manager 0.8.0`
(Git `5eb28f7a686858eea4f4933534ed989d3b71dc2a`) -> default feature `encoding`
-> `encoding-utils 0.1.0` -> `codepage 0.1.3`. It is not exclusively a tool or
test dependency. service-manager's feature also requests `encoding_rs`, which
remains needed elsewhere in the Windows graph.

At that pinned source, `src/utils.rs` has two cfg-separated `wrap_output`
implementations. Only the encoding implementation includes its private decoding
module, and only that module references `encoding_utils` on Windows. It probes
ACP when decoding command output. The no-feature implementation instead uses
UTF-8 lossy command-error text. The trait/context/status/label types and Win32
service APIs are not feature-gated by `encoding`.

Product `easytier/src/service_manager/mod.rs:53` constructs the existing local
`win_service_manager::WinServiceManager` on Windows. Its install/update/start/
stop/status calls use windows-service and Win32 SCM, not service-manager's
sc.exe/WinSW command-output adapters. The common
`ServiceManagerKind::native()` at line 76 still probes the WinSW executable
availability using `which`/path existence; pinned `winsw.rs:327` does not execute
or decode output in that probe. The local Win32 implementation is unchanged.
Non-Windows construction still uses the existing typed adapters.

The complete product source was searched for service-manager/encoding-utils
calls. No direct encoding-utils call or construction of Sc/WinSW adapters was
found in the Windows product service flow. This is static call-path evidence,
not a successful compiled or real service test. A future build may compile
other unused public service-manager adapters; their command-error fallback text
differs without this feature. We have not deleted the crate or its API.

Minimal diff: one Cargo.toml, move the original pinned service-manager
declaration into cfg(not(windows)) unchanged, and add cfg(windows) with
`default-features = false`. No dependency versions, Git commits, Cargo.lock,
service Rust source, 17 native features, AGC/bitrate or runtime configuration
changed. The original prepared patch remains byte-identical and is now applied
to the unique integration source.

Actual locked/offline Windows normal+build cargo trees pass:506 ->504, with
only encoding-utils0.1.0 and codepage0.1.3 removed and nothing added. The inverted
Windows feature tree confirms service-manager features=[] at the same Git pin.
Cargo metadata restores886 workspace packages/865 registry packages and the
unchanged lock; its workspace-union default/encoding feature labels are not
the platform build graph. See the integrated check JSON for both identities.

The non-Windows default declaration is preserved and Cargo parses both target
declarations. An attempted offline Linux active tree stopped before completion
because the Windows custody does not contain iana-time-zone0.1.65.crate. This
failure is preserved and Linux tree/build acceptance is not claimed. No public
download or dependency upgrade was used to hide that gap.

Next parent-coordinated heavy build must compile both Windows core/CLI, inspect
the actual feature fingerprints and linked inputs, refresh exact output hashes,
PE imports and effective BOM, and run relevant service functionality checks in
its separately authorized environment. Current frozen binaries retain the old
author-notice question; a source-only removal cannot waive it.

References: pinned service-manager source is retained in its private source
bundle; [Cargo tree](https://doc.rust-lang.org/cargo/commands/cargo-tree.html) and
[Cargo metadata](https://doc.rust-lang.org/cargo/commands/cargo-metadata.html)
define the recorded graph commands.
