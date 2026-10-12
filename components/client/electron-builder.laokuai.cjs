/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
const config = require("./electron-builder.i18n-test.cjs");
config.appId = "local.laokuai.chat";
config.productName = "唠蒯云";
config.extraMetadata = { name: "laokuai-chat", productName: config.productName,
  grytI18nTest: true, grytLaokuai: true };
config.directories.output = "release-laokuai-opus20-1";
config.win.icon = "private-brand/icon.ico";
config.win.executableName = "唠蒯云";
// The i18n test variant replaces win; restore the real private product's sidecar.
config.win.extraResources = require("./scripts/community-easytier-resources.cjs");
config.portable.artifactName = "唠蒯云-${version}-zh-CN-win-x64-slim-portable.exe";
config.extraResources = config.extraResources.filter(entry => entry.to !== "legal/I18N-PORTABLE-TEST.md");
config.extraResources = config.extraResources.map(entry => entry.to === "icon.png"
  ? { from: "private-brand/icon.png", to: "icon.png" } : entry);
// Every runtime tray state uses the exact approved Kiriye artwork, resized only.
config.extraResources = config.extraResources.map(entry => /^tray.*\.png$/.test(entry.to)
  ? { from: `private-brand/icon-${entry.to.includes("@3x") ? 48 : entry.to.includes("@2x") ? 32 : 16}.png`, to: entry.to }
  : entry);
config.extraResources.push(
  { from: "build/squad/squad-scope.exe", to: "squad/squad-scope.exe" },
  { from: "PRIVATE-PROFILE-REUSE.md", to: "legal/PRIVATE-PROFILE-REUSE.md" },
  { from: "SQUAD-KEY-LIST.md", to: "legal/SQUAD-KEY-LIST.md" },
  { from: "SQUAD-MODE.md", to: "legal/SQUAD-MODE.md" },{ from: "LAOKUAI-SELF-USE.md", to: "legal/LAOKUAI-SELF-USE.md" },
  { from: "LAOKUAI-BRAND-NOTICES.md", to: "legal/LAOKUAI-BRAND-NOTICES.md" });
config.extraResources.push(
  { from: "release/licenses", to: "legal/easytier" },
  { from: "release/easytier-native-input-inventory.json", to: "legal/EASYTIER-NATIVE-INPUTS.json" },
  { from: "release/EASYTIER-NOTICES.md", to: "legal/EASYTIER-NOTICES.md" },
  { from: "node_modules/@gryt/voice/LICENSE", to: "legal/VOICE-AGPL-3.0.txt" },
  { from: "node_modules/@gryt/voice/third-party/Signalsmith-LICENSE.txt", to: "legal/Signalsmith-LICENSE.txt" },
  { from: "node_modules/@gryt/voice/third-party/Signalsmith-DSP-LICENSE.txt", to: "legal/Signalsmith-DSP-LICENSE.txt" },
  { from: "node_modules/@gryt/voice/third-party/receive-rnn/licenses", to: "legal/receive-rnn" },
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
config.beforePack = async (...args) => {
  require("./scripts/check-easytier-patched-payload.cjs").assertPatchedEasyTierPayload(__dirname, config);
  await config.beforeBuild(...args);
  const fs = require("node:fs");
  const path = require("node:path");
  const { inventory } = require("./scripts/laokuai-package-audit.cjs");
  const manifest = inventory(__dirname,config);
  fs.writeFileSync(path.join(__dirname,"build/legal/LAOKUAI-PACKAGE-MANIFEST.json"),JSON.stringify(manifest,null,2)+"\n");
};
module.exports = config;
