/** A nickname operation never includes avatar fields or implicitly changes scope. */
export type NicknameScope =
  | { kind: "default" }
  | { kind: "server"; host: string }
  | { kind: "all-servers" };

export interface NicknamePlan {
  nickname: string;
  updateDefault: boolean;
  hosts: string[];
}

export function planNicknameUpdate(
  input: string,
  scope: NicknameScope,
  knownHosts: readonly string[],
): NicknamePlan {
  const nickname = input.trim().slice(0, 20);
  if (!nickname) throw new Error("empty-nickname");
  const hosts = [...new Set(knownHosts)];
  if (scope.kind === "server" && !hosts.includes(scope.host)) {
    throw new Error("unknown-server");
  }
  return {
    nickname,
    updateDefault: scope.kind === "default",
    hosts: scope.kind === "default" ? [] : scope.kind === "server" ? [scope.host] : hosts,
  };
}

type Listener = (...args: unknown[]) => void;
export interface NicknameSocket {
  connected: boolean;
  on(event: string, listener: Listener): unknown;
  off(event: string, listener: Listener): unknown;
  emit(event: string, payload: { nickname: string }): unknown;
}

// Existing value updates confirm no attribution; only explicit nickname refusals do.
const NICKNAME_REFUSALS = new Set([
  'Names that start with "bot" are reserved.',
  "You do not have permission to change your nickname here.",
  "Not authenticated",
]);

export function nicknameFailureKey(error: unknown): string {
  const reason = error instanceof Error ? error.message : "";
  if (reason === "nickname-rejected") return "nicknameScope.rejected";
  if (reason === "server-offline") return "nicknameScope.offline";
  if (reason === "nickname-operation-pending") return "nicknameScope.pending";
  return "nicknameScope.unconfirmed";
}

// Socket lifetime outlasts a mounted settings screen. Never duplicate an in-flight write
// just because its originating editor was closed and reopened.
const pendingNicknameUpdates = new WeakMap<NicknameSocket, symbol>();

export function requestNicknameUpdate(
  socket: NicknameSocket,
  nickname: string,
  timeoutMs = 8000,
): Promise<void> {
  if (pendingNicknameUpdates.has(socket)) return Promise.reject(new Error("nickname-operation-pending"));
  if (!socket.connected) return Promise.reject(new Error("server-offline"));
  const operation = Symbol("nickname-update");
  pendingNicknameUpdates.set(socket, operation);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      if (pendingNicknameUpdates.get(socket) === operation) pendingNicknameUpdates.delete(socket);
      clearTimeout(timer);
      socket.off("profile:updated", onProfile);
      socket.off("disconnect", onDisconnect);
      socket.off("profile:error", onError);
    };
    const onProfile: Listener = (data) => {
      if (!data || typeof data !== "object" || !("nickname" in data) || data.nickname !== nickname) return;
      cleanup();
      resolve();
    };
    const onError: Listener = (message) => {
      if (typeof message !== "string" || !NICKNAME_REFUSALS.has(message)) return;
      cleanup();
      reject(new Error("nickname-rejected"));
    };
    const onDisconnect: Listener = () => {
      cleanup();
      reject(new Error("nickname-unconfirmed"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("nickname-unconfirmed"));
    }, timeoutMs);
    socket.on("profile:updated", onProfile);
    socket.on("disconnect", onDisconnect);
    socket.on("profile:error", onError);
    try {
      socket.emit("profile:update", { nickname });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
