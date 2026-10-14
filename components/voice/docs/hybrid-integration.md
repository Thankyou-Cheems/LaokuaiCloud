# Voice-only host integration candidate

This increment repairs authenticated recovery ownership and control/media consistency. It is source- and pure-simulation-verified; real media retesting of this increment is pending. The previous integration.2 contained loopback runtime passed core media but reproduced persistent failed controller state after auth recovery despite healthy restored SFU PCM. Windows network fixtures remain paused. The stable voice package and all older frozen tarballs are unchanged. Default audio-only policy, send AGC and microphone codec settings are unchanged.

Web exports: `BrowserHybridVoiceSession`, `BrowserHybridVoiceOptions`, `BrowserHybridVoiceState`, `HybridReceivePortAdapter`, `HybridReceivePortOptions`. Engine/native exports remain compatible. No camera/screen API is added. Physical direct transport is always reported unverified; an EasyTier host candidate is not proof. This voice prototype does not authorize screen media or start EasyTier.

Network membership is a separate pending module: joining the server/community should acquire one server-scoped EasyTier owner handle; voice room changes must not recreate it, and leaving voice must not stop it. Only leaving that server/account or disposing the network owner releases its handle. This patch has no ET driver/core/RPC start/stop or credential issuance, and does not claim that behavior is already implemented. Room-authorized media pairing remains independent: LAN membership is not permission to hear another room. A future member panel needs independent network membership/local-to-peer route evidence and voice media selection; absent measured route evidence stays unknown.

Create one session for one current account/server/socket/channel/SFU-PC binding, supplying the existing authenticated socket and runtime token getter. Set both `enabled: true` and `allowNetwork: true` explicitly; defaults do not send network requests. `expectedRoomId` must match the SDK's current acknowledged room. `getSource(participant)` must return the exact current microphone publication alias, reject screen/conflicting/unknown owners, and enforce current server user/session/publication metadata. Call `update()` for changed sources/rosters; it is single-flight and also refreshes once per second while enabled/recovering. The server and SFU must separately opt in and implement the authenticated pair protocol; unsupported peers retain ordinary SFU.

`borrowHybridPublication()` initially requires the exact final publication ACK and current SFU sender track object. After admission, its physical stream/track identity generation remains stable across user mute, PTT and Squad gate revisions. Every peer uses that same gated track, never a second capture/DSP/raw fallback. Replacement stream/track, ended track, PC replacement or loss invalidates the binding. Sharing a track does not share Opus encoding across PeerConnections.

The receive adapter takes ownership of the existing source→analyser edge. Analyser, leveler, per-user manual gain and final bus stay intact. Current WebAudio handoffs prepare the new source muted, fade the old source out over 12 ms, then fade the new source in over 12 ms. The two independent encodings are not mixed throughout a call or time-aligned. Selection emits the actual target track object and monotonically increasing revision; optional `waitForSelection(revision)` confirms completion in audio time before forwarding changes or outgoing peer disposal. `none` and `receiveCleanup.subscribeRetirement` detach synchronously, including during a fade. The client registry retains participant/physical receiver identity across selections, increments live track generation and rejects stale measurements/prior callbacks. The persistent participant cache is not deleted or exchanged; a new live track resumes its validated stored prior. Live worklet measurement windows are invalidated on track change, not represented as continuous measurements of the old track.

PTT/mute/Squad control ACK revisions no longer retire stable peer media. Probe queues use shared session ordering, not each client's arbitrary roster arrival order; the five-controller ring fixture reproduced zero matching directions before this change and all 20 after it, with two probe slots. That is simulation, not five real users or capacity evidence.

Recovery always needs exact authenticated SFU restore ACK followed by a new post-ACK checkpoint and increasing track-scoped packet/decoded-sample evidence. Controller retirement hands a fenced recovery job to the session; lease expiry or timers alone cannot reconnect the input. Recovery reauthenticates the same instance/room/session/generation and permits receive-only restoration after publish permission loss. The companion server patch is required for that case. Deafen, lost membership/authentication, changed room/generation/PC and failed ACK remain closed/observable; no stale route is reconnected. A failed pre-selection job is retried with increasing operation generation, not a guessed success. `recovering` persists until verified completion.

Integration.3 retains a bounded old-pair release queue across auth invalidation. A current same-binding scope flushes that queue before new probes; a changed room/server/session discards its old jobs without sending cleanup into the new binding. Release ACKs share one per-pair/per-authority-generation flight and are idempotent. Only a known old pair's authenticated `hybrid_pair_stale` response permits an exact guarded unbound restore request; `hybrid_cleanup_conflict` remains an error. No server ownership/CAS check is weakened.

The restored SFU edge transfers back to the controller through `getSelection()` and `confirmRetiredSfuRecovery()`, including its actual track ID and revision. This clears the retired-port restore marker before reconciliation; it does not report a guessed selection or repeat an unbound cleanup over a live new pair. Probe admission remains closed until all pending old-pair jobs complete. Multi-remote reconciliation includes restored ports and excludes still-pending ports. A cleanup retry after verified selection preserves that selection and retries only retirement. Authentication/current-binding checks run again after fresh-media evidence, so a second revocation cannot reconnect an old ACK's input. Public additions are optional `HybridReceivePort.getSelection()`, adapter `getSelection()`, and the adapter's optional authorization fence argument; existing custom ports remain compatible.

Integration.2 incorporates the reviewed closed-PC cleanup fix once: only `removeTrack` is skipped when signalingState is closed. Registered references/timers, PC/WebSocket handlers, room notifications, receive controls/nodes/decoder and remote-track cleanup still run; non-closed remove failures remain logged. Final local publication tracks are not stopped by SFU/peer cleanup. Five pure cases and a real-controller/fake-node Hybrid retirement check cover closed/stable/error/no-PC/in-progress teardown, preserving the prior immutable integration.1 checkpoint.

`setEnabled(false)` waits for restoration, then releases the original SFU edge and closes peer PCs; a failed restore remains recovering. Call `dispose()` only for retired room/account/PC bindings: it closes peers/owned inputs immediately and does not guess that SFU has recovered. On same-call codec/cap reconfiguration the client waits for disabled/restored state before replacing the session; incomplete recovery prevents replacement and stays visible. New sessions use the existing SFU codec request and authenticated channel cap, without raising defaults/admin caps.

Acceptance still requires separately authorized contained real SDK/server/SFU tests of this new exact source: repeated auth fault/recovery with consistent selected edge/controller state, protected synthetic PCM, fresh fallback/permissions/moves, multi-remote order and closed-SFU-PC retirement. No network test was run for integration.3. The previous two-SDK loopback core result does not establish capacity, physical direct underlay, FEC or listening quality. The unique Git integration owner must freeze one component manifest before packaging and perform an exact local-tar install/fresh frozen dependency check; this increment does not modify client/server/SFU source or client dependency locks.
## Safe diagnostics and borrowed input recovery

`BrowserHybridVoiceOptions.onDiagnostic` receives `BrowserHybridDiagnostic`:
fixed selected-path classifications/reasons, candidate types, underlay class,
fresh/missing exact-track decoded proof, sanitized peer failures, and validated
pause/restore ACK results. It contains no IDs, endpoints, SDP, tokens or raw
errors. The session deduplicates events, limits each event category to one per
second and renews a budget of 128 events each minute. Observers cannot change
media routing. A non-TURN candidate never establishes physical direct routing.

The borrowed source-to-analyser edge has a shared owner fence and recorded
connection state. A replacement owner cannot assume a disconnected SFU edge is
connected; old selection/restore/dispose callbacks cannot modify its successor.
An already-selected SFU edge is relinquished intact. A retired paused input keeps
a restore obligation bound to the same PC, authenticated room/local session and
remote publication. A replacement restores it only after a current authenticated
ACK and fresh SFU decoded media, including when P2P is disabled or publish
permission is unavailable. A different room/account/session cannot inherit it.

Synthetic regressions: `check-roster-media-policy`, `check-hybrid-source-ownership`,
`check-hybrid-diagnostics`, `check-hybrid-network-boundary`, `check-hybrid-session`
and `check-hybrid-auth-recovery`. These do not verify real network/audio success.

## Routing.5 local handoff (2026-10-14)

SFU remains audible while peer decoded-media and admitted-path stability are
verified. The controller then completes the local handoff, refreshes the exact
peer track/path proof, and requests the SFU pause. A delayed pause ACK refreshes
peer evidence rather than rejecting the original 500 ms snapshot. Pause lease
state still requires every exact ACK field and a nonexpired lease. ACK failure
or timeout keeps a healthy selected peer through bounded restore requests and
retries; SFU replaces it only after the exact restore ACK, fresh SFU decoded
media and local gain handoff. Permission/epoch/pair revocation remains immediate.

The input's audio-time completion wait has its own one-second wall-time bound
so a suspended context cannot leave a 5 ms polling loop indefinitely. A failed
prepared-node migration removes the new muted graph and preserves the original
edge. Synchronous legacy `dispose(true)` returns the unity SFU edge without a
timer owned by the retired input. Custom receive ports lacking gain automation
or the optional completion method retain synchronous selection behavior.

Sanitized diagnostics add `handoff` stages for first verified peer media, local
start/completion, SFU recovery completion/failure, plus bounded elapsed times for
pause/restore ACKs. These are local operation measurements, not network latency,
room-to-first-SFU timing, longest audible outage or listening-quality claims.

`check-hybrid.mjs` covers 100/750 ms pause ACKs, delayed local completion,
pause/restore timeout retention, late ACK fencing, fresh SFU handoff and immediate
revocation. `check-hybrid-handoff-headless.mjs <playwright module path>` uses real
Chromium WebAudio with synthetic constant sources at 44.1/48 kHz, muted output,
blocked microphone access and loopback-only requests. It checks the gain envelope,
no summed-source boost, exact zero after revocation, synchronous SFU restoration,
graph-error rollback, suspended-context timeout and successor ownership. It has
no real peer, SFU gate or WAN media, and cannot establish perceptual transparency,
encoding-delay alignment or dual-device acceptance. Continuous RTT/loss quality
selection and the dependency on the live SFU-PC binding are unchanged.
