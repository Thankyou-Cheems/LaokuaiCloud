import { normalizeNativeLanAudioDesired } from "../src/lib/nativeLanAudio";
import type { NativeLanAudioRuntime } from "./nativeLanAudioRuntime";

/** Renderer requests audio only; this boundary has no network-management methods. */
export function registerNativeLanAudioIpc(
  ipc: { handle(name: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown): unknown },
  ports: {
    allowed(event: Electron.IpcMainInvokeEvent): boolean;
    runtime: NativeLanAudioRuntime;
    binding(serverId: string): unknown;
    virtualIp(serverId: string): string | undefined;
  },
): void {
  const guard = (event: Electron.IpcMainInvokeEvent) => {
    if (!ports.allowed(event)) throw new Error("native-audio-unavailable");
  };
  ipc.handle("native-lan-audio-binding", (event, serverId: unknown) => {
    guard(event);
    if (typeof serverId !== "string" || !serverId || serverId.length > 256 || !ports.virtualIp(serverId))
      throw new Error("native-voice-lan-unavailable");
    return ports.binding(serverId);
  });
  ipc.handle("native-lan-audio-reconcile", async (event, value: unknown) => {
    guard(event);
    if (value === null) return ports.runtime.stop();
    const desired = normalizeNativeLanAudioDesired(value);
    if (!desired || ports.virtualIp(desired.serverId) !== desired.localIp) {
      await ports.runtime.stop();
      throw new Error("native-voice-lan-unavailable");
    }
    // Recheck grant lifetime without disclosing the bearer or EasyTier secret.
    try { ports.binding(desired.serverId); }
    catch { await ports.runtime.stop(); throw new Error("native-voice-lan-unavailable"); }
    return ports.runtime.reconcile(desired);
  });
  ipc.handle("native-lan-audio-status", event => { guard(event); return ports.runtime.getStatus(); });
}
