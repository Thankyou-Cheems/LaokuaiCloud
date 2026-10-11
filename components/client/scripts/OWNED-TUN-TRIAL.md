# Frozen no-peer TUN coexistence candidate — activation pending

The 65-second stop-request design is implemented in the independent runner with a persistent selective readonly PowerShell reader and a separate Node observation worker. The supervisor owns native startup/stop and never decodes or compares full snapshots. Scope schema 4 is `2392f12f7284d982a1a3b6e179c7becbe294449e519f7832a090aadbeb99bd5b`; it pins 15 runner/observer/collector/adapter sources plus the fixed payload and documents. Both prior native approvals were consumed before core/TUN start. This source/readonly work does not authorize the next native attempt.

Default invocation and `--check` only print scope/hash, with no adapter load, OS observation, copy/config, port reservation, elevation or native launch. Pure checks include `check-owned-tun-trial.mjs`, `check-owned-tun-observer.mjs`, `check-owned-tun-snapshot.mjs`, `check-owned-tun-semantics.mjs` and the mocked production adapter suite. The [observation design](OWNED-TUN-NEXT-TEST-PLAN.md) explains retained coverage and limitations; the [investigation](OWNED-TUN-SNAPSHOT-DIAGNOSIS.md) preserves historical failures.

Only after one fresh original-human confirmation of this frozen commit/scope, run once under the separately approved administrator token in this independent checkout:

```powershell
node scripts/run-owned-tun-trial.mjs --execute --approved-scope-sha256 2392f12f7284d982a1a3b6e179c7becbe294449e519f7832a090aadbeb99bd5b
```

The runner never elevates itself. Its exact-argument gate rejects all older hashes and extra config/profile/server arguments. Preflight conflict, unavailable evidence or source/payload mismatch prevents launch; do not change scope, install a driver, retry native startup or delete residues to make it pass. Administrator readonly benchmarking is a separate authorized operation and loads no ET adapter/native code.

## Fixed four-file payload

All inputs are from C:\Users\cheb2\Documents\Codex\2026-10-10\task-2\et-windows-build-no-npcap\delivery.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| easytier-core.exe | 20107264 | d4f100ace0ae50b5270af10f579a2ccf7b2991731f05b82920eefba60055d49a |
| easytier-cli.exe | 6050816 | b84fa350b9c8036649df3cdc8ee728c364ea81075d82fd3783cdeede3b9ddccd |
| wintun.dll | 427552 | e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce |
| WinDivert64.sys | 94144 | 8da085332782708d8767bcace5327a6ec7283c17cfb85e40b03cd2323a90ddc2 |

BUILD-DELIVERY.json SHA-256 is 2dbb3bb8f67c600fbf48b34e25a8fb3e56a57d58b3bfaa2432eca5ac706c51cf; PE-IMPORT-AUDIT.json SHA-256 is 7eb78be98d262f56dce1e398ed46924d4362ed2d4b23217f9efa22a78b1174a4. Both final PEs passed actual normal/delay imports, dumpbin and ASCII/UTF-16 identifier audits. The runner verifies all four sizes/hashes, exact receipts and pinned source/tree/patch/lock/17-feature profile before staging and again before core start; it does not substitute a Cargo graph claim for binary evidence.

No Packet.dll/wpcap.dll is copied. No Npcap service read, installed/running requirement, install or enable action exists. Only core executes: CLI and WinDivert64.sys are copied as package companions, but CLI is never invoked and enable_udp_broadcast_relay=false prevents broadcast/WinDivert activation. The 17-feature product retains ordinary TCP/UDP/QUIC, TCP hole punching and the Windows broadcast backend; FakeTCP and the pnet enumeration fallback are unavailable. Primary enumeration failure must stay visible. Static preservation is not a full-equivalence/gameplay acceptance claim.

The isolated run includes [native notices](../release/EASYTIER-NOTICES.md), the final four-input inventory and five byte-preserved license texts (EasyTier LGPL/GPL, rust-tun WTFPL, Wintun signed-binary terms, WinDivert license), pinned before staging/start, plus exact build/audit receipts. Public distribution remains separate: the build owner's active 506-package inventory has 25 missing cached top-level license texts; corresponding/relinkable source and distribution-specific review remain pending. The fixed delivery directory includes the final source ZIP and license inventory. This local trial does not publish or clear those release duties.


## Frozen scope and observation

Prepare one fresh ignored `.laokuai-tun-trial/<run>` directory and a synthetic no-peer config with a new instance UUID. No real profile/credential, peers, ET listeners, STUN, UPnP, DNS acceptance, exit/proxy/forward route, game/voice/community join or broadcast relay is used. Only core executes; companion CLI and WinDivert files are copied but never activated.

Create exactly one Wintun adapter `lk_trial_20261011_a`, `10.253.253.1/30`, with permitted on-link/host/multicast routes. Protect existing GUI PID/creation identity 6424 and NIC GUID `4226cc04-7343-4caa-bfd6-55d097487583` / `10.126.126.2/24`; preserve all existing interfaces' selected IP/route/ordered-DNS data and GUID/LUID/index/state, IPv4/IPv6 defaults, full firewall rules/profiles/seven associated filter groups and existing NetworkList categories.

Preflight requires exactly one existing Wintun package, `DriverVer = 10/13/2021,0.14.0.0`, SYS SHA-256 `1a7bb3555c5419befb1a5f54267dcae9a7af16749ddf4eef9b431fcf0b863110`, already Running. There is no explicit install/update/uninstall helper or firewall/category/global-policy write. Wintun CreateAdapter internally checks installation and may perform implicit driver maintenance; existing-package checks do not guarantee otherwise. Windows may maintain device records for the new NIC. This remains a disclosed activation risk.

RPC is only `127.0.0.1:15897`, whitelist `127.0.0.1/32`, without Windows user authentication; other local users can access it during the trial. Foreign/non-loopback RPC ownership, forbidden owned TCP/UDP sockets, broad routes, extra interfaces, driver change or old-network/identity drift fails and requests immediate owned stop.

Two complete preflight observations are each bounded by 40 seconds; preparation is bounded by 5 seconds. The persistent light reader warms concurrently with the prepared full preflight. Before startup the main supervisor arms its **65-second stop-request timer**, then allows at most 10 seconds for startup/readiness. After receipt GUID/LUID/ifIndex matches OS, collect exactly one full during snapshot while checking light state alongside it. One light read may be in flight, at most 5 seconds/read with 1 second pause after completion. After full validation, allow at most 10 seconds to join an existing light read and obtain a fresh passing one. Stop immediately when evidence completes; do not keep core alive just to consume the allowance. Full acquisition/decode/save/compare is bounded by the supervisor's 40-second stage timer even if the observation worker is stuck. Early failure, signal, core exit or timeout stops sooner. No missing check can be suppressed into success.

Stop first writes `LAOKUAI_OWNED_STOP_V1`/EOF; 4 seconds later force termination may target only the stored owned ChildProcess handle; after 6 seconds report graceful/forced/unconfirmed cleanup. **65 seconds bounds the stop request, not guaranteed exit/NIC disappearance.** An unconfirmed child remains owned for reporting. No process-name scan, foreign/old-GUI kill, reused-PID kill, driver uninstall or residue deletion occurs.

Post-stop observation uses `OwnedPid=0`, so sockets of a new process reusing the former number are never attributed to ET. GUID/alias/any RPC owner detect residue. Require two consecutive clean selective samples within 15 seconds, followed by one complete global post snapshot within 40 seconds. Even settling failure still attempts the final full snapshot and preserves its evidence; failure remains failure. ACK alone is not residue proof. Success requires complete before/prepared/during/after comparisons, receipt-matched readiness, a fresh light sample, exactly one graceful cleanup report and no interface/RPC residue.

Worker closure has a separate 6-second confirmation limit. Phase budget is 213 seconds plus up to 6 seconds observation-worker closure (219 seconds), excluding human UAC response and unavailable filesystem/scheduler confirmation. Timing limits are failure deadlines, not guarantees of OS progress.

The worker writes every parsed safe snapshot (including incomplete/error/late-cancel inputs) before validation/comparison and each field comparison before policy rejection. If no parseable snapshot exists, retain bounded output size/digest and structured diagnostics; never invent a snapshot. Disk write failure fails closed. Light inputs, diagnostics, request failures and final outcomes also persist under ignored `.laokuai-tun-diagnostics/<run>`. Explicit configuration semantics preserve all previous fields, firewall rule/filter association and multiplicity; DNS order stays material. Dynamic/temporary rules remain included. String equality tokens/gzip bounds stay unchanged; only required private virtual IPs are printed, and unexpected interface addresses are redacted. Arbitrary stderr, physical endpoints and credentials are not logged.

Readonly timings and final scope are recorded in `et-main-delivery/no-npcap-trial/observer-wiring-20261011`; they exercise the actual worker/collectors but no trial NIC. Native coexistence/teardown remains unverified. Collection is sequential sampling, not an atomic or continuous zero-change/zero-packet-loss guarantee. No gameplay, voice/SFU, community routing, broadcast, authenticated user mapping, physical-direct or dynamic multi-instance acceptance claim follows. Production remains gated; no next TUN activation has been performed.