# Private startup and tray revision

Version 1.13.22-laokuai.squad.2 starts from client 94a21d6cb82a1810b917e64a8bf83bbc9d275576.
Squad, receive leveling, output routing and RNNoise fixes and independent profile remain unchanged.

The Welcome dialog is controlled by settingsLoaded + hasSeenWelcome. OnboardingTour starts only
from completeWelcome({startTour:true}). After loadForUser, the existing device/account ID and
nickname initialization still run; the private build then treats the teaching welcome as seen
in memory. No stored welcome/tour, nickname, account, server or audio preference is rewritten
to bypass teaching. Reloads apply the same private policy, including legacy false tutorial flags.
The local-ID generator, editable nickname, server join, login/pairing and OS media permission
flows remain available and are not preapproved. No identity or credentials are bundled.

All eleven runtime tray resource filenames (idle/live/muted/deafened and DPI/template variants)
map to the existing transparent 16/32/48px Cheems PNGs from the authorized image with SHA256
4352e18f092dd34ebb33e5e6a2c354d749a338244ed36c06cf6e5073da878123.
The same Cheems picture is used across states; voice status remains available in the tooltip
and voice controls. Existing EXE ICO is unchanged. This is a Windows-only private portable.

closeToTray defaults true through the existing config reader and explicit boolean false is
preserved. Private local guests can hide on X while a usable tray exists; no voice or graph
teardown is performed by hiding. Tray click/menu restores the window, and the menu provides
explicit Quit. Missing/empty/failed/destroyed tray permits close and hidden launch requires
a usable tray. Repeated creation is guarded. app.before-quit and update quit flags remain;
query-session-end/session-end allow Windows shutdown/restart/logoff without preventing them.
The desktop toggle has Chinese/English labels and the stable existing search anchor.

The real squad.1 startup log reproduced `uiohook unavailable: require is not defined`.
The Electron main build is ESM; loadUiohook used CommonJS require without defining it,
so the broker reported input-unavailable before starting the scope helper. squad.2 uses
createRequire(import.meta.url), preserving native module resolution and the existing
single input broker. Startup exceptions remain visible in the log; protection is not
disabled or replaced by DOM listeners. Earlier package hash checks only proved that the
native file existed; they did not exercise this ESM loading boundary.

Run node scripts/check-private-startup.mjs for the actual main handlers with fake Electron,
plus Playwright e2e/i18n-tests/startup.spec.ts for new/legacy isolated stores and the real
desktop setting component. These do not prove an actual call survives Windows tray hiding,
nor do they issue real OS shutdown, keyboard capture, microphone recording or production joins.
check-uiohook-esm.mjs runs the old/fixed loaders in real Electron 40.6.1 without starting
hooks. check-private-native-runtime.cjs uses a new temporary profile and packaged assets,
starts/stops the native hook with no key/mouse listeners or event recording, and checks
actual nativeImage/Tray/hidden BrowserWindow close handling. No production app is loaded.
