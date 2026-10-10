# Rebuild the private Squad portable

Use Windows x64, Node 24.10.0, Yarn 1.22.22, Visual Studio 2022 C++ tools/Windows SDK.
The exact dependency lock is yarn.lock; only the local Voice vendor tar differs from the previous private release.
Do not use npm/pnpm to regenerate this lock. Disable publish and install scripts; install Electron runtime explicitly.

```powershell
yarn install --frozen-lockfile --ignore-scripts --network-concurrency 1
node node_modules/electron/install.js
cmd /d /c native\build.bat
cmd /d /c native\squad-scope\build.bat
node node_modules/typescript/bin/tsc -b
node node_modules/eslint/bin/eslint.js . --ext ts,tsx --report-unused-disable-directives --max-warnings 0
node scripts/check-squad-mode.mjs
node scripts/check-squad-broker.mjs
node scripts/check-i18n.mjs
node scripts/check-output-device.mjs
node scripts/check-laokuai-integration.mjs
$env:ELECTRON = '1'
node node_modules/vite/bin/vite.js build
node node_modules/electron-builder/cli.js --config=electron-builder.laokuai.cjs --win portable --x64 --publish never
```

Run builds BelowNormal with affinity 3, UV_THREADPOOL_SIZE=2, CHILD_CONCURRENCY=1, GOMAXPROCS=2, RAYON_NUM_THREADS=2.
There is no executable launch in these steps. Runtime single EXE needs no compiler/installer/admin.
The existing complete dependency materials archive is supplied separately in delivery/gryt-build-dependency-materials.zip;
use its verified npm archives/Electron40.6.1/Windows tool archive plus this new vendor tar and matching Voice source ZIP.
Full UI tests use e2e/playwright.i18n.config.ts, one worker/headless, synthetic profile, deny real media and external requests.
Server protocol check requires sibling gryt-server-squad-work; server delivery includes its separate full source/lock and test instructions.
Frozen Voice source commit: 02508768310d9c359b445549de4cf77d4f37a4c3.
Input helper uses /MT static CRT. It needs no runtime install; --fixture exits before any desktop/key observation.
