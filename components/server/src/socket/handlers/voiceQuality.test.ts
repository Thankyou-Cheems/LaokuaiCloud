import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Clients } from "../../types";
import type { HandlerContext } from "./types";
import type { AuthResult } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { initSqlite, getSqliteDb } from "../../db/sqlite/connection";
import { createServerConfigIfNotExists, getServerConfig } from "../../db/sqlite/servers";
import { upsertUser } from "../../db/sqlite/users";
import { generateAccessToken } from "../../utils/jwt";
import { registerVoiceQualityHandlers, type VoiceQualityHandlerOptions } from "./voiceQuality";

const report = (seq = 1, connectionGeneration = 1) => ({
  schemaVersion: 1 as const, connectionGeneration, seq,
  iceRttMs: 123, uplink: null, receive: null,
});

test("a slow authentication backend gets one in-flight summary rather than a growing queue", async () => {
  const resolvers: ((auth: AuthResult) => void)[] = [];
  const f = fixture(async () => new Promise<AuthResult>((resolve) => resolvers.push(resolve)));
  const first = f.send();
  f.advance(2000);
  const second = f.send(report(2));
  const calls = resolvers.length;
  for (const resolveAuth of resolvers) resolveAuth(f.auth);
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(f.emitted.get("same-room")!.length, 1);
  f.registration.dispose();
});

test("an authentication backend failure leaves the old report unknown without rejecting the event", async () => {
  let fail = false;
  const f = fixture(async () => {
    if (fail) throw new Error("isolated authentication backend unavailable");
    return f.auth;
  });
  await f.send();
  f.advance(2000);
  fail = true;
  await assert.doesNotReject(() => f.send(report(2)));
  assert.equal((f.emitted.get("same-room")!.at(-1) as { report: unknown }).report, null);
  f.registration.dispose();
});

test("real authentication binds the signed token to the current joined socket and revokes stale membership", async () => {
  const directory = mkdtempSync(join(tmpdir(), "gryt-quality-auth-"));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = directory;
  const f = fixture(requireAuth);
  try {
    await initSqlite();
    await createServerConfigIfNotExists();
    const config = await getServerConfig();
    const user = await upsertUser("account-sender", "Fixture sender");
    f.ctx.clientsInfo.sender.serverUserId = user.server_user_id;
    const token = generateAccessToken({
      serverUserId: user.server_user_id, grytUserId: "account-sender",
      serverHost: "fixture.test", nickname: "Fixture sender",
      tokenVersion: config!.token_version ?? 0, userTokenVersion: user.token_version ?? 0,
    });
    f.ctx.clientsInfo.sender.accessToken = token;
    const send = async (accessToken: string, seq: number) => {
      await f.registration.handlers["voice:quality:report"]({ accessToken, report: report(seq) });
    };
    await send("invalid-fixture-token", 1);
    assert.deepEqual(f.emitted.get("same-room"), []);
    f.advance(2000);
    await send(token, 1);
    assert.equal(f.emitted.get("same-room")!.length, 1);
    // Membership revocation is in the real SQLite session gate, not a fake auth response.
    getSqliteDb().prepare("UPDATE users SET is_active = 0 WHERE server_user_id = ?").run(user.server_user_id);
    f.advance(2000);
    await send(token, 2);
    assert.equal((f.emitted.get("same-room")!.at(-1) as { report: unknown }).report, null);
    assert.equal(f.emitted.get("same-room")!.length, 2);
  } finally {
    f.registration.dispose();
    getSqliteDb().close();
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("gryt-quality-auth-"));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("leave, room change, disconnect and disposal each invalidate the old audience once", async () => {
  for (const action of ["leave", "move", "disconnect", "dispose"] as const) {
    const f = fixture();
    await f.send();
    if (action === "leave") f.ctx.clientsInfo.sender.hasJoinedChannel = false;
    if (action === "move") {
      f.ctx.clientsInfo.sender.voiceChannelId = "beta";
      f.ctx.socket.rooms.delete("voice:server:alpha");
      f.ctx.socket.rooms.add("voice:server:beta");
    }
    if (action === "disconnect") f.callbacks.get("disconnect")!();
    else if (action === "dispose") f.registration.dispose();
    else f.registration.clear();
    assert.equal((f.emitted.get("same-room")!.at(-1) as { report: unknown }).report, null);
    assert.deepEqual(f.emitted.get("other-room"), []);
    f.advance(10_000);
    assert.equal(f.emitted.get("same-room")!.length, 2);
    f.registration.dispose();
  }
});

test("invalid envelopes and no actual SFU/socket room never authenticate or broadcast", async () => {
  let authenticated = false;
  const f = fixture(async () => { authenticated = true; return f.auth; });
  for (const payload of [
    { accessToken: "fixture-token", report: report(), roomId: "beta" },
    { accessToken: "x".repeat(8193), report: report() },
    { report: report() },
    { accessToken: "fixture-token", report: { ...report(), codec: "x".repeat(10000) } },
  ]) {
    await f.registration.handlers["voice:quality:report"](payload);
    f.advance(2000);
  }
  f.ctx.socket.rooms.delete("voice:server:alpha");
  await f.send();
  assert.equal(authenticated, false);
  assert.deepEqual(f.emitted.get("same-room"), []);
  f.registration.dispose();
});

test("a pending old-room report cannot arrive in the new room", async () => {
  let resolveAuth!: (value: AuthResult) => void;
  const f = fixture(async () => new Promise<AuthResult>((resolve) => { resolveAuth = resolve; }));
  const pending = f.send();
  f.ctx.clientsInfo.sender.voiceChannelId = "beta";
  resolveAuth(f.auth);
  await pending;
  assert.deepEqual(f.emitted.get("same-room"), []);
  assert.deepEqual(f.emitted.get("other-room"), []);
  f.registration.dispose();
});

test("membership loss or failed reauthentication clears the prior room's snapshot", async () => {
  for (const revoke of ["membership", "auth"] as const) {
    const f = fixture();
    await f.send();
    f.advance(2000);
    if (revoke === "membership") f.ctx.clientsInfo.sender.hasJoinedChannel = false;
    else f.auth.tokenPayload.serverUserId = "different-member";
    await f.send(report(2));
    assert.deepEqual(f.emitted.get("same-room")!.at(-1), {
      schemaVersion: 1, clientId: "sender", report: null, receivedAt: 12_000, expiresAt: 12_000,
    });
    f.registration.dispose();
  }
});

test("reports are limited across generations and stale seq cannot extend summary expiry", async () => {
  const f = fixture();
  await f.send(report(10));
  await f.send(report(1, 2));
  assert.equal(f.emitted.get("same-room")!.length, 1);
  f.advance(2000);
  await f.send(report(11));
  f.advance(2000);
  await f.send(report(11));
  assert.equal(f.emitted.get("same-room")!.length, 2);
  f.advance(2000);
  await f.send(report(1, 2));
  f.advance(2000);
  await f.send(report(12, 1));
  assert.equal(f.emitted.get("same-room")!.length, 3);
  f.advance(6000);
  assert.deepEqual(f.emitted.get("same-room")!.at(-1), {
    schemaVersion: 1, clientId: "sender", report: null, receivedAt: 24_000, expiresAt: 24_000,
  });
  await f.send(report(1, 2));
  assert.equal(f.emitted.get("same-room")!.length, 4);
  f.registration.dispose();
});

function fixture(authenticate?: VoiceQualityHandlerOptions["authenticate"]) {
  let now = 10_000;
  let nextTimer = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const emitted = new Map<string, unknown[]>();
  const callbacks = new Map<string, () => void>();
  const clientsInfo: Clients = {};
  const sockets = new Map<string, HandlerContext["socket"]>();
  for (const [id, channel] of [["sender", "alpha"], ["same-room", "alpha"], ["other-room", "beta"]]) {
    clientsInfo[id] = {
      serverUserId: `secret-${id}`, grytUserId: `account-${id}`, accessToken: "fixture-token",
      nickname: id, color: "blue", isMuted: false, isDeafened: false,
      streamID: id, hasJoinedChannel: true, voiceChannelId: channel, isAFK: false,
      cameraEnabled: false, cameraStreamID: "", screenShareEnabled: false,
      screenShareVideoStreamID: "", screenShareAudioStreamID: "",
      isServerMuted: false, isServerDeafened: false,
    };
    emitted.set(id, []);
    sockets.set(id, {
      id, connected: true, rooms: new Set([id, `voice:server:${channel}`]),
      handshake: { headers: { host: "fixture.test" } },
      emit(event: string, payload: unknown) { if (event === "voice:quality:update") emitted.get(id)!.push(payload); },
      on(event: string, cb: () => void) { if (id === "sender") callbacks.set(event, cb); },
      off(event: string) { if (id === "sender") callbacks.delete(event); },
    } as unknown as HandlerContext["socket"]);
  }
  const ctx = {
    io: { sockets: { sockets } }, socket: sockets.get("sender"),
    clientId: "sender", serverId: "server", clientsInfo,
    sfuClient: { isConnected: () => true, getTrackedUser: () => ({ roomId: "server_alpha" }) },
    getClientIp: () => "unused", clientAddressIsOwn: () => false,
  } as unknown as HandlerContext;
  const auth = {
    tokenPayload: { serverUserId: "secret-sender", grytUserId: "account-sender", serverHost: "fixture.test" },
  } as AuthResult;
  const registration = registerVoiceQualityHandlers(ctx, {
    now: () => now,
    schedule: (run, delay) => {
      const id = ++nextTimer;
      timers.set(id, { at: now + delay, run });
      return () => { timers.delete(id); };
    },
    authenticate: authenticate ?? (async () => auth),
  });
  return {
    ctx, auth, emitted, callbacks, registration,
    async send(value: unknown = report()) {
      await registration.handlers["voice:quality:report"]({ accessToken: "fixture-token", report: value });
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.run(); }
    },
  };
}

test("a verified joined member shares only the allowlisted report in the actual voice room", async () => {
  const f = fixture();
  await f.send();
  assert.deepEqual(f.emitted.get("same-room"), [{
    schemaVersion: 1, clientId: "sender", report: report(), receivedAt: 10_000, expiresAt: 18_000,
  }]);
  assert.deepEqual(f.emitted.get("other-room"), []);
  assert.equal(JSON.stringify(f.emitted.get("same-room")).includes("secret-sender"), false);
  f.registration.dispose();
});

test("clear and dispose invalidate authentication still pending for the same joined room", async () => {
  for (const action of ["clear", "dispose"] as const) {
    let resolveAuth!: (value: AuthResult) => void;
    const f = fixture(async () => new Promise<AuthResult>((resolve) => { resolveAuth = resolve; }));
    const pending = f.send();
    f.registration[action]();
    resolveAuth(f.auth);
    await pending;
    assert.deepEqual(f.emitted.get("same-room"), []);
    f.registration.dispose();
  }
});
