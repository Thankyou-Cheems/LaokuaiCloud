/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
const config = require("./electron-builder.i18n-test.cjs");
config.appId = "local.laokuai.chat";
config.productName = "老蒯聊";
config.extraMetadata = { name: "laokuai-chat", productName: config.productName,
  grytI18nTest: true, grytLaokuai: true };
config.directories.output = "release-laokuai-squad";
config.win.icon = "private-brand/icon.ico";
config.win.executableName = "LaoKuai-Chat";
config.portable.artifactName = "LaoKuai-Chat-${version}-zh-CN-win-x64-slim-portable.exe";
config.extraResources = config.extraResources.filter(entry => entry.to !== "legal/I18N-PORTABLE-TEST.md");
config.extraResources = config.extraResources.map(entry => entry.to === "icon.png"
  ? { from: "private-brand/icon.png", to: "icon.png" } : entry);
config.extraResources.push(
  { from: "build/squad/squad-scope.exe", to: "squad/squad-scope.exe" },
  { from: "SQUAD-MODE.md", to: "legal/SQUAD-MODE.md" },{ from: "LAOKUAI-SELF-USE.md", to: "legal/LAOKUAI-SELF-USE.md" });
config.extraResources.push(
  { from: "node_modules/@gryt/voice/LICENSE", to: "legal/VOICE-AGPL-3.0.txt" },
  { from: "node_modules/@gryt/voice/third-party/Signalsmith-LICENSE.txt", to: "legal/Signalsmith-LICENSE.txt" },
  { from: "node_modules/@gryt/voice/third-party/Signalsmith-DSP-LICENSE.txt", to: "legal/Signalsmith-DSP-LICENSE.txt" },
);
config.win.signtoolOptions.sign = async () => { console.log("Local LaoKuai build: unsigned artifact"); };
const prepare = config.beforeBuild;
config.beforeBuild = async (...args) => {
  await prepare(...args);
  const fs = require("node:fs");
  for (const file of ["private-brand/icon.ico", "private-brand/icon.png", "public/laokuai-icon.png"]) {
    if (!fs.existsSync(file)) throw new Error(`Missing own-brand icon: ${file}`);
  }
};
// npmRebuild=false skips beforeBuild; validate resources at every packaging run.
config.beforePack = async (...args) => { await config.beforeBuild(...args); };
module.exports = config;
