# Existing community IPC: local ET observation contract

The main implementation now reads the owned instance through the existing CLI/RPC path. It does not start another core/provider or query a user's existing ET GUI. `EasyTierCommunityState.localDetails` is optional for older clients and otherwise an acquired snapshot or `null`; `getState` and `onState` retain their existing signatures. The stable scope is `{serverId, instanceId, generation}`, never a room ID. This adds no member authentication, voice selection or media-path proof.

The production adapter runs one bounded read-only child with arguments `--rpc-portal <owned-loopback> --instance-id <owned-UUID> --verbose --output json route list`. Calls share one in-flight read for that core, and receive separate copies. The 2-second timeout/1-MiB output limit, abort signals and owned-child bookkeeping apply. Completion after stop/disconnect cannot publish into that generation. Startup readiness still uses `node info`; instance ID must match for both commands. Raw stdout, NodeInfo.config TOML, physical endpoints, names, public addresses and native errors stay out of IPC/logs.

Exact source evidence is the frozen `dbaf04531024f4201e73ec0bc5ba6a7a6d8d3b49` tree (upstream `8b7f1f0196edb5b580829ed5f135050fb5853478`): `easytier/src/easytier-cli.rs` declares RouteListData and handle_route_list. Verbose output returns `{node_info, peer_routes}`; ordinary table JSON lacks the peer/connection fields. One requested instance returns the direct result; multiple instances wrap it in a list, which this adapter rejects. `easytier-core/src/management/instance_rpc/mod.rs` sets NodeInfo.inst_id to the queried instance; projection.rs places config.dump() into NodeInfo.config, so that entire field is discarded. `easytier-proto/proto/api_instance.proto` defines the peer/connection/route IDs and fields consumed here. No native source/API changes are needed for acquisition.

| IPC field | Meaning and boundary |
| --- | --- |
| localPeerId / private virtualIp | Observer's own instance facts, not account identity |
| routes | Destination peer, private virtual IP, ordinary and latency-first next-hop/cost candidates; no selected packet-forwarding claim |
| peers / connections | Matching local-to-remote peer IDs, normalized connection UUID, reported closure/tunnel type/default connection/direct list; reportedDirect alone proves no full physical path |
| acquisitionStartedAtUnixMs / acquiredAtUnixMs | Actual bounded CLI acquisition window, not RTT measurement time; oldest field can be from start |
| maxAgeMs | At most 5000 ms, expires from acquisition start; main verifies monotonic and UTC clocks |
| latencyFirst | null: this read does not parse the secret-bearing config to discover the active policy |
| memberBinding / rttMs | `unavailable` / null: no authenticated user-to-peer binding or independently timestamped measurement |
| missingEvidence | Explicit required binding, policy, forwarding, RTT-time, next-hop-role and full-path evidence |

Task6's sole existing Provider can consume `state.localDetails ?? null` for a local network details view. Use its existing TTL tick: reject a mismatched stable community scope, clock reversal, and `Date.now() - acquisitionStartedAtUnixMs > maxAgeMs`. Drop it as soon as phase leaves connected. Never turn these peer IDs into member IDs or make a media decision from them. The production `bindings` list remains empty and `lanSnapshot` remains null until the separate authenticated provider supplies valid evidence. No duplicate Provider or renderer module is added here.

Pure verification: `node scripts/check-community-easytier-network.mjs` covers real-shaped nonempty graphs, raw-data stripping, schema/instance/identity/size rejection, policy/RTT unknowns, oldest-time expiry, scope/clock checks, single-flight/copy isolation, cancellation, failed acquisition and late session/core close. Existing lifecycle tests cover reference counting and generation cancellation; production fake-port tests and strict no-emit types continue to pass. No CLI/core, permission token, helper, driver, real profile or network fixture ran.

Activation remains gated. The current asset adapter still pins the old official CLI and five-file inventory; it cannot represent the final no-Npcap package. After capacity owner supplies both new binaries and static normal/delay import evidence, release owner must update both binary hashes, the product manifest and four-file inventory together before activating this path. Do not bypass that step or pass an old CLI as if it were the rebuilt companion.
