import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from "jose";

import { getSqliteDb, initSqlite } from "../../db/sqlite/connection";
import { admitUserWithInvite, createServerInvite, getServerInvite, revokeServerInvite } from "../../db/sqlite/invites";
import { banUser, createServerConfigIfNotExists, listMemberRoles, setServerOwner, setServerRole, updateServerConfig } from "../../db/sqlite/servers";
import { getUserByGrytId, setUserInactive, upsertUser } from "../../db/sqlite/users";
import { hashServerPassword } from "../../db/interfaces";
import { createRoleDefinition } from "../../db/sqlite/roleDefinitions";
import { generateAccessToken } from "../../utils/jwt";
import { verifyCertificate } from "../../auth/identity";
import type { Clients } from "../../types";
import { registerAdminHandlers } from "./admin";
import { registerJoinHandlers } from "./join";
import type { HandlerContext } from "./types";

const HOST = "password-invites.test:5001";
let dir: string;
let seq = 0;
let ownerToken: string;
let ordinaryManagerToken: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "gryt-password-invites-"));
  process.env.DATA_DIR = dir;
  process.env.GRYT_IDENTITY_TIERS = "local,account";
  await initSqlite();
  await createServerConfigIfNotExists();
  const password = await hashServerPassword("test-community-password");
  await setServerOwner("test-owner");
  await updateServerConfig({ joinPolicy: "password", passwordSalt: password.saltB64, passwordHash: password.hashB64, passwordAlgo: password.algo });
  const owner = await upsertUser("test-owner", "Owner");
  await setServerRole(owner.server_user_id, "owner");
  ownerToken = generateAccessToken({ grytUserId: owner.gryt_user_id, serverUserId: owner.server_user_id, nickname: owner.nickname, serverHost: HOST, tokenVersion: 0 });
  await createRoleDefinition("invite-manager", { name: "Invite Manager", rank: 50, permissions: ["create_invite", "manage_invites"] });
  const manager = await upsertUser("test-manager", "Manager");
  await setServerRole(manager.server_user_id, "invite-manager");
  ordinaryManagerToken = generateAccessToken({ grytUserId: manager.gryt_user_id, serverUserId: manager.server_user_id, nickname: manager.nickname, serverHost: HOST, tokenVersion: 0 });
});

after(() => {
  getSqliteDb().close();
  delete process.env.DATA_DIR;
  delete process.env.GRYT_IDENTITY_TIERS;
  rmSync(dir, { recursive: true, force: true });
});

interface Event { event: string; payload: Record<string, unknown> }
function context() {
  const id = `invites-${++seq}`;
  const emitted: Event[] = [];
  const rooms = new Set([id]);
  const socket = {
    id, rooms, handshake: { headers: { host: HOST }, address: `192.0.2.${seq}` },
    emit(event: string, payload: Record<string, unknown> = {}) { emitted.push({ event, payload }); return true; },
    join(room: string) { rooms.add(room); }, leave(room: string) { rooms.delete(room); },
    to: () => ({ emit() {} }),
  };
  const clientsInfo = { [id]: { serverUserId: `temp_${id}`, nickname: "Pending" } } as unknown as Clients;
  const ctx = {
    io: { to: () => ({ emit() {} }), emit() {}, sockets: { sockets: new Map([[id, socket]]) } },
    socket, clientId: id, serverId: "invite-community", clientsInfo, sfuClient: null,
    getClientIp: () => socket.handshake.address, clientAddressIsOwn: () => true,
  } as unknown as HandlerContext;
  return { ctx, emitted, rooms };
}

async function identity() {
  const keys = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(keys.publicKey);
  const sub = `key:${await calculateJwkThumbprint(jwk, "sha256")}`;
  const certificate = await new SignJWT({ jwk }).setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuer("gryt:self").setSubject(sub).setIssuedAt().setExpirationTime("1h").sign(keys.privateKey);
  const verified = await verifyCertificate(certificate);
  return { ...keys, certificate, sub, grytUserId: verified.grytUserId };
}

async function joinIdentity(person: Awaited<ReturnType<typeof identity>>, code?: string, password?: string, corrupt = false) {
  const scene = context();
  const handlers = registerJoinHandlers(scene.ctx);
  await handlers["server:join"]({ nickname: "Invited Member", inviteCode: code });
  const challenge = scene.emitted.find((e) => e.event === "server:challenge")?.payload;
  assert.ok(challenge);
  const assertion = await new SignJWT({ nonce: corrupt ? "wrong-nonce" : challenge.nonce }).setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setSubject(person.sub).setAudience(HOST).setIssuedAt().setExpirationTime("1m").sign(person.privateKey);
  await handlers["server:verify"]({ certificate: person.certificate, assertion, communityPassword: password });
  return scene;
}

function failure(scene: ReturnType<typeof context>) {
  return scene.emitted.find((e) => e.event === "server:error")?.payload.error;
}

describe("password-free invite administration", () => {
  it("creates an administrator link with expiry/use settings and a 128-bit random credential", async () => {
    const scene = context();
    await registerAdminHandlers(scene.ctx)["server:invites:create"]({ accessToken: ownerToken, expiresInHours: 24, maxUses: 2 });
    const invite = scene.emitted.find((e) => e.event === "server:invite:created")?.payload.invite as { code: string; passwordBypass: boolean; maxUses: number; expiresAt: Date };
    assert.ok(invite);
    assert.match(invite.code, /^[a-f0-9]{32}$/);
    assert.equal(invite.passwordBypass, true);
    const stored = await getServerInvite(invite.code);
    assert.equal(stored?.password_bypass, true);
    assert.equal(stored?.max_uses, 2);
    assert.ok(stored?.expires_at && stored.expires_at.getTime() > Date.now());
  });

  it("prevents an invite manager from minting the password bypass", async () => {
    const scene = context();
    await registerAdminHandlers(scene.ctx)["server:invites:create"]({ accessToken: ordinaryManagerToken, passwordBypass: true });
    assert.equal(failure(scene), "forbidden");
    assert.equal(scene.emitted.some((e) => e.event === "server:invite:created"), false);
  });

  it("allows a non-owner community admin to issue the ordinary membership invitation", async () => {
    const admin = await upsertUser("test-admin", "Admin");
    await setServerRole(admin.server_user_id, "admin");
    const token = generateAccessToken({ grytUserId: admin.gryt_user_id, serverUserId: admin.server_user_id, nickname: admin.nickname, serverHost: HOST, tokenVersion: 0 });
    const scene = context();
    await registerAdminHandlers(scene.ctx)["server:invites:create"]({ accessToken: token });
    const invite = scene.emitted.find((e) => e.event === "server:invite:created")?.payload.invite as { passwordBypass: boolean };
    assert.equal(invite.passwordBypass, true);
  });

  it("keeps a non-admin's ordinary legacy invitation within its original scope", async () => {
    const scene = context();
    await registerAdminHandlers(scene.ctx)["server:invites:create"]({ accessToken: ordinaryManagerToken });
    const invite = scene.emitted.find((e) => e.event === "server:invite:created")?.payload.invite as { code: string; passwordBypass: boolean };
    assert.equal(invite.passwordBypass, false);
    assert.equal((await getServerInvite(invite.code))?.password_bypass, false);
  });

  it("rejects short custom codes and role grants on a password-free invite", async () => {
    for (const payload of [{ customCode: "abc" }, { grantsRole: "admin" }, { maxUses: NaN }, { expiresInHours: Infinity }]) {
      const scene = context();
      await registerAdminHandlers(scene.ctx)["server:invites:create"]({ accessToken: ownerToken, ...payload });
      assert.ok(failure(scene));
      assert.equal(scene.emitted.some((e) => e.event === "server:invite:created"), false);
    }
  });

  it("hides and refuses revocation by an ordinary invite manager, then permits owner revocation", async () => {
    const invite = await createServerInvite(null, { passwordBypass: true });
    const manager = context();
    const handlers = registerAdminHandlers(manager.ctx);
    await handlers["server:invites:list"]({ accessToken: ordinaryManagerToken });
    const listed = manager.emitted.find((e) => e.event === "server:invites")?.payload.invites as { code: string }[];
    assert.equal(listed.some((row) => row.code === invite.code), false);
    await handlers["server:invites:revoke"]({ accessToken: ordinaryManagerToken, code: invite.code });
    assert.equal(failure(manager), "forbidden");
    assert.equal((await getServerInvite(invite.code))?.revoked, false);
    const owner = context();
    await registerAdminHandlers(owner.ctx)["server:invites:revoke"]({ accessToken: ownerToken, code: invite.code });
    assert.equal((await getServerInvite(invite.code))?.revoked, true);
  });
});

describe("signed socket invitation admission", () => {
  it("joins without a password, persists an ordinary member, and returns membership credentials", async () => {
    const person = await identity();
    const invite = await createServerInvite(null, { passwordBypass: true, maxUses: 2 });
    // Even a dangerous configured tier default cannot widen this invitation.
    await updateServerConfig({ defaultRoleLocal: "admin" });
    const scene = await joinIdentity(person, invite.code.toUpperCase());
    await updateServerConfig({ defaultRoleLocal: "member" });
    assert.equal(failure(scene), undefined);
    const joined = scene.emitted.find((e) => e.event === "server:joined")?.payload;
    assert.ok(joined?.accessToken && joined.refreshToken);
    assert.equal(joined.isOwner, false);
    const user = await getUserByGrytId(person.grytUserId);
    assert.ok(user?.is_active);
    assert.equal(user.joined_with_invite_code, invite.code);
    assert.deepEqual(await listMemberRoles(user.server_user_id), ["member"]);
    assert.equal((await getServerInvite(invite.code))?.uses_consumed, 1);
  });

  it("reconnects a saved active identity after revocation with no password or extra consumption", async () => {
    const person = await identity();
    const invite = await createServerInvite(null, { passwordBypass: true });
    assert.equal(failure(await joinIdentity(person, invite.code)), undefined);
    await revokeServerInvite(invite.code);
    assert.equal(failure(await joinIdentity(person)), undefined);
    assert.equal(failure(await joinIdentity(person, invite.code)), undefined);
    assert.equal((await getServerInvite(invite.code))?.uses_consumed, 1);
  });

  it("refuses invalid/revoked/expired/exhausted codes even when a correct password accompanies them", async () => {
    const revoked = await createServerInvite(null, { passwordBypass: true });
    await revokeServerInvite(revoked.code);
    const expired = await createServerInvite(null, { passwordBypass: true, expiresAt: new Date(Date.now() - 1000) });
    const exhausted = await createServerInvite(null, { passwordBypass: true });
    await admitUserWithInvite(exhausted.code, "exhaustion-test", "Exhaustion", true);
    for (const [code, error] of [["invalid-code", "invalid_invite"], [revoked.code, "invite_revoked"], [expired.code, "invite_expired"], [exhausted.code, "invite_exhausted"]]) {
      const person = await identity();
      assert.equal(failure(await joinIdentity(person, code, "test-community-password")), error);
      assert.equal(await getUserByGrytId(person.grytUserId), null);
    }
    assert.equal((await getServerInvite(revoked.code))?.uses_consumed, 0);
    assert.equal((await getServerInvite(expired.code))?.uses_consumed, 0);
  });

  it("does not upgrade a legacy link to a password bypass or spend it on refusal", async () => {
    const person = await identity();
    const invite = await createServerInvite(null);
    assert.equal(failure(await joinIdentity(person, invite.code)), "invite_password_required");
    assert.equal((await getServerInvite(invite.code))?.uses_consumed, 0);
    assert.equal(await getUserByGrytId(person.grytUserId), null);
  });

  it("leaves password admission available when no invite was supplied", async () => {
    const person = await identity();
    assert.equal(failure(await joinIdentity(person)), "password_required");
    assert.equal(failure(await joinIdentity(person, undefined, "test-community-password")), undefined);
    const user = await getUserByGrytId(person.grytUserId);
    assert.ok(user?.is_active);
    assert.deepEqual(await listMemberRoles(user.server_user_id), ["member"]);
  });

  it("does not consume an invite when the signed identity assertion is invalid", async () => {
    const person = await identity();
    const invite = await createServerInvite(null, { passwordBypass: true });
    assert.equal(failure(await joinIdentity(person, invite.code, undefined, true)), "identity_verification_failed");
    assert.equal((await getServerInvite(invite.code))?.uses_consumed, 0);
    assert.equal(await getUserByGrytId(person.grytUserId), null);
  });

  it("does not consume or admit a banned identity presenting a valid invitation", async () => {
    const person = await identity();
    const invite = await createServerInvite(null, { passwordBypass: true });
    const owner = await getUserByGrytId("test-owner");
    assert.ok(owner);
    await banUser(person.grytUserId, owner.server_user_id, "test refusal");
    assert.equal(failure(await joinIdentity(person, invite.code)), "join_refused");
    assert.equal((await getServerInvite(invite.code))?.uses_consumed, 0);
    assert.equal(await getUserByGrytId(person.grytUserId), null);
  });

  it("admits only one of two concurrent signed identities for the final use", async () => {
    const people = await Promise.all([identity(), identity()]);
    const invite = await createServerInvite(null, { passwordBypass: true });
    const scenes = await Promise.all(people.map((person) => joinIdentity(person, invite.code)));
    assert.equal(scenes.filter((scene) => scene.emitted.some((e) => e.event === "server:joined")).length, 1);
    assert.deepEqual(scenes.map(failure).filter(Boolean), ["invite_exhausted"]);
    assert.equal((await getServerInvite(invite.code))?.uses_consumed, 1);
  });
});

describe("atomic invitation membership writes", () => {
  it("spends one use for simultaneous admissions of the same identity", async () => {
    const invite = await createServerInvite(null, { passwordBypass: true });
    const admissions = await Promise.all([admitUserWithInvite(invite.code, "same-user", "Same", true), admitUserWithInvite(invite.code, "same-user", "Same", true)]);
    assert.equal(admissions.every((a) => a.ok), true);
    assert.equal(admissions.filter((a) => a.ok && a.consumed).length, 1);
    assert.equal((await getServerInvite(invite.code))?.uses_consumed, 1);
  });

  it("rolls back a consumed use and user row when role persistence fails", async () => {
    const invite = await createServerInvite(null, { passwordBypass: true });
    const db = getSqliteDb();
    db.exec("CREATE TRIGGER fail_invite_role BEFORE INSERT ON roles WHEN NEW.role = 'member' BEGIN SELECT RAISE(ABORT, 'injected role failure'); END");
    try {
      await assert.rejects(admitUserWithInvite(invite.code, "failed-user", "Failed", true), /injected role failure/);
    } finally { db.exec("DROP TRIGGER fail_invite_role"); }
    assert.equal(await getUserByGrytId("failed-user"), null);
    assert.equal((await getServerInvite(invite.code))?.uses_consumed, 0);
    assert.equal((await getServerInvite(invite.code))?.uses_remaining, 1);
    assert.equal((await admitUserWithInvite(invite.code, "failed-user", "Recovered", true)).ok, true);
  });

  it("requires a fresh admission for inactive members and grants only ordinary membership", async () => {
    const user = await upsertUser("inactive-user", "Inactive");
    await setServerRole(user.server_user_id, "admin");
    await setUserInactive(user.server_user_id);
    const invite = await createServerInvite(null, { passwordBypass: true });
    const result = await admitUserWithInvite(invite.code, user.gryt_user_id, "Inactive", true);
    assert.ok(result.ok && result.consumed);
    assert.deepEqual(await listMemberRoles(user.server_user_id), ["member"]);
    assert.equal((await getUserByGrytId(user.gryt_user_id))?.joined_with_invite_code, invite.code);
  });

  it("counts unlimited invitations while honoring revocation", async () => {
    const invite = await createServerInvite(null, { passwordBypass: true, infinite: true });
    const results = await Promise.all([admitUserWithInvite(invite.code, "infinite-1", "One", true), admitUserWithInvite(invite.code, "infinite-2", "Two", true)]);
    assert.equal(results.every((r) => r.ok), true);
    assert.equal((await getServerInvite(invite.code))?.uses_consumed, 2);
    await revokeServerInvite(invite.code);
    assert.deepEqual(await admitUserWithInvite(invite.code, "infinite-3", "Three", true), { ok: false, reason: "revoked" });
    assert.equal((await getServerInvite(invite.code))?.uses_consumed, 2);
  });
});

describe("persisted invitation admission", () => {
  it("restores membership after reopening SQLite without redeeming the invitation again", async () => {
    const person = await identity();
    const invite = await createServerInvite(null, { passwordBypass: true });
    assert.equal(failure(await joinIdentity(person, invite.code)), undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    getSqliteDb().close();
    await initSqlite();
    assert.equal(failure(await joinIdentity(person)), undefined);
    assert.equal((await getServerInvite(invite.code))?.uses_consumed, 1);
  });

  it("adds the bypass column with a false default when upgrading a legacy database", async () => {
    const invite = await createServerInvite(null, { maxUses: 2 });
    await new Promise<void>((resolve) => setImmediate(resolve));
    getSqliteDb().exec("ALTER TABLE invites DROP COLUMN password_bypass");
    getSqliteDb().close();
    await initSqlite();
    assert.equal((await getServerInvite(invite.code))?.password_bypass, false);
    const person = await identity();
    assert.equal(failure(await joinIdentity(person, invite.code)), "invite_password_required");
    assert.equal((await getServerInvite(invite.code))?.uses_consumed, 0);
  });
});
