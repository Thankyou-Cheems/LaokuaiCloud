# Explicit microphone Opus policy

This local increment is independent of the hybrid/P2P experiment. Library defaults
and omission of this option keep the previous eSports/channel bitrate and SDP behavior.
The immutable integration.4 package is not replaced.

```ts
import type { MicrophoneCodecProfile, MicrophoneCodecState } from '@gryt/voice';
const microphoneCodec: MicrophoneCodecProfile = {
  codec: 'opus', channels: 1, maxBitrateBps: 24_000, packetTimeMs: 20,
  vbr: true, dtx: true, fec: true,
};
// VoiceConfig.connection.microphoneCodec = microphoneCodec;
// useSFU().microphoneCodecState supplies actual configuration evidence.
```

The explicit profile wins over the legacy eSports 128kbps/10ms choice. Initial
connections, later offers, automatic recovery and staged destination connections
use the same immutable profile snapshot. A staged destination inherits the source
profile and its destination channel cap. Changing the source profile invalidates
the pending move. Changing a connected profile reports
`profile_changed_reconnect_required`; the caller reconnects to apply the new policy.
Publication, capture, permissions, mute/PTT/Squad gates, receive leveling, manual
volume, receive master and prior storage are not modified by this feature.

The effective sender ceiling is the minimum of the requested profile bitrate, a
finite nonnegative channel cap when present, and an advertised positive Opus
`maxaveragebitrate` on the microphone's authentic remote offer. It is rounded down,
never up. A cap below Opus's 6000bps minimum closes the PC and reports
`bitrate_below_opus_minimum`; it does not raise a 5000bps cap to 6000bps. The original
publication track is not stopped. A future connection can retry with a valid policy.
Invalid profiles are rejected before connecting; negative/nonfinite channel caps
are legacy unset values, not a permission to increase the profile bitrate.

The SDK awaits `setParameters` and reads the ceiling back. Failures are observable
as `set_parameters_failed`/`bitrate_readback_mismatch`, with an exception name and
the observed ceiling where available. Such failures do not imply the requested
ceiling is enforced. A later offer/reconnect retries. Retired-PC asynchronous
results cannot overwrite the active configuration state. Staged state becomes
public only when that connection is promoted. Disconnect clears configuration
state; a terminal invalid/below-minimum connect failure remains diagnosable.

## What each state proves

- `idle`: no explicit active policy.
- `applying`: the connection's explicit policy is being applied, or no accepted
  local answer has established its negotiated Opus configuration yet.
- `configured`: the authentic offer matches the requested Opus options, the SDK's
  local answer was accepted, and the effective bitrate ceiling was read back.
- `degraded`: a named failure, policy change, selected codec difference, or remote
  profile difference. Safe smaller caps are still applied when possible.

`requested` preserves the original user profile. `effectiveMaxBitrateBps`,
`senderMaxBitrateBps`, `remoteMaxAverageBitrateBps` and `limitedBy` distinguish the
request from the effective/observed bounds. `remoteOfferMatches` compares the
complete request, including exact advertised profile bitrate and ptime: a request
for 32000bps/40ms against an offer for 24000bps/20ms is a mismatch, with a 24000bps
effective sender bound. A channel cap of 16000bps further lowers it to 16000bps.

`rtpVerified` is always `false`: SDK configuration alone is not emitted/forwarded
packet evidence. Opus packetization, DTX savings, and actual FEC recovery must be
measured externally. SDP `useinbandfec=1` expresses a receiver preference; it does
not prove redundancy was emitted or a lost frame recovered. VBR requests do not
promise a constant 24kbps rate. Bitrate counters omit some protocol/transport costs.

## SFU interoperability

[RFC 7587](https://www.rfc-editor.org/rfc/rfc7587.html) specifies that ptime,
stereo, cbr, usedtx and useinbandfec are receiver preferences. Consequently,
modifying only the SDK's answer cannot configure the SDK's outgoing encoder.
The SFU must send its actual microphone receive preferences in its wire offer:

```sdp
a=rtpmap:111 opus/48000/2
a=fmtp:111 maxaveragebitrate=24000;stereo=0;cbr=0;usedtx=1;useinbandfec=1
a=ptime:20
a=maxptime:20
```

Payload ID is illustrative; existing IDs, ICE, MID, and permissions remain intact.
Opus's SDP rtpmap **must** retain `/48000/2`, even for mono packets. The SDK does not
rewrite the remote offer or fabricate SFU support. Its local answer sets matching
receive preferences and mono sender declaration on microphone m-lines only,
retaining only offered Opus payloads there; other m-lines remain unchanged. An old
SFU still connects with an explicit 24kbps ceiling where the sender accepts it,
but reports `remote_offer_profile_mismatch`/`opus_not_negotiated` rather than DTX success.

The client owner provides the independently frozen SFU policy from base
`c78c6d6ec14113c64986718b647b2ee22a0ac045`. Pion checks cached CreateOffer bytes at
SetLocalDescription, so that adapter preserves Pion's local description and adds
the receive preferences to the offer it actually sends. This distinction must be
retained in its evidence; only real RTP measurements establish encoding effects.

## Reproducible checks and limits

`npm run build`, `npm run check-microphone-codec`, `npm run check-mic-bitrate`,
and `npm run check-staged-move` cover input validation, caps, genuine offer parsing,
failure visibility, stale ACKs, recovery, destination caps and source changes.

`node scripts/check-microphone-codec-headless.mjs <client-node-modules>` runs three
serial, muted headless Chromium two-peer cases with public fixture PCM: legacy,
explicit 24k/20ms DTX, and the same profile without DTX. It uses the actual SDK
WebSocket negotiation path with a signaling fixture and real Chromium RTP peers,
encoded-frame TOC metadata, RTP counters and decoded PCM. It is not a Pion SFU,
TURN/TCP, production path, capacity, real-user listening or hardware microphone test.
Test output stores codec lines/counters only, never ICE, credentials or audio.

[RFC 6716](https://www.rfc-editor.org/rfc/rfc6716.html#section-3.1) defines the
TOC stereo bit and frame duration/count used by the test. Varied packet sizes
are observed VBR evidence for these fixture signals, not a universal rate promise.

Frozen SDK+SFU double-client tests supplied by the integration owner already show
that real SFU DTX receive preferences reduce 50pps silent streams to about 5pps,
with matching SFU forwarding/receiver counters, while the old SDK's 64k sender
cap still yields roughly 64k active payload. That old-package evidence motivates
this sender-cap increment; it does not validate this new package combination.
The owner must precisely install the frozen new package and repeat that joint test.
Loss-injected FEC recovery and 20-user capacity remain separate acceptance work.
