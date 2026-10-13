# 12-seat SFU microphone fallback candidate

This directory is a review-only configuration candidate. It has not been
loaded into Docker, copied to Tencent Cloud, or applied to a running service.
It changes the SFU service only; the Gryt server and EasyTier service remain
separate.

The candidate keeps the existing authenticated audio-only hybrid switches and
raises the SFU peer guardrail from the currently observed six to twelve. Its
microphone receive offer is 16,000 bps and 60 ms, with the existing mono,
variable-bitrate, DTX and in-band-FEC policy. Screen/share tracks are still
excluded by `SFU_AUDIO_ONLY` and are not rewritten by the microphone policy.

`candidate.env.example` is a small SFU environment delta, not a complete
production environment and contains no secrets. Merge it only after the
matching client/SDK build is available. The source default remains 48,000
bps/20 ms for older deployments; leaving the two new variables unset retains
that behavior.

`rollback.env.example` describes the currently observed six-peer state and
removes the candidate-only microphone variables. Removing a variable is
intentional: setting `SFU_MICROPHONE_OPUS20=false` also disables the legacy
receive preference, while the old deployment did not have that switch enabled.
The former `../hybrid-d38ed22d/cutover.py` is historical evidence only and is
not part of this rollout. The bounded `deploy.py --phase rollback` below owns
rollback for this candidate and refuses to act when the recorded Compose or
container identity has drifted.

Validate only the static material with PowerShell 7:

```powershell
pwsh -File .\check-config.ps1
```

Before any real rollout, run a 12-participant authenticated test and inspect
`/rtp-observations` for actual RTP packet count, RTP bytes and header bytes.
SDP `maxaveragebitrate` alone is not a bandwidth measurement. The loopback
probe can reproduce the packet duration locally (from `components/sfu`):

```powershell
$env:GRYT_LOOPBACK_TEST_AUTHORIZED = '1'
$env:SFU_MICROPHONE_OPUS_MAX_AVERAGE_BITRATE_BPS = '16000'
$env:SFU_MICROPHONE_OPUS_PTIME_MS = '60'
& 'C:\Program Files\Go\bin\go.exe' run ./cmd/integration-probe
```

Its publisher emits a valid synthetic TOC at the selected duration, so the
probe measures Pion RTP packetization and SFU fan-out. It is not a browser
encoder or a WAN/ET test; the final 12-seat acceptance must supply twelve
authenticated concurrently publishing SDK/browser peers and sum the 132
directed egress observations.

For the bounded local 12-peer fan-out check already in this source tree, run:

```powershell
Set-Location D:\Dev\LaokuaiCloud\components\sfu
& 'C:\Program Files\Go\bin\go.exe' test -p 1 -count=1 -v `
  -run '^TestTwelveSyntheticPublishersProduceDirectedRtp$' ./cmd/integration-probe
```

The test uses loopback-only Pion peers and a test-only static server password;
it does not contact production. A passing run currently reports 132 streams,
60 ms packet duration and the aggregated RTP bytes. It is a forwarding and
packetization fixture, not a claim that arbitrary custom client profiles fit
the same 6 Mbps budget.

## Operator rollout helper

`deploy.py` is a bounded, operator-run helper for the Tencent Cloud host. It is
not a local deployment command and this repository does not execute its remote
phases. Run its pure guards from this directory with:

```powershell
python -m unittest discover -s .\puretests -p 'test_*.py'
```

The remote operator phases are `build`, `inspect`, `stage`, `activate`, and
`rollback`. The operator supplies an already cross-built Linux/amd64 SFU file,
its SHA-256, and the exact 40-character source commit. `build` verifies the ELF
header and creates a new image from the current local base image
`sha256:2b6afca88c4f7d6912c044d3b114d17af56104a4fce95ca7dc14cf0f04ec3a8f`.
It gives that verified local image a temporary build-only tag, then generates
a Dockerfile with one `COPY` and labels for the binary hash and source commit;
the command uses `--pull=false` and `--network=none`, contains no `RUN`, and
never downloads or executes the binary. The old image reference remains
available for rollback.

Example operator commands, to be run on the remote host after the binary has
been copied there, are:

```text
python3 deploy.py --phase build --binary /srv/stage/sfu --binary-sha256 <sha256> --source-commit <40-hex-commit>
python3 deploy.py --phase inspect
python3 deploy.py --phase stage
python3 deploy.py --phase activate
```

`inspect` compares each live environment with the merged Compose environment
in memory and emits only a safe summary. `stage` writes the complete merged
Compose snapshot to a remote mode `0600` private file and writes a separate
non-secret overlay/receipt. The fixed Compose inputs are the main file plus
`community-et-real-9db53f79/backend-sfu.override.json`,
`community-et-real-9db53f79/server-release-version.override.json`, and
`community-password-beta-a5c557be/server-password.override.json` under
`/opt/stacks/gryt`; the full snapshot is never printed or copied into a
receipt.

The activation allowlist is exact. The Gryt server keeps image
`sha256:9ddd8f97831436c5b4cae46b04e4c0a9b9afb34961aab5ce4c7d0a9fc80dfc81`
and receives `VOICE_MAX_USERS=12`. Only the SFU image and these SFU variables
change: `MAX_PEERS=12`, `SFU_MICROPHONE_OPUS20=true`,
`SFU_MICROPHONE_OPUS_MAX_AVERAGE_BITRATE_BPS=16000`, and
`SFU_MICROPHONE_OPUS_PTIME_MS=60`. Any change to mounts, networks, ports,
JWT/data environment, other services, or EasyTier causes staging or activation
to stop before a service is replaced.

Activation sends only a graceful TERM to the owned `server` and `sfu`
containers, then starts those two services individually with `--no-deps`,
`--no-build`, and `--pull never`. It waits for both health checks, compares
post-start mounts/network/ports/environment in memory, and attempts the same
service-scoped rollback if a health or identity check fails. Rollback keeps old
images and never starts, stops, or restarts EasyTier. A failed rollback is
reported for manual operator recovery; the helper never force-kills or prunes
images.

After activation, keep `activation.overlay.json` as part of the active Compose
inputs. Any later `docker compose config`, restart, or update that is intended
to retain this candidate must include the four fixed base files followed by
that overlay, or use the corresponding `deploy.py` phase. Running Compose with
only the base files renders the pre-candidate image and environment and can
silently prepare a downgrade; the helper does not control commands issued
outside it.
