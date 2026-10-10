import type { ReceiveAutoLevelBatch, ReceiveAutoLevelIdentity, ReceiveAutoLevelSnapshot, ReceiveStreamControl } from "@gryt/voice";

type AudioTrack = { id: string; readyState?: string; addEventListener?: EventTarget["addEventListener"]; removeEventListener?: EventTarget["removeEventListener"] };
type RouteSource = {
  receiveCleanup?: ReceiveStreamControl;
  stream: { mediaStream?: { getAudioTracks(): AudioTrack[] }; mediaElement?: { srcObject?: unknown } };
};
type RemoteClient = { serverUserId?: string; streamID?: string; screenShareAudioStreamID?: string };
type Binding = { control: ReceiveStreamControl; identity: ReceiveAutoLevelIdentity; track: AudioTrack; selectors: string[]; onEnded: () => void };

export function correctionParticipantId(host: string, member: string): string {
  return JSON.stringify([host, member]);
}

export function correctionSelector(host: string, member: string, streamId: string): string {
  return JSON.stringify([host, member, streamId]);
}

let registryId = 0;

function validMeasurement(snapshot: ReceiveAutoLevelSnapshot): boolean {
  const nullable = [snapshot.learnedAutoGainDb, snapshot.appliedAutoGainDb, snapshot.targetAutoGainDb, snapshot.compressionGainReductionDb];
  const nonnegative = [snapshot.audioTimeSeconds, snapshot.acceptedSpeechSeconds, snapshot.speechWindowSeconds];
  return Number.isSafeInteger(snapshot.sequence) && snapshot.sequence >= 0 &&
    nullable.every(value => value === null || (typeof value === "number" && Number.isFinite(value))) &&
    nonnegative.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0) &&
    ["learning", "settled", "limited", "unavailable"].includes(snapshot.status) &&
    ["provisional", "established", "invalid"].includes(snapshot.estimatorReliability) &&
    Array.isArray(snapshot.limitReasons) && snapshot.limitReasons.every(reason => typeof reason === "string");
}

/** Associates receiver-local SDK measurements with physical audio routes. */
export class ReceiveCorrectionRegistry {
  private readonly id = ++registryId;
  private routeId = 0;
  private generation = 0;
  private connectionKey = "";
  private readonly receiverIds = new WeakMap<ReceiveStreamControl, string>();
  private readonly roles = new WeakMap<ReceiveStreamControl, string>();
  private readonly latest = new WeakMap<ReceiveStreamControl, ReceiveAutoLevelSnapshot>();
  private bindings = new Map<ReceiveStreamControl, Binding>();
  private readings: ReadonlyMap<string, ReceiveAutoLevelSnapshot> = new Map();
  private readonly listeners = new Set<() => void>();

  readonly getSnapshot = (): ReadonlyMap<string, ReceiveAutoLevelSnapshot> => this.readings;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  lookup(host: string, member: string, streamId: string): ReceiveAutoLevelSnapshot | undefined {
    return this.readings.get(correctionSelector(host, member, streamId));
  }

  reconcile(input: { host: string; channel?: string; connected: boolean; sources: Record<string, RouteSource>; clients: RemoteClient[] }): void {
    const connectionKey = input.connected ? JSON.stringify([input.host, input.channel ?? ""]) : "";
    if (connectionKey !== this.connectionKey) {
      this.clear();
      this.connectionKey = connectionKey;
    }
    const grouped = new Map<ReceiveStreamControl, { aliases: string[]; source: RouteSource }>();
    if (input.connected && input.host) {
      for (const [alias, source] of Object.entries(input.sources)) {
        const control = source.receiveCleanup;
        if (!control) continue;
        const group = grouped.get(control);
        if (group) group.aliases.push(alias);
        else grouped.set(control, { aliases: [alias], source });
      }
    }
    const next = new Map<ReceiveStreamControl, Binding>();
    for (const [control, group] of grouped) {
      const screen = input.clients.some(client => client.screenShareAudioStreamID && group.aliases.includes(client.screenShareAudioStreamID));
      const owners = input.clients.filter(client => client.streamID && group.aliases.includes(client.streamID));
      const role = screen ? "screen" : owners.length ? "microphone" : "unknown";
      if (this.roles.get(control) !== role) {
        control.setRole(role);
        this.roles.set(control, role);
      }
      const media = group.source.stream.mediaStream ?? group.source.stream.mediaElement?.srcObject as { getAudioTracks?: () => AudioTrack[] } | undefined;
      const tracks = media?.getAudioTracks?.() ?? [];
      const members = new Set(owners.map(client => client.serverUserId).filter((id): id is string => !!id));
      if (role !== "microphone" || owners.some(client => !client.serverUserId) || members.size !== 1 || tracks.length !== 1 || tracks[0].readyState === "ended" || !tracks[0].id) continue;
      const member = [...members][0];
      const participantId = correctionParticipantId(input.host, member);
      const track = tracks[0];
      const prior = this.bindings.get(control);
      let identity = prior?.identity;
      if (!prior || identity?.participantId !== participantId || prior.track !== track || identity.trackId !== track.id) {
        prior?.track.removeEventListener?.("ended", prior.onEnded);
        let receiverId = this.receiverIds.get(control);
        if (!receiverId) {
          receiverId = `receive-${this.id}-${++this.routeId}`;
          this.receiverIds.set(control, receiverId);
        }
        identity = { participantId, receiverId, trackId: track.id, generation: ++this.generation };
        control.setIdentity(identity);
      }
      const selectors = owners.map(client => correctionSelector(input.host, member, client.streamID!));
      const onEnded = prior?.identity === identity ? prior.onEnded : () => {
        const current = this.bindings.get(control);
        if (!current || current.identity !== identity) return;
        control.setIdentity(undefined);
        this.bindings.delete(control);
        current.track.removeEventListener?.("ended", current.onEnded);
        const readings = new Map(this.readings);
        for (const selector of current.selectors) readings.delete(selector);
        this.publish(readings);
      };
      if (prior?.identity !== identity) track.addEventListener?.("ended", onEnded);
      next.set(control, { control, identity: identity!, track, selectors, onEnded });
    }
    for (const [control, prior] of this.bindings) if (!next.has(control)) {
      control.setIdentity(undefined);
      prior.track.removeEventListener?.("ended", prior.onEnded);
    }
    const readings = new Map<string, ReceiveAutoLevelSnapshot>();
    for (const binding of next.values()) {
      for (const selector of binding.selectors) {
        const old = this.readings.get(selector);
        if (old && this.matches(old, binding.identity)) readings.set(selector, old);
      }
    }
    this.bindings = next;
    this.publish(readings);
  }

  acceptBatch(batch: ReceiveAutoLevelBatch): void {
    if (batch?.kind !== "receive-auto-levels" || batch.schemaVersion !== 1 || !Array.isArray(batch.snapshots)) return;
    const readings = new Map<string, ReceiveAutoLevelSnapshot>();
    for (const binding of this.bindings.values()) {
      const snapshot = batch.snapshots.find(item => this.matches(item, binding.identity));
      if (!snapshot) {
        const staleGeneration = batch.snapshots.some(item => item?.receiverId === binding.identity.receiverId && item.generation < binding.identity.generation);
        if (staleGeneration) for (const selector of binding.selectors) {
          const visible = this.readings.get(selector);
          if (visible) readings.set(selector, visible);
        }
        continue;
      }
      if (!validMeasurement(snapshot)) continue;
      const prior = this.latest.get(binding.control);
      const comparable = prior && this.matches(prior, binding.identity);
      const nullClear = snapshot.status === "unavailable" && snapshot.learnedAutoGainDb === null && snapshot.appliedAutoGainDb === null && snapshot.targetAutoGainDb === null;
      const accepted = !comparable || snapshot.sequence > prior.sequence || (snapshot.sequence === prior.sequence && nullClear);
      if (accepted) {
        const current = Object.freeze({ ...snapshot, limitReasons: [...snapshot.limitReasons] });
        this.latest.set(binding.control, current);
        for (const selector of binding.selectors) readings.set(selector, current);
      } else {
        for (const selector of binding.selectors) {
          const visible = this.readings.get(selector);
          if (visible) readings.set(selector, visible);
        }
      }
    }
    this.publish(readings);
  }

  clear(): void {
    for (const [control, binding] of this.bindings) {
      control.setIdentity(undefined);
      binding.track.removeEventListener?.("ended", binding.onEnded);
    }
    this.bindings.clear();
    this.publish(new Map());
  }

  private matches(snapshot: ReceiveAutoLevelIdentity | null | undefined, identity: ReceiveAutoLevelIdentity): boolean {
    return !!snapshot && snapshot.participantId === identity.participantId && snapshot.receiverId === identity.receiverId && snapshot.trackId === identity.trackId && snapshot.generation === identity.generation;
  }

  private publish(readings: ReadonlyMap<string, ReceiveAutoLevelSnapshot>): void {
    if (readings.size === this.readings.size && [...readings].every(([key, value]) => this.readings.get(key) === value)) return;
    this.readings = readings;
    for (const listener of this.listeners) listener();
  }
}
