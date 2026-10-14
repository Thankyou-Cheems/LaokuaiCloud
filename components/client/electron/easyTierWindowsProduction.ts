import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { EasyTierExistingConfiguration } from "./easyTierExistingConfiguration";
import { readEasyTierExistingConfiguration } from "./easyTierExistingConfiguration";
import { EasyTierWindowsAssets } from "./easyTierWindowsAssets";
import { EasyTierWindowsProcesses, hasEasyTierWindowsPermission } from "./easyTierWindowsProcesses";
import { type WindowsEasyTierCliPorts,WindowsEasyTierCliRuntime } from "./windowsEasyTierCliRuntime";

/** Lazy paths: constructing the adapter performs no profile I/O or activation. */
export function createWindowsEasyTierProduction(root: () => string, bundledDirectory: () => string,
  configuration?: (serverId: string, signal: AbortSignal) => Promise<EasyTierExistingConfiguration>, brokerDirectory?: () => string,
  prepareNetworking?: (coreExecutable: string) => Promise<boolean>,
  prepareOwnedInterface?: WindowsEasyTierCliPorts['prepareOwnedInterface'],
  onStartupStage?: WindowsEasyTierCliPorts['onStartupStage']) {
  const assets = new EasyTierWindowsAssets(root, bundledDirectory);
  // The application is now required to start elevated.  Keep the helper only as
  // a read-only token check; it must never become a second launch path for ET.
  // The fourth argument is retained for the existing main wiring and points at
  // the packaged helper directory.
  const permissionExecutable = brokerDirectory ?
    () => join(brokerDirectory(), "laokuai-community-broker.exe") : undefined;
  const processes = new EasyTierWindowsProcesses(0);
  const interfaceCleanup = new Set<() => Promise<void>>();
  const interfacePreparations = new Set<Promise<() => Promise<void>>>();
  let stoppingInterfaces = false;
  let interfaceDrain: Promise<void> | undefined;
  const drainInterfaces = (): Promise<void> => {
    stoppingInterfaces = true;
    return interfaceDrain ??= (async () => {
      await Promise.allSettled([...interfacePreparations]);
      const results = await Promise.allSettled([...interfaceCleanup].map(cleanup => cleanup()));
      if (results.some(result => result.status === 'rejected')) throw new Error('owned-firewall-cleanup-unconfirmed');
    })();
  };
  // The firewall rule must point at the verified cache copy that the direct
  // process launcher actually starts, not at a resource-side reference copy.
  let preparedDirectory: string | null = null;
  let prepared = false;
  let preparationEpoch = 0;
  let preparation: Promise<boolean> | null = null;
  const checkPermission = async (): Promise<boolean> => {
    const approved = await hasEasyTierWindowsPermission(permissionExecutable?.());
    if (!approved) prepared = false;
    return approved;
  };
  const preparePermission = async (): Promise<boolean> => {
    if (preparation) return preparation;
    const epoch = preparationEpoch;
    const work = (async () => {
      prepared = false;
      // Check the current process token before touching the product cache.  The
      // helper's --check path is read-only and does not request elevation.
      if (!(await checkPermission())) return false;
      const directory = await assets.prepareProductBundled();
      if (epoch !== preparationEpoch) throw new Error("preparation-canceled");
      if (prepareNetworking && !(await prepareNetworking(join(directory, "easytier-core.exe")))) return false;
      if (epoch !== preparationEpoch) throw new Error("preparation-canceled");
      preparedDirectory = directory;
      prepared = true;
      return true;
    })();
    preparation = work;
    void work.finally(() => { if (preparation === work) preparation = null; }).catch(() => undefined);
    return work;
  };
  const runtime = new WindowsEasyTierCliRuntime({
    onStartupStage,
    platform: process.platform === "win32" && process.arch !== "x64" ? "unsupported-windows-arch" : process.platform,
    configuration: configuration ?? (serverId => readEasyTierExistingConfiguration(root(), serverId)),
    permission: checkPermission,
    verifiedAssets: () => assets.prepareProductBundled(),
    start: async (directory, config, signal) => {
      if (signal.aborted) throw new Error("canceled");
      if (prepareNetworking && !(await prepareNetworking(join(directory, "easytier-core.exe")))) throw new Error("firewall-preparation-failed");
      if (signal.aborted) throw new Error("canceled");
      return processes.start(directory, config, signal);
    },
    shutdownOwned: () => {
      void drainInterfaces().catch(() => undefined).finally(() => processes.shutdownOwned());
    },
    prepareOwnedInterface: prepareOwnedInterface ? (config, core, signal) => {
      if (stoppingInterfaces || signal.aborted) return Promise.resolve(async () => {});
      const flight = (async () => {
        const release = await prepareOwnedInterface(config, core, signal);
        let finished = false, releasing: Promise<void> | undefined;
        const cleanup = (): Promise<void> => {
          if (finished) return Promise.resolve();
          return releasing ??= release().then(() => { finished = true; interfaceCleanup.delete(cleanup); })
            .catch(error => { releasing = undefined; throw error; });
        };
        interfaceCleanup.add(cleanup);
        return cleanup;
      })();
      interfacePreparations.add(flight);
      void flight.finally(() => interfacePreparations.delete(flight)).catch(() => undefined);
      return flight;
    } : undefined,
    pause: signal => new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new Error("canceled")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 250);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    }),
  });
  const drainOwned = async () => {
    try {
      try { await drainInterfaces(); }
      finally { await processes.drainOwned(); }
    }
    finally {
      preparationEpoch++;
      prepared = false;
      const reports = processes.cleanupReports();
      if (reports.length) {
        // Diagnostic receipt only. Never authorize deletion/kill from a saved PID or alias.
        await mkdir(root(), { recursive: true });
        await writeFile(join(root(), "owned-cleanup.json"), JSON.stringify({ schemaVersion: 1,
          diagnosticOnly: true, reports }), { mode: 0o600 });
      }
    }
  };
  return { runtime, drainOwned, cleanupReports: () => processes.cleanupReports(),
    preparePermission,
    // This is an enrollment preparation latch, not another permission probe.
    // Reconciliation therefore does not discard a successful preparation on
    // every renderer snapshot. Runtime.connect still performs --check before
    // each native start and clears the latch if the token is no longer valid.
    preparationReady: () => prepared,
    releasePreparation: () => { preparationEpoch++; prepared = false; }, prepareRuntime: async () => {
    if (process.platform !== "win32" || process.arch !== "x64") return { ready: false };
    try {
      preparedDirectory = await assets.prepareProductBundled();
      if (prepareNetworking && !(await prepareNetworking(join(preparedDirectory, "easytier-core.exe")))) return { ready: false };
      return { ready: true };
    } catch { return { ready: false }; }
  }, preparedDirectory: () => preparedDirectory };
}

export const easyTierProductRoot = (userData: string) => join(userData, "community-lan");
