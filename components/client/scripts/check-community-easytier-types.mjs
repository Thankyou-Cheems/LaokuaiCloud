import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const inputs = ["src/lib/easyTierCommunity.ts", "electron/easyTierStatus.ts", "electron/easyTierMemberAdapter.ts", "electron/easyTierCommunityManager.ts", "electron/windowsEasyTierRuntime.ts", "electron/easyTierCommunityIpc.ts", "electron/easyTierTarget.ts"];
const program = ts.createProgram(inputs.map(p => path.join(root, p)), { noEmit: true, strict: true, noUnusedLocals: true, noUnusedParameters: true,
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [], lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
});
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: p => p, getCurrentDirectory: () => root, getNewLine: () => os.EOL }));
assert.equal(diagnostics.length, 0, "Community main/type contract diagnostics");
// Parse edited entrypoints without running Electron or claiming full application typecheck.
for (const p of ["electron/main.ts", "electron/preload.ts"]) {
  const source = fs.readFileSync(path.join(root, p), "utf8");
  const parsed = ts.transpileModule(source, { fileName: p, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  assert.equal(parsed.diagnostics?.length ?? 0, 0, p);
}
const main = fs.readFileSync(path.join(root, "electron/main.ts"), "utf8");
assert.ok(main.includes("new EasyTierCommunityManager(null,"), "Default native activation must remain closed");
assert.ok(main.includes("event.senderFrame === mainWindow.webContents.mainFrame"), "Only main renderer is trusted");
assert.ok(main.includes("easyTierCommunities.shutdownOwned()"));
console.log("Community main modules strict no-emit typecheck and entrypoint syntax checks passed; native activation remains closed");
