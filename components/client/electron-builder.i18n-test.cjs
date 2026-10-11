/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
// Local, unsigned, Windows x64 slim portable. Do not publish this configuration.
process.env.GRYT_VARIANT = "slim";
const fs = require("node:fs");
const path = require("node:path");
const config = require("./electron-builder.config.cjs");
config.appId = "local.laokuai.chat.i18n-test";
config.productName = "老蒯聊 汉化测试";
config.extraMetadata = {
  name: "laokuai-chat-i18n-test",
  productName: config.productName,
  grytI18nTest: true,
};
config.directories.output = "release-i18n-test";
config.electronLanguages = ["en", "en-US", "en-GB", "zh-CN"];
config.publish = null;
config.npmRebuild = false; // uiohook ships a Windows x64 N-API prebuild.
config.nativeRebuilder = "sequential";
config.toolsets = { winCodeSign: "1.1.0" }; // Windows rcedit still uses the legacy tool cache.
config.protocols = [];
config.win = {
  icon: "build/icon.ico",
  target: [{ target: "portable", arch: ["x64"] }],
  executableName: "LaoKuai-Chat-I18n-Test",
  requestedExecutionLevel: "asInvoker",
  signAndEditExecutable: true,
  signtoolOptions: { sign: async () => { console.log("  local i18n test: leaving artifact unsigned"); } },
};
config.portable = {
  artifactName: "LaoKuai-Chat-${version}-zh-CN-win-x64-slim-portable-test.exe",
};
// No shared presence socket or login helper in this isolated test variant.
config.extraResources = config.extraResources.filter((entry) => !String(entry.from).startsWith("build/helper/"));
config.extraResources.push(
  { from: "LICENSE", to: "legal/CLIENT-AGPL-3.0.txt" },
  { from: "node_modules/@gryt/ui/LICENSE", to: "legal/UI-MIT.txt" },
  { from: "I18N-PORTABLE-TEST.md", to: "legal/I18N-PORTABLE-TEST.md" },
  { from: "build/legal/THIRD-PARTY-NOTICES.txt", to: "legal/THIRD-PARTY-NOTICES.txt" },
);
config.beforeBuild = async () => {
  require("./scripts/write-i18n-test-notices.cjs").writeNotices(__dirname);
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("This test package requires Windows x64");
  for (const entry of config.extraResources) {
    if (!fs.existsSync(path.resolve(__dirname, entry.from))) throw new Error(`Missing test resource: ${entry.from}`);
  }
  for (const filename of ["audio-capture.exe", "screen-capture.exe"]) {
    if (!fs.existsSync(path.join(__dirname, "build/native", filename))) throw new Error(`Missing native helper: ${filename}`);
  }
};
config.afterSign = undefined;
module.exports = config;
