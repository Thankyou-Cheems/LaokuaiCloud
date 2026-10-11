/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const inputs = ["src/lib/easyTierCommunity.ts", "src/lib/easyTierCommunitySubscriptions.ts", "electron/easyTierStatus.ts", "electron/easyTierMemberAdapter.ts", "electron/easyTierCommunityManager.ts", "electron/windowsEasyTierRuntime.ts", "electron/windowsEasyTierCliRuntime.ts", "electron/easyTierCommunityIpc.ts", "electron/easyTierTarget.ts", "electron/easyTierWindowsAssets.ts", "electron/easyTierExistingConfiguration.ts", "electron/easyTierWindowsProcesses.ts", "electron/easyTierWindowsProduction.ts"];
const program = ts.createProgram(inputs.map(p => path.join(root, p)), { noEmit: true, strict: true, noUnusedLocals: true, noUnusedParameters: true,
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  types: ["node"], skipLibCheck: true,
});
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: p => p, getCurrentDirectory: () => root, getNewLine: () => os.EOL }));
assert.equal(diagnostics.length, 0, "Community main/type contract diagnostics");
// Parse edited entrypoints without running Electron or claiming full application typecheck.
for (const p of ["electron/main.ts", "electron/preload.ts", "src/App.tsx", "src/components/communityLanSession.tsx"]) {
  const source = fs.readFileSync(path.join(root, p), "utf8");
  const parsed = ts.transpileModule(source, { fileName: p, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } });
  assert.equal(parsed.diagnostics?.length ?? 0, 0, p);
}
const main = fs.readFileSync(path.join(root, "electron/main.ts"), "utf8");
assert.ok(main.includes("IS_I18N_TEST && !IS_LAOKUAI ? null : easyTierProduction.runtime"), "Production adapter is injected; test package remains isolated");
assert.ok(main.includes("event.senderFrame === mainWindow.webContents.mainFrame"), "Only main renderer is trusted");
assert.ok(main.includes("(IS_I18N_TEST && !IS_LAOKUAI) || easyTierQuitDrained"), "Private app quits drain the owned core despite shared i18n isolation");
assert.ok(main.includes("easyTierCommunities.shutdownOwned()"));
// Check the new renderer component against the actual public server shape,
// without resolving/building the entire application or starting a browser.
const temporaryDirectory = fs.mkdtempSync(path.join(root, "node_modules", "et-renderer-types-"));
try {
  const declarations = path.join(temporaryDirectory, "socket.d.ts");
  fs.writeFileSync(declarations, 'declare module "@/socket" { export function useServerManagement(): { servers: Record<string, { host: string; name: string; serverId?: string; approvalRequestedAt?: number }>; currentlyViewingServer: { serverId?: string } | null }; }');
  const renderer = ts.createProgram([path.join(root, "src/components/communityLanSession.tsx"), declarations], {
    noEmit: true, strict: true, noUnusedLocals: true, noUnusedParameters: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], types: ["react"],
  });
  const errors = ts.getPreEmitDiagnostics(renderer);
  if (errors.length) process.stderr.write(ts.formatDiagnosticsWithColorAndContext(errors, { getCanonicalFileName: p => p, getCurrentDirectory: () => root, getNewLine: () => os.EOL }));
  assert.equal(errors.length, 0, "Community renderer contract diagnostics");
} finally {
  for (const file of fs.readdirSync(temporaryDirectory)) fs.unlinkSync(path.join(temporaryDirectory, file));
  fs.rmdirSync(temporaryDirectory);
}
console.log("Community main modules strict no-emit typecheck and entrypoint syntax checks passed; production configuration/permission gates remain closed by default");
