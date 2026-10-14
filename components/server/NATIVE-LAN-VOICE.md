# Integrated native ET voice control

This implementation is a local candidate, disabled by default. Set
`NATIVE_LAN_VOICE_ENABLED=true` only for an explicitly approved runtime. No
production deployment, real audio device, ET/TUN or multi-device acceptance is
implied by the offline tests.

The existing community member identity, saved access token, channel permissions
and ET grant service remain authoritative. In native mode the backend skips SFU
initialization and synchronization and refuses the legacy SFU room join/doctor
protocol. Voice is audio only, with at most 12 active member devices across the
server, respecting a lower `VOICE_MAX_USERS` setting.

`server:info` reports `native_lan_voice_enabled`, `nativeLanVoice` and
`nativeLanVoiceProtocol: 1`, together with the existing audio-only and member-move
capabilities. Older backends cannot provide a native room lease.

## Socket contract

The binding reference is `{v:1, communityId, deviceId, nativeInstanceId, grantId}`.
It contains no IP, audio key or credential secret. Each join and heartbeat calls
the existing authenticated `CommunityGrantService.binding` for this exact device;
the account/member comes from the access token. An allocated directory address
alone is never enough. A member can use one voice device at a time; a second
device is refused rather than choosing one of its account's directory rows.

| Event | Request | Result |
| --- | --- | --- |
| `voice:native:join` | `{v:1, channelId, binding, accessToken?}` | ACK `{v:1,ok:true}` and private snapshot |
| `voice:native:heartbeat` | `{v:1, binding, accessToken?}` | ACK and refreshed private snapshot |
| `voice:native:leave` | `{v:1}` | Ends this socket's membership immediately |
| `voice:native:media` | `{v:1, connected:boolean}` | Client-reported helper presence; only transitions change roster |
| `voice:native:snapshot` | Server event | Per-socket room lease below |
| `voice:native:stopped` | Server event | `{v:1, reason}`; stop native media |
| `voice:native:error` | Server event | `{v:1,ok:false,error}`; stable public error code |

An omitted access token uses this socket's saved authenticated token. Tokens
supplied for another identity do not change the socket's identity. The snapshot
contains `{v:1,serverId,channelId,revision,epoch,localIp,key,peers,canPublish,
canReceive,requirePTT,serverTimeMs,expiresAtMs}`. Each peer contains
`{userId,virtualIp,canPublish,canReceive}`. The 64-hex audio key is randomly
generated and delivered only to authenticated member sockets, with no public
roster field or native event debug logging. An empty peer list is a valid room.

Heartbeats every five seconds refresh a 15-second lease. The renderer/main helper
must stop on lease expiry. A temporary heartbeat binding failure returns a
retryable ACK, emits no fatal native error, and does not extend the existing
lease. A disconnect, kick, membership removal, permission loss or expired lease
removes the device from the authoritative room and rotates the remaining audio
key. This lifecycle does not infer remote decoded media or physical directness
from a grant or ET route.

The snapshot revision increases across room moves and room recreation. Routine
heartbeat refresh keeps the revision/epoch/key stable and advances server time
and expiry. Mute, local deafen, speak permission and PTT settings update controls
and revision in place without restarting all peers. Membership, device address
or device credential authority changes rotate the key and epoch. A shared room
key provides cooperative publish/receive controls; it does not cryptographically
exclude a malicious server-muted member from transmitting. Server-deafened
members are fully excluded from media peers and audio keys while retaining room
membership. They receive `stopped` with `server_deafened` without a room leave;
authenticated snapshots resume after the server undeafens them.

## Member management

The existing drag/move request `voice:move:user` is accepted with its existing
payload: request UUID, target member, source channel, destination channel and
access token. It reuses `disconnect_members`, strict outrank, actor source and
destination visibility, target destination visibility/join, current target
authentication and current socket generation. No SFU staging or media ACK is
involved. The backend commits the room change atomically, emits the existing
`voice:move:committed` authority before the destination snapshot and emits
`voice:move:result` to the actor. A bounded five-minute per-request history lets
the same actor retry/query a committed result without repeating the move.

Local mute/deafen state survives a move. The normal leave, disconnect, admin
voice disconnect, moderation and channel/role permission broadcasts reconcile
the native membership lifecycle. Cosmetic helper presence uses a separate rate
limit and an unchanged value emits nothing, avoiding status/snapshot loops.

## Offline verification

`src/socket/handlers/voiceNative.test.ts` uses in-memory socket and service
doubles. It covers solo rooms, exact device/address proofs, automatic private
keys, roster changes, lease refresh/expiry, seat races, same-user device refusal,
stale join completion, mute/deafen controls, administrative moves, cosmetic
telemetry and legacy SFU join rejection. Run through the local Node toolchain:

```text
node --test --require ts-node/register src/socket/handlers/voiceNative.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

These checks do not start sockets, SFU, ET, native audio, or production services.
