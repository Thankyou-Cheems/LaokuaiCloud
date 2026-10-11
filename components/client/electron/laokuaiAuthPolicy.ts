export function parseLaokuaiLogin(url: string): { login: URL; callback: URL } {
  const login = new URL(url);
  const callback = new URL(login.searchParams.get("redirect_uri") || "");
  const secure = (value: URL) => value.protocol === "https:" ||
    (value.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(value.hostname));
  if (!secure(login) || !secure(callback) || login.username || login.password ||
      callback.username || callback.password || callback.hash ||
      !/\/protocol\/openid-connect\/(auth|registrations)$/.test(login.pathname) ||
      login.searchParams.get("response_type") !== "code" ||
      login.searchParams.get("code_challenge_method") !== "S256" ||
      !login.searchParams.get("code_challenge") || !login.searchParams.get("state")) {
    throw new Error("Invalid official login request");
  }
  return { login, callback };
}

export function isLaokuaiAuthCallback(url: string, callback: URL): boolean {
  try {
    const candidate = new URL(url);
    return candidate.origin === callback.origin && candidate.pathname === callback.pathname &&
      (!!candidate.searchParams.get("code") || !!candidate.searchParams.get("error"));
  } catch {
    return false;
  }
}
