import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { app, dialog } from "electron";

import { isI18nTestPackage, isLaokuaiPackage } from "./i18nTestVariant";
import type { LaokuaiAdminStartupResult } from "./windowsAdminStartupGate";
import { enforceLaokuaiWindowsAdminStartup, isExplicitLaokuaiOfflineLaunch } from "./windowsAdminStartupGate";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IS_LAOKUAI = isLaokuaiPackage();
const EXPLICIT_OFFLINE_TEST = IS_LAOKUAI && isI18nTestPackage() && isExplicitLaokuaiOfflineLaunch(process.argv);
let startup: LaokuaiAdminStartupResult | Promise<never> = "bypassed";

if (IS_LAOKUAI && !EXPLICIT_OFFLINE_TEST) {
  const brokerDirectory = join(
    app.isPackaged ? process.resourcesPath : join(__dirname, "../build"),
    "community-lan-helper",
  );
  startup = enforceLaokuaiWindowsAdminStartup({
    platform: process.platform,
    product: true,
    offlineTest: false,
    brokerExecutable: join(brokerDirectory, "laokuai-community-broker.exe"),
    brokerReceipt: join(brokerDirectory, "broker-build.json"),
    packaged: app.isPackaged,
    executable: process.execPath,
    argv: process.argv,
    parentPid: process.pid,
    portableDirectory: process.env.PORTABLE_EXECUTABLE_DIR,
    promptRestart: async () => {
      await app.whenReady();
      return dialog.showMessageBoxSync({
        type: "warning",
        title: "唠蒯云需要管理员权限",
        message: "唠蒯云需要管理员权限才能启动。",
        detail: "选择“以管理员身份重新启动”后，Windows 将请求管理员授权。社区联机尚未启动。",
        buttons: ["以管理员身份重新启动", "退出"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      }) === 0;
    },
    showError: (title, message) => dialog.showErrorBox(title, message),
    exit: code => process.exit(code),
  });
}
// An ordinary launch must let this ESM entry settle so Electron can emit ready.
// Its prompt task exits without importing profiles, services or application UI.
if (typeof startup === "string") {
  await import("./main");
} else {
  void startup.catch(() => {
    dialog.showErrorBox("唠蒯云无法启动", "管理员启动提示未能完成，请退出后重试。");
    process.exit(1);
  });
}