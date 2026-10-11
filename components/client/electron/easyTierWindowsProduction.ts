import { join } from "node:path";

import { readEasyTierExistingConfiguration } from "./easyTierExistingConfiguration";
import { EasyTierWindowsAssets } from "./easyTierWindowsAssets";
import { EasyTierWindowsProcesses, hasEasyTierWindowsPermission } from "./easyTierWindowsProcesses";
import { WindowsEasyTierCliRuntime } from "./windowsEasyTierCliRuntime";

/** Lazy paths: constructing the adapter performs no profile I/O or activation. */
export function createWindowsEasyTierProduction(root: () => string, bundledDirectory: () => string) {
  const assets = new EasyTierWindowsAssets(root, bundledDirectory);
  const processes = new EasyTierWindowsProcesses();
  const runtime = new WindowsEasyTierCliRuntime({
    platform: process.platform === "win32" && process.arch !== "x64" ? "unsupported-windows-arch" : process.platform,
    configuration: serverId => readEasyTierExistingConfiguration(root(), serverId),
    permission: hasEasyTierWindowsPermission,
    verifiedAssets: () => assets.prepareBundled(),
    start: (directory, config, signal) => processes.start(directory, config, signal),
    shutdownOwned: () => processes.shutdownOwned(),
    pause: signal => new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new Error("canceled")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 250);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    }),
  });
  return { runtime, prepareRuntime: async () => {
    if (process.platform !== "win32" || process.arch !== "x64") return { ready: false };
    try { await assets.prepare(); return { ready: true }; } catch { return { ready: false }; }
  } };
}

export const easyTierProductRoot = (userData: string) => join(userData, "community-lan");
