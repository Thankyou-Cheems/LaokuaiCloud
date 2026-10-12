# Receive-prior reliability validation / 接收响度缓存验证

Base: `3a6c794fe6e904ad195fafcd70a8a51d65632b60`; client/Voice trees match frozen `84292bfef11d3cf45987d6fa963b86e52ddbbf7a`. This separate experience-fix branch does not redefine the frozen executable.

## Changes

- Use the SDK's accepted-audio clock to recognize fresh speech after same-track mute, leveling disable or processor recovery resets the speech counter. Duplicate/stale observations do not renew the prior or add historical speech weight. Missing clock data fails closed.
- Keep accepted priors current in memory and opt the product bridge into one fixed 1000 ms persistence window. Flush on route retirement, account change, clear, hidden/pagehide and teardown. Preserve immediate persistence for existing default cache callers.
- Contain storage failures, cancel pending work, and prune expired rows before overflow eviction. Passive reads do not restart timers or force writes.

No DSP algorithm, target, AGC default, cache schema, protocol, server, native payload, package dependency or lock-file changes are included.

## Verified

- All 825 actual client/Voice build inputs were checked against their Git blob IDs. Original locked private UI and Voice archives were retained.
- Complete original SDK typecheck/build passes. All 170 emitted dist files are byte-identical to the locked Voice archive.
- Original client and this candidate pass complete renderer/Electron TypeScript graphs, Vite web production builds, and affected-file ESLint with zero warnings. Installed Voice dist matches the locked archive in both trees.
- Existing cache/session checks pass (21 each). New audio-cursor and bounded-persistence suites pass (9 and 13 groups). Independent review adds 14 storage/lifecycle fault groups.
- Actual embedded receive Worklet/RNN, Controller, registry and session tests reproduce baseline persistence stopping after three counter-reset paths; the candidate continues accepting fresh speech. Test audio is a public reference fixture and nodes/timers are controlled.
- A 120-second public-PCM trace reduces writes from 653 to 79 for four routes, 805 to 82 for five, and 3172 to 101 for twenty. Final priors are exactly equal. These are phase-shifted instances of one fixture, not measured human conversation duty cycles or browser CPU acceptance.

Standalone client regressions:

    node scripts/check-receive-prior-cache.mjs
    node scripts/check-receive-prior-session.mjs
    node scripts/check-receive-prior-audio-cursor.mjs
    node scripts/check-receive-prior-persistence.mjs

The one-second window is scheduled, not hard real time: a suspended/stalled renderer can delay it, and abrupt termination can lose recent unflushed scalar statistics. Previous durable priors remain usable. No recorded audio is stored. Browser/device, actual-call, perceptual loudness, game-load and native-package acceptance remain separate.
