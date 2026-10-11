# Voice quality summary v1

This module adds a minimal **client-reported local-to-SFU** summary. It does not calculate a peer-to-peer delay, identify individual incoming peers, classify quality, modify voice admission, or replace the existing five-field `voice:latency:report/update` protocol.

Base: deployed server commit `6ea9930765a6aed92cc4e5d9f5cce6e8a0a1e45c`. This change contains the handler, contract, validation/store, isolated tests and these integration notes. Registration and leave/move/SFU membership hooks are intentionally left to the integrating parent task. Nothing starts or deploys a server.

## Wire contract

The complete typed contract is `src/socket/utils/voiceQualityContract.ts`.

```ts
// emitAuthenticated(socket, "voice:quality:report", { report }, host)
type Request = { accessToken: string; report: VoiceQualityReport };
type PacketSample = {
  windowMs: number;
  packetsReceived: number;
  packetsLost: number;
};
type VoiceQualityReport = {
  schemaVersion: 1;
  connectionGeneration: number;
  seq: number;
  iceRttMs: number | null;
  uplink: { rttMs: number | null; sample: PacketSample | null } | null;
  receive: { jitterMaxMs: number | null; sample: PacketSample | null } | null;
};
type Update = {
  schemaVersion: 1;
  clientId: string;
  report: VoiceQualityReport | null;
  receivedAt: number;
  expiresAt: number;
};
```

`iceRttMs` is selected ICE candidate-pair RTT between the reporting local client and its SFU. `uplink` comes only from remote-inbound **audio associated with that client's audio sender**; absent association or unavailable feedback means null, never another peer's report. `receive` aggregates the reporting client's local inbound audio from the SFU. `jitterMaxMs` is the maximum measured jitter among the included inbound audio streams; it is not an end-to-end jitter or per-peer value. All reported RTT/jitter values use milliseconds, after converting RTC seconds. No one-way estimate is manufactured.

Packet counts are interval **deltas of cumulative counters**, not lifetime counters or a rounded loss percentage. The client must use a stable stream/counter set. First sample, counter reset/decrease (including negative/revised loss), changed stream set, missing association or untrustworthy interval means `sample:null`; a missing whole direction means that direction is null. A valid zero/zero sample carries no loss denominator, so the UI must treat its loss as unknown. The server validates these claims but cannot independently verify a client's counter derivation.

Every field shown is required; unknown values are explicit null. Envelope, report, directions and samples have strict key allowlists. Identity, room/channel IDs, token, raw RTC objects, IPs, candidates, interface names, codecs or arbitrary strings never enter the report/update. The access token exists only in the incoming envelope and is never cached or broadcast by this module.

## Ordering, safety bounds and lifetime

- `connectionGeneration` and `seq`: positive safe integers. Increment generation for each media PeerConnection replacement within the socket lifetime. A greater generation may restart seq at 1; same-generation seq must increase strictly. Old generations and duplicate/decreasing seq are discarded, including after expiry or leave. A new Socket.IO connection has a new server-assigned clientId and its own watermark.
- At most one attempt per **2000ms per socket**, including invalid envelopes and failed auth; generation changes do not reset the rate gate. A slow authentication backend gets at most one in-flight request, with no queued telemetry. Dropped samples can be skipped; the next seq need not be adjacent.
- RTT and jitter: finite 0–60000ms. Sample window: finite 500–10000ms. Received/lost counts: nonnegative safe integers, sum at most `20000 * windowMs / 1000`. Access-token string: 1–8192 characters. These are protocol validation bounds, **not quality thresholds** or tested capacity claims.
- Server assigns `receivedAt=Date.now()` and `expiresAt=receivedAt+8000`. At expiry, clear/leave or disconnect, the old room receives `report:null`, `receivedAt=expiresAt=current server time`. Stale reports do not extend the timer.
- The client must also expire cached metrics if updates stop. Use the server duration `expiresAt-receivedAt` against local elapsed time; do not assume client/server wall clocks are synchronized. Clear the local cache on socket reconnect, media generation replacement, peer-left and membership change. No database persists summaries.

## Authentication and actual room binding

The default handler calls existing `requireAuth(socket, envelope)`. That middleware verifies JWT signature/expiration and access scope, host binding, server token version, active membership/ban gate, member token version and standing. This report adds no role or permission requirement and changes no seat policy.

Authentication alone cannot let one token name another socket. The handler also binds the verified `serverUserId` and `grytUserId` to the current `clientsInfo[ctx.clientId]`, requires the established context's access token and joined voice channel, verifies actual Socket.IO `voiceRoomName` membership, and requires a connected SFU tracker for the same `sfuRoomId`. It derives the channel and public ephemeral clientId from that context; the request cannot choose them. The context object, room and lifecycle generation are checked again after async auth, so a pending report cannot survive clear/dispose, move or context replacement. Authentication failure/error clears any prior summary without leaking backend details.

Broadcasts go only to authenticated joined contexts in the old/current actual Socket.IO voice room, including the sender so it sees the server timestamps. Internal server/gryt user IDs and tokens are never emitted. The sender's last accepted channel is remembered for invalidation even if the context has already left or moved.

## Required parent integration

```ts
const quality = registerVoiceQualityHandlers(ctx);
const allHandlers = {
  // existing handlers, including legacy latency
  ...quality.handlers,
};
```

Keep the `VoiceQualityRegistration` per socket. Its disconnect listener automatically clears the old summary and cancels expiry. Call `quality.dispose()` on connection teardown to remove its listener and cancel any remaining work. `dispose()` is idempotent and permanently disables this registration; `clear()` keeps the same socket registration usable and preserves replay watermarks.

Call `quality.clear()` for each affected socket on **voice leave, successful atomic room move, SFU peer-left/authoritative membership removal, member kick/ban/removal, voice force disconnect and restored/replaced voice state**. Run it before updating membership where possible; remembered old-channel invalidation also works after the context changes. A reconnect must not copy a prior registration/cache into the new socket. The parent should integrate these hooks wherever its new atomic move/membership code actually commits the transition, rather than clearing on a rejected move request.

This branch intentionally does **not** modify `src/socket/index.ts`, existing move handlers, legacy latency handlers, default seats or permissions. Without the above registration and lifecycle wiring, the new event is not active. The TTL is a fallback, not a substitute for authoritative leave/move invalidation.

## Verification

Public seams: strict report validation, socket-scoped watermark/clear store and `registerVoiceQualityHandlers` with fake clock/timer/auth/room transport boundaries. Test fixtures use only newly generated local tokens and an isolated temporary SQLite database. A real-middleware test proves invalid-token rejection, valid-token acceptance and active-member revocation; other tests cover hidden-field rejection, finite/range/window/delta validation, room-only audience, seq/generation ordering, rate gate, expiry, leave/move/disconnect/dispose, auth errors, single in-flight auth and async lifecycle races. No production token, owner identity, microphone or network session is used.

```sh
node --test --require ts-node/register src/socket/handlers/voiceQuality.test.ts src/socket/utils/voiceQuality.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js src/socket/handlers/voiceQuality.ts src/socket/handlers/voiceQuality.test.ts src/socket/utils/voiceQuality.ts src/socket/utils/voiceQuality.test.ts src/socket/utils/voiceQualityContract.ts
```
