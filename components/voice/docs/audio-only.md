# Microphone-only media policy

Set `VoiceConfig.connection.mediaMode` to `"audio-only"` to disable camera and
screen capture (including screen/system audio), publication and video reception.
Omitting the field or using `"full"` preserves the existing behavior. Embedders
that require microphone-only calls must force this field after reading persisted
settings; a camera shortcut or a stale enabled setting cannot override it.

Remote audio needs a trusted allowlist:

```ts
connection: {
  ...connectionSettings,
  mediaMode: "audio-only",
  receiveMicrophoneStreamIds: authenticatedPeers.map(peer => peer.microphoneStreamId),
}
```

Only use authenticated signaling metadata that identifies the microphone's actual
publication stream ID. Do not include screen audio stream IDs, display names, or
an audio track inferred to be a microphone merely because it has kind `audio`.
If role metadata is unknown or ambiguous, omit the entry. The SDK checks every
`a=msid`/SSRC `msid` source in an offered audio section; missing identities, `-`,
mixed allowed/unknown sources and an absent/empty allowlist fail closed.

This policy is applied to each SFU offer **before** `setRemoteDescription`, to
transceiver directions before `createAnswer`, and to the answer before it is
applied and sent. Video sections become inactive. Unapproved audio sections
cannot send from the SFU to the client; a section may still receive our local
microphone. The SDK routes only approved audio track events. It never treats
muting a received track as evidence of saved downstream bandwidth.

Changing the mode or allowlist on a live call immediately closes the peer
connection and uses the normal recovery path to negotiate a fresh connection.
This revokes previously accepted receivers and cancels pending track replacement
work. Expect a brief call interruption when these settings change. Keep the list
stable and deduplicated. Capture leases release late device results even if mode
changes from full to audio-only and back before the request completes.
The SDK normalizes duplicate/order-only allowlist changes, empty versus omitted
lists, and full-mode defaults; these do not revoke permissions or reconnect.

The current SDK signaling contract carries an ordinary SDP offer and no explicit
remote microphone/screen-audio role map. The SDK cannot verify that an SFU keeps
the publication stream IDs identical to the authenticated signaling IDs. If the
SFU omits or rewrites those IDs, remote audio stays silent; do not broaden the
allowlist to all audio as a workaround. An SFU that mixes microphone and screen
audio in one allowed stream cannot be safely separated with stream metadata.

For a server-side solution, add an authenticated per-receiver subscription API
that explicitly permits only microphone publication IDs, with microphone versus
screen-audio roles and current SDP mids/stream IDs in its acknowledged result.
Reconnect and new offers must reapply that subscription. A client playback-role
registry alone does not establish this network filtering capability.

Verification uses muted synthetic fixtures only:
`node scripts/check-media-policy.mjs` covers actual SDP/lease/peer policy code,
and `node scripts/check-audio-only-engine.mjs` runs the actual hooks with fake
capture, socket and peer connection implementations. They do not measure a real
SFU's network traffic or claim a measured bandwidth saving.

`node scripts/check-audio-only-headless.mjs <playwright module path>` additionally
checks actual Chromium offer/answer acceptance using silent synthetic audio and
canvas tracks. Trusted microphone, unknown renegotiated audio, revoked allowlist
and rewritten stream IDs reach stable signaling with the expected receive
directions. These tests do not establish ICE connectivity or SFU enforcement.
