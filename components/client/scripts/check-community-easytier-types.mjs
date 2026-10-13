/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const inputs = ["src/lib/easyTierCommunity.ts", "src/lib/easyTierCommunitySubscriptions.ts", "electron/easyTierStatus.ts", "electron/easyTierMemberAdapter.ts", "electron/easyTierCommunityManager.ts", "electron/windowsEasyTierRuntime.ts", "electron/windowsEasyTierCliRuntime.ts", "electron/easyTierCommunityIpc.ts", "electron/easyTierTarget.ts", "electron/easyTierWindowsAssets.ts", "electron/easyTierExistingConfiguration.ts", "electron/easyTierWindowsProcesses.ts", "electron/easyTierWindowsProduction.ts"];
inputs.push("electron/communityEnrollment.ts", "electron/easyTierElevationBroker.ts");
const program = ts.createProgram(inputs.map(p => path.join(root, p)), { noEmit: true, strict: true, noUnusedLocals: true, noUnusedParameters: true,
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  types: ["node"], typeRoots: [path.join(root, "node_modules/@types")], skipLibCheck: true,
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
// Exercise the actual constructor argument: isolation must prevent even grant wrapping.
const mainAst = ts.createSourceFile("main.ts", main, ts.ScriptTarget.Latest, true);
let runtimeArgument;
function findRuntime(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(mainAst) === "easyTierCommunities" &&
      node.initializer && ts.isNewExpression(node.initializer)) {
    runtimeArgument = node.initializer.arguments?.[0]?.getText(mainAst);
  }
  ts.forEachChild(node, findRuntime);
}
findRuntime(mainAst);
assert.ok(runtimeArgument, "Community manager must have an explicit runtime selection");
for (const preview of [false, true]) for (const isolation of [false, true]) {
  for (const i18n of [false, true]) for (const product of [false, true]) {
    let wraps = 0;
    const runtime = {}, wrapped = {};
    const selected = vm.runInNewContext(runtimeArgument, {
      LAOKUAI_PREVIEW: preview, UI_ACCEPTANCE_MODE: isolation, IS_I18N_TEST: i18n, IS_LAOKUAI: product,
      easyTierProduction: { runtime }, easyTierGrants: { wrap(value) {
        assert.equal(value, runtime); wraps++; return wrapped;
      } },
    });
    const isolated = preview || isolation || (i18n && !product);
    assert.equal(selected, isolated ? null : wrapped);
    assert.equal(wraps, isolated ? 0 : 1);
  }
}
assert.ok(main.includes("event.senderFrame === mainWindow.webContents.mainFrame"), "Only main renderer is trusted");
assert.ok(main.includes("(IS_I18N_TEST && !IS_LAOKUAI) || easyTierQuitDrained"), "Private app quits drain the owned core despite shared i18n isolation");
assert.ok(main.includes("easyTierCommunities.shutdownOwned()"));
// Resolve the real renderer contracts instead of maintaining a second, stale socket shape.
const config = ts.readConfigFile(path.join(root, "tsconfig.app.json"), ts.sys.readFile);
assert.equal(config.error, undefined);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, { noEmit: true });
assert.equal(parsed.errors.length, 0);
const renderer = ts.createProgram(parsed.fileNames, parsed.options);
const errors = ts.getPreEmitDiagnostics(renderer);
if (errors.length) process.stderr.write(ts.formatDiagnosticsWithColorAndContext(errors, { getCanonicalFileName: p => p, getCurrentDirectory: () => root, getNewLine: () => os.EOL }));
assert.equal(errors.length, 0, "Actual renderer contract diagnostics");
console.log("Community main and actual renderer no-emit types, entrypoint syntax and 16 runtime-selection cases passed; no product/native execution");
