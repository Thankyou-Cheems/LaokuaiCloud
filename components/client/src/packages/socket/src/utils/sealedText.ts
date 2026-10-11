import { i18n as socketI18n } from "@/i18n";
/**
 * What to draw in place of a message that has not been opened. `locked` and
 * `broken` mean opposite things, and the phone says the same four (GRYT-729).
 */
export function sealedPlaceholder(message: {
  sealed?: string | null;
  sealedState?: "opening" | "open" | "locked" | "broken";
}): string | null {
  if (!message.sealed) return null;

  switch (message.sealedState) {
    case "open":
      // It opened. `text` is the message, and this has nothing to say.
      return null;
    case "locked":
      // No wrapped key for us. Sent before we joined the conversation, which is
      // permanent and ordinary — not a failure, and not worth an alarm.
      return socketI18n.t("socketFull.sealedText_aafdd585f6");
    case "broken":
      // A key that is there and does not open: tampering, or a message from
      // another conversation. Said without naming a cause.
      return socketI18n.t("socketFull.sealedText_cb608e127f");
    default:
      // `opening`, and the render between a sealed message arriving and the
      // effect marking it.
      return "Decrypting…";
  }
}
