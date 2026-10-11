# Optional voice-mode semantic diagnostics

Baseline: official Gryt server v1.10.58, source fa184e7456afc291a73fd7113e664eee8fcbbc7a.
package.json 1.0.76 is upstream source metadata, not the product release version.
Only runtime source changes: src/socket/handlers/voice.ts registration and new voiceMode.ts.
No database schema, owner, identity, token, SFU, permission or persistent setting changes.
No new dependency, unchanged package.json/yarn.lock. Bundle external modules remain sharp and jsdom.

Events: voice:mode:capabilities -> ACK {v:1,supported:true}; voice:mode:set -> ACK {accepted:boolean};
voice:mode:fetch -> ACK array; server voice:mode broadcast only to caller's current joined voice room.
State whitelist: v=1, monotonically increasing seq, inputMode voice_activity|push_to_talk,
squad off|standby|armed|suppressed|resuming|unavailable,
transmit normal|manual-muted|server-muted|ptt-idle|squad-suppressed|resuming|pending|suspended|error.
Every extra field is rejected; identity/room derive from identified server-side clientsInfo.
No keys, process names, paths, tokens or raw events are transmitted.
These values are self-reported UI diagnostics; they do not authorize speaking or alter mute/SFU enforcement.
12 accepted updates/second per socket, duplicate semantics <500ms coalesced, fetch cooldown250ms, cacheTTL8s.
Disconnect socket removal/stream replacement/current-room validation excludes stale fetch entries.
Client sends2s heartbeat; client expires6s with1s timer, clears on disconnect/room/roster changes.
Old clients need no change and retain all existing handlers; new clients detect capability before sending states.
Old server without capability leaves remote mode unknown. No mode guessed from audio activity.

Validation on Windows Node22.23.2: frozen Yarn install (ignore-scripts/ignore-engines), full tsc,
15 actual loopback Socket.IO checks with four isolated fixture clients plus anonymous/reconnecting fixtures;
19 client/server pure contract checks; 50 existing voice join/access/speak/capability/recovery assertions;
scoped eslint and repository comment checker; official esbuild Node22 bundle flags.
First unmodified voice test cleanup failed EBUSY on Windows because SQLite fixtures were open.
Test-only windows-voice-test-cleanup.cjs closes only matching gryt-* fixture databases directly inside os.tmpdir
before cleanup; all original assertions are unchanged. Initial failure evidence is retained.
No actual microphone/owner key/profile, real game input, production connection or real call in local tests.

Rebuild: yarn install --frozen-lockfile --ignore-scripts --ignore-engines --network-concurrency1;
node node_modules/typescript/bin/tsc; node scripts/check-voice-mode-socket.mjs;
node scripts/build-voice-mode-delivery.mjs (Node22). Windows test preload is exclusively test harness code.
Deploy only through deployment owner after checking old image ID and bundle SHA. Reuse exact official
image sha256:5dab9fcc4f4284889e6b4c069fbc5418bf0f36fac71f85423d8a66d0d8b11df8 and COPY only /app/bundle.js.
Keep /opt/stacks/gryt/data, owner identity, SFU/Caddy/domain/network unchanged. No migration or admin command.
Rollback: restore previous container image/config, preserving the same data mount; no database rollback needed.
