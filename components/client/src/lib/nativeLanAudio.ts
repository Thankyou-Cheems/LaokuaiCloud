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
  "audio-runtime" | "network-runtime" | NativeLanHelperError;

// Keep only helper-owned enum values; never forward driver messages or stdin.
export const nativeLanHelperErrors = ["invalid-config", "invalid-command", "invalid-arguments", "host-failure",
  "audio-init", "audio-enumeration", "audio-device", "audio-format", "audio-open", "audio-start", "audio-inactive",
  "udp-init", "udp-open", "udp-exclusive", "udp-bind", "udp-nonblocking", "udp-options", "udp-runtime"] as const;
export type NativeLanHelperError = typeof nativeLanHelperErrors[number];
export function nativeLanHelperError(value: unknown): NativeLanHelperError | null {
  return typeof value === "string" && (nativeLanHelperErrors as readonly string[]).includes(value)
    ? value as NativeLanHelperError : null;
}

export function nativeLanAudioErrorText(error: NativeLanAudioError): string {
  const labels: Record<NativeLanAudioError, string> = {
    "invalid-session": "语音会话无效，请重新加入频道",
    "helper-unavailable": "原生音频组件缺失或校验失败",
    "helper-start": "无法启动原生音频组件",
    "helper-exit": "原生音频组件意外退出",
    "helper-protocol": "原生音频组件通信异常",
    "helper-timeout": "原生音频组件启动超时",
    "helper-stop": "原生音频组件尚未退出",
    "audio-runtime": "音频设备运行失败",
    "network-runtime": "音频网络运行失败",
    "invalid-config": "原生音频组件拒绝会话配置",
    "invalid-command": "原生音频组件拒绝控制指令",
    "invalid-arguments": "原生音频组件启动参数无效",
    "host-failure": "原生音频组件初始化失败",
    "audio-init": "无法初始化音频系统",
    "audio-enumeration": "无法读取音频设备列表",
    "audio-device": "系统默认麦克风或扬声器不可用",
    "audio-format": "默认音频设备不支持当前声道或采样格式",
    "audio-open": "无法打开默认音频设备，请检查设备占用和系统麦克风权限",
    "audio-start": "无法启动默认音频设备",
    "audio-inactive": "音频设备已停止工作",
    "udp-init": "无法初始化语音网络",
    "udp-open": "无法创建语音 UDP 通道",
    "udp-exclusive": "无法准备独占语音端口",
    "udp-bind": "无法绑定社区虚拟地址的语音端口，请检查地址或端口占用",
    "udp-nonblocking": "无法准备语音网络读写",
    "udp-options": "无法配置语音 UDP 通道",
    "udp-runtime": "语音 UDP 通道运行失败",
  };
  return `${labels[error]}（${error}）`;
}

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
