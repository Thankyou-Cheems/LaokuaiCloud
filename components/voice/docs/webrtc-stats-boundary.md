# Raw WebRTC stats boundary (read-only investigation)

Public entry: `useSFU().getPeerConnection?.()` (`src/webrtc/types/SFU.ts`, `src/webrtc/hooks/useSFU.ts:getPeerConnection`) returns the current native/browser peer or null. Call its `getStats()` directly. `src/engine.ts` exports `useSFU` through `webrtc/index.ts`; both web and native roots reach the same hook. No new server summary or UI is added here.

The connected peer is the local client's SFU peer. Stats do not establish another participant's client-to-SFU network RTT. Retain direction, id, SSRC, codecId, transportId, remoteId/localId and a local connection generation. Multiple streams and screen audio can coexist; never take the last audio object as the user's microphone. Use the actual microphone sender/receiver track or MID mapping when available, and mark identity ambiguous if it cannot be established. Reconnect, replacement, missing IDs, changed SSRC or decreasing counters reset delta baselines.

The following field meanings are from the [W3C WebRTC stats specification](https://www.w3.org/TR/webrtc-stats/):

| Object | Scope and optional fields |
| --- | --- |
| inbound-rtp | Local receive stream. `packetsReceived`, `packetsLost` are cumulative; loss may be negative. `jitter` is seconds. `jitterBufferDelay` is cumulative seconds; divide its delta by emitted-count delta for interval buffering. |
| outbound-rtp | Local sent stream. `packetsSent`/`bytesSent` count transmission, not speech. Loss/jitter of reception belong to its associated remote-inbound report. |
| remote-inbound-rtp | Remote RTCP reception report for local outbound SSRC; `localId` associates it. `roundTripTime` is seconds and can be absent before valid feedback. `fractionLost` describes reported interval fraction. |
| candidate-pair | ICE transport. `currentRoundTripTime` is latest STUN-check RTT in seconds, not media playout. Prefer transport's `selectedCandidatePairId` to guessed nomination. |

Missing fields remain unavailable, never synthetic zero. RTP statistics, ICE RTT and receive buffering must retain their distinct direction/scope. RTT/2 is an estimate requiring symmetric paths, not measured one-way latency. Packet growth cannot prove audible speech or remote hearing. These conclusions apply to whichever measurements the implementation actually provides, not a guarantee that every browser/native release emits every field.

Frozen source limitation: `src/audio/hooks/useVoiceLatency.ts:poll` overwrites scalar inbound/outbound fields while iterating all audio entries. It has one byte and one jitter-buffer baseline for all entries, does not associate remote-inbound reports, and selects succeeded/nominated candidate pairs rather than a transport link. Its scalar last-entry summary cannot be used as raw per-user/direction evidence. It also calls its RTT/2 result `oneWayNetworkMs`; the contract is estimated, and its totals omit other-client/server/decoder/playout paths. This read-only task does not change that legacy helper.

Native source verification: `src/platform/native.ts:createPeerConnection` casts `react-native-webrtc` to the DOM peer interface; this does not strengthen runtime field guarantees. Installed v124 `src/RTCPeerConnection.ts:631-646` implements full `getStats()` as `new Map(JSON.parse(data))`; its declaration returns `Promise<any>`. Android `PeerConnectionObserver.java:235` forwards native `getStats`, and `StringUtils.java:23+` serializes native type/id/members with timestamp microseconds divided by 1000. iOS `WebRTCModule+RTCPeerConnection.m:360,570+` forwards statistics and JSON serializes actual values. Native missing fields are native/libwebrtc capabilities, not a Voice synthesis opportunity. Actual device stats have not been gathered in this task.

Suggested client read contract: one batch keyed by local connection generation and collection time, carrying raw objects grouped by `type` with each original `id` and optional fields. `unavailable`/empty is distinct from a zero metric. Preserve native/browser runtime values, validate finite numeric fields before presentation, and derive intervals only between same-object positive-time samples. Reading or displaying transport addressing is unnecessary for the requested loss/jitter/RTT contract. No authenticated identities, credentials, user profile or active call was accessed for this investigation.
