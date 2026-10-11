import {
  type MemberVoiceMediaEvidence,
  type MemberVoiceMediaPathSnapshot,
  type MemberVoiceMediaScope,
  readMemberVoiceMediaPath,
  type SelectedVoiceMediaEvidence,
} from "./memberVoiceMediaPath";

/** Borrowed identities only. This store cannot select, dispose or stop a source. */
export interface VoiceReceiveIdentity {
  isCurrent?(): boolean;
  subscribeRetirement?(listener: () => void): () => void;
}
export interface AuthenticatedVoiceMember {
  userId: string;
  sessionId: string;
  publicationId: string;
  source: VoiceReceiveIdentity;
}
export interface AuthenticatedVoiceConnection {
  accountId: string;
  host: string;
  /** Stable community identity from current server details; never an instance ID. */
  serverId?: string;
  serverInstanceId?: string;
  roomId: string;
  localUserId: string;
  localSessionId: string;
  localPublicationId: string | null;
  /** Current authenticated socket and current SDK SFU PC, compared by reference. */
  socket: object;
  peerConnection: object;
  members: readonly AuthenticatedVoiceMember[];
  /** Integration-normalized authenticated SDK scope, not an SDK API declaration.
   * Only supply after matching its current SDK connection epoch to this exact PC. */
  roomAuthority?: {
    serverInstanceId: string;
    roomId: string;
    localUserId: string;
    localSessionId: string;
    roomGenerationToken: string;
  };
}
export interface VoiceMediaObservationLease {
  readonly scope: Readonly<MemberVoiceMediaScope>;
  readonly source: VoiceReceiveIdentity;
}
interface Binding {
  lease: VoiceMediaObservationLease;
  evidence?: MemberVoiceMediaEvidence;
  unsubscribe?: () => void;
}
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** Local lifecycle epochs preserve opaque SDK room tokens; they never parse/hash
 * a token or reuse an old epoch after A -> B -> A / disconnect -> same room. */
export class VoiceRoomEpoch {
  private token: string | undefined;
  private connection: object | undefined;
  private revision = 0;
  update(connection: object | undefined, token: string | undefined): number {
    if (connection !== this.connection || token !== this.token) {
      this.connection = connection; this.token = token; this.revision++;
    }
    return this.revision;
  }
}

/** Single passive authority store. Only the integration adapter may accept SDK
 * observations after checking SDK auth/epoch against its captured live lease.
 * Reconciliation/ticks never refresh an observation's time or manufacture proof. */
export class MemberVoiceMediaStore {
  private connection?: AuthenticatedVoiceConnection;
  private identity = "";
  private generation = 0;
  private lifecycle?: object;
  private roomEpoch = new VoiceRoomEpoch();
  private bindings = new Map<string, Binding>();
  private listeners = new Set<() => void>();
  private snapshot: MemberVoiceMediaPathSnapshot;
  constructor(private readonly now: () => number) {
    this.snapshot = { nowMs: now(), entries: [] };
  }
  getSnapshot = (): MemberVoiceMediaPathSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  private publish(): void {
    this.snapshot = { nowMs: this.now(), entries: [...this.bindings.values()].map(binding => ({ scope: binding.lease.scope, evidence: binding.evidence })) };
    for (const listener of this.listeners) listener();
  }
  private remove(sessionId: string): void {
    const binding = this.bindings.get(sessionId);
    this.bindings.delete(sessionId);
    binding?.unsubscribe?.();
  }
  clear(): void {
    for (const id of this.bindings.keys()) this.remove(id);
    this.connection = undefined; this.identity = "";
    this.lifecycle = undefined; this.roomEpoch.update(undefined, undefined);
    this.publish();
  }
  reconcile(input?: AuthenticatedVoiceConnection): void {
    if (!input || ![input.accountId, input.host, input.roomId, input.localUserId, input.localSessionId].every(text) ||
      (input.localPublicationId !== null && !text(input.localPublicationId)) || !input.socket || !input.peerConnection) {
      this.clear(); return;
    }
    const authority = input.roomAuthority;
    if (authority && (!text(authority.roomGenerationToken) || !text(authority.serverInstanceId) || authority.serverInstanceId !== input.serverInstanceId ||
      authority.roomId !== input.roomId || authority.localUserId !== input.localUserId || authority.localSessionId !== input.localSessionId)) {
      this.clear(); return;
    }
    const identity = JSON.stringify([input.accountId, input.host, input.serverId, input.serverInstanceId, input.roomId, input.localUserId, input.localSessionId,
      input.localPublicationId, authority?.roomGenerationToken]);
    if (identity !== this.identity || input.socket !== this.connection?.socket || input.peerConnection !== this.connection?.peerConnection) {
      this.clear(); this.generation++; this.identity = identity; this.lifecycle = {};
    }
    this.connection = { ...input };
    const valid = input.members.filter(member => [member.userId, member.sessionId, member.publicationId].every(text) &&
      member.userId !== input.localUserId && member.sessionId !== input.localSessionId && member.source.isCurrent?.() !== false &&
      input.members.filter(other => other.userId === member.userId || other.sessionId === member.sessionId ||
        other.publicationId === member.publicationId || other.source === member.source).length === 1);
    for (const [id, binding] of this.bindings) {
      const member = valid.find(candidate => candidate.sessionId === id);
      if (!member || member.source !== binding.lease.source || member.publicationId !== binding.lease.scope.remotePublicationId ||
        member.userId !== binding.lease.scope.remoteServerUserId) this.remove(id);
    }
    for (const member of valid) {
      if (this.bindings.has(member.sessionId)) continue;
      const scope: MemberVoiceMediaScope = {
        authority: authority ? "authenticated-room" : "authenticated-connection", accountId: input.accountId, serverScope: input.host,
        roomId: input.roomId, roomGeneration: this.roomEpoch.update(this.lifecycle, authority?.roomGenerationToken), connectionGeneration: this.generation,
        localServerUserId: input.localUserId, localSessionId: input.localSessionId, localPublicationId: input.localPublicationId,
        remoteServerUserId: member.userId, remoteSessionId: member.sessionId, remotePublicationId: member.publicationId,
        ...(input.serverInstanceId ? { serverInstanceId: input.serverInstanceId } : {}),
        ...(authority ? { roomGenerationToken: authority.roomGenerationToken } : {}),
      };
      const binding: Binding = { lease: Object.freeze({ scope: Object.freeze(scope), source: member.source }) };
      this.bindings.set(member.sessionId, binding);
      binding.unsubscribe = member.source.subscribeRetirement?.(() => {
        if (this.bindings.get(member.sessionId) !== binding) return;
        this.remove(member.sessionId); this.publish();
      });
      // A synchronous retirement callback may have already removed the binding.
      if (this.bindings.get(member.sessionId) !== binding) binding.unsubscribe?.();
    }
    this.tick();
  }
  capture(sessionId: string): VoiceMediaObservationLease | undefined {
    const binding = this.bindings.get(sessionId);
    return binding?.lease.source.isCurrent?.() === false ? undefined : binding?.lease;
  }
  acceptReceive(lease: VoiceMediaObservationLease, receive: SelectedVoiceMediaEvidence): boolean {
    const binding = this.bindings.get(lease.scope.remoteSessionId);
    if (!binding || binding.lease !== lease || lease.source.isCurrent?.() === false) return false;
    const previous = binding.evidence?.receive;
    if (previous && (receive.observedAtMs < previous.observedAtMs ||
      (receive.mediaRouteId === previous.mediaRouteId && receive.routeGeneration === previous.routeGeneration &&
        receive.selectionRevision < previous.selectionRevision))) return false;
    const evidence: MemberVoiceMediaEvidence = {
      schemaVersion: 1, source: "authenticated-sdk-media-selection", scope: { ...lease.scope },
      observedAtMs: receive.observedAtMs, receive,
    };
    const reading = readMemberVoiceMediaPath({ scope: lease.scope, evidence, nowMs: this.now() }).receive;
    if (["invalid", "expired", "inconsistent", "scope-mismatch"].includes(reading.reason ?? "")) return false;
    // Own a copy: subscribers/async SDK callbacks cannot mutate accepted proof later.
    binding.evidence = structuredClone(evidence); this.publish(); return true;
  }
  invalidateReceive(lease: VoiceMediaObservationLease): void {
    const binding = this.bindings.get(lease.scope.remoteSessionId);
    if (binding?.lease !== lease) return;
    binding.evidence = undefined;
    // Fence in-flight observations captured before a track/revision change.
    binding.lease = Object.freeze({ scope: lease.scope, source: lease.source });
    this.publish();
  }
  tick(): void {
    for (const [id, binding] of this.bindings) if (binding.lease.source.isCurrent?.() === false) this.remove(id);
    this.publish();
  }
}
