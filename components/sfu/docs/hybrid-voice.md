# Experimental physical audio forwarding lease

Source checkpoint only; new real network execution remains paused. `SFU_HYBRID_ENABLED` defaults false and support additionally requires `RequireClientToken` and `AudioOnly`. Only the current authenticated registered application-server WebSocket may send `hybrid_command`; `hybrid_result` echoes its command ID. Pair UUID authority resides in that server; the SFU independently resolves current token-signed app-socket sessions, admitted same-room PCs and the exact current audio publication.

`WithHybridPeers` keeps membership locked through `ApplyHybridLease`; track replacement/fencing is checked under the track-manager lock. `LayerForwarder.ApplyAudioLease` takes the exclusive mutex covering actual RTP Track.Write. An ACK follows prior writes; it cannot recall previously in-flight packets. Forwarding defaults on, pause is bounded to ten seconds, and RTP-thread clock checks restore after expiry. Monotonic authority revisions reject replay; another active pair cannot be opened by stale or unbound cleanup. Packet-held/forwarded counters are attached to the actual forwarding edge, not local speaker volume.

`audio_lease_state.go` uses only errors, sync/atomic and time. Its file-list test can execute without importing Pion or creating any network resource:

```
go test -p 1 -v internal/svc/audio_lease_state.go internal/svc/audio_lease_test.go
```

Do not run the repository-wide network tests on Windows under the current stop. The imported coordinator repair comes from the independently frozen capacity-repair candidate ZIP SHA256 `0e20791e981ad9b566ef285513765dcf93e4f56628aa08ecc26ae74a3fab13c5`, based on upstream `c78c6d6` plus frozen Opus policy ZIP `b7c18887...`. It serializes GetSenders/AddTrack/offer work per actual PC and obtains a fresh track snapshot after locking. The owner's pre-stop minimal Pion evidence passed twelve rounds; this combined hybrid source has not been network-retested and is not a twenty-user pass.

The imported test-only transport guard refuses wildcard/nonliteral/nonloopback binds, limits network types and disables mDNS. The probe requires explicit authorization environment opt-in; setting that flag does not itself authorize a test. This hardening is source-only and not a proven no-firewall-prompt path. Earlier IPFilter(loopback) fixtures could still open multicast DNS sockets. Preserve this evidence boundary.

The frozen a36adcab real48/64 test exposed the inherited fixed24000 receive offer as a blocking limit. Preserve that failed fixture and original offers; it is not new48/64 acceptance. The subsequent source policy advertises a48000 microphone receive ceiling and20ms, preserving any existing lower SDP ceiling (including an explicit24000) and rejecting malformed explicit limits. Only the first reserved receiving Opus microphone slot is modified; other media slots remain unchanged. The opt-in remains gated by AudioOnly. Peer64 is a separate client encoder intent and does not enter this SFU policy.

The existing SFU policy takes a boolean, not an authenticated channel bitrate. Current join/capability claims carry no per-channel bitrate field. Do not pretend to enforce a missing value or turn the aggregate MaxIngestKbps hint into such authority. The frozen SDK applies min(custom/requested profile, actual client channel cap, remote microphone receive cap). Thus lower custom/channel values stay lower; custom values above48 remain limited by this SFU's advertised receive ceiling. No permissions or token protocol changed. Real new-offer negotiation/encoder/RTP/PCM/forwarding acceptance requires a fresh frozen capacity-owner run.

Pure cap checks execute only the production stdlib helper and the frozen SDK with fake senders, with no Pion PC or network:

```
go test -p 1 -count=1 -v internal/webrtc/microphone_opus_parameters.go internal/webrtc/microphone_opus_parameters_test.go
node scripts/check-microphone-caps.cjs
```

Future screen media must never enter this SFU: only positively proven direct P2P is allowed, with no TURN/EasyTier relay. Voice fallback remains separate.
