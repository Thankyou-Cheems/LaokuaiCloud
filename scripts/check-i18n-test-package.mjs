/* eslint-env node */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const config = require("../electron-builder.i18n-test.cjs");
assert.equal(config.appId, "local.laokuai.chat.i18n-test");
assert.equal(config.extraMetadata.grytI18nTest, true);
assert.equal(config.extraMetadata.name, "laokuai-chat-i18n-test");
assert.equal(config.publish, null);
assert.deepEqual(config.protocols, []);
assert.deepEqual(config.win.target, [{ target: "portable", arch: ["x64"] }]);
assert.ok(config.electronLanguages.includes("zh-CN"));
assert.ok(config.extraResources.every((entry) => !/build\/(embedded-|helper\/)/.test(entry.from)));
await config.beforeBuild();

// Exercise data isolation with a mocked Electron app, without loading Electron,
// touching any real client data, registering anything or running an executable.
const calls=[];
const app={ getAppPath:()=>"fixture-app", setName:(...args)=>calls.push(["name",...args]),
  setPath:(...args)=>calls.push(["path",...args]), setAppUserModelId:(...args)=>calls.push(["appId",...args]) };
const body=stripTypeScriptTypes(readFileSync(join(root,"electron/i18nTestVariant.ts"),"utf8"))
  .replace(/^import .*;$/gm, "").replace(/^export /gm, "");
const load=(metadata,portableDir)=>new Function("app","readFileSync","mkdirSync","dirname","join","process",`${body}\nreturn {isI18nTestPackage,isolateI18nTestData};`)(
  app,()=>JSON.stringify(metadata),(...args)=>calls.push(["mkdir",...args]),dirname,join,
  {execPath:join("fixture-extracted","test.exe"),env:{PORTABLE_EXECUTABLE_DIR:portableDir}});
assert.equal(load({},undefined).isI18nTestPackage(),false);
assert.equal(load({grytI18nTest:true},undefined).isI18nTestPackage(),true);
load({grytI18nTest:true},"fixture-portable").isolateI18nTestData();
assert.ok(calls.some((call)=>call[0]==="path" && call[1]==="userData" && call[2]===join("fixture-portable","laokuai-chat-i18n-test-data")));
assert.ok(calls.some((call)=>call[0]==="path" && call[1]==="sessionData" && call[2]===join("fixture-portable","laokuai-chat-i18n-test-data","sessions")));
calls.length=0;
load({grytI18nTest:true},undefined).isolateI18nTestData();
assert.ok(calls.some((call)=>call[0]==="path" && call[1]==="userData" && call[2]===join("fixture-extracted","laokuai-chat-i18n-test-data")));

const main=readFileSync(join(root,"electron/main.ts"),"utf8");
assert.ok(main.indexOf("if (IS_I18N_TEST) isolateI18nTestData();") < main.indexOf('const LOG_PATH'));
assert.match(main, /if \(!IS_I18N_TEST\) \{\s*if \(process.defaultApp\)/);
assert.ok(main.includes('const canHostRichPresence = !IS_I18N_TEST && !process.mas;'));
assert.ok(main.includes('const canOpenAtLogin = !IS_I18N_TEST'));
for (const name of ["turnHelperOn","turnHelperOff","syncHelperAtLaunch","cleanupLegacyWindowsInstallBackup","pinFeedToNewestCompleteRelease","newestReleaseWithoutApi","checkForUpdatesInBackground","offerRelease","initBackgroundUpdater","installOnQuit","installDownloadedUpdate","installNewestUpdate","downloadAnnouncedRelease","launchedDuringAnUpdate"]) {
  const start=main.indexOf(`function ${name}(`);
  assert.ok(start>=0,name);
  assert.ok(main.slice(start,start+250).includes("if (IS_I18N_TEST)"),`${name} must return before its first side effect`);
}
console.log("Isolated test metadata, portable/unpacked data paths and update/helper/protocol guards passed without running Electron");
