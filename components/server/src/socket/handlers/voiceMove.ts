import { randomBytes, randomUUID } from "node:crypto";
import type { Socket, Server } from "socket.io";
import type { Clients } from "../../types";
import { getServerChannel, insertServerAudit } from "../../db";
import { mayInChannel } from "../../services/channelPermissions";
import { getVoiceSeatLimit } from "../../utils/voiceSeats";
import type { SfuMoveCommand, SfuMoveResult } from "../../sfu/moveProtocol";
import type { HandlerContext, EventHandlerMap } from "./types";
import { requireAuth, requireOutranks } from "../middleware/auth";
import { sfuRoomId, voiceRoomName } from "../utils/voiceRooms";
import { syncAllClients, broadcastMemberList } from "../utils/clients";
import { voiceCapabilities, turnOffWhatWasTaken, forgetVoiceCapabilities } from "../utils/voiceCapabilities";
import { forgetStashedVoiceState, clearVoiceRecoveryGrace } from "../utils/voiceStash";
import { clearVoiceQuality } from "../utils/voiceQualityLifecycle";
import { watchVoiceMoves } from "../utils/voiceMoveLifecycle";
import { getSqliteDb } from "../../db/sqlite/connection";
import { invalidateHybridSession } from "../utils/voiceHybridLifecycle";

type Status = "preparing" | "prepared" | "committed" | "aborted" | "failed" | "pending";
interface Result { v: 1; requestId: string; status: Status; generation: string; sourceChannelId: string; destinationChannelId: string; invalidated?: boolean; channelSettings?: MoveSettings; error?: string }
interface MoveSettings { requirePTT: boolean; disableRNNoise: boolean; maxBitrate: number | null; eSportsMode: boolean; speak: boolean; shareVideo: boolean; shareScreen: boolean; isMuted: boolean; isDeafened: boolean }
interface Move {
  actor: Socket; target: Socket; actorCi: Clients[string]; targetCi: Clients[string];
  actorUserId: string; actorGrytId?: string; targetGrytId?: string;
  source: string; destination: string; command: SfuMoveCommand;
  status: Status; error?: string; streamId?: string; applied: boolean;
  settings?: MoveSettings;
  invalidated?: boolean;
  policyInvalidated?: boolean;
  preparedRevision?: string;
  commitSent?: boolean;
  cleanupScheduled?: boolean;
  queue: Promise<unknown>; timer?: NodeJS.Timeout;
}
interface Hub { moves: Map<string, Move>; busy: Map<string, string>; capable: Set<Socket> }
const hubs = new WeakMap<Server, Hub>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 128;
const terminal = (m: Move) => ["committed", "aborted", "failed"].includes(m.status);

/** Local proposal only: production must explicitly opt in after approving the
 * disconnect_members + strict outrank policy and deploying the SFU/SDK contract. */
export function registerVoiceMoveHandlers(ctx: HandlerContext,
  options: { enabled?: boolean } = {}): EventHandlerMap {
  const { io, socket, clientId, clientsInfo, serverId, sfuClient } = ctx;
  const enabled = options.enabled ?? process.env.VOICE_ATOMIC_MOVE_ENABLED === "true";
  let hub = hubs.get(io);
  const newHub = !hub;
  if (!hub) { hub = { moves: new Map(), busy: new Map(), capable: new Set() }; hubs.set(io, hub); }
  const state = hub;
  function current(s: Socket, ci: Clients[string]): boolean {
    return s.connected && io.sockets.sockets.get(s.id) === s && clientsInfo[s.id] === ci;
  }
  function targetCurrent(m: Move): boolean {
    return current(m.target, m.targetCi) && m.targetCi.serverUserId === m.command.user_id &&
      m.targetCi.grytUserId === m.targetGrytId && !!m.targetCi.accessToken && m.targetCi.hasJoinedChannel &&
      (m.applied ? m.targetCi.voiceChannelId === m.destination && m.targetCi.streamID === m.streamId :
        [m.source, m.destination].includes(m.targetCi.voiceChannelId));
  }
  if (newHub) watchVoiceMoves(io, () => {
    for (const m of state.moves.values()) {
      if (terminal(m) || m.invalidated) continue;
      if (!targetCurrent(m)) {
        m.invalidated = true;
        void serialized(m, () => reconcile(m, true));
      } else if (!m.commitSent && m.preparedRevision && databaseRevision() !== m.preparedRevision && !m.policyInvalidated) {
        m.policyInvalidated = true;
        void serialized(m, () => reconcile(m, true));
      }
    }
  });
  function databaseRevision(): string {
    const db = getSqliteDb();
    return JSON.stringify([db.prepare("SELECT total_changes() AS changes").get(), db.prepare("PRAGMA data_version").get()]);
  }
  async function authenticate(s: Socket, token: unknown, expected?: Clients[string], permission = false) {
    const ci = clientsInfo[s.id];
    if (!ci || (expected && ci !== expected) || !current(s, ci) || typeof token !== "string") return null;
    const auth = await requireAuth(s, { accessToken: token }, permission ? { permission: "disconnect_members" } : undefined);
    if (!auth || !current(s, ci) || ci.serverUserId !== auth.tokenPayload.serverUserId ||
      ci.grytUserId !== auth.tokenPayload.grytUserId) return null;
    return auth;
  }
  async function allowed(m: Move): Promise<boolean> {
    if (m.policyInvalidated || m.invalidated) return false;
    if (m.actorCi.serverUserId !== m.actorUserId || m.actorCi.grytUserId !== m.actorGrytId ||
        m.targetCi.grytUserId !== m.targetGrytId) return false;
    const auth = await authenticate(m.actor, m.actorCi.accessToken, m.actorCi, true);
    if (!auth || !await authenticate(m.target, m.targetCi.accessToken, m.targetCi) ||
        !await requireOutranks(m.actor, auth, m.command.user_id, "move")) return false;
    const [source, destination] = await Promise.all([getServerChannel(m.source), getServerChannel(m.destination)]);
    if (source?.type !== "voice" || destination?.type !== "voice") return false;
    const can = (ci: Clients[string], channel: string, permission: "read_messages" | "join_voice") =>
      mayInChannel(channel, ci.serverUserId, permission, ci.grytUserId);
    const decisions = await Promise.all([can(m.actorCi, m.source, "read_messages"),
      can(m.actorCi, m.destination, "read_messages"), can(m.targetCi, m.destination, "read_messages"),
      can(m.targetCi, m.destination, "join_voice")]);
    return decisions.every(Boolean) && current(m.actor, m.actorCi) && current(m.target, m.targetCi) &&
      m.targetCi.serverUserId === m.command.user_id && m.targetCi.hasJoinedChannel &&
      m.targetCi.voiceChannelId === m.source;
  }
  function summary(m: Move): Result { return { v: 1, requestId: m.command.request_id, status: m.status,
    generation: m.command.socket_id, sourceChannelId: m.source, destinationChannelId: m.destination,
    ...(m.invalidated ? { invalidated: true } : {}),
    ...(m.settings ? { channelSettings: m.settings } : {}), ...(m.error ? { error: m.error } : {}) }; }
  function finish(m: Move, status: Status, error?: string): Result {
    m.status = status; m.error = error;
    if (terminal(m)) {
      clearTimeout(m.timer);
      if (state.busy.get(m.command.user_id) === m.command.request_id) state.busy.delete(m.command.user_id);
      if (!m.cleanupScheduled) {
        m.cleanupScheduled = true;
        const cleanup = setTimeout(() => state.moves.delete(m.command.request_id), 300_000); cleanup.unref();
      }
    }
    const result = summary(m);
    if (current(m.actor, m.actorCi)) m.actor.emit("voice:move:result", result);
    if ((status === "aborted" || status === "failed") && current(m.target, m.targetCi))
      m.target.emit("voice:move:aborted", result);
    return result;
  }
  function serialized<T>(m: Move, work: () => Promise<T>): Promise<T> {
    const next = m.queue.then(work, work); m.queue = next.catch(() => {}); return next;
  }
  function checked(m: Move, r: SfuMoveResult): SfuMoveResult {
    if (r.request_id !== m.command.request_id || (r.status !== "failed" &&
      (r.user_id !== m.command.user_id || r.source_room_id !== m.command.source_room_id ||
       r.destination_room_id !== m.command.destination_room_id))) throw new Error("SFU move identity mismatch");
    return r;
  }
  async function applyCommitted(m: Move): Promise<Result> {
    if (m.invalidated || !targetCurrent(m)) {
      m.invalidated = true;
      const removed = checked(m, await sfuClient!.requestMove("remove", m.command));
      if (removed.status !== "committed" || !removed.removed) { m.status = "pending"; return summary(m); }
      return finish(m, "committed");
    }
    // Controls issued while the commit ACK travelled still named the source.
    // A transaction-bound refresh ACK establishes the destination policy
    // before this application publishes committed authority to the SDK.
    let stable = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const revision = databaseRevision();
      if (!await authenticate(m.target, m.targetCi.accessToken, m.targetCi)) {
        m.invalidated = true; return applyCommitted(m);
      }
      const caps = await voiceCapabilities(m.destination, m.command.user_id, m.targetGrytId);
      const channel = await getServerChannel(m.destination);
      if (!targetCurrent(m) || !channel || channel.type !== "voice" ||
          !await mayInChannel(m.destination, m.command.user_id, "read_messages", m.targetGrytId) ||
          !await mayInChannel(m.destination, m.command.user_id, "join_voice", m.targetGrytId)) {
        m.invalidated = true; return applyCommitted(m);
      }
      if (databaseRevision() !== revision) continue;
      const audio = [m.targetCi.isMuted, m.targetCi.isServerMuted, m.targetCi.isDeafened, m.targetCi.isServerDeafened];
      m.command.capabilities = caps;
      m.command.is_muted = audio[0] || audio[1] || !caps.includes("speak");
      m.command.is_deafened = audio[2] || audio[3];
      m.settings = { requirePTT: channel.require_push_to_talk, disableRNNoise: channel.disable_rnnoise,
        maxBitrate: channel.max_bitrate, eSportsMode: channel.esports_mode, speak: caps.includes("speak"),
        shareVideo: caps.includes("share_video"), shareScreen: caps.includes("share_screen"),
        isMuted: m.command.is_muted, isDeafened: m.command.is_deafened };
      const refreshed = checked(m, await sfuClient!.requestMove("refresh", m.command));
      if (!targetCurrent(m) || m.invalidated) { m.invalidated = true; return applyCommitted(m); }
      if (refreshed.status !== "committed" || refreshed.removed) { m.status = "pending"; return summary(m); }
      if (databaseRevision() === revision && JSON.stringify(audio) === JSON.stringify([
        m.targetCi.isMuted, m.targetCi.isServerMuted, m.targetCi.isDeafened, m.targetCi.isServerDeafened])) {
        stable = true; break;
      }
    }
    if (!stable) { m.status = "pending"; return summary(m); }
    // SFU sync can already have updated the channel while the ack travelled.
    if (!m.applied && current(m.target, m.targetCi) && m.targetCi.serverUserId === m.command.user_id &&
        m.targetCi.hasJoinedChannel && [m.source, m.destination].includes(m.targetCi.voiceChannelId)) {
      m.applied = true;
      clearVoiceQuality(io, m.target.id);
      m.target.leave(voiceRoomName(serverId, m.source));
      m.target.join(voiceRoomName(serverId, m.destination));
      m.targetCi.voiceChannelId = m.destination;
      m.targetCi.streamID = m.streamId ?? m.targetCi.streamID;
      turnOffWhatWasTaken(clientsInfo, m.command.user_id, m.destination, m.command.capabilities);
      forgetStashedVoiceState(m.command.user_id); clearVoiceRecoveryGrace(m.command.user_id);
      forgetVoiceCapabilities(m.command.user_id);
      sfuClient!.untrackUserConnection(m.command.user_id);
      sfuClient!.trackUserConnection(m.command.destination_room_id, m.command.user_id);
      syncAllClients(io, clientsInfo); broadcastMemberList(io, clientsInfo, serverId);
      const event = { v: 1, requestId: m.command.request_id, clientId: m.target.id,
        serverUserId: m.command.user_id, nickname: m.targetCi.nickname };
      io.to(voiceRoomName(serverId, m.source)).emit("voice:peer:left", { ...event, channelId: m.source });
      m.target.to(voiceRoomName(serverId, m.destination)).emit("voice:peer:joined", { ...event, channelId: m.destination });
      m.target.emit("voice:move:committed", { ...summary(m), status: "committed" });
      void insertServerAudit({ actorServerUserId: m.actorCi.serverUserId,
        action: "voice_move", target: m.command.user_id,
        meta: { requestId: m.command.request_id, source: m.source, destination: m.destination } }).catch(() => {});
    }
    return finish(m, "committed");
  }
  async function reconcile(m: Move, abort = false): Promise<Result> {
    try {
      if (m.status === "committed") return await applyCommitted(m);
      if (terminal(m)) return summary(m);
      const r = checked(m, await sfuClient!.requestMove(m.invalidated ? "remove" : abort ? "abort" : "status", m.command));
      if (r.status === "committed") return await applyCommitted(m);
      if (r.status === "aborted") return finish(m, "aborted");
      if (r.status === "failed") { m.status = "pending"; m.error = "sfu_status_unavailable"; return summary(m); }
      if (!abort && !await allowed(m)) return reconcile(m, true);
      m.status = "prepared"; return summary(m);
    } catch { m.status = "pending"; return summary(m); }
  }
  socket.once("disconnect", () => {
    state.capable.delete(socket);
    for (const m of state.moves.values()) if (!terminal(m) && (m.actor === socket || m.target === socket)) {
      if (m.target === socket) m.invalidated = true;
      void serialized(m, () => reconcile(m, true));
    }
  });
  function wrapped(work: (p: Record<string, unknown>) => Promise<Result | object>) {
    return async (payload: unknown, ack?: (r: unknown) => void) => {
      let result: object;
      try {
        if (!enabled) result = { status: "failed", error: "move_disabled" };
        else if (!payload || typeof payload !== "object" || Array.isArray(payload)) result = { status: "failed", error: "invalid_payload" };
        else if (!await authenticate(socket, (payload as Record<string, unknown>).accessToken)) result = { status: "failed", error: "unauthenticated_connection" };
        else result = await work(payload as Record<string, unknown>);
      } catch { result = { status: "failed", error: "move_failed" }; }
      result = { v: 1, ...result };
      if (typeof ack === "function") ack(result);
      else socket.emit("voice:move:result", result);
    };
  }
  async function owned(p: Record<string, unknown>): Promise<Move | undefined> {
    if (typeof p.requestId !== "string" || !uuid.test(p.requestId)) return;
    const m = state.moves.get(p.requestId);
    if (m && (m.actorCi.serverUserId !== m.actorUserId || m.actorCi.grytUserId !== m.actorGrytId ||
      m.targetCi.serverUserId !== m.command.user_id || m.targetCi.grytUserId !== m.targetGrytId)) return;
    if (!m || !((m.actor === socket && current(socket, m.actorCi)) ||
      (m.target === socket && current(socket, m.targetCi)))) return;
    return m;
  }
  return {
    "voice:move:client": wrapped(async p => {
      if (p.v !== 1 || p.staging !== true) return { status: "failed", error: "unsupported_sdk" };
      clientsInfo[clientId].voiceMoveStagingSupported = true;
      syncAllClients(io, clientsInfo);
      state.capable.add(socket); return { v: 1, staging: true };
    }),
    "voice:move:user": wrapped(async p => {
      if (!text(p.requestId) || !uuid.test(p.requestId) || !text(p.targetServerUserId) ||
        !text(p.sourceChannelId) || !text(p.destinationChannelId)) return { status: "failed", error: "invalid_payload" };
      const prior = state.moves.get(p.requestId);
      if (prior) {
        if (prior.actor !== socket || !await owned(p) || prior.command.user_id !== p.targetServerUserId ||
          prior.source !== p.sourceChannelId || prior.destination !== p.destinationChannelId)
          return { status: "failed", error: "request_conflict" };
        return serialized(prior, () => reconcile(prior));
      }
      if (!sfuClient?.isConnected()) return { status: "failed", error: "sfu_unavailable" };
      const targets = [...io.sockets.sockets.values()].filter(s => clientsInfo[s.id]?.serverUserId === p.targetServerUserId && clientsInfo[s.id]?.hasJoinedChannel);
      if (targets.length !== 1) return { status: "failed", error: "target_not_current" };
      const target = targets[0], targetCi = clientsInfo[target.id], actorCi = clientsInfo[clientId];
      const m: Move = { actor: socket, target, actorCi, targetCi, source: p.sourceChannelId, destination: p.destinationChannelId,
        actorUserId: actorCi.serverUserId, actorGrytId: actorCi.grytUserId, targetGrytId: targetCi.grytUserId,
        command: { request_id: p.requestId, user_id: p.targetServerUserId, source_room_id: sfuRoomId(serverId, p.sourceChannelId),
          destination_room_id: sfuRoomId(serverId, p.destinationChannelId), socket_id: target.id,
          nonce: randomBytes(24).toString("base64url"), expires_at_ms: Date.now() + 30_000,
          capabilities: [], is_muted: false, is_deafened: false }, status: "preparing", applied: false, queue: Promise.resolve() };
      if (!await allowed(m)) return { status: "failed", error: "forbidden_or_stale" };
      // Authentication/permission reads yield: another copy of the same request
      // may have reserved this user while they ran.
      const raced = state.moves.get(p.requestId);
      if (raced) {
        if (raced.actor !== socket || !await owned(p) || raced.command.user_id !== p.targetServerUserId ||
          raced.source !== p.sourceChannelId || raced.destination !== p.destinationChannelId)
          return { status: "failed", error: "request_conflict" };
        return serialized(raced, () => reconcile(raced));
      }
      if (m.source === m.destination) return { ...summary(m), status: "committed", noop: true };
      if (!state.capable.has(target)) return { status: "failed", error: "unsupported_sdk" };
      if (state.busy.has(m.command.user_id)) return { status: "failed", error: "move_busy" };
      if (state.moves.size >= 1024) return { status: "failed", error: "move_capacity" };
      const tracked = sfuClient.getTrackedUser(m.command.user_id);
      const limit = getVoiceSeatLimit();
      if (!tracked || tracked.roomId !== m.command.source_room_id ||
        (limit !== null && sfuClient.getActiveUsers().size > limit)) return { status: "failed", error: "seat_or_source_changed" };
      state.moves.set(p.requestId, m); state.busy.set(m.command.user_id, p.requestId);
      return serialized(m, async () => {
        let prepareSent = false;
        try {
          const probe = await sfuClient.requestMove("probe", { ...m.command, request_id: randomUUID() });
          if (probe.status !== "supported") return finish(m, "failed", "unsupported_sfu");
          await sfuClient.registerRoom(m.command.destination_room_id);
          if (!await allowed(m)) return finish(m, "failed", "forbidden_or_stale");
          m.command.capabilities = await voiceCapabilities(m.destination, m.command.user_id, targetCi.grytUserId);
          prepareSent = true;
          const prepared = checked(m, await sfuClient.requestMove("prepare", m.command));
          if (prepared.status !== "prepared") return finish(m, "failed", prepared.error ?? "sfu_refused");
          if (!await allowed(m)) return reconcile(m, true);
          const joinToken = { ...sfuClient.generateClientJoinToken(m.command.destination_room_id, m.command.user_id,
            [...m.command.capabilities, `move:${m.command.request_id}:${m.command.nonce}`], target.id), move_id: p.requestId };
          const channel = await getServerChannel(m.destination);
          m.settings = { requirePTT: channel?.require_push_to_talk ?? false, disableRNNoise: channel?.disable_rnnoise ?? false,
            maxBitrate: channel?.max_bitrate ?? null, eSportsMode: channel?.esports_mode ?? false,
            speak: m.command.capabilities.includes("speak"), shareVideo: m.command.capabilities.includes("share_video"),
            shareScreen: m.command.capabilities.includes("share_screen"), isMuted: targetCi.isMuted || targetCi.isServerMuted,
            isDeafened: targetCi.isDeafened || targetCi.isServerDeafened };
          m.status = "prepared";
          m.preparedRevision = databaseRevision();
          m.timer = setTimeout(() => { void serialized(m, () => reconcile(m, true)); },
            Math.max(0, m.command.expires_at_ms - Date.now())); m.timer.unref();
          target.emit("voice:move:prepare", { v: 1, requestId: p.requestId, sourceChannelId: m.source,
            destinationChannelId: m.destination, joinToken, expiresAt: m.command.expires_at_ms,
            sfuUrls: (process.env.SFU_PUBLIC_HOST || process.env.SFU_WS_HOST || "").split(",").map(s => s.trim()).filter(Boolean),
            generation: m.command.socket_id, channelSettings: m.settings });
          return summary(m);
        } catch { return prepareSent ? reconcile(m, true) : finish(m, "failed", "unsupported_or_unavailable_sfu"); }
      });
    }),
    "voice:move:ready": wrapped(async p => {
      const m = await owned(p);
      if (!m || m.target !== socket || !text(p.streamId)) return { status: "failed", error: "invalid_move" };
      return serialized(m, async () => {
        if (terminal(m)) return reconcile(m);
        if (m.streamId && m.streamId !== p.streamId) return { status: "failed", error: "stream_conflict" };
        m.streamId = p.streamId as string;
        try {
          const ready = checked(m, await sfuClient!.requestMove("status", m.command));
          if (ready.status === "committed") return await applyCommitted(m);
          if (ready.status !== "ready") return reconcile(m);
          const revision = databaseRevision();
          if (!await allowed(m)) return reconcile(m, true);
          m.command.capabilities = await voiceCapabilities(m.destination, m.command.user_id, m.targetCi.grytUserId);
          m.command.is_muted = m.targetCi.isMuted || m.targetCi.isServerMuted || !m.command.capabilities.includes("speak");
          m.command.is_deafened = m.targetCi.isDeafened || m.targetCi.isServerDeafened;
          const channel = await getServerChannel(m.destination);
          // PTT/DSP/encoder setup was applied by the SDK before ready. If these
          // changed during staging, restart preparation instead of publishing
          // under settings the SDK never received.
          if (!channel || !m.settings || channel.require_push_to_talk !== m.settings.requirePTT ||
            channel.disable_rnnoise !== m.settings.disableRNNoise || channel.max_bitrate !== m.settings.maxBitrate ||
            channel.esports_mode !== m.settings.eSportsMode) return reconcile(m, true);
          m.settings = { ...m.settings, speak: m.command.capabilities.includes("speak"),
            shareVideo: m.command.capabilities.includes("share_video"), shareScreen: m.command.capabilities.includes("share_screen"),
            isMuted: m.command.is_muted, isDeafened: m.command.is_deafened };
          // Every DB write (also from another SQLite connection) during these
          // permission/settings reads aborts conservatively. No await separates
          // this fence and the commit send. Moderation is copied at that boundary.
          if (databaseRevision() !== revision || m.invalidated || !targetCurrent(m) ||
              !current(m.actor, m.actorCi) || m.actorCi.serverUserId !== m.actorUserId ||
              m.actorCi.grytUserId !== m.actorGrytId) return reconcile(m, true);
          m.command.is_muted = m.targetCi.isMuted || m.targetCi.isServerMuted || !m.command.capabilities.includes("speak");
          m.command.is_deafened = m.targetCi.isDeafened || m.targetCi.isServerDeafened;
          m.settings.isMuted = m.command.is_muted; m.settings.isDeafened = m.command.is_deafened;
          m.commitSent = true;
          invalidateHybridSession(io, m.target.id);
          const committed = checked(m, await sfuClient!.requestMove("commit", m.command));
          if (committed.status === "committed") return await applyCommitted(m);
          return reconcile(m, true);
        } catch { return reconcile(m); }
      });
    }),
    "voice:move:query": wrapped(async p => {
      const m = await owned(p); return m ? serialized(m, () => reconcile(m)) : { status: "failed", error: "unknown_move" };
    }),
    "voice:move:abort": wrapped(async p => {
      const m = await owned(p); return m ? serialized(m, () => reconcile(m, true)) : { status: "failed", error: "unknown_move" };
    }),
  };
}
