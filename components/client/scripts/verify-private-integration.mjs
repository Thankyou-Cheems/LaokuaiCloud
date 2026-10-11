/* eslint-env node */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const results = [];
const checks = [
  ["typecheck", ["node_modules/typescript/bin/tsc", "-b"]],
  ["lint", ["node_modules/eslint/bin/eslint.js", ".", "--ext", "ts,tsx", "--fix", "--report-unused-disable-directives", "--max-warnings", "0"]],
  ...["check-private-startup", "check-private-profile", "check-private-defaults", "check-private-relaunch",
    "check-notification-prefs", "check-message-notification", "check-uiohook-esm", "check-settings-index",
    "check-comment-length", "check-i18n", "check-squad-mode", "check-squad-broker", "check-voice-modes",
    "check-output-device", "check-laokuai-integration", "check-hotkeys", "check-screen-audio",
    "check-receive-leveling", "check-receive-aliases", "check-nickname-scope", "check-nickname-display-scope",
    "check-receive-volume-shortcut", "check-receive-correction", "check-i18n-completion",
    "check-settings-search-i18n", "check-localized-copy-helpers", "check-private-profile-rebrand"].map(name => [name, [`scripts/${name}.mjs`]]),
];
for (const [label, args] of checks) {
  const result = spawnSync(process.execPath, args, { windowsHide: true, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  writeFileSync(`integration-${label}.txt`, result.stdout ?? "");
  writeFileSync(`integration-${label}.stderr.txt`, result.stderr ?? "");
  results.push({ label, exit: result.status });
  writeFileSync("integration-check-results.json", JSON.stringify(results, null, 2));
  console.log(`${label}: ${result.status}`);
}
if (results.some(result => result.exit !== 0)) process.exitCode = 1;
