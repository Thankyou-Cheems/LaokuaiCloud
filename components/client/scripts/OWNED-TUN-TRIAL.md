# One current-user-approved no-peer TUN coexistence trial

The final no-Npcap candidate is fixed and statically audited. The runner is ready for **one new human approval**, not already approved or executed. Default invocation and --check only print scope/hash; they do not load the adapter, read OS state, copy inputs, create a config, reserve a port, elevate or launch a binary. The old approval hash is superseded.

```powershell
node scripts/run-owned-tun-trial.mjs --check
node scripts/check-owned-tun-trial.mjs
```

Only after current human approval of the complete scope below, run once under a user-approved administrator token from this independent client checkout:

```powershell
node scripts/run-owned-tun-trial.mjs --execute --approved-scope-sha256 c737fd450558cd0176356dc0e1dea3a086bf34a9042ed8e60cd89a6c15b47f20
```

The runner never elevates itself. The agent must wait for current confirmation before this command or any UAC/native/driver action. Any failed/conflicting preflight prevents launch; do not silently change scope or install/enable a driver to proceed.

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

## Approval scope

Prepare one fresh ignored .laokuai-tun-trial/<run> directory. The synthetic no-peer config has a new instance UUID and fixed test settings, no real network identity/credential or profile. No external peers, ET listeners, STUN, UPnP, DNS acceptance, exit node, proxy route, port forwarding, game/voice/community join or broadcast relay occurs. No user-supplied config/server/profile argument is accepted.

Create exactly one Wintun adapter lk_trial_20261011_a with 10.253.253.1/30 and only its permitted on-link/host/multicast routes. Preserve existing ET GUI PID/creation identity 6424, protected NIC GUID 4226cc04-7343-4caa-bfd6-55d097487583 / 10.126.126.2/24, old NIC route/IP/DNS fingerprints, IPv4/IPv6 defaults, full firewall fingerprints and existing NetworkList categories. Application code makes no firewall/category/global policy writes; Windows may maintain device records for the new adapter.

Wintun CreateAdapter internally performs driver-installation checks. Preflight requires exactly one existing driver package with DriverVer = 10/13/2021,0.14.0.0 and wintun.sys SHA-256 1a7bb3555c5419befb1a5f54267dcae9a7af16749ddf4eef9b431fcf0b863110, already Running. This supports expected reuse but does NOT guarantee absence of API-internal implicit driver maintenance. The runner performs no explicit install/update/uninstall helper action. This risk is part of the current approval scope.

Owned management listens only on 127.0.0.1:15897 with whitelist 127.0.0.1/32. It lacks Windows user authentication and is accessible by other local users during the trial. Alias/subnet/port conflicts or any unavailable preflight check prevent launch. Observed foreign RPC ownership, other owned TCP/UDP sockets, changed old network, wrong actual GUID/LUID/ifIndex, broad routes or extra adapters stop it. A scope hash does not authenticate RPC users.

## Deadline and exact-owned cleanup

The startup/running watchdog starts immediately before launch: at most 30 seconds including pending startup/read. Read-only preflight precedes that timer; each snapshot has a 10-second timeout. Failure, early exit, policy change or SIGINT/SIGTERM stops sooner. Stop writes LAOKUAI_OWNED_STOP_V1/EOF; after 4 seconds force termination may target ONLY the stored owned child, with unconfirmed exit reported after 6 seconds. Then a separate maximum 10-second read-only residual observation follows. No process-name scan/kill, old GUI stop, residual deletion or shared driver uninstall occurs.

ACK alone cannot prove adapter disappearance. Success requires ready receipt-matched NIC, preservation of old network, zero added adapter/RPC residue and graceful owned exit. Forced/unconfirmed cleanup, unavailable evidence, old-network change or residue is failure. Retain result.json with exact owned PID/GUID/LUID/ifIndex; do not blindly delete. An unconfirmed live child remains owned for reporting.

Output omits raw native stdout/stderr, physical endpoints and credentials; reports/test inputs stay in the ignored run directory. This checks only no-peer NIC coexistence/start/stop, not community routing, live gameplay, media path or uninterrupted packets; production remains gated.

18 pure checks cover scope/substitution rejection, final evidence/payload/notices gates, no Npcap dependency, broadcast-disabled config, driver conflicts, receipt matching, deadline/hangs/cancel/failures and bounded residual checks. PowerShell was AST/command inspected only. Static reads verified actual four files and seven notice/license artifacts; no core, CLI, driver, UAC or OS snapshot ran.
