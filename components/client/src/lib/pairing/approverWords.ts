import type { HistoryProgress, PairingEndReason } from "@gryt/core";

import { type CopyI18n,englishCopy } from "../copyI18n.ts";

/* What the approving side says, kept out of the dialog so the check script can read it. */

const ended = (i18n: CopyI18n): Partial<Record<PairingEndReason, string>> => ({
  get cancelled() { return i18n.t("pairingFull.approverWords_ts_2add4b9127"); },
  get cancelled_by_other() { return i18n.t("pairingFull.approverWords_ts_3792ef81d0"); },
  get mismatch() { return i18n.t("pairingFull.approverWords_ts_ef6f723ba8"); },
  get timed_out() { return i18n.t("pairingFull.approverWords_ts_a50c1d0ab0"); },
  get expired() { return i18n.t("pairingFull.approverWords_ts_ac018cccfe"); },
  get already_claimed() { return i18n.t("pairingFull.approverWords_ts_b56c6374dc"); },
  get unknown_code() { return i18n.t("pairingFull.approverWords_ts_fcdca414ce"); },
  get wrong_relay() { return i18n.t("pairingFull.approverWords_ts_b3150ae24f"); },
  get not_pairing() { return i18n.t("pairingFull.approverWords_ts_fde627cc2c"); },
  get newer_version() { return i18n.t("pairingFull.approverWords_ts_0a91791463"); },
  get tampered() { return i18n.t("pairingFull.approverWords_ts_14193210e6"); },
  get rate_limited() { return i18n.t("pairingFull.approverWords_ts_0f4f6abfef"); },
  get relay_error() { return i18n.t("pairingFull.approverWords_ts_a771214cc9"); },
  get code_used() { return i18n.t("pairingFull.approverWords_ts_cd51ecf9a2"); },
  get code_expired() { return i18n.t("pairingFull.approverWords_ts_e342ca5a18"); },
  get required_actions() { return i18n.t("pairingFull.approverWords_ts_07022e3391"); },
  get stale_token() { return i18n.t("pairingFull.approverWords_ts_e60a53fbf1"); },
  get access_denied() { return i18n.t("pairingFull.approverWords_ts_a8451ac1cb"); },
  get expired_token() { return i18n.t("pairingFull.approverWords_ts_e342ca5a18"); },
  get "approve:network"() { return i18n.t("pairingFull.approverWords_ts_dd297ef6a1"); },
  get "approve:user_locked"() { return i18n.t("pairingFull.approverWords_ts_cd66f5d13c"); },
});

export function approverEndText(reason: PairingEndReason, i18n: CopyI18n = englishCopy): string {
  const known = ended(i18n)[reason];
  if (known) return known;
  if (reason.startsWith("approve:")) {
    return i18n.t("pairingFull.approverWords_ts_ec1dc1aaa5", { value0: reason.slice("approve:".length) });
  }
  return i18n.t("pairingFull.approverWords_ts_bf7f016246");
}

/** While the history goes across, after the new device is in every conversation. */
export function sendingHistoryText(progress: HistoryProgress | null, i18n: CopyI18n = englishCopy): string {
  if (!progress) return i18n.t("pairingFull.approverWords_ts_2adfdc7317");
  if (progress.total === null) return i18n.t("pairingFull.approverWords_ts_4a663e3685", { value0: progress.messages });
  return i18n.t("pairingFull.approverWords_ts_83ed1d5300", { value0: Math.min(progress.messages, progress.total), value1: progress.total });
}

/** Null when no history went, so the done screen says nothing about it. */
export function sentHistoryText(progress: HistoryProgress | null, i18n: CopyI18n = englishCopy): string | null {
  if (!progress || progress.messages === 0) return null;
  return i18n.t("pairingFull.historySent", { count: progress.messages });
}
