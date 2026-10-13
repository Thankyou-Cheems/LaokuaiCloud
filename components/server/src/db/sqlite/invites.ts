import { randomBytes, randomUUID } from "crypto";

import type { ServerAuditRecord, ServerInviteRecord, UserRecord } from "../interfaces";
import { fromIso, fromIsoNullable, getSqliteDb, toIso } from "./connection";
import { getUserByGrytIdSync, upsertUserSync } from "./users";

function rowToInvite(r: Record<string, unknown>): ServerInviteRecord {
  const maxUses = (r.max_uses as number) ?? 1;
  const usesRemaining = (r.uses_remaining as number) ?? 0;
  const isInfinite = maxUses < 0 || usesRemaining < 0;
  return {
    code: r.code as string,
    password_bypass: r.password_bypass === 1,
    created_at: fromIso(r.created_at as string),
    created_by_server_user_id: (r.created_by_server_user_id as string) ?? null,
    expires_at: fromIsoNullable(r.expires_at as string | null),
    max_uses: isInfinite ? -1 : maxUses,
    uses_remaining: isInfinite ? -1 : usesRemaining,
    uses_consumed: (r.uses_consumed as number) ?? 0,
    revoked: (r.revoked as number) === 1,
    note: (r.note as string) ?? null,
    granted_role_id: (r.granted_role_id as string) ?? null,
    granted_role_rank:
      r.granted_role_rank == null ? null : Number(r.granted_role_rank),
  };
}

function generateInviteCode(): string {
  try { return randomBytes(9).toString("base64url").toLowerCase(); }
  catch { return randomBytes(9).toString("base64").replace(/[+/=]/g, "").slice(0, 12).toLowerCase(); }
}

const CUSTOM_CODE_RE = /^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$/;

export async function createServerInvite(createdByServerUserId: string | null, opts?: {
  expiresAt?: Date | null; infinite?: boolean; maxUses?: number; note?: string | null; customCode?: string | null;
  /** The socket handler enforces administrator authority before setting this. */
  passwordBypass?: boolean;
  /** Validated by the caller against `mayBindRoleToInvite`: this layer writes
      rows, and the rule in two places ends up a check short in one. */
  grantedRole?: { roleId: string; rank: number } | null;
}): Promise<ServerInviteRecord> {
  const db = getSqliteDb();
  const now = new Date();
  const infinite = !!opts?.infinite;
  const maxUses = infinite ? -1 : Math.max(1, Math.min(1000, Math.floor(opts?.maxUses ?? 1)));
  const expiresAt = opts?.expiresAt ?? null;
  const note = (opts?.note ?? null) ? String(opts?.note).slice(0, 200) : null;
  const usesRemaining = infinite ? -1 : maxUses;
  const grantedRoleId = opts?.grantedRole?.roleId ?? null;
  const grantedRoleRank = opts?.grantedRole ? opts.grantedRole.rank : null;
  const passwordBypass = opts?.passwordBypass === true;
  if (passwordBypass && grantedRoleId) throw new Error("Password-free invites grant ordinary membership only.");

  const rawCustom = opts?.customCode ? String(opts.customCode).trim().toLowerCase() : null;
  if (passwordBypass && rawCustom) throw new Error("Password-free invites require a random code.");
  if (rawCustom) {
    if (!CUSTOM_CODE_RE.test(rawCustom))
      throw new Error("Custom code must be 3–32 chars, lowercase alphanumeric / hyphens / underscores.");
    const existing = db.prepare(`SELECT 1 FROM invites WHERE code = ?`).get(rawCustom);
    if (existing) throw new Error("That invite code already exists.");
    db.prepare(`INSERT INTO invites (code, created_by_server_user_id, expires_at, max_uses, uses_remaining, uses_consumed, revoked, note, created_at, granted_role_id, granted_role_rank, password_bypass) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`).run(
      rawCustom, createdByServerUserId, expiresAt ? toIso(expiresAt) : null, maxUses, usesRemaining, note, toIso(now), grantedRoleId, grantedRoleRank, passwordBypass ? 1 : 0);
    return { code: rawCustom, password_bypass: passwordBypass, created_at: now, created_by_server_user_id: createdByServerUserId, expires_at: expiresAt, max_uses: maxUses, uses_remaining: usesRemaining, uses_consumed: 0, revoked: false, note, granted_role_id: grantedRoleId, granted_role_rank: grantedRoleRank };
  }

  for (let i = 0; i < 5; i++) {
    const code = passwordBypass ? randomBytes(16).toString("hex") : generateInviteCode();
    try {
      db.prepare(`INSERT INTO invites (code, created_by_server_user_id, expires_at, max_uses, uses_remaining, uses_consumed, revoked, note, created_at, granted_role_id, granted_role_rank, password_bypass) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`).run(
        code, createdByServerUserId, expiresAt ? toIso(expiresAt) : null, maxUses, usesRemaining, note, toIso(now), grantedRoleId, grantedRoleRank, passwordBypass ? 1 : 0);
      return { code, password_bypass: passwordBypass, created_at: now, created_by_server_user_id: createdByServerUserId, expires_at: expiresAt, max_uses: maxUses, uses_remaining: usesRemaining, uses_consumed: 0, revoked: false, note, granted_role_id: grantedRoleId, granted_role_rank: grantedRoleRank };
    } catch { /* collision, retry */ }
  }
  throw new Error("Failed to create invite code (collision)");
}

export async function listServerInvites(): Promise<ServerInviteRecord[]> {
  const db = getSqliteDb();
  const rows = db.prepare(`SELECT * FROM invites`).all() as Record<string, unknown>[];
  return rows.map(rowToInvite);
}

/** For answering how somebody got in, and whether that door is still open,
    without listing every invite on the server. */
export async function getServerInvite(code: string): Promise<ServerInviteRecord | null> {
  const db = getSqliteDb();
  const row = db.prepare(`SELECT * FROM invites WHERE code = ?`).get(code) as Record<string, unknown> | undefined;
  return row ? rowToInvite(row) : null;
}

export async function revokeServerInvite(code: string, revoked = true): Promise<void> {
  const db = getSqliteDb();
  db.prepare(`UPDATE invites SET revoked = ? WHERE code = ?`).run(revoked ? 1 : 0, code);
}

export type InviteFailure = "not_found" | "revoked" | "expired" | "used_up" | "password_required";
export type InviteConsumption = { ok: true; passwordBypass: boolean } | { ok: false; reason: InviteFailure };

export async function consumeServerInvite(code: string): Promise<InviteConsumption> {
  return consumeServerInviteSync(code);
}

function consumeServerInviteSync(code: string, requirePasswordBypass = false): InviteConsumption {
  const db = getSqliteDb();
  const norm = String(code || "").trim().toLowerCase();
  if (!norm) return { ok: false, reason: "not_found" };

  const row = db.prepare(`SELECT * FROM invites WHERE code = ?`).get(norm) as Record<string, unknown> | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  const invite = rowToInvite(row);
  if (invite.revoked) return { ok: false, reason: "revoked" };
  if (invite.expires_at && invite.expires_at.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  const isInfinite = invite.max_uses < 0 || invite.uses_remaining < 0;
  if (!isInfinite && invite.uses_remaining <= 0) return { ok: false, reason: "used_up" };
  if (requirePasswordBypass && !invite.password_bypass) return { ok: false, reason: "password_required" };

  // Expiry/revocation/use count are all checked by the same write, including
  // unlimited invitations. Exhaustion is distinct from explicit revocation.
  const result = db.prepare(`UPDATE invites SET
    uses_remaining = CASE WHEN max_uses < 0 OR uses_remaining < 0 THEN -1 ELSE uses_remaining - 1 END,
    uses_consumed = uses_consumed + 1
    WHERE code = ? AND revoked = 0 AND (expires_at IS NULL OR expires_at > ?)
      AND (max_uses < 0 OR uses_remaining > 0 OR uses_remaining < 0)
      AND (? = 0 OR password_bypass = 1)`).run(norm, toIso(new Date()), requirePasswordBypass ? 1 : 0);
  return result.changes > 0 ? { ok: true, passwordBypass: invite.password_bypass } : { ok: false, reason: "used_up" };
}

/** A committed use always has a durable membership. No awaits inside the
    transaction: a concurrent join/revoke cannot share this connection's lock. */
export async function admitUserWithInvite(
  code: string, grytUserId: string, nickname: string, requirePasswordBypass = false,
): Promise<{ ok: true; user: UserRecord; consumed: boolean; passwordBypass: boolean } | { ok: false; reason: InviteFailure }> {
  const db = getSqliteDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = getUserByGrytIdSync(grytUserId);
    if (existing?.is_active) {
      const user = upsertUserSync(grytUserId, nickname);
      db.exec("COMMIT");
      return { ok: true, user, consumed: false, passwordBypass: false };
    }
    const consumption = consumeServerInviteSync(code, requirePasswordBypass);
    if (!consumption.ok) {
      db.exec("ROLLBACK");
      return consumption;
    }
    const norm = code.trim().toLowerCase();
    const user = upsertUserSync(grytUserId, nickname, { inviteCode: norm });
    // Re-admission records the new credential as well, rather than the stale
    // link retained on an inactive user row.
    db.prepare("UPDATE users SET joined_with_invite_code = ? WHERE server_user_id = ?").run(norm, user.server_user_id);
    user.joined_with_invite_code = norm;
    if (consumption.passwordBypass) {
      const now = toIso(new Date());
      db.prepare("DELETE FROM roles WHERE server_user_id = ?").run(user.server_user_id);
      db.prepare("INSERT INTO roles (server_user_id, role, created_at, updated_at) VALUES (?, 'member', ?, ?)").run(user.server_user_id, now, now);
    }
    db.exec("COMMIT");
    return { ok: true, user, consumed: true, passwordBypass: consumption.passwordBypass };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export async function insertServerAudit(entry: {
  actorServerUserId?: string | null; action: string; target?: string | null; meta?: Record<string, unknown>; createdAt?: Date;
}): Promise<ServerAuditRecord> {
  const db = getSqliteDb();
  const created_at = entry.createdAt ?? new Date();
  const event_id = randomUUID();
  const action = String(entry.action || "").slice(0, 80);
  const target = entry.target == null ? null : String(entry.target).slice(0, 120);
  const meta_json = entry.meta === undefined ? null : JSON.stringify(entry.meta).slice(0, 4000);

  db.prepare(`INSERT INTO audit_log (event_id, actor_server_user_id, action, target, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    event_id, entry.actorServerUserId ?? null, action, target, meta_json, toIso(created_at));

  return { created_at, event_id, actor_server_user_id: entry.actorServerUserId ?? null, action, target, meta_json };
}

/** Rows naming this action and target since a time. The spam filter's strikes are
    these, so its escalation survives a restart without a table of its own. */
export async function countServerAudit(action: string, target: string, since: Date): Promise<number> {
  const db = getSqliteDb();
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND target = ? AND created_at >= ?`)
    .get(action, target, toIso(since)) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

export async function listServerAudit(limit = 50, before?: Date): Promise<ServerAuditRecord[]> {
  const db = getSqliteDb();
  const lim = Math.max(1, Math.min(200, Math.floor(limit)));
  const rows = before
    ? db.prepare(`SELECT * FROM audit_log WHERE created_at < ? ORDER BY created_at DESC LIMIT ?`).all(toIso(before), lim)
    : db.prepare(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?`).all(lim);
  return (rows as Record<string, unknown>[]).map((r) => ({
    created_at: fromIso(r.created_at as string),
    event_id: r.event_id as string,
    actor_server_user_id: (r.actor_server_user_id as string) ?? null,
    action: (r.action as string) ?? "",
    target: (r.target as string) ?? null,
    meta_json: (r.meta_json as string) ?? null,
  }));
}
