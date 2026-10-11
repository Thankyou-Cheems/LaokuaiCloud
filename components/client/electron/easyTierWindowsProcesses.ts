import { type ChildProcess,execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";

import { EasyTierOperationError } from "./easyTierCommunityManager";
import type { EasyTierExistingConfiguration } from "./easyTierExistingConfiguration";
import { easyTierVirtualIp } from "./easyTierStatus";

export interface EasyTierCliCore {
  isAlive(): boolean;
  readNode(signal: AbortSignal): Promise<{ peerId: number; virtualIp: string | null }>;
  close(): Promise<void>;
  terminateOwned(): void;
}
export interface EasyTierOwnedCleanupReport {
  outcome: "graceful" | "forced" | "unconfirmed";
  ownedPid: number | null;
  // Main-only resource identifiers. Never infer ownership from an adapter alias.
  interfaces: Array<{ guid: string; luid: string; ifIndex: number }>;
  residualCheckRequired: boolean;
}
/** This is read-only token inspection. No elevation verb, service install or UAC bypass. */
export async function hasEasyTierWindowsPermission(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const shell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return new Promise(resolve => {
    execFile(shell, ["-NoProfile", "-NonInteractive", "-Command", "$p=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()); if($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){[Console]::Write('approved')}"],
      { windowsHide: true, timeout: 3000, maxBuffer: 128 }, (error, stdout) => resolve(!error && stdout === "approved"));
  });
}
export function easyTierCoreArguments(config: EasyTierExistingConfiguration, portal: string): string[] {
  if (!/^127\.0\.0\.1:\d{1,5}$/.test(portal)) throw new Error("invalid-owned-portal");
  return ["--disable-env-parsing", "--rpc-portal", portal, "--rpc-portal-whitelist", "127.0.0.1/32",
    "--console-log-level", "off", "--file-log-level", "off", "--laokuai-owned-stdin", "--config-file", config.configFile];
}
export function easyTierCliArguments(instanceId: string, portal: string): string[] {
  return ["--rpc-portal", portal, "--instance-id", instanceId, "--output", "json", "node", "info"];
}
export function sanitizedEasyTierCliNode(value: unknown): { peerId: number; virtualIp: string | null } {
  const v = value as Record<string, unknown>;
  if (!v || Array.isArray(v) || !Number.isInteger(v.peer_id) || (v.peer_id as number) <= 0 || (v.peer_id as number) > 0xffffffff) throw new EasyTierOperationError("status-unavailable");
  return { peerId: v.peer_id as number, virtualIp: easyTierVirtualIp(v.ipv4_addr) };
}
async function unusedLoopbackPortal(): Promise<string> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", () => reject(new EasyTierOperationError("connect-failed")));
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      server.close(error => {
        if (error || !address || typeof address === "string") reject(new EasyTierOperationError("connect-failed"));
        else resolve(`127.0.0.1:${address.port}`);
      });
    });
  });
}

/** Owns exactly the children it creates. Never finds, attaches, kills by name, or discovers PIDs. */
export class EasyTierWindowsProcesses {
  private children = new Set<ChildProcess>();
  private cores = new Map<ChildProcess, () => Promise<void>>();
  private stopped = false;
  private draining: Promise<void> | null = null;
  private reports: EasyTierOwnedCleanupReport[] = [];
  cleanupReports(): EasyTierOwnedCleanupReport[] {
    return this.reports.map(report => ({ ...report, interfaces: report.interfaces.map(value => ({ ...value })) }));
  }
  shutdownOwned(): void {
    this.stopped = true;
    // Begin stop immediately, even during session end. EOF also asks patched core to stop.
    void this.drainOwned().catch(() => { /* Report is retained; never inspect other processes. */ });
    for (const child of this.children) if (child.exitCode === null && child.signalCode === null) {
      if (this.cores.has(child)) continue;
      try { child.kill(); } catch { /* Only bounded, read-only CLI children reach here. */ }
    }
  }
  drainOwned(): Promise<void> {
    this.stopped = true;
    if (!this.draining) this.draining = Promise.allSettled([...this.cores.values()].map(close => close())).then(results => {
      if (results.some(result => result.status === "rejected")) throw new EasyTierOperationError("cleanup-failed");
    });
    return this.draining;
  }
  async start(directory: string, config: EasyTierExistingConfiguration, signal: AbortSignal): Promise<EasyTierCliCore> {
    if (this.stopped || signal.aborted) throw new EasyTierOperationError("connect-failed");
    const portal = await unusedLoopbackPortal();
    if (this.stopped || signal.aborted) throw new EasyTierOperationError("connect-failed");
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(ET_|RUST_LOG$|RUST_BACKTRACE$)/i.test(key)));
    const child = spawn(join(directory, "easytier-core.exe"), easyTierCoreArguments(config, portal), {
      windowsHide: true, shell: false, detached: false, cwd: directory, env, stdio: ["pipe", "pipe", "ignore"],
    });
    this.children.add(child);
    let alive = true;
    let acknowledged = false;
    let closing: Promise<void> | null = null;
    let pendingLine = "";
    let discardLine = false;
    let forced = false;
    const interfaces: EasyTierOwnedCleanupReport["interfaces"] = [];
    child.stdout?.on("data", (bytes: Buffer) => {
      // Discard all unrelated native output; never log secrets, endpoints or errors.
      // Bound unterminated lines, and do not interpret the tail of a discarded line.
      for (const piece of bytes.toString("utf8").split(/(?<=\n)/)) {
        if (!discardLine) pendingLine += piece;
        if (pendingLine.length > 256) { pendingLine = ""; discardLine = true; }
        if (!piece.endsWith("\n")) continue;
        if (!discardLine) {
          const line = pendingLine.trim();
          if (line === "LAOKUAI_OWNED_STOPPED_V1") acknowledged = true;
          const nic = /^LAOKUAI_OWNED_NIC_V1 ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) ([0-9]{1,20}) ([0-9]{1,10})$/.exec(line);
          if (nic && Number(nic[3]) > 0 && Number(nic[3]) <= 0xffffffff && interfaces.length < 16
            && !interfaces.some(value => value.guid === nic[1])) {
            interfaces.push({ guid: nic[1], luid: nic[2], ifIndex: Number(nic[3]) });
          }
        }
        pendingLine = ""; discardLine = false;
      }
    });
    child.stdin?.on("error", () => { /* Broken pipe: wait for owned exit, then report it. */ });
    const exited = new Promise<void>(resolve => {
      const finish = () => { alive = false; this.children.delete(child); this.cores.delete(child); resolve(); };
      child.once("exit", finish);
      child.on("error", () => { if (!child.pid) finish(); });
    });
    const close = (): Promise<void> => {
      if (closing) return closing;
      closing = (async () => {
        if (alive) {
          try { child.stdin?.end("LAOKUAI_OWNED_STOP_V1\n"); } catch { /* Timeout fallback below. */ }
          await new Promise<void>((resolve, reject) => {
            const forceTimer = setTimeout(() => {
              if (alive) { forced = true; try { child.kill(); } catch { /* Keep exact owned handle. */ } }
            }, 4000);
            const finalTimer = setTimeout(() => reject(new EasyTierOperationError("cleanup-failed")), 6000);
            void exited.then(() => { clearTimeout(forceTimer); clearTimeout(finalTimer); resolve(); });
          });
        }
        const graceful = acknowledged && child.exitCode === 0 && !forced;
        this.reports.push({ outcome: forced ? "forced" : graceful ? "graceful" : "unconfirmed",
          ownedPid: child.pid ?? null, interfaces: interfaces.map(value => ({ ...value })),
          // A stop acknowledgement proves instance stop, not Windows adapter disappearance.
          residualCheckRequired: !graceful || interfaces.length > 0 });
        if (this.reports.length > 64) this.reports.shift();
      })().catch(() => {
        this.reports.push({ outcome: "unconfirmed", ownedPid: child.pid ?? null,
          interfaces: interfaces.map(value => ({ ...value })), residualCheckRequired: true });
        if (this.reports.length > 64) this.reports.shift();
        closing = null; throw new EasyTierOperationError("cleanup-failed");
      });
      return closing;
    };
    this.cores.set(child, close);
    // Existing port name preserved, but shutdown first requests stop rather than killing.
    const terminateOwned = () => { void close().catch(() => {}); };
    const abort = () => terminateOwned();
    signal.addEventListener("abort", abort, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", error => reject(new EasyTierOperationError(["EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "") ? "needs-permission" : "connect-failed")));
      });
    } catch (error) { await close(); throw error; }
    finally { signal.removeEventListener("abort", abort); }
    const isAlive = () => alive && !this.stopped;
    return {
      isAlive, terminateOwned, close,
      readNode: async readSignal => {
        if (!isAlive() || readSignal.aborted) throw new EasyTierOperationError("runtime-exited");
        const node = await new Promise<unknown>((resolve, reject) => {
          const reader = execFile(join(directory, "easytier-cli.exe"), easyTierCliArguments(config.instanceId, portal),
            { windowsHide: true, shell: false, cwd: directory, env, timeout: 2000, maxBuffer: 1024 * 1024, signal: readSignal },
            (error, stdout) => {
              // Never propagate child error strings, raw stdout/stderr, config or public endpoints.
              if (error) { reject(new EasyTierOperationError("status-unavailable")); return; }
              try { resolve(JSON.parse(stdout)); } catch { reject(new EasyTierOperationError("status-unavailable")); }
            });
          this.children.add(reader);
          const release = () => this.children.delete(reader);
          reader.once("exit", release); reader.on("error", () => { if (!reader.pid) release(); });
        });
        if (!isAlive() || readSignal.aborted) throw new EasyTierOperationError("runtime-exited");
        return sanitizedEasyTierCliNode(node);
      },
    };
  }
}
