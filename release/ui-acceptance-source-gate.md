# Internal hidden UI source checkpoint

The branded-only `--laokuai-ui-check-dir=<absolute fresh empty directory>` is
integrated for a separately coordinated internal UI test. Its directory basename
must be `laokuai-ui-check-` followed by letters, digits, underscores or hyphens.
Never pass the option to the frozen83dd artifact: that executable predates it.
Normal launches without this option use the original product paths and behavior.

The real main/preload/renderer remain in use. The source sets independent
userData/sessionData/crashDumps and identity before stores/logging/instance lock,
serves real dist assets through a secure custom protocol, denies media permission
and session requests to outside origins, and skips HTTP/mDNS/RPC/native/hook/
helper/updater/show/tray activation. IPC retains only explicit real settings and
store handlers; unavailable operations return errors, not synthetic identities,
communities, roster or transport state.

Owner patch dc51a377f823be3365f37d51bb87f4fe5bb4eca24b3d2517c2bf4fa0e877b9b0
applied without conflicts. Integration adaptations are import sorting, an
Electron listener type instead of explicit any, and central UI guards for update
checks/download/install/periodic callbacks and old-install-backup deletion. The
owner skipped startup update wiring, but an unexpected focus event still reached
an unguarded update function; these guards also cover that path. Ordinary product
conditions remain effective when the UI option is absent.

Reproduce only pure/type checks from components/client with
`node --max-old-space-size=1536 scripts/check-ui-acceptance-mode.cjs <own-fixture-dir>`.
The checker creates only dedicated fixture files/junctions and uses mocked
Electron ports and a noEmit compiler overlay. The integration run passed23
checks, full tsconfig.node checking and targeted main/mode ESLint. No Electron,
product process, listener, native binary, hook, capture or real DOM was executed.

Before the UI owner starts a new build, freeze its exact source, dependency lock,
SDK/native resource/helper hashes and internal-only build receipt. Inspect actual
compiled guards, import-time behavior, preload and packaged/asar protocol paths.
The12-second observer starts when the BrowserWindow is created, so the external
owner also needs a bounded startup watchdog. Verify actual owned processes,
sockets, hidden/no-focus state and DOM/viewport evidence during the separately
coordinated run. Chromium webRequest is not an OS/WebRTC firewall. Any unexpected
show/focus, listener or helper is a failed boundary check, not a success inferred
from these source tests.

The fresh unauthenticated profile cannot accept member rows, community details or
in-call menus. Those need separately authorized authentic accounts or an isolated
fixture with explicit provenance. No fake snapshot is permitted. UI execution,
device/media/native/coexistence, legal distribution and final packaging remain
unaccepted. ready=false, finalPackage=null and publicDistributionApproved=false.
