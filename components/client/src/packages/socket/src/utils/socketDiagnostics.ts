import type {Socket} from "socket.io-client";

import {diagnosticCode, diagnosticHostSlot, diagnosticOperation, localDiagnostic} from "../../../../lib/localDiagnostics";

const attached = new WeakSet<Socket>();
/** Event names and permitted error fields only; no raw packet/identity access. */
export function attachSocketDiagnostics(socket: Socket, host: string): void {
  if (attached.has(socket)) return; attached.add(socket);
  const hostSlot = diagnosticHostSlot(host);
  socket.onAnyOutgoing(event => {
    const operation = diagnosticOperation(event); if (operation === "other") return;
    localDiagnostic({phase: "socket", operation, action: "send", code: "ok", hostSlot, sent: 1});
  });
  socket.onAny((event, error: unknown) => {
    const operation = diagnosticOperation(event); if (operation === "other") return;
    const isError = event === "server:error" || event === "token:error" || event === "voice:room:error" || event === "server:details";
    const value = isError && error && typeof error === "object" ? error as {error?: unknown; retryAfterMs?: unknown} : null;
    const retryAfterMs = typeof value?.retryAfterMs === "number" && Number.isFinite(value.retryAfterMs) ? Math.min(Math.max(value.retryAfterMs, 0), 3_600_000) : undefined;
    const code = event === "voice:channel:joined" && typeof error === "boolean" ? error ? "connected" : "disconnected" :
      value?.error ? diagnosticCode(value.error) : isError && typeof error === "string" ? diagnosticCode(error) : "ok";
    localDiagnostic({phase: "socket", operation, action: "receive", code, hostSlot, ...(retryAfterMs !== undefined ? {retryAfterMs} : {})});
  });
  socket.on("connect", () => localDiagnostic({phase: "socket", operation: "connect", action: "finish", code: "ok", hostSlot}));
  socket.on("connect_error", () => localDiagnostic({phase: "socket", operation: "connect_error", action: "finish", code: "connect_error", hostSlot}));
  socket.on("disconnect", () => localDiagnostic({phase: "socket", operation: "disconnect", action: "finish", code: "transport-close", hostSlot}));
}
