import type { VoiceConfig } from "../types";

export type MediaPolicy = Pick<VoiceConfig["connection"], "mediaMode" | "receiveMicrophoneStreamIds">;
export const isAudioOnly = (policy: MediaPolicy): boolean => policy.mediaMode === "audio-only";

type ReceiveRefresh = (policy: MediaPolicy, committed: boolean) => void;
const receivePolicies = new WeakMap<RTCPeerConnection, { refresh: ReceiveRefresh; committedKey?: string }>();
export function registerPeerReceivePolicy(pc: RTCPeerConnection, refresh: ReceiveRefresh): void {
  receivePolicies.set(pc, { refresh });
}
export function peerReceivePolicyCommitted(pc: RTCPeerConnection, policy: MediaPolicy): boolean {
  return !isAudioOnly(policy) || receivePolicies.get(pc)?.committedKey === JSON.stringify(canonicalMediaPolicy(policy));
}
export function refreshPeerReceivePolicy(pc: RTCPeerConnection, policy: MediaPolicy, committed = false): void {
  const state = receivePolicies.get(pc);
  if (!state) return;
  if (committed) state.committedKey = JSON.stringify(canonicalMediaPolicy(policy));
  state.refresh(policy, committed);
}

/** Compare effective permissions, not caller array order or omitted full-mode defaults. */
export function canonicalMediaPolicy(policy: MediaPolicy): MediaPolicy {
  if (!isAudioOnly(policy)) return { mediaMode: "full" };
  const ids = Array.isArray(policy.receiveMicrophoneStreamIds) ? policy.receiveMicrophoneStreamIds : [];
  return { mediaMode: "audio-only", receiveMicrophoneStreamIds:
    [...new Set(ids.filter(id => typeof id === "string" && id.length > 0))].sort() };
}

/** Capture leases invalidate pending device requests even across full → audio-only → full. */
export class CaptureLease {
  private revision = 0;
  private audioOnly = false;
  setMode(policy: MediaPolicy): void {
    const next = isAudioOnly(policy);
    if (next !== this.audioOnly) ++this.revision;
    this.audioOnly = next;
  }
  begin(): number | null { return this.audioOnly ? null : this.revision; }
  valid(lease: number | null): boolean { return lease !== null && !this.audioOnly && lease === this.revision; }
  invalidate(): void { ++this.revision; }
  async capture(request: () => Promise<MediaStream>, lease = this.begin()): Promise<MediaStream | null> {
    if (!this.valid(lease)) return null;
    const stream = await request();
    if (this.valid(lease)) return stream;
    stream.getTracks().forEach(track => track.stop());
    return null;
  }
}

function sections(sdp: string): string[][] {
  const result: string[][] = [[]];
  for (const line of sdp.split(/\r?\n/).filter(Boolean)) {
    if (line.startsWith("m=")) result.push([]);
    result[result.length - 1].push(line);
  }
  return result;
}

/** All advertised sources must be trusted microphones; missing/ambiguous msid is denied. */
function sectionStreamIds(lines: string[]): string[] {
  const streams = new Set<string>();
  for (const line of lines) {
    const match = line.match(/^a=msid:([^ ]+)/) ?? line.match(/^a=ssrc:\d+ msid:([^ ]+)/);
    if (match) streams.add(match[1]);
  }
  return [...streams];
}
function microphoneSection(lines: string[], policy: MediaPolicy): boolean {
  const streams = sectionStreamIds(lines);
  return streams.length > 0 && streams.every(id => id !== "-" && policy.receiveMicrophoneStreamIds?.includes(id));
}
export function microphoneReceiveStreamIds(sdp: string | undefined, mid: string | null, policy: MediaPolicy): string[] {
  if (!sdp || mid === null || !microphoneReceiveAllowed(sdp, mid, policy)) return [];
  return sectionStreamIds(sections(sdp).find(lines => lines.includes(`a=mid:${mid}`)) ?? []);
}

export function microphoneReceiveAllowed(sdp: string | undefined, mid: string | null, policy: MediaPolicy): boolean {
  if (!isAudioOnly(policy)) return true;
  if (!sdp || mid === null) return false;
  const lines = sections(sdp).find(lines => lines.includes(`a=mid:${mid}`));
  return !!lines?.[0]?.startsWith("m=audio ") && microphoneSection(lines, policy);
}

/** Remove the remote sending direction before setRemoteDescription, and receiving in answers. */
export function restrictMediaSdp(sdp: string, policy: MediaPolicy, side: "remote" | "local", remoteSdp?: string): string {
  if (!isAudioOnly(policy)) return sdp;
  const groups = sections(sdp);
  const sessionDirection = groups[0].find(line => /^a=(sendrecv|sendonly|recvonly|inactive)$/.test(line)) ?? "a=sendrecv";
  for (const lines of groups.slice(1)) {
    const video = lines[0].startsWith("m=video ");
    const mid = lines.find(line => line.startsWith("a=mid:"))?.slice(6) ?? null;
    const allowed = side === "local" ? microphoneReceiveAllowed(remoteSdp, mid, policy) : microphoneSection(lines, policy);
    const denyAudio = lines[0].startsWith("m=audio ") && !allowed;
    if (!video && !denyAudio) continue;
    const direction = lines.find(line => /^a=(sendrecv|sendonly|recvonly|inactive)$/.test(line)) ?? sessionDirection;
    const allowedSending = side === "remote" ? direction === "a=recvonly" || direction === "a=sendrecv" : direction === "a=sendonly" || direction === "a=sendrecv";
    const next = video ? "a=inactive" : allowedSending ? (side === "remote" ? "a=recvonly" : "a=sendonly") : "a=inactive";
    for (let index = lines.length - 1; index >= 1; --index) if (/^a=(sendrecv|sendonly|recvonly|inactive)$/.test(lines[index])) lines.splice(index, 1);
    lines.push(next);
  }
  return groups.flat().join("\r\n") + "\r\n";
}

/** The local answer's msid is our sender, so use the original remote offer for receive roles. */
export function applyPeerMediaPolicy(pc: RTCPeerConnection, policy: MediaPolicy, microphoneSenders: readonly RTCRtpSender[], remoteSdp = pc.remoteDescription?.sdp, enableReceivers = true): void {
  if (!isAudioOnly(policy)) return;
  for (const transceiver of pc.getTransceivers()) {
    if ((transceiver as RTCRtpTransceiver & { stopped?: boolean }).stopped) continue;
    const sender = transceiver.sender;
    const video = transceiver.receiver.track.kind === "video" || sender.track?.kind === "video";
    const sending = !video && microphoneSenders.includes(sender) && sender.track?.kind === "audio";
    const receiving = !video && microphoneReceiveAllowed(remoteSdp, transceiver.mid, policy);
    transceiver.direction = sending ? (receiving ? "sendrecv" : "sendonly") : receiving ? "recvonly" : "inactive";
    if (sender.track && !sending) {
      sender.track.stop();
      void sender.replaceTrack(null).catch(() => pc.close());
    }
    if (!receiving || enableReceivers) transceiver.receiver.track.enabled = receiving;
  }
}
