import { Checkbox, TextField } from "@gryt/ui";
import { useEffect, useState } from "react";
import { Trans } from "react-i18next";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Reporting a person, as opposed to one thing they said: nothing is attached, so
 * the reason is required. **Blocking is offered here, and defaults to on.**
 */
export const REPORT_REASON_MAX = 1000;

export function ReportUserDialog({
  target,
  onClose,
  onSubmit,
  isBlocked,
}: {
  /** Who is being reported, or null when the dialog is closed. */
  target: { serverUserId: string; nickname: string } | null;
  onClose: () => void;
  onSubmit: (args: { serverUserId: string; reason: string; alsoBlock: boolean }) => void;
  /** Already blocked, in which case the offer is left out rather than shown ticked. */
  isBlocked: (serverUserId: string) => boolean;
}) {
  useSocketTranslation();
  const [reason, setReason] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);

  /* Cleared when it opens rather than when it closes, so a reason half typed is
     still there if the dialog is dismissed by accident. */
  useEffect(() => {
    if (target) {
      setReason("");
      setAlsoBlock(!isBlocked(target.serverUserId));
    }
  }, [target, isBlocked]);

  const trimmed = reason.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= REPORT_REASON_MAX;
  const alreadyBlocked = target ? isBlocked(target.serverUserId) : false;

  return (
    <ConfirmDialog
      open={!!target}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={socketI18n.t("socketFull.reportUserDialog_a1feb26ead", { p0: (target?.nickname) })}
      description={
        <><Trans i18n={socketI18n} i18nKey="socketFull.userReportDisclosure" values={{ name: target?.nickname ?? "" }} /></>
      }
      confirmLabel={socketI18n.t("socketFull.reportUserDialog_654eb38dad")}
      confirmTone="primary"
      confirmDisabled={!canSubmit}
      onConfirm={() => {
        if (!target || !canSubmit) return;
        onSubmit({
          serverUserId: target.serverUserId,
          reason: trimmed,
          alsoBlock: alsoBlock && !alreadyBlocked,
        });
        onClose();
      }}
    >
      <div className="flex flex-col gap-1">
        <span className="text-xs">{socketI18n.t("socketFull.reportUserDialog_99f12f84be")}</span>
        <TextField
          multiline
          minRows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={socketI18n.t("socketFull.reportUserDialog_d972becffa")}
          maxLength={REPORT_REASON_MAX}
        />
        <span className="text-xs text-gryt-muted">
          {trimmed.length}/{REPORT_REASON_MAX}
        </span>
      </div>

      {!alreadyBlocked && (
        <label className="text-sm" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Checkbox
            checked={alsoBlock}
            onCheckedChange={(v) => setAlsoBlock(v === true)}
          />{socketI18n.t("socketFull.reportUserDialog_9d63a1513b")}</label>
      )}
    </ConfirmDialog>
  );
}
