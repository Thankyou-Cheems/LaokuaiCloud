# Windows build without Npcap, retaining normal game networking

Use the frozen `dbaf04531024f4201e73ec0bc5ba6a7a6d8d3b49` source, Rust 1.95.0 and unchanged lock SHA in `easytier-windows-feature-profile.json`. No Rust/network-stack patch or lock change is required. This profile removes only `faketcp` from the native package's official default features, rather than silently removing other protocols or broadcast support.

Capacity/build owner can run this single Cargo build (this owner did not run it):

```powershell
$env:RUSTFLAGS = '-C target-feature=+crt-static'
cargo +1.95.0 build --locked --offline --release -p easytier --bin easytier-core --bin easytier-cli --target x86_64-pc-windows-msvc --no-default-features --features 'cli,wireguard,websocket,smoltcp,tun,socks5,kcp,quic,magic-dns,zstd,upnp,icmp-proxy,management,endpoint-discovery,extended-services,linux-netlink,tcp-hole-punch' -j 1
```

Existing build environment/credentials/cache policy still applies. A missing locked dependency is a build-owner issue; do not update versions/lock or fetch a different source. Parent schedules one compiler; do not launch another build here. This is a source-backed build recipe with a passing locked/offline dependency graph, not a completed compilation claim.

Evidence from the exact frozen source:

- `easytier/Cargo.toml`: `pnet_datalink` is optional and is enabled only by `faketcp = ["dep:flume", "dep:pnet_datalink", "dep:smoltcp", "easytier-proto/faketcp"]`. Both the current core and CLI PE imports include `packet.dll`; that DLL's metadata is Npcap 1.79.
- `easytier/src/socket/mod.rs`, `socket/tcp.rs`, `host_runtime.rs`, `instance/listeners.rs` and `tunnel/mod.rs` gate FakeTCP implementations/factory schemes by `cfg(feature="faketcp")`. Ordinary TCP and UDP are separate transport paths; `tcp-hole-punch` is retained. The profile also retains WireGuard, QUIC/KCP, WebSocket, DHCP, UPnP, endpoint discovery, compression and the other default capabilities.
- `easytier/src/common/network.rs:312,350,362`: the primary interface enumeration is `network_interface::NetworkInterface::show()`. The pnet fallback after a primary enumeration error is under the FakeTCP cfg. Losing that fallback is a real secondary difference; disclose enumeration failure instead of fabricating interface success.
- `easytier/src/instance/virtual_nic.rs:887` and `windows_udp_broadcast/capture_windivert.rs:163`: Windows UDP broadcast capture is independent of FakeTCP. It tries the constrained WinDivert sniff backend, then falls back to a raw socket. Do not remove this path or claim raw fallback is equally reliable for every game. The existing broadcast flags and loopback/broadcast fix remain.
- A direct Rust 1.95 Cargo `tree --locked --offline -p easytier --target x86_64-pc-windows-msvc --no-default-features --features <above> -e normal` succeeded: zero active `pnet_datalink/pnet_sys`; retained `network-interface 2.0.5`, owned patched `tun-easytier 1.1.1`, and pinned `windivert/windivert-sys`. `Cargo.lock` SHA remained unchanged. An inverse pnet query correctly reported that package absent from the active graph; no compiler, ET executable or network fixture ran.

The minimum protocol-only alternative `cli,tun,tcp-hole-punch` would remove more transports/services than the approved default behavior; it is not the recommended product profile. Do not silently substitute it or rewrite `faketcp://` configurations to another scheme. The no-Npcap profile must transparently reject an explicitly FakeTCP-dependent configuration; a user with that requirement needs a separately evaluated supported build. Existing real configurations were not read or changed here.

Both binaries must be rebuilt: retaining the official CLI would retain its mandatory Packet.dll dependency even if the new core is clean. Audit their normal and delay PE imports statically after compilation, pin both new hashes, and update the release-owned runtime manifest/file inventory together. Do not include Npcap Packet.dll in the resulting product bundle just because the old five-file inventory contained it. No fake/replacement DLL is acceptable.

This preserves the Windows WinDivert broadcast backend, so a complete game-broadcast package still has Wintun plus WinDivert driver capability. There is no official feature switch in this exact source to remove WinDivert while retaining that same backend: the dependency is unconditional for Windows x86/x64. A Wintun-only runtime can use the already-existing raw-socket fallback in some cases, but claiming full equivalence would require evidence we do not have. Source does not justify advertising only Wintun while keeping all broadcast promises.

No activation or trial approval is requested now. The old Npcap-dependent runner is hard-suspended. After the final package, import audit, companion inventory, license/source delivery and actual side effects are fixed, update its scope/pins and seek one concrete activation approval.
