# Hybrid prototype boundary

Historical note: this document records the frozen simulation baseline at `310e740344e8b9a30361643537ea39020f9a33dd`. The newer network-source checkpoint is described in [hybrid-network.md](hybrid-network.md); its real network execution is paused and unverified. Claims below about absent adapters/events describe that earlier baseline.

This is an independent, local-only, adapter-driven **simulation prototype**. It does not change `useSFU`, install a network adapter, create an `RTCPeerConnection`, obtain capture, or enable P2P in the client. The normal SFU path remains the supported default. It is not a production feature, a bandwidth-saving claim, or a 20-user capacity certification.

The client currently has no server-minted pair connection IDs, authenticated same-room SDP/ICE relay, or per-pair SFU forwarding lease ACKs. Supply `authority: null` for that environment. Do not fabricate any of these capabilities to enable the prototype.

## Public contract

Exports: `HybridRouteController`, `HybridReceiveInput`, `HybridReceiveInputOptions` and the `Hybrid*` types in `src/webrtc/types/Hybrid.ts`. This separate experimental API is not wired into `VoiceConfigProvider` or the singleton hooks.

```ts
const routes = new HybridRouteController({
  authority: null, // Current client/server: authenticated pair protocol unavailable.
  getPublication: () => finalProtectedPublication,
  getReceivePort: participant => physicalReceivePorts.get(participant.participantId) ?? null,
  createPeer: createFutureAuthorizedPeer,
}, { enabled: true });
routes.getState().status; // "unsupported": SFU stays connected, no probing/gate calls.
```

Library default `enabled: false` reports `disabled`. Missing protocol capabilities report `unsupported` with `authenticated_pair_protocol_unavailable`. A network authority also needs a separate `allowNetwork: true`, otherwise `network_not_authorized`. This delivery never enables that option or runs a network adapter. `active` means the controller has a supported adapter, not that any route is P2P; inspect each route and `environment` separately. Simulation states and metrics identify themselves as simulation.

`reconcile(scope, participants)` accepts only already-authorized stable server instance, room generation, participant, session, and publication IDs. Never use display names. Both local send/receive permission and remote `canSendAudio` / `canReceiveAudio` must be true for this bidirectional prototype. Listen-only or unsupported participants retain normal SFU. Duplicate participant/session IDs and duplicate physical receive ports cannot start extra peers. Call `reconcile` on roster, physical port, protected publication generation/revision, permission, and server/room/session changes. The authority must synchronously emit invalidation on revocation/leave; polling `isCurrent` is a secondary guard, not a substitute for timely revocation.

`getPublication` must return the SDK's exact **final protected audio publication** and its acknowledged generation/revision. All peer senders borrow that one track/stream. A peer adapter must never call `getUserMedia`, clone an earlier capture stream, select raw microphone fallback, stop the borrowed track, or bypass user/admin/PTT/Squad protection. `publicationAcknowledged` is actual SDK publication evidence, not a requested UI flag. The prototype validates the live audio track, stream membership, generation, revision, and continued binding. It cannot inspect a dishonest adapter's graph.

`subscribe` emits the current state immediately and returns unsubscribe. Observer exceptions do not change routing. `routeGeneration` advances on replacement, fallback, and cancellation. `selectionRevision` advances on every confirmed input change. Both are controller-local counters, not durable server authority. The server-minted pair ID supplies the transaction namespace across controller recreation.

## Atomic receive ownership and identity

`HybridReceiveInput` wraps an **already connected, current physical SFU node** and its existing downstream node. It initially does nothing. It disconnects the previous input before connecting the next; there is one upstream connection after every successful operation. A failed disconnect never allows a second connection. A failed connect leaves a confirmed `none` selection. It never moves or recreates the analyser, receive DSP, manual gain, or mix bus, and never stops a media track.

The owner must provide `createCandidateNode` that creates a *disconnected* same-context node for the supplied P2P media. It must not choose a node that is already connected elsewhere to the downstream. The controller/port owns that sole upstream edge until orderly restoration or disposal. No other graph writer may reconnect the original input during that interval. The owner must dispose the port before its SDK stream entry is cleaned up. A stale physical entry is disconnected without restoring it; it cannot reconnect through a late async callback.

Use `onSelection(kind, actualTrackId, selectionRevision)` to bind the client's receiver identity. Rebind real `track.id` and receiver generation on P2P selection, SFU replacement, fallback, channel/session changes, and cleanup. Preserve the stable participant key for safe prior lookup, but clear old live measurements and reject old asynchronous cache writes. Do not reuse an old track ID because the manual/DSP nodes are unchanged. `none` clears the binding immediately. Route state and port callback are separate from normal receive-leveling graph state.

The DSP path and manual gain are unchanged in this prototype. No new real-time processing, RNNoise instance, PCM message loop, or audio buffering is introduced. Single-input operations can briefly disconnect; their audibility and real device latency remain untested.

## Switch and recovery

1. Obtain a server-minted pair lease with exact current scope and remote session. The server chooses the offer initiator to avoid glare. Create one adapter peer borrowing the final publication.
2. Obtain **local decoded audio** evidence (`decodedFrames > 0`, increasing positive media sequence, live track, matching stream, age <=500ms) and `peer.isReceiving(candidate)`. ICE-connected or a remote "ready" message is insufficient. Every adapter proof timestamp must use the injected controller clock's monotonic time base.
3. Request SFU forwarding pause for that remote publication to this local destination session. Validate all ACK fields, applied=true, and a nonexpired server pause lease. Recheck publication, physical port and P2P media immediately before selecting P2P. A false/stale/mismatched ACK cannot trigger selection.
4. Renew the server-owned pause lease while that peer continues to receive. `forwardingPaused` is true only while an exact ACK remains valid. False can mean missing/expired evidence; it is not proof of SFU packet counts. A failed renewal triggers restoration. Lease expiry is observable independently of the UI poll interval.
5. Fallback advances route generation and cancels old work. Request SFU forwarding ON, validate its actual applied ACK, then wait for decoded SFU media with `mediaSequence >` the baseline captured before restoration. Only then select SFU and close the peer. Healthy P2P can remain the one selected input during recovery. A failed/lost peer is detached immediately; recovery then reports silence/failed instead of playing two sources or claiming successful fallback.

Timeouts are bounded, cancelable, and observable. Probe timeout defaults 10s, switch timeout 5s, pause lease 10s, renewal <=one third of the lease. Timeout is a failure bound, never a substitute for fresh-media proof. A failed restore preserves a healthy selected P2P input, reports `failed`, and eventually clears pause evidence when its lease expires. There is no silent retry storm. Call `fallback(participantId)` to retry restoration.

Use `await restoreSfuAndDispose()` for an ordinary feature disable. It returns true only after every route restored SFU and the controller disposed. False means `sfu_restore_incomplete`; preserve the observable recovery state and require attention. `dispose()` is immediate fail-closed cleanup for leave, revoked membership, or teardown: it detaches selected direct inputs, closes peers, unsubscribes handlers, cancels timers, and requests best-effort forwarding restoration. It cannot assert that an unacknowledged server cleanup succeeded. The server independently restores forwarding on pair/session cleanup and pause-lease expiry. Dispose the physical port at the corresponding SDK-entry lifecycle boundary.

## Required future server/peer adapter

`HybridAuthority` is an explicit trust boundary, not implemented authentication. Before a network implementation is authorized, the server must implement and test all of the following:

- Authenticate the account/session and authorize both endpoints in the same active voice room, with current send/receive permissions and current source microphone publication. A participant cannot mint its own pair connection ID or pause forwarding to another destination.
- Mint one unique active pair connection lease, deterministic initiator, and server room/session generation. Reject retired connection IDs, cross-room identities, stale sessions and unauthorized relays. Revoke old pairs before issuing replacements; old release callbacks cannot affect a new pair.
- Relay only bounded, ordered SDP/ICE for that exact pair. The controller bounds SDP to 65536 characters, candidate text to 4096, strips extra body fields, checks scope/session/pair/sequence, and limits each pending signal queue to 64. The peer adapter must serialize negotiation and queue early ICE until its remote description is installed.
- Apply pause to the actual **SFU source-publication→destination-session forwarding gate**, not a local speaker mute. Return an ACK only when the forwarding gate has applied. Echo scope, pairConnectionId, source IDs, destination session, routeGeneration, operationId, enabled, pauseLeaseMs, applied and actual leaseRemainingMs.
- Compare-and-set transactions by active server pair ID and monotonic route generation/operation order. A restore must fence older pending pauses, including a pause arriving after its caller timed out. `pairConnectionId: null` is allowed only for authenticated forwarding-ON cleanup, which atomically revokes/fences old pause transactions for that source/destination. It can never authorize a pause. New pair leases get a new namespace; controller-local counters must not be trusted across recreation.
- Default forwarding ON; enforce a short server-owned pause lease and restore on expiry, disconnect, room/permission change or pair release. Server timers are independent of browser timers. Pair release is idempotent. Emit invalidation promptly so compliant SDKs close direct media on revoked permission; do not keep relaying after membership changes.
- Supply actual local decoded-media and fresh-SFU proof, not fabricated counters. Close only the peer connection, never the shared capture track. Apply the current authenticated channel/remote Opus cap to every new/replaced P2P sender; do not inherit legacy esports128 over an explicit low-bandwidth profile. Verify actual RTP and decoded media independently.

No wire event names or production server handlers are delivered here. Implementing this contract, especially the server transaction fencing and permission lifecycle, is a prerequisite to any network experiment. Current client/server must expose `unsupported` and retain SFU.

## 20-user admission and observability

Default maximum 19 peers per client, 2 concurrent probe jobs (including pair leasing/media readiness/initial switching), and at least 250ms between admissions. Options can reduce these limits; probes never exceed 19 concurrent peers. Extra roster entries remain SFU with `peer_limit`. FIFO queued probes do not create PCs until admitted. `setProbeAdmission(false, "cpu_budget" | "uplink_budget" | another diagnostic code)` stops new probes while existing SFU/direct media continue. The host must measure its real process/renderer/DSP load and available uplink and control this admission gate. No CPU threshold is inferred from mock execution speed.

`getState` exposes selected routes, PC count, probe count, queued count and rejected signals. `sampleMetrics` is single-flight, cached for 1s, with serial bounded reads. It returns measured-peer count, completeness, known payload/header bitrates, packet rate and nullable encoder timing deltas. First samples, missing values, counter resets and failures are unknown, not zero. Missing audio encoder timing does not become process CPU: `knownEncoderCpuSecondsPerSecond` remains null. `complete` requires all four deltas for every peer; inspect `reportingPeers` and each sample when comparing partial sums. Host CPU must be observed separately. Results include no SDP, ICE addresses, tokens, room secrets or media PCM.

A 20-person full mesh can involve 19 peers per client and 190 pair connections in the room. Admission pacing does not establish that this topology fits real CPU, uplink, downlink, TURN, latency or reliability budgets. This delivery only tests 19 simulated peers and deliberately reports actualPeerConnections=0. Real network authorization, adapters, per-pair forwarding counters, device load and perceptual tests remain pending. SFU remains the current product path.

## Evidence and references

`npm run check-hybrid` tests the actual controller and input-selector implementation with a deterministic clock, fake authenticated authority, fake media evidence and fake AudioNodes. The report explicitly labels all authority, decoded evidence, forwarding gates and peers as simulation. It covers unsupported/disabled, shared publication binding, strict/stale ACKs, late lease cleanup, replay/foreign/oversized signaling, bounded queues, timeout/renewal/restore failure, track/identity replacement, revocation, orderly/immediate dispose, single input on connection failure, 19-peer admission, and partial/reset metrics. It is not a mock that replaces the state machine being tested.

Standards references: [WebRTC API](https://www.w3.org/TR/webrtc/) and [WebRTC statistics](https://www.w3.org/TR/webrtc-stats/). These define the future adapter's peer/media/statistics primitives; they do not establish capacity or authenticity for this prototype.

The inherited Opus20 package is separately frozen at 5b9559cf. Its real SDK/Pion/TURN TCP evidence supplied by the client owner does not test this prototype. See delivery manifest/report for exact local artifacts, source commit, hashes and unchanged audio/codec source evidence. AGPL and all inherited third-party license notices are preserved.
