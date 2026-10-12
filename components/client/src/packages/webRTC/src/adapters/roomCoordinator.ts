import type { RoomAccess, RoomCoordinator } from "@gryt/voice";
import type { Socket } from "socket.io-client";

import { handleRateLimitError } from "@/socket/src/utils/rateLimitHandler";
import {RoomAccessCooldown} from "../../../../lib/roomAccessCooldown";
import {diagnosticHostSlot, localDiagnostic} from "../../../../lib/localDiagnostics";


/**
 * What the server sends back on `voice:room:granted`. Declared here rather than
 * imported: it is Gryt's socket payload, not anything `@gryt/voice` knows.
 */
interface RoomAccessData {
  room_id: string;
  join_token: unknown;
  sfu_url: string;
  sfu_urls?: string[];
  timestamp: number;
}

/** How long to wait for the server to answer a room request. */
const ACCESS_TIMEOUT_MS = 15_000;

/* The engine only asks again after a refusal that carries retryAfterMs. The server's
   bare-string answers and our own timeout are failures rather than decisions. */
const RETRY_SOON_MS = 2_000;

/**
 * Gryt's half of joining a channel, over the socket the client already has. The
 * rate-limit toast is here because saying it out loud is the app's job.
 */
interface PendingAccess { cancel(reason: string): void; }
interface AccessSocketScope { id: string | undefined; ambiguous: boolean; pending: Set<PendingAccess>; }
// Retained coordinators can share a reconnected socket. Legacy errors have no
// request/room identity, so an ambiguous socket generation must fail closed.
const accessScopes = new WeakMap<Socket, AccessSocketScope>();
const cooldowns = new WeakMap<Socket, RoomAccessCooldown>();
function socketCooldown(socket: Socket): RoomAccessCooldown {
  const previous = cooldowns.get(socket); if (previous) return previous;
  const cooldown = new RoomAccessCooldown(); cooldowns.set(socket, cooldown);
  // Observe late refusals after a grant listener was removed. Coordinator
  // replacement/reconnect must not reset a server's unexpired cooldown.
  socket.on("voice:room:error", value => cooldown.observe(value));
  return cooldown;
}

type ClientAuthority=NonNullable<RoomCoordinator["moveAuthority"]> & {invalidate?:(reason:string)=>void};
export function createRoomCoordinator(socketSource: Socket|(()=>Socket|undefined), host: string, moveAuthority?:ClientAuthority|(()=>ClientAuthority|undefined), serverId?: string): RoomCoordinator {
  const currentSocket=()=>typeof socketSource==="function" ? socketSource() : socketSource;
  const authority=()=>typeof moveAuthority==="function" ? moveAuthority() : moveAuthority;
  const ownedRequests = new Set<PendingAccess>();
  return {
    get moveAuthority(){return authority();},
    requestAccess(channelId: string): Promise<RoomAccess> {
      // Capture the current authenticated socket for this request's listener cleanup.
      const socket=currentSocket();
      if(!socket?.connected || !socket.id)return Promise.resolve({granted:false,reason:"Server socket disconnected",retryAfterMs:RETRY_SOON_MS});
      if (!serverId) return Promise.resolve({ granted: false, reason: "Server identity unavailable", retryAfterMs: RETRY_SOON_MS });
      const remaining = socketCooldown(socket).remaining();
      if (remaining > 0) {
        localDiagnostic({phase: "socket", operation: "voice:room:request", action: "suppress", code: "rate_limited", hostSlot: diagnosticHostSlot(host), nextRetryMs: remaining, suppressed: 1});
        return Promise.resolve({granted: false, reason: "Voice connection is cooling down", retryAfterMs: remaining});
      }
      const socketId = socket.id;
      let scope = accessScopes.get(socket);
      if (!scope || scope.id !== socketId) {
        for (const pending of scope?.pending ?? []) pending.cancel("Server socket changed");
        scope = { id: socketId, ambiguous: false, pending: new Set() };
        accessScopes.set(socket, scope);
      }
      const currentScope = scope;
      if (scope.pending.size) scope.ambiguous = true;
      const expectedRoomId = `${serverId}_${channelId}`;
      const isCurrent = () => currentSocket() === socket && socket.connected && socket.id === socketId;
      return new Promise((resolve) => {
        const request: PendingAccess = { cancel: reason => {
          currentScope.ambiguous = true;
          cleanup();
          resolve({ granted: false, reason, retryAfterMs: RETRY_SOON_MS });
        } };
        let receivedUncorrelatedError = false;
        const timeout = setTimeout(() => {
          if (receivedUncorrelatedError) {
            cleanup();
            // Do not attribute an unknown refusal to this target, or repeatedly
            // retry a decision that this protocol cannot correlate. A matching
            // grant remains usable immediately until this request's deadline.
            resolve({ granted: false, reason: "Room access could not be confirmed. Please try joining again." });
            return;
          }
          request.cancel("Room access request timed out");
        }, ACCESS_TIMEOUT_MS);

        const cleanup = () => {
          clearTimeout(timeout);
          socket.off("voice:room:granted", onGranted);
          socket.off("voice:room:error", onError);
          socket.off("disconnect", onDisconnect);
          currentScope.pending.delete(request);
          ownedRequests.delete(request);
        };
        const onDisconnect = () => request.cancel("Server socket disconnected");

        const onGranted = (data: RoomAccessData) => {
          if (!isCurrent()) { request.cancel("Server socket changed"); return; }
          if (data?.room_id !== expectedRoomId) return;
          cleanup();
          resolve({
            granted: true,
            roomId: data.room_id,
            joinToken: data.join_token,
            sfuUrls: data.sfu_urls?.length ? data.sfu_urls : [data.sfu_url],
            // The engine caches its chosen SFU against this and never reads it.
            // The host is what the old code keyed the cache on.
            cacheKey: host,
          });
        };

        const onError = (
          error:
            | string
            | { error: string; message?: string; retryAfterMs?: number },
        ) => {
          if (!isCurrent()) { request.cancel("Server socket changed"); return; }
          // No target field exists on legacy errors. Never let an old request's
          // refusal reject a different request; its own timeout still resolves it.
          if (currentScope.ambiguous) { receivedUncorrelatedError = true; return; }
          cleanup();

          if (typeof error === "object" && error.error === "rate_limited" && error.message) {
            handleRateLimitError(error, "Voice connection");
            resolve({
              granted: false,
              reason: error.message,
              retryAfterMs: error.retryAfterMs,
            });
            return;
          }

          if (typeof error === "string") {
            resolve({ granted: false, reason: error, retryAfterMs: RETRY_SOON_MS });
            return;
          }

          // The engine hands `reason` back as connectionError, which is what gets shown.
          resolve({
            granted: false,
            reason: error.message || error.error || "Unknown error",
            retryAfterMs: error.retryAfterMs,
          });
        };

        currentScope.pending.add(request); ownedRequests.add(request);
        socket.on("voice:room:granted", onGranted);
        socket.on("voice:room:error", onError);
        socket.on("disconnect", onDisconnect);
        socket.emit("voice:room:request", channelId);
      });
    },

    leave: () => {
      for (const request of ownedRequests) request.cancel("Room access request cancelled");
      authority()?.invalidate?.("voice:room:leave");currentSocket()?.emit("voice:room:leave");
    },
    announceJoined: (joined) => currentSocket()?.emit("voice:channel:joined", joined),
    setLocalStream: (streamId) => currentSocket()?.emit("voice:stream:set", streamId ?? ""),
    peerChanged: (streamId, present) =>
      currentSocket()?.emit(present ? "voice:peer:connected" : "voice:peer:disconnected", streamId),

    get connected() {
      return currentSocket()?.connected===true;
    },

    onReconnected(handler: () => void) {
      // The client raises a `server_socket_reconnected` window event with the host
      // in its detail. It stays a window event here, filtered to this server.
      const listener = (event: Event) => {
        const detail = (event as CustomEvent<{ host?: string }>).detail;
        if (detail?.host && detail.host !== host) return;
        if(!currentSocket()?.connected)return;
        handler();
      };
      window.addEventListener("server_socket_reconnected", listener);
      return () => window.removeEventListener("server_socket_reconnected", listener);
    },
  };
}
