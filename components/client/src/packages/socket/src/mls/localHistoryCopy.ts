import type { ArchiveKeyErrorCode } from "@/common";
import { i18n as socketI18n } from "@/i18n";

/** What's wrong when the archive won't open. `where` is "on this device" or "in this browser". */
export function localHistoryProblemText(code: ArchiveKeyErrorCode | null, where: string): string {
  switch (code) {
    case "unseal-failed":
      return socketI18n.t("socketFull.localHistoryCopy_385ba703dc");
    case "no-keychain":
      return socketI18n.t("socketFull.localHistoryCopy_e220da8609", { p0: (where) });
    case "mismatch":
      return socketI18n.t("socketFull.localHistoryCopy_ee1aa7b5f1", { p0: (where) });
    case "damaged":
      return socketI18n.t("socketFull.localHistoryCopy_6484a08ac6", { p0: (where) });
    default:
      return socketI18n.t("socketFull.localHistoryCopy_61c814a447", { p0: (where) });
  }
}

export const CLEAR_LOCAL_HISTORY = "socketFull.localHistoryCopy_73722c67ee";
export const CLEAR_CONFIRM_TITLE = "socketFull.localHistoryCopy_7759f03e05";
export const CLEAR_CONFIRM_TEXT =
  "socketFull.localHistoryCopy_6fbba3da2d";
