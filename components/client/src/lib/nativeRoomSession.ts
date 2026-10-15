import { type NativeLanAudioDesired,normalizeNativeLanAudioDesired } from "./nativeLanAudio";

/** Private socket snapshot. The room key lives only in this session's memory. */
export interface NativeRoomSnapshot {
  v: 1; serverId: string; channelId: string; revision: number; epoch: string;
  localIp: string; key: string; peers: NativeLanAudioDesired["peers"];
  serverTimeMs: number; expiresAtMs: number;
  /** Added to v1 separately from effective mute/deafen; absent on older hosts. */
  canSpeak?: boolean; canPublish: boolean; canReceive: boolean; requirePTT: boolean;
}
export interface NativeRoomControls {
  muted: boolean; deafened: boolean; pttRequired: boolean; pttHeld: boolean;
  suppressed: boolean; inputGain: number; outputGain: number; memberVolumes: Record<string, number>;
}
/** Monotonic local lease and terminal identity prevent late IPC/socket replies reviving a room. */
export function createNativeRoomSession(serverId: string, channelId: string, now: () => number = () => performance.now()) {
  let active = true, snapshot: NativeRoomSnapshot | null = null, deadline = 0, revision = -1;
  let room = channelId;
  let serverTime = -Infinity, serverExpiry = -Infinity;
  return {
    get active() { return active; },
    get room() { return room; },
    get requirePTT() { return snapshot?.requirePTT === true; },
    get canSpeak() { return snapshot?.canSpeak; },
    get canPublish() { return snapshot?.canPublish === true; },
    accept(value: unknown, allowMove = false): boolean {
      if (!active || !value || typeof value !== "object") return false;
      const next = value as NativeRoomSnapshot;
      if (next.v !== 1 || next.serverId !== serverId || typeof next.channelId !== "string" ||
        (!allowMove && next.channelId !== room) || !Number.isSafeInteger(next.revision) || next.revision < revision ||
        typeof next.canPublish !== "boolean" || typeof next.canReceive !== "boolean" || typeof next.requirePTT !== "boolean" ||
        (next.canSpeak !== undefined && typeof next.canSpeak !== "boolean") ||
        !Number.isFinite(next.serverTimeMs) || !Number.isFinite(next.expiresAtMs)) return false;
      const remaining = next.expiresAtMs - next.serverTimeMs;
      if (next.revision === revision && (next.serverTimeMs < serverTime ||
        (next.serverTimeMs === serverTime && next.expiresAtMs <= serverExpiry) || (snapshot && next.epoch !== snapshot.epoch))) return false;
      if (remaining <= 0 || remaining > 15000) return false;
      const normalized = normalizeNativeLanAudioDesired({serverId,roomId:next.channelId,epoch:next.epoch,localIp:next.localIp,
        key:next.key,peers:next.peers,muted:true,deafened:true,inputGain:1,outputGain:1,memberVolumes:{},expiresInMs:remaining});
      if (!normalized) return false;
      snapshot = {...next,peers:normalized.peers,key:normalized.key};
      room = next.channelId; revision = next.revision; deadline = now() + remaining;
      serverTime=next.serverTimeMs;serverExpiry=next.expiresAtMs;
      return true;
    },
    desired(controls: NativeRoomControls): NativeLanAudioDesired | null {
      const remaining = Math.floor(deadline - now());
      if (!active || !snapshot || remaining <= 0) { snapshot = null; return null; }
      return normalizeNativeLanAudioDesired({serverId,roomId:room,epoch:snapshot.epoch,localIp:snapshot.localIp,
        key:snapshot.key,peers:snapshot.peers,
        muted:controls.muted || !snapshot.canPublish || controls.suppressed || ((controls.pttRequired || snapshot.requirePTT) && !controls.pttHeld),
        deafened:controls.deafened || !snapshot.canReceive,inputGain:controls.inputGain,outputGain:controls.outputGain,
        memberVolumes:controls.memberVolumes,expiresInMs:Math.min(15000,remaining)});
    },
    suspend() { snapshot = null; deadline = 0; },
    move(destination: string) { if(active && destination) {room=destination;snapshot=null;deadline=0;revision=-1;serverTime=-Infinity;serverExpiry=-Infinity;} },
    close() { active = false; snapshot = null; deadline = 0; },
  };
}
