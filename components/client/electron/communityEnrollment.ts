import type { CommunityEnrollmentSnapshot, EasyTierCommunityState } from "../src/lib/easyTierCommunity";
import { validCommunityBearer } from "./communityEtGrantTransport";
import { EasyTierCommunityManager, validEasyTierId } from "./easyTierCommunityManager";

interface Member { serverId: string; host: string; accessToken: string }
interface EnrollmentPorts {
  manager: EasyTierCommunityManager;
  supports(member: Member): boolean;
  approve(serverId: string): Promise<{ accepted: boolean }>;
  authenticate(member: { serverId: string; host: string; accessToken: string | null }): Promise<{ changed: boolean }>;
  releasePreparation(): void;
  preparationReady(): boolean;
  schedule?(work: () => void, delayMs: number): () => void;
}

function snapshot(value: unknown): CommunityEnrollmentSnapshot {
  const input = value as CommunityEnrollmentSnapshot;
  if (!input || typeof input !== "object" || Object.keys(input).some(k => !["members", "enabled", "retry"].includes(k)) ||
      typeof input.enabled !== "boolean" || (input.retry !== undefined && !validEasyTierId(input.retry)) ||
      !Array.isArray(input.members) || input.members.length > 64) throw Error("invalid-enrollment");
  const seen = new Set<string>();
  for (const m of input.members) {
    if (!m || typeof m !== "object" || Object.keys(m).length !== 3 || !validEasyTierId(m.serverId) || seen.has(m.serverId) ||
        typeof m.host !== "string" || !m.host || m.host.length > 256 ||
        (m.accessToken !== null && !validCommunityBearer(m.accessToken))) throw Error("invalid-enrollment-member");
    seen.add(m.serverId);
  }
  return structuredClone(input);
}

/** One lane for membership, consent, native readiness and auth. Rooms never enter this interface. */
export class CommunityEnrollment {
  private revision = 0;
  private authenticated = new Map<string, Member>();
  private pendingAuthentication = new Set<string>();
  private pendingManagerReplacement = new Map<string, {host: string; revision: number}>();
  private membershipRetiredAt = new Map<string, number>();
  private attempted = new Set<string>();
  private prepared = new Set<string>();
  private denied = new Set<string>();
  private tail: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private desired: CommunityEnrollmentSnapshot | null = null;
  private cancelRetry: (() => void) | null = null;
  private retryCount = 0;
  constructor(private ports: EnrollmentPorts) {}

  reconcile(value: unknown): Promise<EasyTierCommunityState[]> {
    const next = snapshot(value);
    if (this.stopped) return Promise.resolve([]);
    this.cancelRetry?.(); this.cancelRetry = null;
    const previousMembers = this.desired?.members ?? [];
    this.desired = { ...next, retry: undefined };
    const revision = ++this.revision;
    if (next.retry) { this.attempted.delete(next.retry); this.prepared.delete(next.retry); this.denied.delete(next.retry); }
    // Cancellation does not wait behind a UAC dialog or a slow authentication flight.
    const wanted = new Map(next.members.filter(m => m.accessToken).map(m => [m.serverId, m]));
    for (const old of previousMembers) {
      const member = wanted.get(old.serverId);
      if (!next.enabled || !member || member.host !== old.host || !this.ports.supports(member as Member)) {
        this.membershipRetiredAt.set(old.serverId, revision);
        this.pendingManagerReplacement.delete(old.serverId);
      }
    }
    for (const id of this.pendingAuthentication) if (!wanted.has(id) || !this.ports.supports(wanted.get(id)! as Member)) this.pendingAuthentication.delete(id);
    const retirements: Promise<unknown>[] = [];
    if (!next.enabled) retirements.push(this.ports.manager.setEnabled(false));
    for (const [id, old] of this.authenticated) if (!wanted.has(id) || wanted.get(id)!.host !== old.host) {
      this.authenticated.delete(id); this.prepared.delete(id); this.attempted.delete(id); this.denied.delete(id);
      retirements.push(this.ports.manager.disconnectCommunity(id));
      retirements.push(this.ports.authenticate({ ...old, accessToken: null }));
    }
    const cancelled = Promise.allSettled(retirements);
    const work = this.tail.catch(() => undefined).then(async () => {
      const results = await cancelled;
      if (results.some(r => r.status === "rejected")) throw Error("enrollment-cleanup-failed");
      if (this.stopped || revision !== this.revision) return [];
      try { return await this.apply(next, revision); }
      catch (error) { if (revision === this.revision) this.scheduleRecovery(); throw error; }
    });
    this.tail = work;
    return work;
  }

  private async apply(next: CommunityEnrollmentSnapshot, revision: number): Promise<EasyTierCommunityState[]> {
    const current = () => !this.stopped && revision === this.revision;
    const members = next.members.filter((m): m is Member => !!m.accessToken && this.ports.supports(m as Member));
    const active: string[] = [];
    if (next.enabled) for (const member of members) {
      const id = member.serverId;
      if (this.prepared.has(id) && !this.ports.preparationReady()) {
        this.prepared.delete(id); this.attempted.delete(id);
      }
      if (!this.prepared.has(id)) {
        if (this.attempted.has(id)) continue;
        this.attempted.add(id);
        let accepted = false;
        try { accepted = (await this.ports.approve(id)).accepted; }
        catch { this.attempted.delete(id); throw Error("enrollment-preparation-failed"); }
        if (!accepted) this.denied.add(id);
        else this.prepared.add(id);
        if (!current()) return [];
        if (!accepted) continue;
      }
      const old = this.authenticated.get(id);
      {
        // Track in-flight auth too, so removal can immediately invalidate its epoch.
        this.authenticated.set(id, member);
        try {
          const result = await this.ports.authenticate(member);
          // Auth may have committed a scope replacement before a newer snapshot
          // superseded this lane. Carry that fact, but never across retirement.
          if (result.changed && old && !this.stopped && (this.membershipRetiredAt.get(id) ?? 0) <= revision && this.desired?.enabled &&
              this.desired.members.some(m => m.serverId === id && m.host === member.host && m.accessToken))
            this.pendingManagerReplacement.set(id, {host: member.host, revision});
          if (!current()) return [];
          this.pendingAuthentication.delete(id);
          const replacement = this.pendingManagerReplacement.get(id);
          if (replacement && replacement.host === member.host && replacement.revision >= (this.membershipRetiredAt.get(id) ?? 0)) {
            await this.ports.manager.authenticatedSessionChanged(id);
            if (this.pendingManagerReplacement.get(id) === replacement) this.pendingManagerReplacement.delete(id);
            if (!current()) return [];
          }
        } catch {
          if (current()) {
            // Keep responsibility for the last verified member and its manager
            // session. Runtime authorization still owns TTL/revocation checks.
            if (old) this.authenticated.set(id, old);
            else this.authenticated.delete(id);
            this.pendingAuthentication.add(id);
          }
          throw Error("enrollment-authentication-failed");
        }
      }
      active.push(id);
    }
    if (!current()) return [];
    // Only authenticated, prepared members can acquire the community lease.
    await this.ports.manager.syncMemberships(active);
    if (!current()) return [];
    await this.ports.manager.setEnabled(next.enabled);
    if (!active.length) {
      this.ports.releasePreparation(); this.prepared.clear();
      for (const id of this.attempted) if (!this.denied.has(id)) this.attempted.delete(id);
    }
    return next.members.map(m => this.denied.has(m.serverId) ? {
      ...this.ports.manager.getState(m.serverId), phase: "activation-required", reason: "needs-permission",
    } : this.ports.manager.getState(m.serverId));
  }

  /** Lifecycle errors retry from the saved member, never from a voice-room event. */
  observe(state: EasyTierCommunityState): void {
    // Missing CLI/binding evidence invalidates telemetry, not the owned core.
    // The manager's normal refresh lane retries observations independently.
    if (state.phase === "connected" && this.pendingAuthentication.size === 0) { this.retryCount = 0; this.cancelRetry?.(); this.cancelRetry = null; }
    else if (state.phase === "error" && ["runtime-exited", "connect-failed", "operation-timeout"].includes(state.reason ?? "")) this.scheduleRecovery();
  }

  private scheduleRecovery(): void {
    if (this.stopped || this.cancelRetry || !this.desired?.enabled ||
        !this.desired.members.some(m => m.accessToken && this.ports.supports(m as Member) && !this.denied.has(m.serverId))) return;
    const schedule = this.ports.schedule ?? ((work: () => void, delayMs: number) => {
      const timer = setTimeout(work, delayMs); return () => clearTimeout(timer);
    });
    this.cancelRetry = schedule(() => {
      this.cancelRetry = null;
      if (this.desired) void this.reconcile(this.desired).catch(() => undefined);
    }, Math.min(30_000, 5_000 * 2 ** Math.min(this.retryCount++, 3)));
  }

  shutdown(): void {
    this.stopped = true; this.revision++; this.cancelRetry?.(); this.cancelRetry = null;
    this.pendingManagerReplacement.clear();
    this.ports.releasePreparation();
  }
}
