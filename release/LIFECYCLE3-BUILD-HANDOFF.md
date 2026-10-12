# lifecycle.3 Windows build owner handoff

This is a local source freeze, not a Windows executable or permission to start
a build. Parent assigns exactly one builder; Task6 starts no concurrent heavy
job, app, helper, listener or TUN. No remote sync is performed.

The build-input source commit is cb31e2e4ec044a2574f88321bc90cc01c3b51e0c; tree
5c526da271470077e716de26f34eb6cb668ce3da, recovered from baseline 3a6c794fe6e904ad195fafcd70a8a51d65632b60.
The final documentation commit and tree are recorded in the detached
LOCAL-FREEZE-HANDOFF.json outside Git, avoiding a self-referencing commit pin.
Use a fresh builder checkout of that final commit, not this owner working tree.
Original release/integration-20261011 stays at3a6c794f.

Prior cb209bd was unavailable locally, so its complete eight-file patch was
applied once as 1574d1bcfcf9225ff4a2b9cb82429378c5c30ffd. Those exact candidate Git blobs match
the delivery. Do not apply prior again. Lifecycle.3 is24 exact manifest paths,
with no conflicts or other product source changes. No .1/.2 package is used.

SDK: components/client/vendor/gryt-voice-0.6.2-laokuai.lifecycle.3.tgz
version0.6.2-laokuai.lifecycle.3,3779305 bytes, SHA256
897b597926cad23447f057e2b45e95f47806ddfba2f6808e6beb32f80eec49ae, SHA1
586b11c4382ff326a25ff555e9f94f50ddca9de8. Client devDependency and Yarn resolved
pin point to this exact package. Client lock SHA256
6b85a483ac898e251ea9f889136a6251b5f25ea1a3b87aa925313aaf96997cea; SDK lock
SHA256c35a6567a0355c3445cf04bea4a12f368a8ead7e7e4dcf71a91c1061c10f3124.
Custom UI gryt-ui-0.44.0-zh-cn.tgz remains1273112 bytes, SHA256
a2f38b3efb98dec64df486d11472d93e0c61bc7e36770a19f27d12b15f8d9822.
Keep original receive-path.1 and all historical artifacts.

Local verification:16 delivery member hashes, prior8 and lifecycle24 SHA/Git
blob identities;212 archive paths,170 dist paths,41 byte-identical static
resources; dependency/lock/archive identity; eight deterministic guarded VM/
fake-clock suites and14 script syntax checks pass. Node22.23.2/TypeScript5.9.3
were used locally. No install/full typegraph/SDK build/web/desktop/native package
build or mounted React runtime occurred in Task6. Full cloud SDK/client/server
checks and352-batch ~5.87-hour offline logical-user soak are delivered summaries,
not independently replayed local proof. Raw cloud harness is not in this ZIP.

After separate parent build assignment, acquire exact locked dependencies with
ignore-scripts in the builder's fresh checkout, preserving frozen Yarn/npm
locks. Record tool versions: cloud used Node24.19.0/npm11.9.0/Yarn1.22.22/
TypeScript5.9.3; prior Windows producer used Node24.10.0. Do not silently call
these identical toolchains. Check complete SDK/client/server typegraphs as
applicable, web/desktop outputs, and actually installed212 SDK files against
the exact lifecycle.3 tar. Package reproducibility requires staging the old
receive-path.1 static files, replacing only dist and package.json with rebuilt
SDK output; see components/voice/docs/lifecycle-reliability-20261012.md.
Do not overwrite the supplied vendor package or old source artifacts.

Native payload/source/driver/resource identity is unchanged: modern source
089b6182, coref716a113, CLI1ad46380, runtime input ZIP17bdccba. Exact native
resource receipts remain in components/easytier/provenance.json; do not rebuild
native or substitute test-only recipient marker binaries. The previous full
app842 portable3cff0c00 is immutable and lacks these32 new product paths.
Use the established separately reviewed internal-only packaging wrapper in a
fresh build-owner layout; adapt/pin layout only under parent assignment, retain
production license/activation gates false, label INTERNAL-CANDIDATE and publish
never. Do not treat that wrapper as public distribution authorization.

Freeze actual source/tool/runtime inputs, outputs/ASAR/package hashes and source
parity for the new candidate. No launch is part of packaging. Parent separately
schedules Windows bootstrap, authentic devices/two-way listening/media/TUN/
coexistence/capacity acceptance. Offline logical-user tests are not20 physical
clients or real calls. Server source is integrated; server deployment is not.
ready=false/finalPackage=null. Keep old failures and known approval boundaries.
