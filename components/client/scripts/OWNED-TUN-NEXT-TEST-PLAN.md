# Minimal no-peer coexistence observation — implemented candidate

Before/after full snapshots plus during-run lightweight checks cannot replace a during-run global snapshot while retaining the current global configuration claim. They miss firewall/default-route/DNS/category/other-interface changes that occur while core is alive and restore before the final snapshot. The 65-second candidate now retains one complete global observation after readiness and before stop, with selective light observations alongside it. Source wiring and readonly verification are authorized; native activation is pending. See [frozen scope and executable behavior](OWNED-TUN-TRIAL.md).

## Evidence and one proposed budget

The two repaired administrator readonly samples took 27,604 and 27,621 ms; both were complete and equal. Their combined 55,612 ms wall time minus 55,225 ms read time left 387 ms for the observed persistence/decoding/validation/comparison work. This is measured evidence, not a future latency guarantee. With a 10-second readiness allowance and a fresh 5-second light read, even the measured full read requires 42.621 seconds. The current 30-second window is structurally too small for a reliably complete run.

Propose **one 65-second stop-request deadline**, armed before native startup. Stop earlier as soon as evidence is complete or any safety check fails. The allowance is 10 seconds readiness + 40 seconds full during read + 10 seconds to finish an existing light read and obtain a fresh one + 2 seconds persist/compare = 62 seconds, leaving 3 seconds margin. There is no native retry. The readiness and light timing have not been measured with a live trial NIC; 40 seconds remains a provisional full-read limit, including possible query contention.

| Phase | Maximum | Required result |
| --- | ---: | --- |
| Complete baseline | 40 s | Full safe input saved; every preflight invariant available |
| Prepare/hash synthetic inputs | 5 s | Frozen payload/config, no real profile or native start |
| Complete prepared baseline | 40 s | Same global configuration, old identity/state intact |
| Start/readiness/during observation | 65 s | One full during sample, light safety samples, fresh final sample; independent stop request |
| Owned stop confirmation | 6 s | Graceful ACK and stored-child exit; force only that handle after 4 s |
| Post-stop lightweight settling | 15 s | Two consecutive clean samples, at most 5 s/read, with 1 s pause |
| Complete post-stop snapshot | 40 s | Full old-state comparison and no added interface/RPC residue |
| Final persistence | 2 s | Durable evidence and explicit result |
| Observation worker closure | 6 s | Confirm readonly operations drained or fail |
| Conservative total, excluding UAC response | **219 s** | About 3 min 39 s; can finish earlier |

65 seconds bounds the stop request, not guaranteed process exit or NIC disappearance. By 71 seconds after startup begins the supervisor must report confirmation or unconfirmed cleanup; a stuck child may still be alive. ACK is not residue proof. The 15-second settling interval avoids racing a full snapshot's adapter lookup/LUID conversion against asynchronous adapter removal. Its two-clean requirement fits two 5-second reads plus a 1-second pause with 4 seconds margin. Missing, late or inconsistent evidence fails; it never converts to success by dropping checks. Do not spend an additional full retry after the 40-second final limit.

## Coverage

| Observation | Required coverage | Remaining limit |
| --- | --- | --- |
| Full baseline/prepared/during/post | Existing selected configuration semantics: all old NIC IP/route/DNS, IPv4/IPv6 defaults, rules/profiles and all seven linked firewall filter groups, existing NetworkList categories, driver identity/state, old GUI creation identity and all old NIC GUID/LUID/index/state; trial conflicts/new NIC count/receipt and sockets | Collection is sequential, not an atomic or continuous global transaction |
| Selective light during/settling | Stored-child exit state/creation identity; receipt GUID/LUID/ifIndex matched to OS; owned alias/IP/prefix/allowed routes and absence of defaults; protected old GUI and old NIC identity/state/IP; RPC loopback binding and owner; forbidden owned TCP/UDP socket count; cheap driver running-state check if available | Cannot replace complete firewall/default-route/all-old-NIC/DNS/category evidence |
| Full during validity | Read starts only after receipt/OS readiness; owned child remains alive throughout collection; full input persisted before validation; every configuration/state check passes | One sample may miss a change between query times or between samples |
| After stop | Confirm stored-child exit first, settle, then full comparison and owned GUID/alias/port residue checks | After exit, PID numbers can be reused: never attribute a new process's sockets to the former owned numeric PID |

Only one selective light read may be in flight; pause 1 second after it finishes. This is not a guaranteed 1 Hz sampling rate. A single full during read may run alongside that selective read, so provider contention must be included in readonly benchmarking. Save every full safe snapshot, every comparison and light result metadata on both pass and failure. Do not log endpoint IPs, secrets or arbitrary native output. Existing full selected fields and association/duplicate/order semantics remain unchanged; counters/lifetimes are not silently substituted for configuration.

## Stop independence and activation boundary

The supervisor arms its timer before startup and owns the exact native ChildProcess handle as soon as it is spawned. Snapshot subprocess waits and bulk JSON decoding/persistence/comparison run in `owned-tun-observer-worker.mjs`. `owned-tun-observation-run.mjs` requests owned stop immediately on deadline/early failure, then cancels readers without awaiting their completion. The persistent PowerShell child is a readonly observer; it is not an ET/native helper. Retain the native 4/6-second stored-handle cleanup protocol. Never enumerate/attach/kill by process name or reused PID; never touch the old GUI, foreign ET, shared driver, global routes/firewall or residue by deletion.

The original pure planning model and eight checks remain historical budget/coverage evidence. The executable supervisor has its own fake-clock tests, and a pure JS worker CPU-stall test verifies the main stop callback runs before that worker finishes. Mocked production adapter tests verify exact stored-child stop/force handling and foreign-child preservation. Complete and incomplete read failures retain safe inputs/diagnostics. These tests do not prove native scheduling, OS teardown or coexistence.

The selective reader/worker are wired and hash-pinned in schema 4. Actual administrator readonly benchmarking includes complete global snapshots, persistent warmup, repeated warm queries alongside a full query and post-query clean checks; receipts are retained in the owning investigation. No live trial NIC is present, so extra live-NIC route/UDP/creation-time cost and native readiness remain provisional. A future run needs one fresh original-human confirmation of the frozen commit/scope, including the 65-second stop request and 15+40-second post-stop limits. Neither consumed native approvals nor readonly approval covers activation. This document requests no activation. Four-file payload, no-peer configuration, driver maintenance risk and local RPC exposure stay disclosed.

This plan can establish sampled no-peer NIC coexistence/start/owned-stop evidence only. It cannot establish zero traffic, continuous LAN packet preservation, gameplay, voice/SFU behavior, physical directness or authenticated user-to-peer mapping, broadcast delivery, community network membership or dynamic multi-instance management. Production remains gated until its separate implementation/acceptance work is satisfied.
