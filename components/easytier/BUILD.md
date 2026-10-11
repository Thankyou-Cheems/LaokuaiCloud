# Parent-scheduled isolated native build inputs

This records build inputs; task-6 did not invoke cargo/rustc or execute the core.
ET-OWNERSHIP-001 is resolved in the reviewed create-only source contract. Native
acceptance and payload approval remain pending actual build/Windows evidence. The
parent authorized the capacity owner to begin an isolated artifact build now. Only the parent-designated capacity owner takes the heavy slot.

Current frozen native input: `dbaf04531024f4201e73ec0bc5ba6a7a6d8d3b49`, tree `e58f64a219c204cdaf364fc95466cf03acfb7c21`, branch
`codex/laokuai-et-compat`. Full-source bundle SHA256:
`71c09f9ba90cb87dcc3eb3d828477c21d5761a74c0fd049f965fa90b54d8425e`.
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
`e3ee41507e7a8ef94470b70f4639140e67aadae646ada82dfd23b0beeb0e7fb2`.
Pinned rust-tun revision is `12378839e7985283df0e4fb536b7137230356db5`.
Native C/C++ dependencies include ring/zstd/kcp/thunk. Full cached dependency
availability is unverified. Owner full offline metadata found missing ab_glyph 0.2.32. The parent now authorizes
normal official-registry fetches of the exact locked dependencies. Do not change
the lock, versions or feature policy to bypass missing inputs.

Provide an explicit existing `PROTOC` binary and record its hash/version. The
easytier-proto build script otherwise falls back to downloading protobuf
`v26.0-rc1/protoc-26.0-rc-1-win64.zip`. A read-only PATH binary was found with
SHA256 `9a4fe52db00facbf858dc5af9addb50b551429004044e8a24f137de38c5b209f`;
its version/compatibility was not executed or accepted. CMake is present; required
native tools and cached inputs must be checked by the build owner.

In the fresh native clone, set CARGO_TARGET_DIR to that owner's isolated output
directory, set PROTOC explicitly, then the proposed core-only command is:

`cargo +1.95.0 build --locked --release -p easytier --bin easytier-core --target x86_64-pc-windows-msvc -j 1`

Record exact HEAD/tree, Cargo.lock, toolchain/target/features/flags, dependency inputs,
exit status and executable SHA256 in a build receipt. Do not launch the executable,
core --version, CLI, helper, driver, TUN or product. Compilation alone cannot prove actual coexistence/cleanup or approve activation.
Record fresh executable/build hashes for dbaf0453; never reuse older artifacts.
The root source bundles are immutable; use laokuai-owned-create-full-source.bundle
from the owned-create owner delivery, never compile a moving feature tree.
