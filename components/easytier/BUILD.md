# Parent-scheduled isolated native build inputs

This records build inputs; task-6 did not invoke cargo/rustc or execute the core.
Native acceptance and payload approval remain blocked by ET-OWNERSHIP-001. The
parent may schedule an isolated syntax/artifact build, or request the native-owner
fix first. Only the parent-designated capacity owner takes the heavy slot.

Current frozen native input: `1a44fb98e2429b050d69f36a1fee47eadf26caf5`, tree `c589da1a2049a6bc6e78996fcf0909e40f307bcb`, branch
`codex/laokuai-et-compat`. Full-source bundle SHA256:
`825130c4064acca5cf15f01f9774d4aa8ad678516c3c3491d1457175c9129e58`.
Use a fresh owned clone of that bundle with `core.autocrlf=false`; freeze HEAD
and verify raw Git blobs. The root import is `components/easytier/source`, with
the contributor runtime .env excluded; the delivered standalone source bundle is
the exact native build authority. Never compile or mutate another owner's tree.

Cargo.toml requires Rust **1.95**, edition 2024; rust-toolchain.toml requests 1.95.
The default 1.94 toolchain is insufficient. Read-only directory checks found a
locally installed `1.95.0-x86_64-pc-windows-msvc` toolchain; its executables and
dependency cache were not tested. Target: `x86_64-pc-windows-msvc`. Use the VS x64
MSVC/Windows SDK environment (cl/link are absent from this task's ordinary PATH).
Keep source .cargo/config.toml `-C target-feature=+crt-static` and default features.

Cargo.lock SHA256:
`3f605207a2e29b1ebf24d3e032ab65f00ae3c93d489fa983164c4d3e995dfe70`.
Pinned rust-tun revision is `12378839e7985283df0e4fb536b7137230356db5`.
Native C/C++ dependencies include ring/zstd/kcp/thunk. Full cached dependency
availability is unverified. Do not relax the lock or alter feature policy to hide
an offline dependency failure; report the missing input for parent coordination.

Provide an explicit existing `PROTOC` binary and record its hash/version. The
easytier-proto build script otherwise falls back to downloading protobuf
`v26.0-rc1/protoc-26.0-rc-1-win64.zip`. A read-only PATH binary was found with
SHA256 `9a4fe52db00facbf858dc5af9addb50b551429004044e8a24f137de38c5b209f`;
its version/compatibility was not executed or accepted. CMake is present; required
native tools and cached inputs must be checked by the build owner.

In the fresh native clone, set CARGO_TARGET_DIR to that owner's isolated output
directory, set PROTOC explicitly, then the proposed core-only command is:

`cargo +1.95.0 build --locked --offline --release -p easytier --bin easytier-core --target x86_64-pc-windows-msvc -j 1`

Record exact HEAD/tree, Cargo.lock, toolchain/target/features/flags, dependency inputs,
exit status and executable SHA256 in a build receipt. Do not launch the executable,
core --version, CLI, helper, driver, TUN or product. Compilation alone cannot clear
the ownership finding, prove cleanup or approve activation. A new reviewed owner
fix requires a new source/patch pin and fresh build; never reuse old artifact hashes.
