import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import { isAbsolute } from "node:path";

import {
  NATIVE_LAN_AUDIO_PORT,
  type NativeLanAudioDesired,
  type NativeLanAudioError,
  type NativeLanAudioStatus,
  nativeLanHelperError,
  normalizeNativeLanAudioDesired,
} from "../src/lib/nativeLanAudio";

export interface NativeLanAudioPorts {
  /** Parent verifies a trusted, hash-pinned bundle before returning its absolute path. */
  verifyExecutable(): Promise<string | null> | string | null;
  spawn(executable: string, args: string[], options: SpawnOptionsWithoutStdio): ChildProcessWithoutNullStreams;
  onStatus?(status: NativeLanAudioStatus): void;
  shutdownMs?: number;
  startupMs?: number;
}

function identity(s: NativeLanAudioDesired): string {
  return JSON.stringify([s.serverId, s.roomId, s.epoch, s.localIp, s.key, s.peers.map(p => p.virtualIp)]);
}
const idle = (): NativeLanAudioStatus => ({ phase: "idle", peerCount: 0, muted: true, deafened: true,
  captureRms: 0, playbackRms: 0, packetsSent: 0, packetsReceived: 0, processErrors: 0 });
const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0;
const rms = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0;

/** Owns one helper, its pipes and timers. It never owns or reconciles EasyTier. */
export class NativeLanAudioRuntime {
  private child: ChildProcessWithoutNullStreams | null = null;
  private active: NativeLanAudioDesired | null = null;
  private failedIdentity: string | null = null;
  private version = 0;
  private queue: Promise<void> = Promise.resolve();
  private status: NativeLanAudioStatus = idle();
  private disposed = false;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private leaseTimer: ReturnType<typeof setTimeout> | null = null;
  private closeWaiters = new Set<() => void>();

  constructor(private readonly ports: NativeLanAudioPorts) {}

  getStatus(): NativeLanAudioStatus { return { ...this.status }; }

  reconcile(value: NativeLanAudioDesired | null): Promise<NativeLanAudioStatus> {
    const normalized = value === null ? null : normalizeNativeLanAudioDesired(value);
    const invalid = value !== null && !normalized;
    if (this.leaseTimer) clearTimeout(this.leaseTimer);
    this.leaseTimer = normalized && !this.disposed ? setTimeout(() => { this.leaseTimer = null; void this.reconcile(null); }, normalized.expiresInMs) : null;
    const version = ++this.version;
    this.queue = this.queue.then(async () => {
      if (version !== this.version) return;
      if (this.disposed || invalid || !normalized) {
        await this.stopChild();
        if (!this.child) {
          this.failedIdentity = null;
          this.publish(invalid ? { ...idle(), phase: "error", error: "invalid-session" } : idle());
        }
        return;
      }
      const signature = identity(normalized);
      if (this.child && this.active && identity(this.active) === signature) {
        this.applyControls(normalized);
        return;
      }
      await this.stopChild();
      if (this.child || version !== this.version || this.disposed) return;
      if (this.failedIdentity === signature) return; // Repeated roster events must not cause a restart loop.
      this.active = normalized;
      this.publish({ ...idle(), phase: "starting", serverId: normalized.serverId, roomId: normalized.roomId,
        peerCount: normalized.peers.length, muted: normalized.muted, deafened: normalized.deafened });
      let executable: string | null;
      try { executable = await this.ports.verifyExecutable(); } catch { executable = null; }
      if (version !== this.version || this.disposed) { this.active = null; return; }
      if (!executable || !isAbsolute(executable)) { this.fail("helper-unavailable"); return; }
      let child: ChildProcessWithoutNullStreams;
      try { child = this.ports.spawn(executable, ["--stdio"], { shell: false, windowsHide: true }); }
      catch { this.fail("helper-start"); return; }
      this.child = child;
      let pending = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (this.child !== child) return;
        pending += chunk;
        if (pending.length > 32768) { pending = ""; this.childFailure("helper-protocol"); return; }
        let newline: number;
        while ((newline = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
          this.receipt(child, line);
        }
      });
      // Drain diagnostics without persisting or reflecting driver strings or keys.
      child.stderr.on("data", () => {});
      child.stdin.on("error", () => { if (this.child === child && this.status.phase !== "stopping") this.childFailure("helper-start"); });
      child.on("error", () => { if (this.child === child && this.status.phase !== "stopping") this.childFailure("helper-start"); });
      child.once("close", () => {
        if (this.child !== child) return;
        const expected = this.status.phase === "stopping";
        this.clearStartup();
        this.child = null;
        if (!expected && this.status.phase !== "error") this.fail("helper-exit");
        this.active = null;
        for (const resolve of this.closeWaiters) resolve();
        this.closeWaiters.clear();
      });
      this.startupTimer = setTimeout(() => { if (this.child === child) this.childFailure("helper-timeout"); }, this.ports.startupMs ?? 10000);
      const s = normalized;
      const peerGains = s.peers.map(p => `${s.memberVolumes[p.userId] ?? 1}:${Number(p.canPublish)}:${Number(p.canReceive)}`).join(",");
      this.write(["LAOKUAI_NATIVE_AUDIO_V1", s.localIp, String(NATIVE_LAN_AUDIO_PORT),
        s.peers.map(p => `${p.virtualIp}:${NATIVE_LAN_AUDIO_PORT}`).join(","), s.key, "duplex", "-1", "-1",
        `start ${Number(s.muted)} ${Number(s.deafened)} ${s.inputGain} ${s.outputGain}${peerGains ? ` ${peerGains}` : ""}`, ""].join("\n"));
    }).catch(() => this.childFailure("helper-start"));
    return this.queue.then(() => this.getStatus());
  }

  stop(): Promise<NativeLanAudioStatus> { return this.reconcile(null); }
  async dispose(): Promise<void> { this.disposed = true; await this.stop(); }

  private publish(status: NativeLanAudioStatus): void {
    this.status = status;
    try { this.ports.onStatus?.(this.getStatus()); } catch { /* Observers do not own audio. */ }
  }
  private clearStartup(): void { if (this.startupTimer) clearTimeout(this.startupTimer); this.startupTimer = null; }
  private fail(error: NativeLanAudioError): void {
    this.clearStartup();
    if (this.active) this.failedIdentity = identity(this.active);
    this.publish({ ...this.status, phase: "error", error, captureRms: 0, playbackRms: 0 });
    if (!this.child) this.active = null;
  }
  private childFailure(error: NativeLanAudioError): void {
    this.fail(error);
    this.queue = this.queue.then(async () => { await this.stopChild(); this.publish({ ...this.status, phase: "error", error }); });
  }
  private write(command: string): void {
    try { this.child?.stdin.write(command); } catch { this.childFailure("helper-start"); }
  }
  private applyControls(next: NativeLanAudioDesired): void {
    const prior = this.active!;
    let commands = "";
    // Apply deafen before unmuting, and mute before releasing deafen.
    if (!prior.deafened && next.deafened) commands += "deafen\n";
    if (prior.muted !== next.muted) commands += `${next.muted ? "mute" : "unmute"}\n`;
    if (prior.inputGain !== next.inputGain) commands += `input-gain ${next.inputGain}\n`;
    if (prior.outputGain !== next.outputGain) commands += `output-gain ${next.outputGain}\n`;
    for (const peer of next.peers) {
      const previousPeer = prior.peers.find(p => p.virtualIp === peer.virtualIp);
      const previous = previousPeer ? prior.memberVolumes[previousPeer.userId] ?? 1 : 1;
      const gain = next.memberVolumes[peer.userId] ?? 1;
      if (previous !== gain) commands += `peer-gain ${peer.virtualIp}:${NATIVE_LAN_AUDIO_PORT} ${gain}\n`;
      if (previousPeer?.canPublish !== peer.canPublish || previousPeer?.canReceive !== peer.canReceive)
        commands += `peer-permissions ${peer.virtualIp}:${NATIVE_LAN_AUDIO_PORT} ${Number(peer.canPublish)} ${Number(peer.canReceive)}\n`;
    }
    if (prior.deafened && !next.deafened) commands += "undeafen\n";
    this.active = next;
    if (commands) this.write(commands);
    this.publish({ ...this.status, muted: next.muted, deafened: next.deafened });
  }
  private receipt(child: ChildProcessWithoutNullStreams, line: string): void {
    if (this.child !== child || this.status.phase === "stopping" || this.status.phase === "error") return;
    let value: Record<string, unknown>;
    try { value = JSON.parse(line); } catch { this.childFailure("helper-protocol"); return; }
    if (!value || typeof value !== "object") { this.childFailure("helper-protocol"); return; }
    if (value.event === "ready") {
      if (value.peerCount !== this.active?.peers.length) { this.childFailure("helper-protocol"); return; }
      this.clearStartup(); this.publish({ ...this.status, phase: "running" });
    } else if (value.event === "stats") {
      this.publish({ ...this.status, captureRms: rms(value.captureRms), playbackRms: rms(value.playbackRms),
        packetsSent: count(value.packetsSent), packetsReceived: count(value.packetsReceived), processErrors: count(value.processErrors) });
    } else if (value.event === "error") {
      this.childFailure(nativeLanHelperError(value.code) ?? "helper-protocol");
    } else if (value.event !== "stopped") this.childFailure("helper-protocol");
  }
  private async stopChild(): Promise<void> {
    const child = this.child;
    this.clearStartup();
    if (!child) { this.active = null; return; }
    this.publish({ ...this.status, phase: "stopping", captureRms: 0, playbackRms: 0 });
    const wait = (ms: number) => new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); this.closeWaiters.delete(done); resolve(); };
      this.closeWaiters.add(done); const timer = setTimeout(done, ms);
    });
    const exit = wait(this.ports.shutdownMs ?? 3200);
    try { child.stdin.end("stop\n"); } catch { /* Force only this child at the deadline. */ }
    await exit;
    if (this.child === child) {
      const killed = wait(Math.min(this.ports.shutdownMs ?? 3200, 1000));
      try { child.kill(); } catch { /* Report rather than starting another capture process. */ }
      await killed;
    }
    if (this.child === child) this.fail("helper-stop");
    else this.active = null;
  }
}
