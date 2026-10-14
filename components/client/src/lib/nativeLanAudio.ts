/** Ephemeral, authenticated room configuration. Never store or log the key. */
export interface NativeLanAudioDesired {
  serverId: string;
  roomId: string;
  epoch: string;
  localIp: string;
  key: string;
  expiresInMs: number;
  peers: Array<{ userId: string; virtualIp: string; canPublish?: boolean; canReceive?: boolean }>;
  muted: boolean;
  deafened: boolean;
  inputGain: number;
  outputGain: number;
  memberVolumes: Record<string, number>;
}

export type NativeLanAudioError = "invalid-session" | "helper-unavailable" | "helper-start" |
  "helper-exit" | "helper-protocol" | "helper-timeout" | "helper-stop" |
  "audio-device" | "audio-runtime" | "network-runtime";

export interface NativeLanAudioStatus {
  phase: "idle" | "starting" | "running" | "stopping" | "error";
  serverId?: string;
  roomId?: string;
  error?: NativeLanAudioError;
  peerCount: number;
  muted: boolean;
  deafened: boolean;
  captureRms: number;
  playbackRms: number;
  packetsSent: number;
  packetsReceived: number;
  processErrors: number;
}

export const NATIVE_LAN_AUDIO_PORT = 39177;

/** Current device proof handles; addresses and room keys come from server authentication. */
export interface NativeLanAudioBinding {
  v: 1;
  communityId: string;
  deviceId: string;
  nativeInstanceId: string;
  grantId: string;
}

export interface NativeLanAudioBridge {
  getBinding(serverId: string): Promise<NativeLanAudioBinding | null>;
  reconcile(desired: NativeLanAudioDesired | null): Promise<NativeLanAudioStatus>;
  getStatus(): Promise<NativeLanAudioStatus>;
  onStatus(listener: (status: NativeLanAudioStatus) => void): () => void;
}

declare global {
  interface Window { nativeLanAudio?: NativeLanAudioBridge; }
}

/** Matches the exclusively owned EasyTier community subnet. */
export function isNativeLanVirtualIp(value: unknown): value is string {
  return typeof value === "string" && /^10\.203\.217\.(?:[1-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/.test(value);
}

export function normalizeNativeLanAudioDesired(value: unknown): NativeLanAudioDesired | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const identity = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= 256 &&
    !Array.from(s).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
  const gain = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 2;
  if (!identity(v.serverId) || !identity(v.roomId) || !identity(v.epoch) || !isNativeLanVirtualIp(v.localIp) ||
    typeof v.key !== "string" || !/^[a-fA-F0-9]{64}$/.test(v.key) || /^0+$/.test(v.key) ||
    typeof v.expiresInMs !== "number" || !Number.isSafeInteger(v.expiresInMs) || v.expiresInMs < 1 || v.expiresInMs > 15000 ||
    !Array.isArray(v.peers) || v.peers.length > 11 || typeof v.muted !== "boolean" ||
    typeof v.deafened !== "boolean" || !gain(v.inputGain) || !gain(v.outputGain) ||
    !v.memberVolumes || typeof v.memberVolumes !== "object" || Array.isArray(v.memberVolumes)) return null;
  const users = new Set<string>(), ips = new Set<string>();
  const peers: NativeLanAudioDesired["peers"] = [];
  for (const p of v.peers) {
    if (!p || typeof p !== "object" || !identity(p.userId) || !isNativeLanVirtualIp(p.virtualIp) ||
      p.virtualIp === v.localIp || users.has(p.userId) || ips.has(p.virtualIp) ||
      (p.canPublish !== undefined && typeof p.canPublish !== "boolean") ||
      (p.canReceive !== undefined && typeof p.canReceive !== "boolean")) return null;
    users.add(p.userId); ips.add(p.virtualIp);
    peers.push({ userId: p.userId, virtualIp: p.virtualIp, canPublish: p.canPublish ?? true, canReceive: p.canReceive ?? true });
  }
  const volumes: Record<string, number> = Object.create(null);
  const entries = Object.entries(v.memberVolumes);
  if (entries.length > 256) return null;
  for (const [user, volume] of entries) {
    if (!identity(user) || !gain(volume)) return null;
    // Keep only present room members. Never grow a room control payload from history.
    if (users.has(user)) volumes[user] = volume;
  }
  peers.sort((a, b) => a.virtualIp.localeCompare(b.virtualIp));
  return { serverId: v.serverId, roomId: v.roomId, epoch: v.epoch, localIp: v.localIp,
    key: v.key.toLowerCase(), expiresInMs: v.expiresInMs, peers, muted: v.muted, deafened: v.deafened,
    inputGain: v.inputGain, outputGain: v.outputGain, memberVolumes: volumes };
}
