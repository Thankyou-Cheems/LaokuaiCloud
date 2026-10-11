# Official WebRTC RNN analyzer: scalar WASM reference

This directory preserves the supplied reference's source provenance below. Its historical test/browser results and standalone harness are delivered separately; they are not shipped in this source subset. Current integration behavior and test boundaries are documented in `../../docs/receive-longterm.md` and the accompanying delivery reports. Historical browser blockers below describe the reference environment, not the later authorized Windows headless validation.

To rebuild the embedded analyzer from this subset, run `bash setup_sdk.sh` and `bash build.sh` in an authorized environment with the required tools/network access. Setup verifies and extracts the retained source archives; build creates its output/results directories. This packaging directory-creation fix does not change upstream DSP, flags, or analyzer binary. The integration embeds `dist/gryt-rnn.wasm` as base64 in `src/audio/processors/receiveAnalyzerAsset.ts`; expected binary SHA256 is `21b6eb801901c5250215ff6a29b83471b13cdf45b69ba3fe438770b391a1d95b`. No SDK download or new full WASM build was performed during Windows integration.

Verified 2026-10-10. This is a real, compiled WASM analyzer subset for an isolated receiver-side experiment. It is **not** a released client, a complete loudness algorithm, a gain controller, a perceptual loudness meter, or full RNNoise denoising.

## What passed

- A second clean-directory build is byte-identical to the first final build. See clean-build.log.
- Genuine WebRTC M131 / freedesktop audio-processing 2.1 RNN features, pretrained weights, resampler, production VAD wrapper, speech estimator and noise estimator. Abseil is pinned to the fixed 20240722.1 release. All 663 WebRTC and 1,538 Abseil archive files remain unmodified.
- Emscripten **4.0.20**, official emsdk release c387d7a7e9537d0041d2c3ae71b7538cc978104e. Genuine debug checks are retained and enforced by a static assertion. No DSP/check/weight stubs, x86 objects, relaxed floating-point math, or SIMD instructions in the WASM.
- Official 889-frame golden regression: maximum probability error **1.2517e-6**, mean **7.1606e-8**. Original limits remain per-frame <=1e-3 and mean <1e-4. Golden mode deliberately has no periodic RNN reset; production mode retains the official 1,500 ms reset.
- Seven exact prepared real-speech/noise scenarios, **46,385 frames**, compared against the earlier native traces: maximum probability difference **3.7552e-6**; historical confidence identical; worst accumulated speech-level difference **1.145e-5 dB**. Full WASM CSV traces and input SHA-256 values are included.
- Strict rates/scales/frame lengths; stale handles; invalid-input atomicity; reset replay; cross-stream state independence; arbitrary render-quantum accumulation; capacity at 32 streams; 1,000 additional create/reset/destroy cycles with stable post-cleanup heap.
- Successful processing performs **zero observed malloc/calloc/realloc/free calls**. Linker wrappers are verified to observe constructors. The WASM has **no memory.grow instruction**; its declared memory minimum and maximum are both 256 pages (16 MiB). JS processing uses pre-created typed views and no explicit per-quantum allocation.

These are numerical/engineering checks, not human speech-activity accuracy or an end-to-end output-gain safety claim. The earlier speech/noise findings still apply: historical confidence is not current activity, and the official noise estimator can react slowly to increased noise.

## Deliverable sizes and memory

The final dist/gryt-rnn.wasm is **91,173 bytes** (about 89.0 KiB; gzip-9 approximately 45.3 KiB). SHA-256: 21b6eb801901c5250215ff6a29b83471b13cdf45b69ba3fe438770b391a1d95b.

Fixed linear memory is **16 MiB per module instance**, including a 256 KiB stack. Each module can hold 32 independent speaker states. Observed heap metric (including allocator overhead) was 77,976 bytes with one speaker, 311,784 with four, 1,247,016 with sixteen and 2,493,992 with thirty-two. It returned to 44 bytes after disposal; startup before first allocation was 40 bytes. Another 1,000 create/reset/destroy cycles did not increase that 44-byte allocator bookkeeping remainder.

Do not instantiate a separate 16 MiB module for every participant in production without budgeting it. A single-threaded AudioWorklet scope can share one module instance and use separate handles. Handles and modules are not thread-safe and must not be shared across concurrently executing threads.

## FloatS16 boundary and API

src/analyzer.h is the C ABI. Create with an integer rate from 8,000 through 48,000 Hz divisible by 100, mode 0 for the real production wrapper or mode 1 only for official golden parity. 22,050 and 96,000 Hz are rejected; callers must explicitly convert unsupported source rates before using this API.

The module owns preallocated input/output buffers, retrieved with gryt_input(handle) and gryt_output(handle). Write exactly sampleRate/100 **mono FloatS16** samples, then call gryt_process10ms(handle, sampleCount). Accepted range is [-32768, 32767], finite only. The complete frame is checked before state changes. Failed frames do not advance history or overwrite the prior result.

The browser/analyzer.mjs adapter accepts normalized [-1, 1] floats, validates the entire quantum first, multiplies by 32768 exactly once, and clamps the positive full-scale endpoint to 32767. It accumulates arbitrary quantum lengths into a fixed 10 ms buffer; it does not assume 128-sample callbacks. A partial final frame is reported, never zero-padded silently. The test exercises lengths 1, 7, 17, 128, 256, 480, 511 and 1024.

Output fields are separate: current speech probability, frame RMS/peak dBFS, accumulated speech level dBFS, estimated noise dBFS, historical speech-level confidence, and frame index. **Confidence is not an activity flag.** These values are not LUFS or ITU-T P.56 measurements. No gain application, gate, limiter or controller parameter changes are included.

create/reset/destroy allocate or free and must run outside the real-time process callback while the relevant stream is stopped. Reset reconstructs the complete state and invalidates cached WASM typed-array pointers; the JS adapter refreshes its views. Never concurrently process and reset/destroy a handle. Destroyed-generation handles are rejected. One module holds at most 32 live states.

The standalone WASM imports only fd_close/fd_seek/fd_write diagnostic host hooks. They are not DSP replacements. Upstream numeric-check failures retain their actual WASM trap/error path, and the JS host surfaces diagnostic output as an error.

## The 44.1 kHz difference was investigated

A 1-second 173 Hz tone plus deterministic noise produced probability max/mean differences of 0.001336/0.0001217 against the original native build. The input was the same FloatS16 bytes and 100 frames of 441 samples. This is **not** silently counted as a strict 1e-3 cross-build pass.

A four-way diagnostic isolated the difference to the native SIMD sinc-resampler path. Selecting the genuine upstream GetCPUInfoNoASM function only for the diagnostic native build reduced maximum difference to 4.7681e-7. Making both native resampler and PFFFT scalar reduced it to 1.7885e-7. Changing only PFFFT left the 0.001336 difference. No DSP arithmetic or weights were modified.

That tone test had zero disagreements at probabilities .95 or .5 and zero confidence disagreements. The original native-vs-WASM accumulated speech estimate differed by at most 0.0004693 dB, including 0.0004673 dB at the end.

Additionally, both complete warm speech→white/low-pass noise sequences were deterministically converted from 48 kHz to 44.1 kHz using scipy resample_poly(147,160), then fed byte-identically to all builds. Each was 80.4 seconds/8,040 frames, with the transition at frame 3,990. Against native SIMD, max probability error was 3.34e-6, with zero .95/.5/confidence disagreements and final speech-estimate difference below 4e-9 dB (CSV rounding scale). This supports bounded arithmetic-path differences on these tested inputs, not a guarantee for every threshold-edge input or unlimited-duration run. See results/44100-*-diagnostic.json.

## Node coarse performance, not browser performance

Cloud CPU: AMD EPYC 9V74. Node v24.19.0, repeated fixed real-speech frame, 100 warm-up batches then 500 timed batches. CSV I/O and construction are excluded. One batch processes one 10 ms frame per speaker:

| Streams | p50 ms/batch | p95 ms/batch | Worst ms/batch |
| ---: | ---: | ---: | ---: |
| 1 | 0.0393 | 0.0516 | 4.1802 |
| 4 | 0.1575 | 0.2149 | 1.6750 |
| 16 | 0.6524 | 0.8535 | 4.7910 |
| 32 | 1.3606 | 3.3990 | 5.1534 |

Shared-cloud scheduling outliers occurred. These are **Node WASM** smoke measurements, not AudioWorklet deadlines, browser/mobile battery costs, or a production concurrency budget. A render quantum at 48 kHz is often only about 2.67 ms even though an analyzer frame covers 10 ms, so comparing batch time solely to a 10 ms budget would be misleading.

## Browser verification: not run successfully

Actual AudioWorklet/browser loading, audio scheduling, underruns and performance remain **unverified**. Standalone Chromium could not start because the execution sandbox denied its local socket. The supported cloud browser first could not reach the project-only local server, then returned an explicit browser URL-policy denial. Testing stopped at that policy boundary. No alternate address, protocol or proxy was used to evade it. The temporary test server was stopped.

browser/analyzer-worklet.mjs and browser/test.html are an unverified, synthetic-only test harness. Their JS syntax was checked. They are designed to check 44.1/48 kHz offline rendering, unchanged passthrough, reset/disposal, and four muted synthetic real-time streams. They use no microphone, accounts or user profile data. Do not call this browser-tested or production-ready.

In a separately authorized, normally functioning browser test environment, serve this directory locally with node test/server.mjs, open its printed loopback URL plus /browser/test.html, and click “Run synthetic tests.” The harness writes a result file only if it runs. A passed continuity check still would not prove absence of audible underruns.

## Reproduce

The compact archive excludes the multi-gigabyte SDK, native executables and large real-speech inputs. It includes the real WASM, adapters, build scripts, pinned upstream source archives, official golden fixtures, results and licenses.

1. Use an existing Python 3, shell, curl and tar. Run bash setup_sdk.sh. It downloads the fixed official SDK to this project only (about 367 MiB compressed, approximately 2.1 GiB installed including retained packages). It does not install system packages or modify shell profiles/global PATH. Do not continue through any policy/security denial.
2. Run bash build.sh. EM_CONFIG and EM_CACHE are directory-local. Source archives and downloaded SDK hashes are verified by the supplied setup files. The build uses official scalar paths, retains assertions, and disables memory growth.
3. With any existing compatible Node, run node test/validate.mjs --smoke-only. This independently checks the included 889-frame fixture, guards, lifecycle, arbitrary quantum behavior, no-allocation processing, memory and coarse benchmarks.
4. For the full same-input native comparison, materialize the separate native and real-speech validation deliverables. Set AGC2_NATIVE_DIR to the native reference root and AGC2_VALIDATION_DIR to the real-speech root containing exported/ and agc2-csv/, then run node test/validate.mjs. Missing extended inputs cause failure; they are not silently skipped. AGC2_RESEARCH_DIR can override the included golden-fixture directory.

The original SDK installer removed its downloaded packages; they were fetched once more from the same official URLs to record SHA-256 and verify the official GCS Content-MD5. The reproducible setup keeps them the first time. The SHA-256 values are locally observed hashes of fixed official downloads, not claimed signed upstream checksum attestations.

## Licensing and scope

Preserve licenses/, sources.json and the notices in the included source archives. They cover WebRTC BSD-3-Clause and PATENTS; RNNoise-derived weights/activations; PFFFT/FFTPACK; Abseil Apache-2.0; and linked Emscripten, musl, libc++, libc++abi and compiler-rt runtime notices. The five-clip real-speech attribution remains in the separate input manifest; it is not replaced by this numerical parity report.

No user-PC edits, current-client changes, microphone recording, account creation, credential use, publication, deployment or gain/controller integration occurred. The next required gate is a real browser/AudioWorklet test in an authorized working environment, followed by integration-level output-gain and target-device/concurrency evaluation.
