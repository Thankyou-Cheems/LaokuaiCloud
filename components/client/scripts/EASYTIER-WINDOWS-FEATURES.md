# Windows build without Npcap, retaining normal game networking

Update: capacity owner compiled both exact binaries and passed actual normal/delay import, dumpbin and byte-identifier audits. Core SHA-256 is d4f100ace0ae50b5270af10f579a2ccf7b2991731f05b82920eefba60055d49a; CLI SHA-256 is b84fa350b9c8036649df3cdc8ee728c364ea81075d82fd3783cdeede3b9ddccd. Both were rehashed read-only here. The profile and final input inventory record this evidence. No execution or full behavioral equivalence is claimed. The recipe below is reproducibility documentation; do not start another build.

Use the frozen `dbaf04531024f4201e73ec0bc5ba6a7a6d8d3b49` source, Rust 1.95.0 and unchanged lock SHA in `easytier-windows-feature-profile.json`. No Rust/network-stack patch or lock change is required. This profile removes only `faketcp` from the native package's official default features, rather than silently removing other protocols or broadcast support.

Exact completed capacity-owner build recipe (this owner did not compile or execute it):

```powershell
$env:RUSTFLAGS = '-C target-feature=+crt-static'
cargo +1.95.0 build --locked --offline --release -p easytier --bin easytier-core --bin easytier-cli --target x86_64-pc-windows-msvc --no-default-features --features 'cli,wireguard,websocket,smoltcp,tun,socks5,kcp,quic,magic-dns,zstd,upnp,icmp-proxy,management,endpoint-discovery,extended-services,linux-netlink,tcp-hole-punch' -j 1
```

Existing build environment/credentials/cache policy still applies. A missing locked dependency is a build-owner issue; do not update versions/lock or fetch a different source. Parent schedules one compiler; do not launch another build here. The capacity-owner build and actual PE audits are complete; runtime behavior acceptance is pending.

Evidence from the exact frozen source:

- `easytier/Cargo.toml`: `pnet_datalink` is optional and is enabled only by `faketcp = ["dep:flume", "dep:pnet_datalink", "dep:smoltcp", "easytier-proto/faketcp"]`. Both historical core and CLI PE imports included `packet.dll`; that DLL's metadata is Npcap 1.79.
- `easytier/src/socket/mod.rs`, `socket/tcp.rs`, `host_runtime.rs`, `instance/listeners.rs` and `tunnel/mod.rs` gate FakeTCP implementations/factory schemes by `cfg(feature="faketcp")`. Ordinary TCP and UDP are separate transport paths; `tcp-hole-punch` is retained. The profile also retains WireGuard, QUIC/KCP, WebSocket, DHCP, UPnP, endpoint discovery, compression and the other default capabilities.
- `easytier/src/common/network.rs:312,350,362`: the primary interface enumeration is `network_interface::NetworkInterface::show()`. The pnet fallback after a primary enumeration error is under the FakeTCP cfg. Losing that fallback is a real secondary difference; disclose enumeration failure instead of fabricating interface success.
- `easytier/src/instance/virtual_nic.rs:887` and `windows_udp_broadcast/capture_windivert.rs:163`: Windows UDP broadcast capture is independent of FakeTCP. It tries the constrained WinDivert sniff backend, then falls back to a raw socket. Do not remove this path or claim raw fallback is equally reliable for every game. The existing broadcast flags and loopback/broadcast fix remain.
- A direct Rust 1.95 Cargo `tree --locked --offline -p easytier --target x86_64-pc-windows-msvc --no-default-features --features <above> -e normal` succeeded: zero active `pnet_datalink/pnet_sys`; retained `network-interface 2.0.5`, owned patched `tun-easytier 1.1.1`, and pinned `windivert/windivert-sys`. `Cargo.lock` SHA remained unchanged. An inverse pnet query correctly reported that package absent from the active graph; no compiler, ET executable or network fixture ran.

The minimum protocol-only alternative `cli,tun,tcp-hole-punch` would remove more transports/services than the approved default behavior; it is not the recommended product profile. Do not silently substitute it or rewrite `faketcp://` configurations to another scheme. The no-Npcap profile must transparently reject an explicitly FakeTCP-dependent configuration; a user with that requirement needs a separately evaluated supported build. Existing real configurations were not read or changed here.

Both binaries have been rebuilt; this requirement remains for future reproductions: retaining the official CLI would retain its mandatory Packet.dll dependency even if the new core is clean. Audit their normal and delay PE imports statically after compilation, pin both new hashes, and update the release-owned runtime manifest/file inventory together. Do not include Npcap Packet.dll in the resulting product bundle just because the old five-file inventory contained it. No fake/replacement DLL is acceptable.

This preserves the Windows WinDivert broadcast backend, so a complete game-broadcast package still has Wintun plus WinDivert driver capability. There is no official feature switch in this exact source to remove WinDivert while retaining that same backend: the dependency is unconditional for Windows x86/x64. A Wintun-only runtime can use the already-existing raw-socket fallback in some cases, but claiming full equivalence would require evidence we do not have. Source does not justify advertising only Wintun while keeping all broadcast promises.

The old candidate/scope is superseded. The runner now pins the final four files and build/import receipts, copies notices/licenses, has no Npcap precondition, and requires current human approval of its new scope before any native/TUN/UAC action. It runs only the core and keeps CLI execution and WinDivert broadcast activation off for the no-peer trial. Wintun internal driver API checks and local unauthenticated loopback RPC remain disclosed; consult OWNED-TUN-TRIAL.md. No approval or native activation has occurred.
