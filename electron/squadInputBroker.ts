import { type ChildProcessWithoutNullStreams, spawn } from "child_process";
import { existsSync } from "fs";

import {
  type SquadConfig, SquadController,   squadObservedKeys, type SquadScope, type SquadSnapshot,
validateSquadConfig,
} from "../src/lib/squadMode";

/** One broker owns all game holds. Native snapshots reconcile missing releases. */
export class SquadInputBroker {
  private controller = new SquadController();
  private child: ChildProcessWithoutNullStreams | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private buffer = "";
  private pendingAt = 0;
  private edgeDown = new Set<number>();
  private last = "";
  private excluded = false;
  private fault: string | undefined;
  private config: SquadConfig = { enabled: false, processDetection: true, processTarget: "", keys: [] };

  constructor(private helper: string, private emit: (state: SquadSnapshot) => void,
    private launch = (helper: string, args: string[]): ChildProcessWithoutNullStreams =>
      spawn(helper, args, { windowsHide: true, stdio: "pipe" })) {}
  read(): SquadSnapshot { return this.controller.read(); }
  exclude(value: boolean): void { this.excluded = value; }
  configure(config: SquadConfig, otherKeys: string[], captureAvailable: boolean): SquadSnapshot {
    const changed = JSON.stringify(config) !== JSON.stringify(this.config);
    this.config = config;
    this.controller.configure(config);
    this.fault = validateSquadConfig(config, otherKeys) ?? (!captureAvailable ? "input-unavailable" : undefined);
    if (!config.enabled) {
      this.stop();
      this.publish({ valid: true, path: "", down: [] });
      return this.read();
    }
    if (process.platform !== "win32" || !existsSync(this.helper)) this.fault = "helper-unavailable";
    if (changed) this.stop();
    if (this.fault) {
      this.stop();
      this.publish({ valid: false, path: "", down: [], reason: this.fault });
      return this.read();
    }
    if (!this.child) this.start();
    this.request();
    return this.read();
  }
  /** Called by the existing uiohook transport; it never consumes a game event. */
  edge(vk: number | null, pressed: boolean): void {
    if (vk === null || !squadObservedKeys(this.config).includes(vk)) return;
    if (pressed) this.edgeDown.add(vk);
    this.request();
  }
  private publish(scope: SquadScope): void {
    const snapshot = this.controller.sample(scope, Date.now(), this.excluded, this.fault);
    const serialized = JSON.stringify(snapshot);
    if (serialized !== this.last) { this.last = serialized; this.emit(snapshot); }
  }
  private start(): void {
    this.child = this.launch(this.helper, squadObservedKeys(this.config).map(String));
    const child = this.child;
    this.buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (this.child !== child) return;
      this.buffer += chunk.toString("utf8");
      if (this.buffer.length > 65536) { this.fail("helper-protocol"); return; }
      let end: number;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        try {
          const scope = JSON.parse(line) as SquadScope;
          if (typeof scope.valid !== "boolean" || typeof scope.path !== "string" || !Array.isArray(scope.down)
            || scope.down.some(k => !Number.isInteger(k) || k < 1 || k > 255)) throw new Error("protocol");
          this.pendingAt = 0;
          // Preserve short presses received while the metadata request was in flight.
          if (scope.valid) scope.down = [...new Set([...scope.down, ...this.edgeDown])];
          this.edgeDown.clear();
          this.publish(scope);
        } catch { this.fail("helper-protocol"); }
      }
    });
    child.on("error", () => { if (this.child === child) this.fail("helper-start-failed"); });
    child.on("exit", () => { if (this.child === child) this.fail("helper-exited"); });
    this.timer = setInterval(() => {
      if (this.pendingAt && Date.now() - this.pendingAt > 300) this.fail("helper-timeout");
      else this.request();
    }, 50);
  }
  private request(): void {
    if (!this.child || this.pendingAt) return;
    this.pendingAt = Date.now();
    this.child.stdin.write("sample\n");
  }
  private fail(reason: string): void {
    this.stop(); this.fault = reason;
    this.publish({ valid: false, path: "", down: [], reason });
  }
  unavailable(reason: string): void { this.fail(reason); }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const child = this.child; this.child = null;
    if (child) { child.stdin.end("quit\n"); child.kill(); }
    this.pendingAt = 0; this.edgeDown.clear();
  }
}
