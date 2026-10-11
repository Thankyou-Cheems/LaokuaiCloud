/* eslint-env node */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { inventory,verifyPayload,verifyPortable } = require("./laokuai-package-audit.cjs");
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index+1]; };
const root = path.resolve(option("--root") || fileURLToPath(new URL("..",import.meta.url)));
const output = path.resolve(option("--out") || path.join(root,"build/legal/LAOKUAI-PACKAGE-MANIFEST.json"));
let report;
if (option("--payload")) {
  if (!option("--manifest")) throw Error("--payload requires --manifest from the exact final build");
  if (!option("--out")) throw Error("--payload requires a separate --out report (preserve the manifest)");
  const manifest = JSON.parse(fs.readFileSync(option("--manifest"),"utf8"));
  report = verifyPayload(path.resolve(option("--payload")),manifest);
  if(option("--portable")) report.portable=verifyPortable(path.resolve(option("--portable")),manifest);
} else {
  report = inventory(root,require(path.join(root,"electron-builder.laokuai.cjs")),{ sourceOnly:args.includes("--source-only") });
}
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(report,null,2)+"\n");
console.log(`PASS static package ${option("--payload") ? "archive" : args.includes("--source-only") ? "source inventory" : "preflight"}: ${report.version}; Voice ${report.voice?.version || report.voiceVersion}; ${output}`);
