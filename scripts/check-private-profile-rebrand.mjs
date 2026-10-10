import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "laokuai-brand-profile-fixture-"));
fs.writeFileSync(path.join(profile, "gryt-global.json"), '{"synthetic":true}');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const cases = [];
for (const mode of ["write", "read"]) {
  const result = spawnSync("node_modules/electron/dist/electron.exe", ["scripts/check-private-profile-native.cjs", profile, mode, "4781"],
    { env, windowsHide: true, encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  const evidence = JSON.parse(fs.readFileSync(path.join(profile, `result-${mode}.json`), "utf8"));
  assert.equal(evidence.applicationName, mode === "write" ? "老蒯聊" : "唠蒯");
  cases.push(evidence);
}
fs.writeFileSync("integration-profile-rebrand.json", JSON.stringify({ status: "passed", cases, profile: "synthetic Temp only", credentialsReadOrCopied: false }, null, 2));
console.log("PASS two hidden real Electron processes: old display name writes synthetic IndexedDB; 唠蒯 reuses exact profile/session/origin and reads it");
