# Current corrective source review — accepted for isolated build

Reviewed native source `dbaf04531024f4201e73ec0bc5ba6a7a6d8d3b49`, tree `e58f64a219c204cdaf364fc95466cf03acfb7c21`.
Client fingerprint-only commit `1b29040ca9199f02cfe92c3f533d3d9e2120e55c`; cumulative
code patch SHA256 `eb30fab089422c82256a8c8db9cb7a15d3c41b8b972a05729f63ebfbac7e8cad`.
All six artifacts matched delivered sizes/hashes; 1,277 imported staged Git blobs
match the frozen bundle, excluding contributor .env. The lock retains every
version/dependency, replacing only the fixed TUN git source with a pinned local override.

ET-OWNERSHIP-001 is **resolved in the source contract**. VirtualNic sets create_only.
The vendored owned branch requires a GUID before DLL loading and directly calls
Adapter::create with no open callback/fallback. Failure returns immediately. The
created adapter LUID is converted by the OS to its actual GUID and compared before
address configuration or start_session; it does not trust the cached requested GUID.
Windows CompareStringOrdinal uses case-insensitive UTF-16 alias preflight. Preflight
is an early rejection; the create-only/pre-session verification is the ownership
contract. Legacy open behavior remains outside the product-owned branch. Five
compiled pure Rust tests were reported by the owner; task-6 independently passed
ten literal source contracts and 22 mocked adapter checks without native execution.

Isolated compilation is authorized for the capacity owner with Rust 1.95/MSVC.
Source review does not prove compilation, actual adapter coexistence, driver Drop,
cleanup or networking; payload approval/activation remain false. Host policy and
owned-stop code are unchanged, public ET relay configuration unchanged.

The historical review below applies to the preserved 1a44 checkpoint.

# Historical immutable compatibility review

Reviewed source: `1a44fb98e2429b050d69f36a1fee47eadf26caf5`, tree `c589da1a2049a6bc6e78996fcf0909e40f307bcb`.
Client delivery: `30d2fc24acd602322abca50d739142890d9de900`; rebased integration
patch SHA256 `f138a401c9d8949b65b7ce474fe035ae1f9e8955513366b18dcaf209272fe925`.
All eleven delivered artifact sizes and hashes matched the owner handoff.

## Historical ET-OWNERSHIP-001 — corrected by dbaf0453

The requirement is to avoid opening or changing an existing private ET adapter.
At [arch/windows.rs](source/easytier/src/arch/windows.rs#L565), alias preflight uses
case-sensitive `interface.name == name`. At
[virtual_nic.rs](source/easytier/src/instance/virtual_nic.rs#L536), preflight precedes
`tun::create(&config)?` (line 550); the requested GUID identity is checked only
afterward (line 552).

Cargo.lock pins rust-tun to `12378839e7985283df0e4fb536b7137230356db5`.
Its `src/platform/windows/device.rs` lines 54–57 first call
`wintun::Adapter::open(&wintun, tun_name)`, reusing an existing alias on success;
creation with the requested GUID occurs only if open fails. Line 77 starts its
session before returning to the caller. This exact pinned dependency was inspected
read-only from the local Cargo checkout. Therefore the fresh GUID/post-create
receipt does not make the operation create-only. Alias case variants and the
enumerate/create race remain unprotected. The source comment claiming rejection
before rust-tun can open an existing adapter overstates the guarantee.

The native owner should enforce a create-only ownership operation in the native
dependency path and reject existing aliases case-insensitively before any session
start. A preflight-only change still leaves the race. Deliver a new immutable source
commit, code patch and bundle; task-6 will review and update loader/provenance pins.
This is a static contract failure, not an observed real adapter incident. The
eight delivered literal source tests passing do not establish this guarantee.

## Contracts preserved in this checkpoint

Broad NetworkList profile/category and firewall mutations are inert under the
hardcoded externally-managed host policy; there is no runtime toggle enabling the
old broad behavior. TUN DHCP/NetBIOS registry writes are skipped on this path.
The owned stdin mode rejects daemon/default/directory/config-server/shared-stdin
configuration. Its bounded OS thread requests stop on the command, EOF or invalid
input, without a Tokio blocking-stdin shutdown lifetime. Serialized instance stop
cancels owned work and clears resources without deleting persistent configuration.
The stopped receipt follows stop; peer-controlled CLI presentation is disabled.
The executable reports downstream `2.7.0-laokuai`, preserving upstream identity.

Client shutdown uses only captured child handles, bounded receipt parsing and
idempotent drain. After 4 seconds it may kill the owned child; after 6 seconds it
retains uncertainty if closure is unconfirmed. Missing ACK/NIC evidence cannot be
reported as native cleanup success. Ordinary quit/updater install await drain;
session-end starts stop immediately but the OS deadline remains unverified.
Cleanup diagnostics stay in main and are never replayed as deletion authority.

Task-6's adapter/lifecycle/package guards and full app/desktop TypeScript checks
passed without core/CLI/helper execution. No real TUN, firewall, RPC, socket,
route cleanup, configuration conversion or existing-private-ET coexistence test
was performed here. Source and client integration are review checkpoints only.
