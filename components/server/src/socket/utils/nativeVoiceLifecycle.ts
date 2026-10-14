import type { Server } from "socket.io";

export const nativeLanVoiceEnabled = () => process.env.NATIVE_LAN_VOICE_ENABLED === "true";
interface Lifecycle { reconcile(): void; remove(sid: string, reason: string): boolean }
const lifecycles = new WeakMap<Server, Lifecycle>();
export function setNativeVoiceLifecycle(io: Server, lifecycle: Lifecycle): void { lifecycles.set(io, lifecycle); }
export function reconcileNativeVoice(io: Server): void { lifecycles.get(io)?.reconcile(); }
export function removeNativeVoice(io: Server, sid: string, reason = "removed"): boolean {
  return lifecycles.get(io)?.remove(sid, reason) ?? false;
}
