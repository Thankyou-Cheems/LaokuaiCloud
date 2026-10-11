import toast from "react-hot-toast";

import { i18n as socketHooksI18n } from "@/i18n";

import { socketDisplayText, socketHookToast } from "./socketHookMessages";

// Track recent rate limit messages to prevent duplicates
const recentRateLimitMessages = new Set<string>();
const RATE_LIMIT_DEBOUNCE_MS = 2000; // 2 seconds

export const handleRateLimitError = (
  error: string | { error: string; message?: string; retryAfterMs?: number; currentScore?: number; maxScore?: number },
  context: string = "operation"
) => {
  if (typeof error === 'object' && error.error === 'rate_limited' && error.message) {
    const messageKey = `${context}-${error.message}`;
    
    if (recentRateLimitMessages.has(messageKey)) {
      return;
    }
    
    // Add to recent messages and set up cleanup
    recentRateLimitMessages.add(messageKey);
    setTimeout(() => {
      recentRateLimitMessages.delete(messageKey);
    }, RATE_LIMIT_DEBOUNCE_MS);
    
    // Keep debounce keys and the server's message raw. Only the display suffix
    // is localized, from the subscribed toast body rather than a captured string.
    toast.error(socketHookToast(() => {
      const message = error.message ?? "";
      if (error.retryAfterMs && error.retryAfterMs > 0) {
        const seconds = Math.ceil(error.retryAfterMs / 1000);
        return seconds > 1
          ? socketHooksI18n.t("socketHooksFull.rateLimitedWait", { message, count: seconds })
          : socketHooksI18n.t("socketHooksFull.rateLimitedMoment", { message });
      }
      return message;
    }));
    return;
  }
  
  // Somebody's contact setting explains itself (GRYT-1470).
  if (typeof error === 'object' && error.error === 'contact_refused' && error.message) {
    toast.error(socketHookToast(() => error.message), { id: `contact-refused:${error.message}` });
    return;
  }

  // Handle other errors
  toast.error(socketHookToast(() => {
    const errorMessage = typeof error === "string" ? error : error.error || socketHooksI18n.t("socketHooksFull.unknownOperationError", { context });
    return socketHooksI18n.t("socketHooksFull.operationError", { context, error: socketDisplayText(errorMessage) });
  }));
};
