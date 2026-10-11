/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";
const source = stripTypeScriptTypes(fs.readFileSync("electron/privateProfile.ts", "utf8"));
const { privateProfilePaths } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "laokuai-profile-path-fixture-"));
const original = path.join(root, "Original profile");
fs.mkdirSync(path.join(original, "IndexedDB"), { recursive: true });
fs.writeFileSync(path.join(original, "gryt-global.json"), '{"synthetic":true}');
const before = fs.readFileSync(path.join(original, "gryt-global.json"), "utf8");
assert.deepEqual(privateProfilePaths(true, [], root), { data: path.join(root,"laokuai-chat-data"), sessions:path.join(root,"laokuai-chat-data/sessions"),reuseExisting:false });
for (const argv of [[`--user-data-dir=${original}`], ["--user-data-dir", original]]) {
  assert.deepEqual(privateProfilePaths(true, argv, root), { data: original, sessions: original, reuseExisting:true });
}
for (const argv of [["--user-data-dir=relative"], ["--user-data-dir="], [`--user-data-dir=${root}`], ["--user-data-dir",original,`--user-data-dir=${original}`]]) {
  assert.throws(()=>privateProfilePaths(true,argv,root));
}
assert.equal(privateProfilePaths(false,[`--user-data-dir=${original}`],root).reuseExisting,false);
assert.equal(fs.readFileSync(path.join(original,"gryt-global.json"),"utf8"),before);
assert.deepEqual(fs.readdirSync(original).sort(),["IndexedDB","gryt-global.json"]);
fs.writeFileSync("profile-selection-check.json",JSON.stringify({status:"passed",cases:9,syntheticOnly:true,credentialCopies:0,originalSessionRootPreserved:true},null,2));
console.log("PASS explicit profile selection, default isolation, session root, invalid/conflicting paths; no profile contents changed");
