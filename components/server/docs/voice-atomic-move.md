# Atomic administrator voice move v1

Local implementation based on deployed server `6ea9930765a6aed92cc4e5d9f5cce6e8a0a1e45c`. Production enablement requires explicit policy approval and coordinated SFU + Voice SDK deployment. No seat, resource or production configuration is changed here.

## Policy proposal and feature advertisement

`VOICE_ATOMIC_MOVE_ENABLED` defaults off; only exact `true` enables these handlers. `server:info.voice_atomic_move_enabled` is true only with the switch on, a connected SFU and a successful actual `move_probe` (10-second cache). It remains false for an old SFU. Client roster records expose non-sensitive `voiceMoveStagingSupported:boolean`, the authenticated SDK declaration; this is not proof that a particular replacement connection is ready.

Proposed authorization reuses `disconnect_members` and existing strict outrank. Reject self/equal/higher/owner targets. Actor must view source and destination; target must view and possess join_voice in destination. Both are current authenticated Socket.IO identities, checked through existing host/token-version/member-version/session/standing gates and bound to their context and connection generation. Only existing voice channels, no DM/text/offline moves. The target's single current source seat is verified and reused, including at the configured seat limit. Same channel is a no-op.

No new production authorization default is inferred from this proposal. Approve these rules explicitly before switching it on.

## Socket contract

All requests carry `accessToken`. Every known-transfer ACK/result/query includes `{v:1,requestId,status,generation,sourceChannelId,destinationChannelId,invalidated?,channelSettings?,error?}`. Generation is the original target Socket.IO id; source/destination are stored authority fields, not values filled from local client state. Status is preparing/prepared/committed/aborted/failed/pending. `invalidated:true` forbids SDK promotion even when the historical transaction is committed. A same-channel no-op has no staged destination and requires no promotion.

- Target declares `voice:move:client {v:1,staging:true}` only if actual SDK staging APIs exist.
- Actor requests `voice:move:user {requestId:UUID,targetServerUserId,sourceChannelId,destinationChannelId}`.
- Target receives `voice:move:prepare {v:1,requestId,generation,sourceChannelId,destinationChannelId,joinToken,sfuUrls,expiresAt,channelSettings}`.
- Target announces `voice:move:ready {requestId,streamId}` after the second PC connects. Server asks SFU; this announcement alone cannot authorize movement.
- Actor/target query `voice:move:query {requestId}` or abort `voice:move:abort {requestId}`. Result ownership binds to captured sessions and never follows a replacement socket.
- Target receives `voice:move:committed` or `voice:move:aborted`. Actor receives `voice:move:result`. Socket ACK is supported for every request.

`channelSettings` is `{requirePTT,disableRNNoise,maxBitrate,eSportsMode,speak,shareVideo,shareScreen,isMuted,isDeafened}`. SDK applies destination PTT/noise/encoder/publication settings before ready; if those configuration fields change during preparation, server aborts safely and preparation must restart. Current speak/share/mute/deafen are rechecked for commit.

The join object includes `move_id:requestId`; signed token capabilities bind `app_socket:<targetSocketId>` and `move:<requestId>:<nonce>`. An active source that joined before the new socket-binding token was deployed must rejoin with the upgraded grant before it can be moved.

## Transaction and SDK requirements

The SDK creates a separate websocket/PC without replacing active engine refs, announcing joined/left, calling normal connect, or cleaning up source. Staged inbound audio stays silent. SFU holds staged publishing and excludes it from all room/seat/sync membership. Readiness comes only from the actual Pion Connected callback.

SFU commit permanently fences old publishing and receiving, atomically swaps source and destination maps under the same lock as authoritative sync, and activates current destination grants. Abort/expiry closes pending only; source stays intact if still present. Per-user reservation and request serialization prevent competing moves. Pending expiry is 30 seconds, terminal query retention is five minutes. Temporary second-PC resource cost is bounded by one reservation per user and the SFU transaction cap, rather than changing live seats.

After confirmed commit, server updates socket rooms/roster/stream, clears old quality telemetry and emits one source-left/destination-joined pair carrying stable requestId, then target committed. SDK promotes the second PC using prepareMove/commitMove/abortMove; duplicate calls are harmless. Old PC closure while pending must query authority before ordinary leave cleanup: it can precede the app commit ACK.

Missing commit ACK is unknown. Query before deciding which connection to keep; never assume a timeout means failure. Disconnect before commit is rejected/aborted. If disconnect races an already-linearized SFU commit, return its actual result and never rebind it to a new socket. SFU process restart loses transaction memory and PCs; unknown status remains pending rather than inventing a result.

Existing SDK invalidation signals are disconnect, token:revoked, server:kicked, voice:device:disconnect, voice:kicked, voice:room:leave, voice:channel:joined:false and client identity/socket-generation changes. There is no voice:force:disconnect event. A room-request error does not prove source left.

Final authorization, settings and media grant reads are fenced by the SQLite connection's total_changes and data_version, with no await between the fence check and commit send. Any database write during those reads conservatively aborts; unrelated writes can also require a retry. Roster invalidation synchronously marks the transfer before queued reconciliation. A removal racing an in-flight commit uses authenticated `move_remove`, which fences/removes only the captured destination peer and generation; it cannot remove a replacement connection. Historical committed status is retained with SFU `removed:true`, and app authority returns `invalidated:true`. Pending room/auth/policy invalidation aborts the staged connection. Current mute/deafen values are copied at commit send; changes after that point remain ordinary live moderation operations. The transaction does not claim a cross-process database/SFU distributed lock.

Live SFU mute gating added for move preservation applies only to peers activated by this protocol. Ordinary peers keep their existing moderation semantics. Historical duplicate commits cannot activate another staged peer or reactivate a retired peer.

Before app committed authority is published, `move_refresh` re-reads destination visibility/join/grants/settings and current mute/deafen, applies them to the exact committed SFU peer and awaits an ACK. This repairs source-addressed live updates during the commit ACK window. Database/moderation changes during refresh cause another attempt; after three unstable attempts or an unknown ACK, app authority stays pending for query. It never reports a false abort of an already committed SFU move. Newly created source-room forwarders inherit the retired receiver fence before becoming visible.

Every committed recovery query and duplicate ready/request repeats current target eligibility and destination control refresh; historical committed status is not permission to promote a departed, replaced or later-moved stream. A later leave returns committed with invalidated:true and cleans only the original captured destination. Repeated queries never re-emit movement events or allocate more retention timers.

## Audio-only opt-in and telemetry integration

`VOICE_AUDIO_ONLY=true` removes share_video/share_screen and adds video_checked at every server token mint and capability push, including Doctor and direct-call grants. Camera/screen announcements cannot turn them on. Default is compatible. `server:info.voice_audio_only` describes this server policy switch; it is not independent proof of SFU enforcement.

`SFU_AUDIO_ONLY=true` in the companion SFU rejects video, screen audio and unknown slots/kinds regardless of legacy tokens or role grants; only negotiated microphone audio slot 0 may pass its speak gate. Deploy both flags for server-wide voice audio-only policy. This is transport/codec/slot enforcement, not content recognition: audio on the allowed Opus slot may be software-created or disguised content, and this SFU does not decode or perform DSP to identify it. No role label can establish such a guarantee.

The room-quality summary handler is registered, retained per connection, cleared on authoritative room/stream/identity changes, move, force removal and SFU peer-left, and disposed on teardown. Legacy latency events remain unchanged. See voice-quality-summary.md for its strictly allowlisted, client-reported local-to-SFU metric contract and TTL; it does not assert peer-to-peer latency or classify quality.

## Deployment gate

Review server + companion SFU immutable commits together with the actual SDK staging implementation. Confirm the proposed permission/visibility/rank/current-generation/no-op/timeout settings, 30s temporary staging cost, and explicit audio-only activation. Deploy SFU support before enabling the server; refresh source grants with socket binding. Keep existing quotas, CPU/memory and seats. Merge room-quality integration into the same server build. Exercise synthetic staging/abort/query and then an explicitly authorized staging environment before any production cutover. No production service was started by the local tests.
