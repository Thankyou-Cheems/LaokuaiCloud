/* eslint-env node */
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { unzipSync } from "fflate";
import ts from "typescript";

// Explicit static packaging step. Never execute ET, CLI, driver or helper.
// The official console/web executables are not copied into the product.
const root = fileURLToPath(new URL("../", import.meta.url));
function compile(file, dependencies) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: key => {
    if (!(key in dependencies)) throw new Error("unexpected packaging dependency");
    return dependencies[key];
  } });
  return exports;
}
const targetModule = compile("electron/easyTierTarget.ts", {});
const target = targetModule.EASYTIER_WINDOWS_TARGET;
const { verifiedEasyTierArchive } = compile("electron/easyTierWindowsAssets.ts", {
  "node:crypto": crypto, "node:fs/promises": fsp, "node:path": path, fflate: { unzipSync },
  "./easyTierCommunityManager": { EasyTierOperationError: Error }, "./easyTierTarget": targetModule,
});
const flag = process.argv.indexOf("--archive");
if (flag === -1 || !process.argv[flag + 1]) throw new Error("Use --archive with the downloaded official Windows archive. This command never downloads or executes runtime components.");
const contents = verifiedEasyTierArchive(fs.readFileSync(path.resolve(process.argv[flag + 1])));
const output = path.join(root, "build", "community-lan", "runtime", target.archiveSha256);
await fsp.mkdir(output, { recursive: true });
for (const [name, value] of Object.entries(contents)) await fsp.writeFile(path.join(output, name), value);
console.log(`Prepared ${Object.keys(contents).length} hash-verified runtime files; management console excluded; no runtime started`);
