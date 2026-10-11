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
    "--console-log-level", "off", "--file-log-level", "off", "--config-file", config.configFile];
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
  private stopped = false;
  shutdownOwned(): void {
    this.stopped = true;
    for (const child of this.children) if (child.exitCode === null && child.signalCode === null) {
      try { child.kill(); } catch { /* Keep its handle; no discovery/kill-by-name fallback. */ }
    }
  }
  async start(directory: string, config: EasyTierExistingConfiguration, signal: AbortSignal): Promise<EasyTierCliCore> {
    if (this.stopped || signal.aborted) throw new EasyTierOperationError("connect-failed");
    const portal = await unusedLoopbackPortal();
    if (this.stopped || signal.aborted) throw new EasyTierOperationError("connect-failed");
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(ET_|RUST_LOG$|RUST_BACKTRACE$)/i.test(key)));
    const child = spawn(join(directory, "easytier-core.exe"), easyTierCoreArguments(config, portal), {
      windowsHide: true, shell: false, detached: false, cwd: directory, env, stdio: "ignore",
    });
    this.children.add(child);
    let alive = true;
    const exited = new Promise<void>(resolve => {
      const finish = () => { alive = false; this.children.delete(child); resolve(); };
      child.once("exit", finish);
      child.on("error", () => { if (!child.pid) finish(); });
    });
    const terminateOwned = () => { if (alive) { try { child.kill(); } catch { /* close() requires an exit before releasing ownership. */ } } };
    const close = async () => {
      if (!alive) return;
      terminateOwned();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new EasyTierOperationError("cleanup-failed")), 3000);
        void exited.then(() => { clearTimeout(timer); resolve(); });
      });
    };
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
