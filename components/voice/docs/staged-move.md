# Staged administrator voice move

The SDK exposes optional `prepareMove`, `commitMove`, `abortMove` and
`resumeMoveTransmission` on `useSFU()`. Their presence alone is not a server capability
claim. This implementation targets the locally prepared SFU `move_probe`,
`move_prepare/status/commit/abort` protocol and server `voice:move:*` adapter. It does
not establish that those server changes are deployed or available in production.

## Authenticated adapter contract

Supply `RoomCoordinator.moveAuthority: VoiceMoveAuthority` from the authenticated
Socket.IO adapter. It must provide all of the following:

- `generation`: a nonempty identity for the current authenticated socket/session.
- `stagingSupported`: true only after the authenticated server/SFU capability probe
  succeeded, with the required signing, source binding and reservation semantics.
- `confirmCommit(requestId)`: a fresh authenticated query returning exact `requestId`,
  `generation`, `sourceChannelId`, `destinationChannelId` and `status` (pending,
  aborted or committed). Never derive committed from an SDK PC state or UI event.
- `onInvalidated(callback)`: an immediate subscription for socket/auth revocation,
  destination denial/removal and other authority invalidation. Update generation and
  invalidate before asynchronous client work; merely changing a React prop is inadequate.
- `isDestinationPolicyApplied(requestId, settings)`: transaction-bound confirmation
  that actual destination speak permission and settings (PTT, RNNoise, bitrate and
  eSports mode) have been applied, including the actual final transmit gate ACK.
  A ready UI state, permission intention, or source-room ACK cannot satisfy this.

The SDK holds no server password, SFU control credential or raw transfer nonce. The
adapter must correlate fresh transport queries and reject old command replies. It
must query before delivering a committed result and handle authoritative server abort
separately from retiring the SDK's local pending PC.

## Sequence

1. Receive the signed `voice:move:prepare` payload. Call `prepareMove(payload)` and send
   `voice:move:ready` with its returned request ID and stream ID only after resolution.
   The SDK creates an independent WS/PC, with one disabled clone of the stable protected
   publication track. It never requests microphone capture, uses raw/processed fallback,
   mutates active source refs, announces joined/left, or calls setLocalStream. Staged
   inbound tracks remain in a private collector; they do not enter playback routing.
2. On authority committed, call `commitMove(requestId)`. The SDK performs its own fresh
   adapter query, checking request, source, destination, authority object and generation
   before and after the await. It promotes only confirmed committed, closes retired source
   handlers/WS/PC without announcing leave, and retains a disabled staged sender.
3. Apply actual destination configuration and permission while transmit connection
   qualification is closed. Wait for the final gate's current closed ACK. Then set the
   adapter's transaction-specific policy confirmation and call
   `resumeMoveTransmission(requestId)`. The SDK requires `publicationAcknowledged`,
   `publicationBlocked === true`, and a finite actual `publicationRevision`; it replaces
   the disabled clone with the original stable protected publication track, rechecks the
   exact active PC/WS/track/auth/policy/ACK revision after the await, then releases connection
   qualification. It never enables the clone. Concurrent resumes share one promise and
   replacement; duplicate successful resume is harmless. The protected original track must
   stay enabled and registered to the actual PC. Resume resolves after safe track replacement,
   not proof that PCM has started: the transmit controller may still be rebuilding a fresh
   native/model graph and waiting for its actual ACK before `publicationAllowed` becomes true.
4. For an authoritative abort, call `abortMove(requestId)`. Local pending disposal stops
   only its clone and transport. Query already committed promotes instead of rolling back.

Keep the prepare result's stream ID as the authoritative microphone publication identity.
Replacing its track preserves the sender's original staged MediaStream/msid. Do not infer
publication identity from the replacement track's own stream ID.

Only one pending operation is allowed. Same ID and same payload share the prepare promise;
changed payload is a conflict. A newer request retires the old pending operation. Expiry,
source/policy changes, authority invalidation, destination disconnect and SDK disposal
retire pending transport without stopping the original protected track. Successful later
moves dispose the previous move's control observers; late callbacks cannot affect the new PC.

## Failure and capability boundaries

Staging requires audio-only mode, a live current source PC/WS, an authenticated adapter,
matching signed `joinToken.move_id`, a bounded unexpired request (at most 60 seconds), and
an acknowledged protected publication boundary. Default legacy audio without actual gate
ACK fields is rejected with `unsupported_publication_boundary` before allocating staging.
A stable stream alone is insufficient. Full media mode is `unsupported_media_mode`.

Video and screen publication are not permitted. Video and unknown/screen audio receive
m-lines are inactive under the existing audio-only policy. Only trustworthy microphone
msid allowlists permit receive audio. The staged policy uses the current strict allowlist;
missing destination microphone metadata therefore stays silent. A destination allowlist
change can require ordinary renegotiation/recovery after promotion. The SDK does not
claim screen-audio identification or downlink savings for an unrecognized msid.

If the source disconnects while preparing, the SDK first queries authority. Pending or
aborted reports real source failure. Unknown/timeout leaves a still-connected source PC
intact; a physically lost source is reported failed. A committed query promotes the target
even if the SFU closed source before the application's committed event arrived.

If authority committed but the target PC/WS died, `commitMove` adopts the authoritative
destination and rejects `destination_recovery_required`. There is no source rollback.
Automatic stale source reconnect/reannouncement is blocked while staging, transmission
policy release, or authority reconciliation remains outstanding. With current authority,
destination configuration and closed final gate ACK applied, the client may explicitly
`connect(destinationId)` to recover; this is a new ordinary destination connection. After
auth invalidation, use a fresh authenticated generation and authoritative room query first.

## Effective transmit qualification

Registered-original-sender qualification also requires
`!moveControllerRef.current?.transmissionBlocked`. PC event listeners rebind when the
actual PC object changes even when `isConnected` stays true. Promotion explicitly calls
`setTransmitConnected(false)`; successful release verifies the new connected PC and
registered live enabled original sender, calls fresh qualification and emits a new connection-state
object. Both ordinary microphone replacement effects are also blocked by this latch.

`npm run check-staged-move` drives actual controller and hook code with synthetic tracks,
PCs, SFU SDP and Socket.IO authority fixtures. It covers old-source isolation, SDP policy,
legacy boundary refusal, stale query identities, invalidation, expiry/supersede/dispose,
destination/source failure, two consecutive moves, idempotence, and asynchronous replacement
races. These tests use no real devices, public network, deployed server, or audio playback.
