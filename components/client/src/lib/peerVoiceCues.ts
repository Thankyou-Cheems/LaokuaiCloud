export interface PeerCueSettings { enabled: boolean; dnd: boolean; joinVolume: number; leaveVolume: number }
export const PEER_CUE_DEFAULTS: Readonly<PeerCueSettings> = Object.freeze({ enabled: true, dnd: false, joinVolume: 60, leaveVolume: 60 });
export function resolvePeerCueSettings(value: unknown, defaults: Readonly<PeerCueSettings> = PEER_CUE_DEFAULTS): PeerCueSettings {
  const input = value && typeof value === "object" ? value as Partial<PeerCueSettings> : {};
  const volume = (v: unknown, fallback: number) => typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : fallback;
  return { enabled: typeof input.enabled === "boolean" ? input.enabled : true, dnd: input.dnd === true,
    joinVolume: volume(input.joinVolume, defaults.joinVolume), leaveVolume: volume(input.leaveVolume, defaults.leaveVolume) };
}
/** Event-only: roster snapshots never produce cues. No delayed/batched sound queue. */
export class PeerCuePolicy {
  private connection = "";
  private lastCue = -Infinity;
  private readonly seen = new Map<string, number>();
  accept(input: { connectionKey: string; selfId: string; memberId: string; kind: "join" | "leave"; eligible: boolean; now: number }): boolean {
    if (!input.eligible || !input.connectionKey || !input.memberId || !input.selfId || input.memberId === input.selfId || !Number.isFinite(input.now)) return false;
    if (this.connection !== input.connectionKey) { this.connection = input.connectionKey; this.seen.clear(); this.lastCue = -Infinity; }
    for (const [key, time] of this.seen) if (input.now - time >= 5000) this.seen.delete(key);
    const key = JSON.stringify([input.kind, input.memberId]);
    if (this.seen.has(key)) return false;
    this.seen.set(key, input.now);
    while (this.seen.size > 256) this.seen.delete(this.seen.keys().next().value!);
    if (input.now - this.lastCue < 400) return false;
    this.lastCue = input.now; return true;
  }
}
/** Original short two-tone cues, not recordings. Rising join, falling leave. */
export function peerCuePcm(kind: "join" | "leave", sampleRate: number): Float32Array {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error("invalid_sample_rate");
  const pcm = new Float32Array(Math.round(sampleRate * 0.18));
  for (let i = 0; i < pcm.length - 1; i++) {
    const time = i / sampleRate;
    const tone = time < 0.08 ? 0 : time >= 0.1 ? 1 : -1;
    if (tone < 0) continue;
    const local = time - (tone ? 0.1 : 0);
    const frequency = (kind === "join" ? [760, 1040] : [1040, 760])[tone];
    const envelope = Math.min(1, local / 0.008, (0.08 - local) / 0.008);
    pcm[i] = 0.18 * Math.max(0, envelope) * Math.sin(2 * Math.PI * frequency * local);
  }
  return pcm;
}
const cueUrls = new Map<string, string>();
export function peerCueUrl(kind: "join" | "leave"): string {
  const cached = cueUrls.get(kind); if (cached) return cached;
  const sampleRate = 24000; const pcm = peerCuePcm(kind, sampleRate);
  const bytes = new Uint8Array(44 + pcm.length * 2); const view = new DataView(bytes.buffer);
  const tag = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
  tag(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); tag(8, "WAVE"); tag(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, "data"); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, Math.round(pcm[i] * 32767), true);
  const url = `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`;
  cueUrls.set(kind, url); return url;
}
