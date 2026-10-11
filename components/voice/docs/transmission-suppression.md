# Temporary microphone transmission suppression

The embedder owns key/process detection. The engine never installs keyboard hooks,
checks process names, changes user preferences or mutes received/screen audio.
The library defaults `audio.transmitSuppressionEnabled` to false. A private client
may enable it for its configured scope; feature enabled and currently suppressed
are separate decisions.

## API

```ts
import { useMicrophone, type TransmissionState } from '@gryt/voice';

// Provider configuration:
// audio.transmitSuppressionEnabled?: boolean
const mic = useMicrophone();
mic.setTransmitSuppressed(true);  // Independent temporary cause.
mic.setTransmitSuppressed(false); // Start fresh recovery, never restore an old mute.
mic.retryTransmission();         // Retry a failed barrier, including RNNoise recreation.
const state: TransmissionState = mic.transmissionState;
```

`TransmissionState` has `status`, optional diagnostic `reason`, and monotonic
`generation`. The statuses are:

| Status | Meaning |
| --- | --- |
| disabled | The temporary feature is off; ordinary user/server mute and PTT remain effective. |
| ready | Fresh route and actual publication-boundary ACK completed. This does not mean user mute/PTT is open. |
| suppressed | The audio thread has applied a closed final boundary and output zero PCM. |
| recovering | Loading/awaiting capture, awaiting boundary ACK, or clearing old audio. Do not present as protected/ready. |
| suspended | The AudioContext is not running. |
| failed | Recovery/loading/processor failed; publication remains closed until successful recovery. |

`reason` is a diagnostic code, for example `awaiting-suppression-ack`,
`fresh-audio-timeout`, `rnnoise-worker-error`, `capture-processor-error` or
`transmission-processor-error`. Reading a GainNode's `.value` is not an audio ACK.

Use a pressed-key set and aggregate scope/capability state in the client. A client
hangover before calling false is permitted, but it is not an engine flush proof.
A new true cancels the previous recovery generation. Turning configuration off
while held/recovering also passes a fresh barrier before reopening. A release does
not write user mute, server mute or PTT state; the engine recomputes these current
causes at its final boundary.

## Publication and recovery

All web microphone publication uses one stable MediaStream destination. The
controller exists independently of the current processing route, so addTrack,
the connect-wait path and both replaceTrack paths prefer `publicationStream` over
processed/raw capture. Rebuilding a route keeps the published track identity.
The gate starts closed. Normal transmission without this opt-in still uses the
compatible GainNode path; enabling loads an AudioWorklet boundary whose ACK is
issued after rendering the requested open/closed state. Capture and incoming
audio continue while the outgoing microphone gate is closed.

On release, RNNoise clears partial input/current output/output queue, uses a new
generation on every worker request/reply, resets its denoise state, ignores late
old replies, and starts capturing only after the reset ACK. Its fresh promise
resolves only when a new-generation processed frame is actually output. This
does not depend on an 80/200 ms timer. The 10-second watchdog fails closed rather
than opening on timeout.

The hook then constructs new buffered sender DSP nodes and a new capture barrier,
disconnecting old native compressor/limiter/shaper history. It retains capture,
the RNNoise worker/model module, and the final destination. Fresh capture and the
new final boundary ACK precede ready. No neural model is added per remote stream.
Runtime RNNoise/capture/final-boundary failures invalidate pending generations.
Retry recreates RNNoise after its failure or the final boundary after its failure.

The current native/ownPipeline adapter has no equivalent fresh-history contract.
Opting it in reports `transmission-platform-unsupported` and keeps its mic closed;
default false retains the existing native behavior. This local package targets
the Windows web/Electron client. Do not silently advertise native support.

## Boundaries and evidence

The control boundary is the audio render/capture frame after commands are applied,
not a hardware capture timestamp. OS hook/main-thread scheduling is not zero
latency. PCM already handed to the encoder, queued RTP and remote jitter buffers
cannot be recalled. Suppression emits zero microphone PCM; it need not emit zero
network bytes. No real microphone, key hook, game voice or listening is tested.

`check-transmission` tests controller causes, superseded recovery, failure/retry,
and the production RNNoise worklet's old/fresh marker handling with varied block
lengths. `check-transmission-publication` executes all four production selection
expressions, including raw fallback. `scripts/check-transmission-headless.mjs`
uses muted Chromium, real AudioWorklets/RNNoise WASM/Worker and React hooks with a
synthetic capture platform. It verifies audio-thread ACK, zero PCM, stable stream
identity, configuration rebuild, fresh native-history marker, late generation,
PTT/user/server causes, visible failure and retry. Received audio is not connected
to the transmission controller; client receive continuity is tested separately.

Capture/boundary worklets add no sample buffer or lookahead. Their audio callbacks
do no per-block allocation/logging or recurring telemetry: one capture message
per route and one boundary ACK per control revision. Rebuild and model reset can
create a short transmission gap on release. Observed test recovery times are not
latency guarantees, game-load benchmarks or a claim that speech beginnings never
drop; press/release voice handoff still needs user listening validation.

This package also contains the confirmed RNNoise per-AudioContext registration
fix, equivalent to independent upstream Draft voice#80, without its public-PR
metadata or any automatic release. Receive leveling retains the earlier frozen
implementation and licenses. This feature is local-only and absent from voice#79.
