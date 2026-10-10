import type { HistoryProgress, PairingEndReason } from "@gryt/core";

import { type CopyI18n,englishCopy } from "../copyI18n.ts";

/* What the new device says, kept out of the dialog so the check script can read it. */

const ended = (i18n: CopyI18n): Partial<Record<PairingEndReason, string>> => ({
  get cancelled_by_other() { return i18n.t("pairingFull.newDeviceWords_ts_e21a2a1635"); },
  get mismatch() { return i18n.t("pairingFull.newDeviceWords_ts_7516884617"); },
  get timed_out() { return i18n.t("pairingFull.newDeviceWords_ts_e2e217b234"); },
  get expired() { return i18n.t("pairingFull.newDeviceWords_ts_0189f86d90"); },
  get tampered() { return i18n.t("pairingFull.newDeviceWords_ts_97d5600c77"); },
  get wrong_account() { return i18n.t("pairingFull.newDeviceWords_ts_5e084632b2"); },
  get sign_in_failed() { return i18n.t("pairingFull.newDeviceWords_ts_99a3769b56"); },
  get newer_version() { return i18n.t("pairingFull.newDeviceWords_ts_5bdb39eca6"); },
  get rate_limited() { return i18n.t("pairingFull.newDeviceWords_ts_0f4f6abfef"); },
  get relay_error() { return i18n.t("pairingFull.newDeviceWords_ts_a771214cc9"); },
  get history_failed() { return i18n.t("pairingFull.newDeviceWords_ts_d27b0fe687"); },
  get access_denied() { return i18n.t("pairingFull.newDeviceWords_ts_c7676e8973"); },
  get expired_token() { return i18n.t("pairingFull.newDeviceWords_ts_11331ff845"); },
});

export function newDeviceEndText(reason: PairingEndReason, i18n: CopyI18n = englishCopy): string {
  return ended(i18n)[reason] ?? i18n.t("pairingFull.newDeviceWords_ts_bf7f016246");
}

/** Lines about the history coming in. Empty until the other device says it's sending some. */
export function historyLines(progress: HistoryProgress | null, i18n: CopyI18n = englishCopy): string[] {
  if (!progress) return [];
  const date = (ms: number) => new Date(ms).toLocaleDateString(i18n.resolvedLanguage, { year: "numeric", month: "short", day: "numeric" });
  const lines: string[] = [];
  if (!progress.complete) {
    lines.push(
      progress.total === null
        ? i18n.t("pairingFull.newDeviceWords_ts_316f22979a", { value0: progress.messages })
        : i18n.t("pairingFull.newDeviceWords_ts_7b2dc373fd", { value0: Math.min(progress.messages, progress.total), value1: progress.total }),
    );
  } else if (progress.oldest !== null && progress.messages > 0) {
    lines.push(
      progress.truncated
        ? i18n.t("pairingFull.newDeviceWords_ts_01f239c1b7", { value0: date(progress.oldest) })
        : i18n.t("pairingFull.newDeviceWords_ts_2692af5bf9", { value0: date(progress.oldest) }),
    );
  }
  const lost = progress.missing + progress.refused;
  if (lost > 0) lines.push(i18n.t("pairingFull.missingBatches", { count: lost }));
  return lines;
}
