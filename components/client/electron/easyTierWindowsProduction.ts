import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { readEasyTierExistingConfiguration } from "./easyTierExistingConfiguration";
import { EasyTierWindowsAssets } from "./easyTierWindowsAssets";
import { EasyTierWindowsProcesses, hasEasyTierWindowsPermission } from "./easyTierWindowsProcesses";
import { WindowsEasyTierCliRuntime } from "./windowsEasyTierCliRuntime";
import type { EasyTierExistingConfiguration } from "./easyTierExistingConfiguration";

/** Lazy paths: constructing the adapter performs no profile I/O or activation. */
export function createWindowsEasyTierProduction(root: () => string, bundledDirectory: () => string,
  configuration?: (serverId: string, signal: AbortSignal) => Promise<EasyTierExistingConfiguration>) {
  const assets = new EasyTierWindowsAssets(root, bundledDirectory);
  const processes = new EasyTierWindowsProcesses();
  const runtime = new WindowsEasyTierCliRuntime({
    platform: process.platform === "win32" && process.arch !== "x64" ? "unsupported-windows-arch" : process.platform,
    configuration: configuration ?? (serverId => readEasyTierExistingConfiguration(root(), serverId)),
    permission: hasEasyTierWindowsPermission,
    verifiedAssets: () => assets.prepareProductBundled(),
    start: (directory, config, signal) => processes.start(directory, config, signal),
    shutdownOwned: () => processes.shutdownOwned(),
    pause: signal => new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new Error("canceled")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 250);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    }),
  });
  const drainOwned = async () => {
    try { await processes.drainOwned(); }
    finally {
      const reports = processes.cleanupReports();
      if (reports.length) {
        // Diagnostic receipt only. Never authorize deletion/kill from a saved PID or alias.
        await mkdir(root(), { recursive: true });
        await writeFile(join(root(), "owned-cleanup.json"), JSON.stringify({ schemaVersion: 1,
          diagnosticOnly: true, reports }), { mode: 0o600 });
      }
    }
  };
  return { runtime, drainOwned, cleanupReports: () => processes.cleanupReports(), prepareRuntime: async () => {
    if (process.platform !== "win32" || process.arch !== "x64") return { ready: false };
    try { await assets.prepareProductBundled(); return { ready: true }; } catch { return { ready: false }; }
  } };
}

export const easyTierProductRoot = (userData: string) => join(userData, "community-lan");
