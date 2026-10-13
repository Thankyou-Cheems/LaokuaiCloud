export const DEFAULT_INVITE_HOURS = 24;
export const DEFAULT_INVITE_USES = 1;

export type InviteAvailability = "active" | "revoked" | "expired" | "exhausted";

export function inviteAvailability(invite: {
  revoked?: boolean;
  expiresAt?: string | Date | null;
  maxUses?: number;
  usesConsumed?: number;
  usesRemaining?: number;
}, now = Date.now()): InviteAvailability {
  if (invite.revoked) return "revoked";
  if (invite.expiresAt) {
    const expiry = new Date(invite.expiresAt).getTime();
    if (Number.isFinite(expiry) && expiry <= now) return "expired";
  }
  if (typeof invite.maxUses === "number" && invite.maxUses > 0 &&
    (invite.usesRemaining === 0 || (invite.usesConsumed ?? 0) >= invite.maxUses)) return "exhausted";
  return "active";
}

/** Empty fields use the safe defaults; entered values are validated, never coerced. */
export function invitationLimits(maxUses: string, hours: string, infinite: boolean):
  | { ok: true; maxUses?: number; infinite?: true; expiresInHours: number }
  | { ok: false; messageKey: "invite.invalidUses" | "invite.invalidExpiry" } {
  const uses = maxUses.trim() ? Number(maxUses) : DEFAULT_INVITE_USES;
  const expiresInHours = hours.trim() ? Number(hours) : DEFAULT_INVITE_HOURS;
  if (!infinite && (!Number.isInteger(uses) || uses < 1 || uses > 1000)) {
    return { ok: false, messageKey: "invite.invalidUses" };
  }
  if (!Number.isFinite(expiresInHours) || expiresInHours <= 0) {
    return { ok: false, messageKey: "invite.invalidExpiry" };
  }
  return { ok: true, ...(infinite ? { infinite: true } : { maxUses: uses }), expiresInHours };
}
