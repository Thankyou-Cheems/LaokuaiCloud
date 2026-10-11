# Passive selected receive path contract

`ReceivePathObserver` is a web-only, local read-only SDK interface. It does not enable Hybrid, refresh authentication, create a PC/socket, capture a device, change an input/gain, request remote actions, or own borrowed media. Ordinary SFU receives work with Hybrid disabled and without a local publication. The host supplies its independent current authenticated account/server/socket/room binding and exact roster publication→source mapping. This is not a second client Provider.

```ts
const observer = new ReceivePathObserver({
  getSfu: () => currentSfuApi,
  getScope: () => currentAuthenticatedReceiveScope, // null immediately on auth/room retirement
  getBindings: () => currentMicrophoneBindings,
});
const unsubscribe = observer.subscribe(snapshot => translate(snapshot), { details: false });
observer.update(); // call synchronously on host scope/roster/selection updates
// On unmount: unsubscribe(); observer.dispose();
```

Exports: `ReceivePathObserver`, `ReceivePathObserverOptions`, `ReceivePathScope`, `ReceivePathBinding`, `ReceivePathSnapshot`, `ReceivePathRow`, `ReceiveDecodeWindow`, `ReceiveTransportMetrics`, `ReceiveTrackObservation`, `ReceiveSourceSelection`, `ReceivePathSelectionPort`. `useSFU().getConnectionEpoch()` returns the SDK-local identity of its actual current PC, or null; it neither parses a room token nor invents a server epoch. `BrowserHybridVoiceSession.getReceiveScope()` is a passive current authenticated room scope getter: null while unavailable, no refresh/probe on read.

## Lifetime and identities

`getScope()` returns `{source:'host-authenticated-connection', bindingId, serverId, roomId, localSessionId, canReceive}`. `bindingId` must change on account/auth/socket/room lifetime changes. Obtain it from independent host authentication/roster, never from observer output. No local microphone publication is required. `getBindings()` returns microphone participant/session/publication IDs plus the existing actual `StreamSources` entry. Remote session may be null if ordinary SFU roster cannot supply it; a consumer requiring a verified session must reject that row, not fill a placeholder. Screen/unknown roles, shared-source alias conflicts, different-source publication conflicts, retired controls and Hybrid identity/scope conflicts cannot produce usable proof.

Every snapshot includes `connectionEpoch`, independent `scope`, `readAtMs`, `sampledAtMs` and `clockDomain`. Verify `connectionEpoch === currentSfuApi.getConnectionEpoch()` and the independently captured actual PC reference before publishing into the client store. Do not create the current scope by copying evidence. A changed PC/object, account binding, room, session, publication, source, track object (even same track ID), raw selection revision or Hybrid opaque room token retires the observation key. A→B→A does not recover an old observation generation.

Snapshots are the full current receive view, not incremental deltas. Missing bindings clear their evidence; scope retirement yields an empty view. Each subscription has its own cancellation token, including identical callbacks registered with different details options.

Every row carries participant/session/publication, a local `sourceId`, exact selected `trackId`, original `selectionRevision`, original Hybrid `routeGeneration` (null for ordinary SFU), and positive local SDK-observer `receiveGeneration`/`selectionEpoch`. `observer.getSource(sourceId)` returns only the current valid borrowed source, or null, so the translator can compare object identity and `receiveCleanup` with its captured current binding. Never serialize that object. These local ordinal fences are not server generations; raw Hybrid revision may initially be -1. `hybridScope` preserves the actual authority's opaque roomGeneration string, instance and identities; ordinary SFU has no fabricated Hybrid scope.

`selected` describes the actual SDK edge, independently of media freshness: sfu/p2p/none, or null for an invalid binding. Selection source is sdk-sfu-source or sdk-hybrid-selected-edge. The source's passive Hybrid marker tracks its actual selected node; a disposed owner cannot be mistaken for normal SFU. Orderly verified return to SFU relinquishes that marker. Multiple live selection owners are rejected. Existing onSelection callbacks and retirement subscriptions remain.

## Decoded observation and metrics

All production timestamps use local `performance.now()` in the same page as the client translator, not Date.now, raw RTCStats.timestamp or a remote clock. Injected test clocks are explicitly labelled injected-local and must share the consumer's clock domain. `observedAtMs` is a report receipt time; readAtMs never refreshes proof. A decoded window is derived from two reports for exactly one audio inbound-rtp row matching the selected track ID and one receive generation. The first report is a baseline, never fresh proof. Positive packetsDelta **and** samplesDelta are required. `decodedFramesDelta` equals the actual totalSamplesReceived delta in PCM sample frames per channel, including concealed samples; it is not Opus packet frames, utterances, audible speech or a guessed samples/480 count. No RMS is used.

Windows crossing a selection/track/generation boundary are rejected until a new window starts at or after the new binding. Counters moving backwards, missing/ambiguous exact-track rows, gaps over3000ms, zero increments, stale reports over3000ms or ended/closed inputs are unavailable. Known zero deltas remain zero with fresh:false; absent/reset values remain null. The logical selection can remain known when media is unmeasured.

Details opt-in returns metrics for the **same exact selected edge**. Loss is the nonnegative packetsLost delta divided by received+lost deltas in that inbound window; signed loss-counter regression leaves loss unknown without inventing zero. It is the local receive leg: SFU→local or peer→local. SFU is not a remote participant's end-to-end path. RTT comes only from that inbound row's transportId→transport.selectedCandidatePairId→succeeded candidate-pair. No fallback to nominated/candidate lists. A new pair requires a new baseline; unchanged/missing responsesReceived yields RTT:null. A positive responsesReceived delta qualifies currentRoundTripTime in that local measurement window. Zero RTT/loss is retained only when actually measured; no decode increment means these window metrics remain null.

The only pair value exposed is its local opaque stats ID; no SDP, candidate object, address, port, ICE username, token or credentials are projected or logged. Metrics are local debugging/UI data, not presence protocol fields. Transport RTT is not a remote decoded/selected receipt. `sentToRemote` is always null: the current protocol has no such authenticated receipt. `physicalPath` is always unverified, even for selected P2P; this API cannot prove EasyTier's physical underlay or authorize screen media.

## Sampling and cleanup

Construction/getSnapshot/update never request stats or start a timer. `subscribe(listener,{details?:boolean})` immediately delivers current selection and registers only passive source/track retirement/selection listeners. While any subscriber exists it requests a snapshot at most once per1000ms; default rows omit metrics. Opening details uses the same sampler, not a second poll loop. Last unsubscribe cancels the timer/listeners and rejects stale in-flight writes. `sample()` is an explicit one-shot read, also limited to once per1000ms; `getSnapshot({details:true})` only reads stored evidence and advances local TTL. After dispose snapshots are empty; cleanup never stops tracks, closes PCs, disconnects sockets or disposes receive controls.

Ordinary SFU shares one PC stats flight for all routes. Existing SFU/peer monitors and the observer reuse single-flight reports; P2P observation borrows its existing media monitor's strict track evidence without an extra PC read. Existing media monitor rates/selection algorithms are unchanged. SFU post-restore checkpoint waits for any pre-ACK shared flight before requesting a new report, so passive sampling cannot weaken ACK→fresh-media restoration.

## Mapping to task-6 path Provider

Use the existing unique MemberVoiceMediaBridge/store. Capture its independently authenticated remote lease, validate epoch, scope and `getSource(sourceId)` identity, and invalidate that lease before accepting a changed receiveGeneration/selectionEpoch/track. Map sfu→sfu, p2p→peer, none→none; reject selected:null. Use sourceId as the local mediaRouteId, receiveGeneration as the positive local route fence and selectionEpoch as its positive local selection fence. Preserve raw SDK Hybrid routeGeneration/revision separately for diagnostics. This does not claim they are server-provided numbers.

Map fresh→usable only with decode.fresh and its positive decodedFramesDelta, window start/end, exact track and matching fences. Nonfresh is unavailable/unknown with a diagnostic code. Copy the actual measurement timestamps, never subscription/tick time as proof time. Supply ordinary authenticated-connection or real Hybrid authenticated-room scope from the independent host+current passive authority getter; retain opaque room token and use the existing client lifecycle epoch mapping. Receive-only stays valid without fabricated local publication.

Raw status is the SDK route status. queued/probing retain their existing SFU input, so they are not a confirmed switch; switching/recovering indicate transition. failed may mean failed fallback while a healthy selected P2P input remains: do not turn that into a claim of no audio. Preserve the diagnostic and actual selection/freshness separately. Confirm failed unavailable media only when the selected edge has no usable proof. For available stable selected input use stable receive evidence; the raw route warning can remain in details. Disable/release back to normal SFU resets observation fences but never changes manual/PTT/Squad/receive correction or its persistent cache.

Map selectedPairId only when present; never synthesize underlay evidence. metrics.scope is sfu-transport or peer-transport according to metricLeg. Loss window maps to packetsReceived/packetsLost/windowMs; RTT retains its source/window and measurement age. Missing RTT remains null. Send and full physical path remain absent. No client-owned getStats/RMS loop or additional media protocol is required.

Pure fake-PC checks cover ordinary SFU with Hybrid off, receive-only, actual adapter P2P/none/SFU edges, conflicting identity/aliases, new track/revision fences, stale flights, closed/replaced PC, auth/room/account changes, missing/reset/silent counters, selected-pair metrics, subscription retirement and the pre-ACK shared-flight boundary. Real SDK media/48-64 quality acceptance of this increment is pending the sole capacity owner's queue; Windows network tests remain paused.
