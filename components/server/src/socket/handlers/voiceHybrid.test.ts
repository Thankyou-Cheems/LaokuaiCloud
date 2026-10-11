import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { initSqlite } from "../../db/sqlite/connection";
import { upsertServerChannel } from "../../db/sqlite/channels";
import { createServerConfigIfNotExists, setServerRole } from "../../db/sqlite/servers";
import { upsertUser } from "../../db/sqlite/users";
import { generateAccessToken } from "../../utils/jwt";
import { createPermissionScope, replacePermissionRules, setChannelPermissionScope } from "../../db/sqlite/channelScopes";
import { resetChannelPermissionCache } from "../../services/channelPermissions";
import { reconcileVoiceHybrid } from "../utils/voiceHybridLifecycle";
import type { Clients } from "../../types";
import type { HandlerContext } from "./types";
import type { SfuHybridCommand } from "../../sfu/hybridProtocol";
import { registerVoiceHybridHandlers } from "./voiceHybrid";

const HOST = "hybrid.synthetic.test:5002";
let seq = 0;
before(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "gryt-hybrid-pure-"));
  await initSqlite(); await createServerConfigIfNotExists();
  for (const id of ["source", "destination"]) await upsertServerChannel({ channelId: id, name: id, type: "voice", position: 10 });
});
async function fixture(enabled = true) {
  const clients: Clients = {}, sockets = new Map(), deliveries: { id: string; event: string; data: any }[] = [], commands: SfuHybridCommand[] = [];
  const io = { sockets: { sockets }, to() { return { emit() {} }; } };
  let supported = true, gateAck = true, duringGate: (() => void) | undefined;
  const sfu = { isConnected: () => true, async requestHybrid(command: SfuHybridCommand) {
    commands.push(command); if (command.phase === "probe") return { status: supported ? "supported" : "failed" };
    duringGate?.(); return { status: gateAck ? "applied" : "failed", snapshot: { remaining_ms: command.enabled ? 0 : command.pause_ms, forwarded_packets: 0, held_packets: 0 } };
  } };
  async function member(channel = "source") {
    const sid = `socket-${++seq}`, gryt = `synthetic-${randomUUID()}`, user = await upsertUser(gryt, sid);
    await setServerRole(user.server_user_id, "member");
    const token = generateAccessToken({ grytUserId: gryt, serverUserId: user.server_user_id, nickname: sid, serverHost: HOST, tokenVersion: 0 });
    const callbacks = new Map<string, () => void>();
    const socket = { id: sid, connected: true, handshake: { headers: { host: HOST } }, once(event: string, callback: () => void) { callbacks.set(event, callback); },
      emit(event: string, data: any) { deliveries.push({ id: sid, event, data }); } };
    const ci = clients[sid] = { serverUserId: user.server_user_id, grytUserId: gryt, accessToken: token, nickname: sid,
      hasJoinedChannel: true, voiceChannelId: channel, streamID: `actual-publication-${randomUUID()}`, isConnectedToVoice: true,
      isMuted: false, isDeafened: false, isServerMuted: false, isServerDeafened: false } as Clients[string];
    sockets.set(sid, socket);
    const handlers = registerVoiceHybridHandlers({ io, socket, clientsInfo: clients, clientId: sid, serverId: "synthetic-server", sfuClient: sfu } as unknown as HandlerContext, { enabled });
    return { sid, ci, socket, async call(event: string, data: object = {}, accessToken: unknown = ci.accessToken): Promise<any> {
      let result: unknown; await handlers[event]({ ...data, accessToken }, (value: unknown) => { result = value; }); return result;
    }, dispose() { socket.connected = false; callbacks.get("disconnect")?.(); } };
  }
  const a = await member(), b = await member();
  const scope = async () => { const sa = await a.call("voice:hybrid:scope"), sb = await b.call("voice:hybrid:scope"); return { sa, sb }; };
  const lease = async () => { const { sa, sb } = await scope();
    const la = await a.call("voice:hybrid:lease", { scope: sa.scope, participant: sa.participants.find((p: any) => p.sessionId === b.sid) });
    const lb = await b.call("voice:hybrid:lease", { scope: sb.scope, participant: sb.participants.find((p: any) => p.sessionId === a.sid) });
    return { sa, sb, la, lb }; };
  const request = (bound: any, generation = 1, operation = 1, enabled = false, id: string | null = bound.lb.lease.connectionId) => ({ scope: bound.sb.scope,
    pairConnectionId: id, sourceParticipantId: a.ci.serverUserId, sourceSessionId: a.sid, sourcePublicationId: a.ci.streamID, destinationSessionId: b.sid,
    routeGeneration: generation, operationId: `${generation}:${operation}`, enabled, pauseLeaseMs: enabled ? 0 : 10000 });
  return { a, b, io, clients, commands, deliveries, member, scope, lease, request, supported(value: boolean) { supported = value; }, gateAck(value: boolean) { gateAck = value; },
    duringGate(fn: () => void) { duringGate = fn; }, dispose() { a.dispose(); b.dispose(); } };
}
describe("Hybrid handler: real local JWT/database, no socket or media listener", () => {
  it("restores an authorized receiver after its publish permission is revoked without admitting new peer media", async () => {
    const f=await fixture();try {
      const bound=await f.lease();assert.equal((await f.b.call("voice:hybrid:forwarding",{request:f.request(bound)})).status,"applied");
      f.b.ci.isServerMuted=true;
      const snapshot=await f.b.call("voice:hybrid:scope");assert.equal(snapshot.scope.canPublish,false);assert.equal(snapshot.scope.canReceive,true);
      const restore={...f.request(bound,2,2,true),scope:snapshot.scope};
      assert.equal((await f.b.call("voice:hybrid:forwarding",{request:restore})).status,"applied");
      assert.equal((await f.b.call("voice:hybrid:forwarding",{request:{...restore,enabled:false,pauseLeaseMs:10000,operationId:"3:3",routeGeneration:3}})).error,"hybrid_scope_stale");
      f.b.ci.isServerDeafened=true;
      const deaf=await f.b.call("voice:hybrid:scope");assert.equal((await f.b.call("voice:hybrid:forwarding",{request:{...restore,scope:deaf.scope,operationId:"4:4",routeGeneration:4}})).error,"hybrid_scope_stale");
    } finally{f.dispose();}
  });
  it("keeps disabled/missing-SFU-capability paths unsupported", async () => {
    const disabled = await fixture(false); try { assert.equal((await disabled.a.call("voice:hybrid:scope")).error, "hybrid_disabled"); assert.equal(disabled.commands.length, 0); } finally { disabled.dispose(); }
    const f = await fixture(); try { f.supported(false); assert.equal((await f.a.call("voice:hybrid:scope")).error, "hybrid_unsupported"); } finally { f.dispose(); }
  });
  it("verifies actual signed token and identity instead of fixture metadata", async () => {
    const f = await fixture(); try {
      assert.equal((await f.a.call("voice:hybrid:scope", {}, "wrong")).error, "hybrid_unauthenticated");
      f.a.ci.accessToken = "invalid-token"; assert.equal((await f.a.call("voice:hybrid:scope")).error, "hybrid_unauthenticated");
    } finally { f.dispose(); }
  });
  it("mints one pair with opposite roles and binds the real publication/session", async () => {
    const f = await fixture(); try {
      const bound = await f.lease(); assert.equal(bound.la.status, "leased"); assert.equal(bound.lb.lease.connectionId, bound.la.lease.connectionId);
      assert.match(bound.la.lease.connectionId, /^[a-f0-9-]{36}$/); assert.notEqual(bound.la.lease.initiator, bound.lb.lease.initiator);
      assert.equal(bound.la.lease.remoteSessionId, f.b.sid); assert.equal(bound.sa.participants[0].publicationId, f.b.ci.streamID);
      const stale = { ...bound.sa.participants[0], publicationId: "original-track-stream-is-not-current-publication" };
      assert.equal((await f.a.call("voice:hybrid:lease", { scope: bound.sa.scope, participant: stale })).error, "hybrid_cross_room_or_generation");
    } finally { f.dispose(); }
  });
  it("rejects cross-room pairing and stale server/socket/room generations", async () => {
    const f = await fixture(); try {
      const { sa } = await f.scope(); f.b.ci.voiceChannelId = "destination";
      assert.equal((await f.a.call("voice:hybrid:lease", { scope: sa.scope, participant: sa.participants[0] })).error, "hybrid_cross_room_or_generation");
      for (const field of ["serverInstanceId", "roomGeneration", "localSessionId"]) assert.equal((await f.a.call("voice:hybrid:lease", { scope: { ...sa.scope, [field]: "old" }, participant: sa.participants[0] })).error, "hybrid_scope_stale");
    } finally { f.dispose(); }
  });
  it("serializes authorized signals, rejects role/replay, and forwards only canonical fields", async () => {
    const f = await fixture(); try {
      const bound = await f.lease(), initiator = bound.la.lease.initiator ? f.a : f.b, destination = initiator === f.a ? f.b : f.a;
      const signal = { serverInstanceId: bound.sa.scope.serverInstanceId, roomId: "source", roomGeneration: bound.sa.scope.roomGeneration,
        sourceSessionId: initiator.sid, destinationSessionId: destination.sid, connectionId: bound.la.lease.connectionId, sequence: 1, body: { kind: "offer", sdp: "synthetic-unit-description", extra: "discard" }, extra: "discard" };
      assert.equal((await initiator.call("voice:hybrid:signal", { signal })).status, "relayed");
      assert.equal((await initiator.call("voice:hybrid:signal", { signal })).error, "hybrid_signal_stale");
      const delivered = f.deliveries.find(r => r.event === "voice:hybrid:signal")!.data; assert.equal("extra" in delivered, false); assert.equal("extra" in delivered.body, false);
      assert.equal((await initiator.call("voice:hybrid:signal", { signal: { ...signal, sequence: 2, body: { kind: "answer", sdp: "fake" } } })).error, "hybrid_signal_role");
    } finally { f.dispose(); }
  });
  it("does not acknowledge forwarding without the SFU ACK; replays and stale cleanup cannot clear a new pair", async () => {
    const f = await fixture(); try {
      const bound = await f.lease(); f.gateAck(false); assert.equal((await f.b.call("voice:hybrid:forwarding", { request: f.request(bound) })).error, "hybrid_sfu_ack_failed");
      f.gateAck(true); assert.equal((await f.b.call("voice:hybrid:forwarding", { request: f.request(bound) })).ack.applied, true);
      assert.equal((await f.b.call("voice:hybrid:forwarding", { request: f.request(bound) })).error, "hybrid_operation_stale");
      assert.equal((await f.b.call("voice:hybrid:release", { lease: bound.lb.lease })).status, "released");
      const next = await f.lease(); assert.notEqual(next.lb.lease.connectionId, bound.lb.lease.connectionId);
      assert.equal((await f.b.call("voice:hybrid:forwarding", { request: f.request(next) })).status, "applied");
      assert.equal((await f.b.call("voice:hybrid:forwarding", { request: f.request(bound, 9, 99, true) })).error, "hybrid_cleanup_conflict");
      assert.equal((await f.b.call("voice:hybrid:forwarding", { request: f.request(bound, 10, 100, true, null) })).error, "hybrid_cleanup_conflict");
    } finally { f.dispose(); }
  });
  it("rejects a publication replacement while the mock SFU ACK travels", async () => {
    const f = await fixture(); try { const bound = await f.lease(); f.duringGate(() => { f.a.ci.streamID = "replacement-publication"; });
      assert.equal((await f.b.call("voice:hybrid:forwarding", { request: f.request(bound) })).error, "hybrid_scope_stale");
    } finally { f.dispose(); }
  });
  it("invalidates connected peers on authoritative mute/membership and real database permission changes", async () => {
    const f = await fixture(); let permissionScope: string | undefined;
    try {
      const bound = await f.lease(); f.a.ci.isServerMuted = true; reconcileVoiceHybrid(f.io as unknown as HandlerContext["io"]);
      assert.equal(f.deliveries.filter(r => r.event === "voice:hybrid:pair-invalidated").length, 2);
      f.a.ci.isServerMuted = false; const next = await f.lease();
      permissionScope = await createPermissionScope({}); await setChannelPermissionScope("source", permissionScope);
      await replacePermissionRules(permissionScope, [{ roleId: "member", permission: "speak", effect: "deny" }]); resetChannelPermissionCache();
      const signal = { serverInstanceId: bound.sa.scope.serverInstanceId, roomId: "source", roomGeneration: bound.sa.scope.roomGeneration,
        sourceSessionId: f.a.sid, destinationSessionId: f.b.sid, connectionId: next.la.lease.connectionId, sequence: 1, body: { kind: "candidate", candidate: null } };
      assert.equal((await f.a.call("voice:hybrid:signal", { signal })).error, "hybrid_pair_stale");
    } finally { if (permissionScope) { await setChannelPermissionScope("source", null); resetChannelPermissionCache(); } f.dispose(); }
  });
});
