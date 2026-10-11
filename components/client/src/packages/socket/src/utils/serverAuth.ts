import type { Socket } from "socket.io-client";

import {
  applyServerProofDecision,
  createClientNonce,
  evaluateServerProof,
  forgetServerFileAccess,
  listBlocked,
  restoreServerFileToken,
  type ServerProofDecision,
} from "@/common";
import { i18n as socketHooksI18n } from "@/i18n";

import { markGone, markProved, markRefused, watchHost } from "./proofGate";

/**
 * Authenticate a server before we say anything else to it. **Connection-level,
 * not part of the join handshake** — a saved token reconnects without joining.
 */

/** How long to wait for a proof before deciding the server isn't offering one. */
const IDENTITY_TIMEOUT_MS = 5000;

type EmitArgs = [event: string, ...args: unknown[]];

export interface GuardedSocket {
  /** Resolves once the server is verified, or rejects if it is refused. */
  verified: Promise<ServerProofDecision>;
}

export function guardSocket(
  socket: Socket,
  host: string,
  onRefused: (decision: ServerProofDecision & { action: "block" }) => void,
): GuardedSocket {
  let settled = false;
  // HTTP with a bearer token to this host waits on the same proof as the socket.
  watchHost(host);
  let queue: EmitArgs[] = [];

  const originalEmit = socket.emit.bind(socket);

  // Hold everything except the identity request itself. Stays for the socket's life so a
  // reconnect holds again, as the phone's does; released, it passes straight through.
  socket.emit = ((event: string, ...args: unknown[]) => {
    if (settled || event === "server:identify") {
      return originalEmit(event, ...args);
    }
    queue.push([event, ...args]);
    return socket;
  }) as typeof socket.emit;

  const release = () => {
    settled = true;
    markProved(host, socket);
    restoreServerFileToken(host);
    const pending = queue;
    queue = [];
    for (const [event, ...args] of pending) originalEmit(event, ...args);
  };

  const refuse = (decision: ServerProofDecision & { action: "block" }) => {
    settled = false;
    // Upload URLs are signed from what the socket handed over, so a refused server gets none.
    if (markRefused(host, socket)) forgetServerFileAccess(host);
    queue = [];
    // Stop reconnecting. Without this the refusal reads as an ordinary dropped
    // connection and it retries forever, showing "lost connection".
    try {
      socket.io.opts.reconnection = false;
      socket.disconnect();
    } catch {
      // ignore
    }
    onRefused(decision);
  };

  const verified = new Promise<ServerProofDecision>((resolve, reject) => {
    let done = false;

    const settle = async (proof: string | undefined, vouches?: string[]) => {
      if (done) return;
      done = true;

      const nonce = pendingNonce;
      const mine = connection;
      const decision = await evaluateServerProof({ host, proof, sentNonce: nonce, vouches });
      // The connection this answer was for went while it was checked. The next one proves itself.
      if (mine !== connection) return;
      applyServerProofDecision(host, decision);
      logDecision(host, decision);

      if (decision.action === "block") {
        refuse(decision as ServerProofDecision & { action: "block" });
        reject(new Error(`Server identity refused: ${decision.failure.reason}`));
        return;
      }

      release();
      resolve(decision);
    };

    let pendingNonce = "";
    let connection = 0;
    // One per connection. A stale one left over from before a reconnect refused a pinned server.
    let silenceTimer: ReturnType<typeof setTimeout> | undefined;

    socket.on("connect", () => {
      connection++;
      done = false;
      pendingNonce = createClientNonce();
      originalEmit("server:identify", { clientNonce: pendingNonce });

      // An older server has no handler and never answers. Silence means "offered
      // no proof": fine for an unpinned server, a refusal for a pinned one.
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => { void settle(undefined); }, IDENTITY_TIMEOUT_MS);
    });

    // Hold from the moment it goes: socket.io flushes its buffer on reconnect, before the
    // new server has proved anything. And a connection that is gone cannot be silent.
    socket.on("disconnect", () => {
      connection++;
      settled = false;
      markGone(host, socket);
      clearTimeout(silenceTimer);
      silenceTimer = undefined;
    });

    socket.on("server:identity", (res: { proof?: string; vouches?: string[]; error?: string }) => {
      clearTimeout(silenceTimer);
      void settle(res?.proof, Array.isArray(res?.vouches) ? res.vouches : undefined);
    });
  });

  // A refusal rejects `verified`; callers that don't care still get onRefused.
  verified.catch(() => { /* handled via onRefused */ });

  return { verified };
}

function logDecision(host: string, decision: ServerProofDecision): void {
  switch (decision.action) {
    case "pin":
      console.log(`[ServerAuth] Pinned ${host} as ${decision.keyId}`);
      break;
    case "trusted":
      if (decision.movedFrom) {
        console.log(`[ServerAuth] ${host} is the server previously seen at ${decision.movedFrom}`);
      }
      break;
    case "rotated":
      console.log(
        `[ServerAuth] ${host} rotated its identity key ` +
          `(${decision.previousKeyId} -> ${decision.keyId}` +
          `${decision.hops.length > 1 ? `, ${decision.hops.length} rotations behind` : ""})`,
      );
      break;
    case "unauthenticated":
      console.warn(`[ServerAuth] ${host} offered no identity proof — not pinning.`);
      break;
    case "block":
      console.error(`[ServerAuth] Refusing ${host}: ${decision.failure.reason}`, decision.failure);
      break;
  }
}

/**
 * A rough gap in words, because the exact figure is not the point. A minute out
 * is a missing time sync; a day out is a machine with no battery-backed clock.
 */
export function describeGap(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return socketHooksI18n.t("socketHooksFull.gapSeconds", { count: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return socketHooksI18n.t("socketHooksFull.gapMinutes", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return socketHooksI18n.t("socketHooksFull.gapHours", { count: hours });
  const days = Math.round(hours / 24);
  return socketHooksI18n.t("socketHooksFull.gapDays", { count: days });
}

/** Where to send somebody who cannot act on the sentence alone. */
export function serverProofHelpUrl(
  decision: ServerProofDecision & { action: "block" },
): string | null {
  return decision.failure.reason === "expired"
    ? "https://docs.gryt.chat/docs/use/troubleshooting#server-clock-is-wrong"
    : null;
}

/** What to show a user when a server is refused. */
export function serverProofErrorMessage(
  decision: ServerProofDecision & { action: "block" },
): string {
  // Destructured so the switch narrows the union — `decision.failure.reason`
  // discriminates the property, not the object.
  const failure = decision.failure;

  switch (failure.reason) {
    case "key_mismatch":
      return (
        socketHooksI18n.t("socketHooksFull.proofIdentityChanged")
      );
    case "proof_withdrawn":
      return (
        socketHooksI18n.t("socketHooksFull.proofWithdrawn")
      );
    case "blocked": {
      // Reconnect attempts after the first refusal land here, and a bare "it's
      // blocked" loses the reason. Recover it from what was recorded.
      const entry = listBlocked().find((b) => b.keyId === failure.keyId);
      if (entry?.reason === "key_mismatch") {
        return (
          socketHooksI18n.t("socketHooksFull.proofBlockedIdentityChanged")
        );
      }
      if (entry?.reason === "proof_withdrawn") {
        return (
          socketHooksI18n.t("socketHooksFull.proofBlockedWithdrawn")
        );
      }
      return socketHooksI18n.t("socketHooksFull.proofBlocked");
    }
    case "nonce_mismatch":
      return socketHooksI18n.t("socketHooksFull.proofWrongRequest");
    case "expired": {
      // The client already knows which clock is wrong: it compared the server's
      // timestamp against its own to decide the proof had expired.
      const skew = failure.skewMs;
      if (skew === undefined) {
        return socketHooksI18n.t("socketHooksFull.proofExpired");
      }
      return skew > 0
        ? socketHooksI18n.t("socketHooksFull.serverClockBehind", { gap: describeGap(Math.abs(skew)) })
        : socketHooksI18n.t("socketHooksFull.serverClockAhead", { gap: describeGap(Math.abs(skew)) });
    }
    default:
      return socketHooksI18n.t("socketHooksFull.proofUnchecked");
  }
}
