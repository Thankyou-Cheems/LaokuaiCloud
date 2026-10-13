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
  private attempted = new Set<string>();
  private prepared = new Set<string>();
  private denied = new Set<string>();
  private tail: Promise<unknown> = Promise.resolve();
  private stopped = false;
  constructor(private ports: EnrollmentPorts) {}

  reconcile(value: unknown): Promise<EasyTierCommunityState[]> {
    const next = snapshot(value);
    if (this.stopped) return Promise.resolve([]);
    const revision = ++this.revision;
    if (next.retry) { this.attempted.delete(next.retry); this.prepared.delete(next.retry); this.denied.delete(next.retry); }
    // Cancellation does not wait behind a UAC dialog or a slow authentication flight.
    const wanted = new Map(next.members.filter(m => m.accessToken).map(m => [m.serverId, m]));
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
      return this.apply(next, revision);
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
      if (old?.host !== member.host || old.accessToken !== member.accessToken) {
        // Track in-flight auth too, so removal can immediately invalidate its epoch.
        this.authenticated.set(id, member);
        try {
          const result = await this.ports.authenticate(member);
          if (!current()) return [];
          if (result.changed && old) await this.ports.manager.authenticatedSessionChanged(id);
        } catch {
          if (current()) this.authenticated.delete(id);
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

  shutdown(): void { this.stopped = true; this.revision++; this.ports.releasePreparation(); }
}
