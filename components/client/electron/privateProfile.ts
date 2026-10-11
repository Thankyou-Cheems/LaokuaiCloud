import { existsSync } from "fs";
import { isAbsolute, join } from "path";

/** Explicit profile reuse is opt-in; it never imports or copies credentials. */
export function privateProfilePaths(own: boolean, argv: readonly string[], root: string) {
  const candidates = argv.flatMap((arg, index) => arg.startsWith("--user-data-dir=")
    ? [arg.slice("--user-data-dir=".length)]
    : arg === "--user-data-dir" ? [argv[index + 1] ?? ""] : []);
  if (own && candidates.length > 0) {
    const data = candidates[0];
    if (candidates.length !== 1 || !isAbsolute(data)
      || !existsSync(join(data, "gryt-global.json")) || !existsSync(join(data, "IndexedDB"))) {
      throw new Error("Explicit profile must name one existing absolute Gryt profile; nothing was imported.");
    }
    // Official Gryt's default session uses userData itself, not our isolated sessions subdirectory.
    return { data, sessions: data, reuseExisting: true };
  }
  const data = join(root, own ? "laokuai-chat-data" : "laokuai-chat-i18n-test-data");
  return { data, sessions: join(data, "sessions"), reuseExisting: false };
}
