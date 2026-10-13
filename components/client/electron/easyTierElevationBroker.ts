import { type ChildProcess,spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";

import { EasyTierOperationError } from "./easyTierCommunityManager";

/** Process-shaped handle to one core inside the app-session broker. */
export class BrokerCoreProcess extends EventEmitter {
  pid: number | undefined;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly stdout = new PassThrough();
  readonly stdin: Writable;
  private finished = false;
  constructor(private launcher: ChildProcess) {
    super();
    this.stdin = new Writable({
      write: (chunk, _encoding, done) => { this.launcher.stdin?.write(chunk); done(); },
      final: done => { done(); },
    });
  }
  finish(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.finished) return;
    this.finished = true; this.exitCode = code; this.signalCode = signal;
    this.stdout.end(); this.emit("exit", code, signal);
  }
  kill(): boolean { return this.launcher.kill(); }
}

/** A one-session UAC broker, never a persistent service. Native launch waits for explicit readiness. */
export class EasyTierElevationBroker {
  private child: ChildProcess | null = null;
  private ready = false;
  private core: BrokerCoreProcess | null = null;
  private flight: Promise<boolean> | null = null;
  private epoch = 0;
  constructor(private directory: () => string) {}
  available(): boolean { return !!this.child && this.child.exitCode === null && this.child.signalCode === null && this.ready; }
  prepare(): Promise<boolean> {
    if (this.available()) return Promise.resolve(true);
    if (this.flight) return this.flight;
    const epoch = ++this.epoch;
    const work = this.launch(epoch);
    this.flight = work;
    void work.finally(() => { if (this.flight === work) this.flight = null; }).catch(() => undefined);
    return work;
  }
  private async launch(epoch: number): Promise<boolean> {
    if (process.platform !== "win32") return false;
    const directory = this.directory(), binary = join(directory, "laokuai-community-broker.exe");
    const receiptPath = join(directory, "broker-build.json");
    if ((await stat(receiptPath)).size > 4096 || (await stat(binary)).size > 1024 * 1024) throw new EasyTierOperationError("runtime-required");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")), bytes = await readFile(binary);
    if (receipt.schemaVersion !== 1 || receipt.bytes !== bytes.length ||
        createHash("sha256").update(bytes).digest("hex") !== receipt.sha256) throw new EasyTierOperationError("runtime-required");
    if (epoch !== this.epoch) return false;
    const child = spawn(binary, ["--parent", String(process.pid)], { windowsHide: true, shell: false,
      cwd: directory, stdio: ["pipe", "pipe", "ignore"] });
    this.child = child; this.ready = false;
    child.stdin?.on("error", () => undefined);
    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = null; this.ready = false;
      const core = this.core; this.core = null; core?.finish(code, signal);
    });
    let lines = "";
    child.stdout?.on("data", (bytes: Buffer) => {
      lines += bytes.toString("utf8");
      if (lines.length > 4096) { child.kill(); return; }
      let end: number;
      while ((end = lines.indexOf("\n")) >= 0) {
        const line = lines.slice(0, end).replace(/\r$/, ""); lines = lines.slice(end + 1);
        const finished = /^LAOKUAI_BROKER_FINISHED_V1 (-?[0-9]+)$/.exec(line);
        if (finished) {
          const core = this.core; this.core = null;
          core?.finish(Number(finished[1]));
        } else if (line !== "LAOKUAI_BROKER_READY_V1") {
          const started = /^LAOKUAI_BROKER_STARTED_V1 ([1-9][0-9]*)$/.exec(line);
          if (started && this.core) this.core.pid = Number(started[1]);
          this.core?.stdout.write(line + "\n");
        }
      }
    });
    return new Promise(resolve => {
      let pending = "", settled = false;
      const finish = (accepted: boolean) => {
        if (settled) return; settled = true;
        clearTimeout(timer); child.stdout?.removeListener("data", data);
        child.removeListener("error", failed); child.removeListener("exit", failed);
        this.ready = accepted && epoch === this.epoch && this.child === child;
        if (!this.ready) { try { child.kill(); } catch { /* Exact owned launcher only. */ } }
        resolve(this.ready);
      };
      const failed = () => finish(false);
      const data = (bytes: Buffer) => {
        pending += bytes.toString("utf8");
        if (pending.length > 4096) return finish(false);
        if (pending.split(/\r?\n/).includes("LAOKUAI_BROKER_READY_V1")) finish(true);
      };
      const timer = setTimeout(failed, 120_000);
      child.stdout?.on("data", data); child.once("error", failed); child.once("exit", failed);
    });
  }
  take(): BrokerCoreProcess {
    if (!this.available() || this.core) throw new EasyTierOperationError("needs-permission");
    this.core = new BrokerCoreProcess(this.child!); return this.core;
  }
  releasePreparation(): void {
    if (this.core) return;
    this.epoch++;
    const child = this.child; this.child = null; this.ready = false;
    if (child) { try { child.stdin?.end(); child.kill(); } catch { /* Closes the owned broker pipe. */ } }
  }
}
