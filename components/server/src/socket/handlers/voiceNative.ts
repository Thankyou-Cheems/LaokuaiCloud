import { randomBytes, randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import type { Clients } from "../../types";
import { getServerChannel, insertServerAudit } from "../../db";
import { mayInChannel } from "../../services/channelPermissions";
import { getVoiceSeatLimit } from "../../utils/voiceSeats";
import { privateIpv4 } from "../../easytier/communityGrant";
import { parseCommunityGrantRequest, type CommunityBindingRequestV1, type CommunityBindingProofV1 } from "../../easytier/communityGrantApi";
import { requireAuth, requireOutranks } from "../middleware/auth";
import type { HandlerContext, EventHandlerMap } from "./types";
import { voiceRoomName } from "../utils/voiceRooms";
import { syncAllClients, broadcastMemberList } from "../utils/clients";
import { nativeLanVoiceEnabled, setNativeVoiceLifecycle } from "../utils/nativeVoiceLifecycle";
import { checkRateLimit } from "../../utils/rateLimiter";

export const NATIVE_VOICE_LEASE_MS = 15_000;
type Ci = Clients[string];
interface Policy { speak: boolean; requirePTT: boolean }
interface Member { socket: Socket; ci: Ci; userId: string; grytId?: string; channelId: string;
  binding: CommunityBindingRequestV1; virtualIp: string; credentialId: string; fingerprint: string; expiresAtMs: number; policy: Policy }
interface Room { epoch: string; key: string; revision: number; signature: string; controls: string }
export interface NativeVoiceSnapshot { v: 1; serverId: string; channelId: string; revision: number; epoch: string;
  localIp: string; key: string; peers: { userId: string; virtualIp: string; canPublish: boolean; canReceive: boolean }[];
  canPublish: boolean; canReceive: boolean; requirePTT: boolean; serverTimeMs: number; expiresAtMs: number }
interface Dependencies {
  enabled(): boolean; now(): number; seatLimit(): number | null;
  authenticate(socket: Socket, ci: Ci, token: string): Promise<boolean>;
  policy(ci: Ci, channelId: string): Promise<Policy | null>;
  binding(bearer: string, body: CommunityBindingRequestV1): Promise<CommunityBindingProofV1>;
  moveAllowed(actor: Socket, actorCi: Ci, target: Member, destination: string, token: string): Promise<boolean>;
  broadcast(): void;
}
interface Hub { members: Map<string, Member>; rooms: Map<string, Room>; queue: Promise<unknown>;
  moves: Map<string, { actor: Socket; identity: string; targetUserId: string; expiresAtMs: number; result: Record<string, unknown> }>;
  revisions: Map<string, number>; snapshotRevision: number; reconcilePending: boolean; deps: Dependencies; serverId: string; clients: Clients; io: Server }
const hubs = new WeakMap<Server, Hub>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128;
const current = (hub: Hub, member: Member) => member.socket.connected !== false &&
  hub.io.sockets.sockets.get(member.socket.id) === member.socket && hub.clients[member.socket.id] === member.ci &&
  member.ci.serverUserId === member.userId && member.ci.grytUserId === member.grytId;
const canReceive = (m: Member) => !m.ci.isDeafened && !m.ci.isServerDeafened;
const canPublish = (m: Member) => m.policy.speak && !m.ci.isMuted && !m.ci.isServerMuted && canReceive(m);
const identity = (ci: Ci) => JSON.stringify([ci.serverUserId, ci.grytUserId, ci.accessToken]);

function publish(hub: Hub, channelId: string): void {
  const all = [...hub.members.values()].filter(m => m.channelId === channelId && current(hub, m) &&
    m.ci.hasJoinedChannel && m.ci.voiceChannelId === channelId && m.expiresAtMs > hub.deps.now());
  const media = all.filter(m => !m.ci.isServerDeafened);
  // Membership and device authority change the key. Mute/deafen/PTT controls
  // update in place, keeping each native audio engine running in the same epoch.
  const signature = JSON.stringify(media.map(m => [m.socket.id, m.userId, m.virtualIp, m.credentialId, m.fingerprint])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  const controls = JSON.stringify(media.map(m => [m.socket.id, canPublish(m), canReceive(m), m.policy.requirePTT])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  let room = hub.rooms.get(channelId);
  if (!room || room.signature !== signature) {
    room = { epoch: randomUUID(), key: randomBytes(32).toString("hex"), revision: ++hub.snapshotRevision, signature, controls };
    hub.rooms.set(channelId, room);
  } else if (room.controls !== controls) {
    room.controls = controls; room.revision = ++hub.snapshotRevision;
  }
  const now = hub.deps.now();
  for (const member of all) {
    if (member.ci.isServerDeafened) {
      member.ci.isConnectedToVoice = false;
      member.socket.emit("voice:native:stopped", { v: 1, reason: "server_deafened" });
      continue;
    }
    const snapshot: NativeVoiceSnapshot = { v: 1, serverId: hub.serverId, channelId, revision: room.revision,
      epoch: room.epoch, localIp: member.virtualIp, key: room.key,
      peers: media.filter(m => m !== member).map(m => ({ userId: m.userId, virtualIp: m.virtualIp,
        canPublish: canPublish(m), canReceive: canReceive(m) })),
      canPublish: canPublish(member), canReceive: canReceive(member), requirePTT: member.policy.requirePTT,
      serverTimeMs: now, expiresAtMs: member.expiresAtMs };
    // Keys and device addresses go only to this authenticated socket.
    member.socket.emit("voice:native:snapshot", snapshot);
  }
  if (all.length === 0) hub.rooms.delete(channelId);
}
function remove(hub: Hub, sid: string, reason: string): boolean {
  hub.revisions.set(sid, (hub.revisions.get(sid) ?? 0) + 1);
  const member = hub.members.get(sid);
  if (!member) return false;
  hub.members.delete(sid);
  const { socket, ci, channelId } = member;
  socket.leave(voiceRoomName(hub.serverId, channelId));
  socket.to(voiceRoomName(hub.serverId, channelId)).emit("voice:peer:left", { clientId: sid, nickname: ci.nickname, channelId });
  if (hub.clients[sid] === ci && ci.voiceChannelId === channelId) {
    ci.hasJoinedChannel = false; ci.voiceChannelId = ""; ci.streamID = ""; ci.isConnectedToVoice = false;
    ci.cameraEnabled = false; ci.cameraStreamID = ""; ci.screenShareEnabled = false;
    ci.screenShareVideoStreamID = ""; ci.screenShareAudioStreamID = "";
  }
  socket.emit("voice:native:stopped", { v: 1, reason });
  socket.emit("voice:channel:joined", false); socket.emit("voice:stream:set", ""); socket.emit("voice:room:leave");
  publish(hub, channelId); hub.deps.broadcast(); return true;
}
function serialized<T>(hub: Hub, action: () => Promise<T>): Promise<T> {
  const next = hub.queue.then(action, action); hub.queue = next.catch(() => {}); return next;
}
function reconcile(hub: Hub): void {
  // Known socket removals and moderation flags take effect synchronously,
  // before queued database/issuer work can block the control plane.
  for (const member of [...hub.members.values()]) {
    if (!current(hub, member) || !member.ci.hasJoinedChannel || member.ci.voiceChannelId !== member.channelId ||
      member.expiresAtMs <= hub.deps.now() || !hub.deps.enabled()) remove(hub, member.socket.id, "authorization_expired");
  }
  for (const channelId of new Set([...hub.members.values()].map(m => m.channelId))) publish(hub, channelId);
  if (hub.reconcilePending) return;
  hub.reconcilePending = true;
  void serialized(hub, async () => {
    const changed = new Set<string>();
    try {
      for (const member of [...hub.members.values()]) {
        if (!current(hub, member) || !member.ci.hasJoinedChannel || member.ci.voiceChannelId !== member.channelId ||
          member.expiresAtMs <= hub.deps.now() || !hub.deps.enabled()) { remove(hub, member.socket.id, "authorization_expired"); continue; }
        const allowed = await hub.deps.authenticate(member.socket, member.ci, member.ci.accessToken ?? "");
        const policy = allowed ? await hub.deps.policy(member.ci, member.channelId) : null;
        if (hub.members.get(member.socket.id) !== member) continue;
        if (!allowed || !policy || !current(hub, member)) { remove(hub, member.socket.id, "authorization_revoked"); continue; }
        member.policy = policy; changed.add(member.channelId);
      }
      for (const channelId of changed) publish(hub, channelId);
    } catch {
      // Fail closed if permission/auth services cannot be read; never substitute
      // a directory address or keep publishing under an unverifiable policy.
      for (const sid of [...hub.members.keys()]) remove(hub, sid, "authorization_unavailable");
    } finally { hub.reconcilePending = false; }
  });
}

export function registerNativeVoiceHandlers(ctx: HandlerContext, overrides: Partial<Dependencies> = {}): EventHandlerMap {
  const { io, socket, clientsInfo, serverId } = ctx;
  if (!(overrides.enabled ?? nativeLanVoiceEnabled)()) return {};
  let hub = hubs.get(io);
  if (!hub) {
    const deps: Dependencies = {
      enabled: nativeLanVoiceEnabled, now: Date.now, seatLimit: getVoiceSeatLimit,
      authenticate: async (s, ci, token) => {
        const auth = await requireAuth(s, { accessToken: token });
        return !!auth && clientsInfo[s.id] === ci && s.connected !== false && !!ci.accessToken &&
          token === ci.accessToken && ci.serverUserId === auth.tokenPayload.serverUserId && ci.grytUserId === auth.tokenPayload.grytUserId;
      },
      policy: async (ci, channelId) => {
        const channel = await getServerChannel(channelId);
        if (channel?.type !== "voice" || !await mayInChannel(channelId, ci.serverUserId, "read_messages", ci.grytUserId) ||
          !await mayInChannel(channelId, ci.serverUserId, "join_voice", ci.grytUserId)) return null;
        return { speak: await mayInChannel(channelId, ci.serverUserId, "speak", ci.grytUserId), requirePTT: channel.require_push_to_talk };
      },
      binding: (bearer, body) => {
        if (!ctx.communityGrantService) return Promise.reject(new Error("binding_unavailable"));
        return ctx.communityGrantService.binding(bearer, body);
      },
      moveAllowed: async (actor, actorCi, target, destination, token) => {
        const auth = await requireAuth(actor, { accessToken: token }, { permission: "disconnect_members" });
        return !!auth && auth.tokenPayload.serverUserId === actorCi.serverUserId &&
          auth.tokenPayload.grytUserId === actorCi.grytUserId && await requireOutranks(actor, auth, target.userId, "move") &&
          await mayInChannel(target.channelId, actorCi.serverUserId, "read_messages", actorCi.grytUserId) &&
          await mayInChannel(destination, actorCi.serverUserId, "read_messages", actorCi.grytUserId);
      },
      broadcast: () => { syncAllClients(io, clientsInfo); broadcastMemberList(io, clientsInfo, serverId); },
      ...overrides,
    };
    hub = { members: new Map(), rooms: new Map(), moves: new Map(), revisions: new Map(), queue: Promise.resolve(),
      snapshotRevision: 0, reconcilePending: false, deps, serverId, clients: clientsInfo, io };
    hubs.set(io, hub);
    setNativeVoiceLifecycle(io, { reconcile: () => reconcile(hub!), remove: (sid, reason) => remove(hub!, sid, reason) });
    const timer = setInterval(() => {
      for (const m of [...hub!.members.values()]) if (m.expiresAtMs <= hub!.deps.now()) remove(hub!, m.socket.id, "authorization_expired");
    }, 1000); timer.unref(); io.once("close", () => clearInterval(timer));
  }
  const state = hub;
  socket.once("disconnect", () => remove(state, socket.id, "socket_disconnected"));
  function wrap(action: (payload: Record<string, unknown>, revision: number) => Promise<object>, supersedes = false,
    move = false, leaseRefresh = false) {
    return async (raw: unknown, ack?: (reply: unknown) => void) => {
      let reply: object;
      const revision = supersedes ? (state.revisions.get(socket.id) ?? 0) + 1 : (state.revisions.get(socket.id) ?? 0);
      if (supersedes) state.revisions.set(socket.id, revision);
      try {
        if (!state.deps.enabled()) throw new Error("native_voice_disabled");
        if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
          (!move && (raw as Record<string, unknown>).v !== 1)) throw new Error("invalid_payload");
        const rl = checkRateLimit("voice:native", clientsInfo[socket.id]?.serverUserId ?? socket.id, ctx.getClientIp(),
          { limit: 60, windowMs: 60_000, scorePerAction: 0.1, maxScore: 10, scoreDecayMs: 1000 });
        if (!rl.allowed) throw new Error("rate_limited");
        reply = await serialized(state, () => action(raw as Record<string, unknown>, revision));
      } catch (error) {
        // Exception text from issuer/RPC/database is private and never emitted.
        const safe = ["native_voice_disabled", "invalid_payload", "rate_limited", "unauthenticated_connection", "binding_unavailable",
          "binding_mismatch", "forbidden", "server_full", "device_in_voice", "not_joined", "stale_request", "invalid_move", "target_not_current", "request_conflict"];
        const code = error instanceof Error && safe.includes(error.message) ? error.message : "native_voice_unavailable";
        const retryable = leaseRefresh && (code === "binding_unavailable" || code === "native_voice_unavailable") &&
          state.members.has(socket.id);
        const p = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
        const target = [...state.members.values()].find(m => m.userId === p.targetServerUserId);
        reply = { ok: false, error: code, ...(retryable ? { retryable: true } : {}), ...(move ? { status: "failed", requestId: p.requestId,
          generation: target?.socket.id ?? "", sourceChannelId: p.sourceChannelId, destinationChannelId: p.destinationChannelId } : {}) };
        if (!move && !retryable) socket.emit("voice:native:error", { v: 1, ...reply });
      }
      if (typeof ack === "function") ack({ v: 1, ...reply });
      if (move) socket.emit("voice:move:result", { v: 1, ...reply });
    };
  }
  async function authorized(payload: Record<string, unknown>, revision: number): Promise<{ ci: Ci; binding: CommunityBindingRequestV1;
    ip: string; credentialId: string; fingerprint: string; identity: string }> {
    const ci = clientsInfo[socket.id];
    const expectedIdentity = ci ? identity(ci) : "";
    const token = typeof payload.accessToken === "string" ? payload.accessToken : ci?.accessToken ?? "";
    if (!ci || !await state.deps.authenticate(socket, ci, token)) throw new Error("unauthenticated_connection");
    const body = parseCommunityGrantRequest("binding", payload.binding);
    let proof: CommunityBindingProofV1;
    try { proof = await state.deps.binding(token, body); } catch { throw new Error("binding_unavailable"); }
    if (state.revisions.get(socket.id) !== revision || clientsInfo[socket.id] !== ci || socket.connected === false ||
      io.sockets.sockets.get(socket.id) !== socket || identity(ci) !== expectedIdentity) throw new Error("stale_request");
    if (proof.serverUserId !== ci.serverUserId || proof.scope.accountId !== ci.grytUserId ||
      proof.scope.communityId !== body.communityId || proof.scope.deviceId !== body.deviceId ||
      proof.scope.nativeInstanceId !== body.nativeInstanceId || proof.grantId !== body.grantId || !privateIpv4(proof.virtualIp)) throw new Error("binding_mismatch");
    return { ci, binding: body, ip: proof.virtualIp, credentialId: proof.credentialId,
      fingerprint: proof.publicKeyFingerprint, identity: expectedIdentity };
  }
  return {
    "voice:native:join": wrap(async (payload, revision) => {
      if (!text(payload.channelId)) throw new Error("invalid_payload");
      const { ci, binding, ip, credentialId, fingerprint, identity: expectedIdentity } = await authorized(payload, revision);
      const policy = await state.deps.policy(ci, payload.channelId);
      if (!policy) throw new Error("forbidden");
      if (state.revisions.get(socket.id) !== revision || clientsInfo[socket.id] !== ci || socket.connected === false ||
        io.sockets.sockets.get(socket.id) !== socket || identity(ci) !== expectedIdentity) throw new Error("stale_request");
      // A user has one voice device at a time; never select a directory row by user.
      if ([...state.members.values()].some(m => m.userId === ci.serverUserId && m.socket !== socket)) throw new Error("device_in_voice");
      if ([...state.members.values()].some(m => m.virtualIp === ip && m.socket !== socket)) throw new Error("binding_mismatch");
      const limit = state.deps.seatLimit() ?? 12;
      if (!state.members.has(socket.id) && state.members.size >= Math.min(limit > 0 ? limit : 12, 12)) throw new Error("server_full");
      const old = state.members.get(socket.id);
      if (old && old.channelId !== payload.channelId) remove(state, socket.id, "channel_switched");
      const member: Member = { socket, ci, userId: ci.serverUserId, grytId: ci.grytUserId,
        channelId: payload.channelId, binding, virtualIp: ip, credentialId, fingerprint, policy, expiresAtMs: state.deps.now() + NATIVE_VOICE_LEASE_MS };
      state.members.set(socket.id, member);
      ci.hasJoinedChannel = true; ci.voiceChannelId = member.channelId; ci.streamID = `native:${ci.serverUserId}`;
      ci.isConnectedToVoice = false; ci.voiceMoveStagingSupported = true;
      socket.join(voiceRoomName(serverId, member.channelId));
      socket.emit("voice:channel:joined", true);
      if (!old || old.channelId !== member.channelId) socket.to(voiceRoomName(serverId, member.channelId)).emit("voice:peer:joined",
        { clientId: socket.id, nickname: ci.nickname, channelId: member.channelId });
      publish(state, member.channelId); state.deps.broadcast(); return { ok: true };
    }, true),
    "voice:native:heartbeat": wrap(async (payload, revision) => {
      const member = state.members.get(socket.id);
      if (!member || member.expiresAtMs <= state.deps.now()) throw new Error("not_joined");
      const { ci, binding, ip, credentialId, fingerprint, identity: expectedIdentity } = await authorized(payload, revision);
      if (state.members.get(socket.id) !== member || member.ci !== ci) throw new Error("stale_request");
      if (binding.communityId !== member.binding.communityId || binding.deviceId !== member.binding.deviceId ||
        binding.nativeInstanceId !== member.binding.nativeInstanceId) throw new Error("binding_mismatch");
      const policy = await state.deps.policy(ci, member.channelId);
      if (!policy) { remove(state, socket.id, "authorization_revoked"); throw new Error("forbidden"); }
      if (state.members.get(socket.id) !== member || state.revisions.get(socket.id) !== revision ||
        !current(state, member) || identity(ci) !== expectedIdentity || member.expiresAtMs <= state.deps.now()) throw new Error("stale_request");
      if ([...state.members.values()].some(m => m !== member && m.virtualIp === ip)) throw new Error("binding_mismatch");
      member.binding = binding; member.virtualIp = ip; member.credentialId = credentialId; member.fingerprint = fingerprint; member.policy = policy;
      member.expiresAtMs = state.deps.now() + NATIVE_VOICE_LEASE_MS;
      publish(state, member.channelId); return { ok: true };
    }, false, false, true),
    "voice:native:leave": (_payload: unknown, ack?: (reply: unknown) => void) => {
      remove(state, socket.id, "left"); if (typeof ack === "function") ack({ v: 1, ok: true });
    },
    "voice:native:media": (raw: unknown, ack?: (reply: unknown) => void) => {
      const member = state.members.get(socket.id);
      const payload = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const respond = (ok: boolean) => { if (typeof ack === "function") ack({ v: 1, ok }); };
      if (!member || !current(state, member) || member.expiresAtMs <= state.deps.now() || payload.v !== 1 ||
        typeof payload.connected !== "boolean") { respond(false); return; }
      // Presence remains a client report, never a verified remote-media claim.
      const connected = payload.connected && !member.ci.isServerDeafened;
      if (member.ci.isConnectedToVoice === connected) { respond(true); return; }
      const rl = checkRateLimit("voice:native:media", member.userId, ctx.getClientIp(),
        { limit: 30, windowMs: 60_000, scorePerAction: 0.1, maxScore: 10, scoreDecayMs: 1000 });
      // Cosmetic telemetry cannot invalidate a valid room or consume its lease
      // refresh budget. Only transitions publish roster state, preventing loops.
      if (!rl.allowed) { respond(false); return; }
      member.ci.isConnectedToVoice = connected; state.deps.broadcast(); respond(true);
    },
    "voice:move:client": wrap(async () => {
      const ci = clientsInfo[socket.id];
      if (!ci || !await state.deps.authenticate(socket, ci, ci.accessToken ?? "")) throw new Error("unauthenticated_connection");
      ci.voiceMoveStagingSupported = true; state.deps.broadcast(); return { staging: true };
    }),
    "voice:move:user": wrap(async payload => {
      if (!text(payload.requestId) || !uuid.test(payload.requestId) || !text(payload.targetServerUserId) ||
        !text(payload.sourceChannelId) || !text(payload.destinationChannelId)) throw new Error("invalid_move");
      const actorCi = clientsInfo[socket.id];
      const actorIdentity = actorCi ? identity(actorCi) : "";
      const token = typeof payload.accessToken === "string" ? payload.accessToken : actorCi?.accessToken ?? "";
      if (!actorCi || !await state.deps.authenticate(socket, actorCi, token)) throw new Error("unauthenticated_connection");
      for (const [requestId, old] of state.moves) if (old.expiresAtMs <= state.deps.now()) state.moves.delete(requestId);
      const prior = state.moves.get(payload.requestId);
      if (prior) {
        if (prior.actor !== socket || prior.identity !== actorIdentity || prior.targetUserId !== payload.targetServerUserId ||
          prior.result.sourceChannelId !== payload.sourceChannelId || prior.result.destinationChannelId !== payload.destinationChannelId) throw new Error("request_conflict");
        return prior.result;
      }
      const targets = [...state.members.values()].filter(m => m.userId === payload.targetServerUserId && m.channelId === payload.sourceChannelId);
      if (targets.length !== 1) throw new Error("target_not_current");
      const target = targets[0];
      const policy = await state.deps.policy(target.ci, payload.destinationChannelId);
      if (!policy || !await state.deps.moveAllowed(socket, actorCi, target, payload.destinationChannelId, token) ||
        !await state.deps.authenticate(target.socket, target.ci, target.ci.accessToken ?? "")) throw new Error("forbidden");
      if (!current(state, target) || state.members.get(target.socket.id) !== target || target.expiresAtMs <= state.deps.now() ||
        clientsInfo[socket.id] !== actorCi || identity(actorCi) !== actorIdentity || socket.connected === false ||
        io.sockets.sockets.get(socket.id) !== socket) throw new Error("target_not_current");
      const source = target.channelId;
      target.socket.leave(voiceRoomName(serverId, source)); target.channelId = payload.destinationChannelId;
      target.policy = policy; target.ci.voiceChannelId = target.channelId;
      target.socket.join(voiceRoomName(serverId, target.channelId));
      publish(state, source);
      const result = { v: 1, ok: true, requestId: payload.requestId, status: "committed", generation: target.socket.id,
        sourceChannelId: source, destinationChannelId: target.channelId,
        channelSettings: { requirePTT: policy.requirePTT, speak: policy.speak, shareVideo: false, shareScreen: false,
          disableRNNoise: true, maxBitrate: 16000, eSportsMode: false, isMuted: !canPublish(target), isDeafened: !canReceive(target) } };
      io.to(voiceRoomName(serverId, source)).emit("voice:peer:left", { clientId: target.socket.id, nickname: target.ci.nickname, channelId: source });
      target.socket.to(voiceRoomName(serverId, target.channelId)).emit("voice:peer:joined", { clientId: target.socket.id, nickname: target.ci.nickname, channelId: target.channelId });
      target.socket.emit("voice:move:committed", result);
      publish(state, target.channelId); state.deps.broadcast();
      if (state.moves.size >= 256) state.moves.delete(state.moves.keys().next().value!);
      state.moves.set(payload.requestId, { actor: socket, identity: actorIdentity, targetUserId: target.userId,
        expiresAtMs: state.deps.now() + 300_000, result });
      void insertServerAudit({ actorServerUserId: actorCi.serverUserId, action: "voice_move", target: target.userId,
        meta: { requestId: payload.requestId, source, destination: target.channelId, transport: "native-et" } }).catch(() => {});
      return result;
    }, false, true),
    "voice:move:query": wrap(async payload => {
      const ci = clientsInfo[socket.id];
      if (!ci || !await state.deps.authenticate(socket, ci, ci.accessToken ?? "")) throw new Error("unauthenticated_connection");
      if (!text(payload.requestId)) throw new Error("invalid_move");
      const prior = state.moves.get(payload.requestId);
      if (!prior || prior.actor !== socket || prior.identity !== identity(ci) || prior.expiresAtMs <= state.deps.now()) throw new Error("target_not_current");
      return prior.result;
    }, false, true),
  };
}
