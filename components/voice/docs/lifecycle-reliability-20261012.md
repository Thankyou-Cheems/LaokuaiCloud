# Voice lifecycle.3 source and validation

This independent experience-fix candidate is based on frozen integration `3a6c794fe6e904ad195fafcd70a8a51d65632b60`. The earlier receive-prior fixes are independently preserved at `cb209bd24fd47f2d0ff6841e5032c118678c441f`. The frozen executable and release branch are not redefined.

## Source and package identity

The modified preferred SDK source, package lock and regression tests are ordinary files under `components/voice`. The client consumes the separately named `components/client/vendor/gryt-voice-0.6.2-laokuai.lifecycle.3.tgz` through its file dependency and Yarn lock.

- New SDK archive: 3,779,305 bytes; SHA256 `897b597926cad23447f057e2b45e95f47806ddfba2f6808e6beb32f80eec49ae`.
- Retained original SDK archive: SHA256 `8abea479d053b6310e8c97746ae8b07f153a17d691dc20bdd5a241b6fe90caed`.
- Separate audit source supplement: SHA256 `ba1a901a0618b0728f58b9c329e80f0547f35a9b1177d37886ed0b09ada85a8d`. Its delivery archive is not duplicated in this repository. The actual corresponding SDK source is present here.

The new vendor package retains all 212 paths. Only four lifecycle JavaScript modules, two declarations and package.json change; all 41 non-dist static files retain the original bytes. The SDK remains AGPL-3.0-only and original third-party notices, licenses, source archives and attribution remain intact. The unchanged WebRTC/Abseil archives are dependency source, not substitutes for the modified SDK TypeScript. This records provenance rather than granting publication rights or asserting complete product distribution clearance.

## Verified build and regressions

The SDK owner and a separate reviewer passed 52 permitted offline SDK checks; 16 other registered checks were explicitly unrun. The independently combined client/SDK tree passes complete SDK typecheck/build, offline frozen-lock client install, complete renderer/Electron typechecking, Vite web production build, six-module targeted ESLint with zero warnings, and 14 focused/mounted regression scripts. New archive, rebuilt SDK and actually installed client SDK match in all 170 dist files. An independent repack also reproduced the complete vendor SHA above exactly.

The full server baseline and candidate each pass no-emit typechecking and complete TypeScript emission with zero diagnostics. All 226 acquired original inputs match their Git blobs; each build emits 218 JavaScript files, with only socket/handlers/voice.js changing in the candidate. Installation uses the original frozen Yarn lock and skips lifecycle scripts. This verifies compilation, not a running or deployed server.

The corrected cases include grants after Leave, stale PC/socket ownership, queued old SDP, codec-terminal cleanup, remote-track replacement, ambiguous legacy room errors, and room changes after signaling but before ICE connects. Versions 1 and 2 remain superseded test candidates; earlier passed checks did not cover later discovered counterexamples. Real browser/device calls, actual network transport, native runtime, desktop packaging and perceptual acceptance remain separate. No deployment is performed by these source changes.

## Reproduce from this commit

From `components/voice`, run `npm ci --ignore-scripts`, `npm run typecheck`, then `npm run build`. This checks generated worklets and compiles the complete SDK, without running native dependency build scripts.

To reproduce the vendor archive, use a fresh staging directory. Extract the retained `gryt-voice-0.6.2-laokuai.receive-path.1.tgz` into it. Replace only staging `package/dist` with the just-built SDK dist and staging `package/package.json` with this commit's SDK package.json. Run `npm pack --ignore-scripts --offline` inside staging `package`. This exact procedure reproduced the new archive SHA with Node 24.19.0 / npm 11.9.0. Preserving the original static files matters: 36 text files have CRLF in the archived Windows package and LF in Git; their text is otherwise identical. The other five static files already match Git byte-for-byte.

To export a new source archive from a checkout of this commit, run:

    git archive --format=tar.gz --prefix=voice-lifecycle.3-source/ -o voice-lifecycle.3-source-from-commit.tar.gz HEAD components/voice

That exports the complete tracked SDK directory. Its layout/container hash differs from the separately sealed audit supplement; do not label it with the supplement's SHA. Build it using the same locked SDK commands above. Keep all notices and corresponding source together when reviewing any later authorized distribution.
