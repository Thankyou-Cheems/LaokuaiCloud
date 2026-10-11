import { Button } from "@gryt/ui";
import { useState } from "react";
import toast from "react-hot-toast";

import { clearLocalArchive, openLocalArchive, useLocalArchive } from "@/common";
import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { isElectron } from "../../../../lib/electron";
import { PiWarningFill } from "../../../../lib/icons";
import {
  CLEAR_CONFIRM_TEXT,
  CLEAR_CONFIRM_TITLE,
  CLEAR_LOCAL_HISTORY,
  localHistoryProblemText,
} from "../mls/localHistoryCopy";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Shown while the archive won't open: in a DM above the composer, and in Settings.
 * Try again never deletes anything; only the confirmed clear does.
 */
export function LocalHistoryProblem({ compact = false }: { compact?: boolean }) {
  useSocketTranslation();
  const { status } = useLocalArchive();
  const [busy, setBusy] = useState<"retry" | "clear" | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (status.kind !== "failed") return null;
  const where = isElectron() ? socketI18n.t("socketFull.localHistoryProblem_8bf7aa1c53") : socketI18n.t("socketFull.localHistoryProblem_6a25e70584");
  const canRetry = status.code === "unseal-failed" || status.code === null;

  const retry = () => {
    setBusy("retry");
    openLocalArchive()
      .then(() => toast.success(socketI18n.t("socketFull.localHistoryProblem_5cef9e7c50")))
      .catch(() => undefined)
      .finally(() => setBusy(null));
  };

  const clear = () => {
    setBusy("clear");
    clearLocalArchive()
      .then(() => toast.success(socketI18n.t("socketFull.localHistoryProblem_6dcc577a98")))
      .catch((e: unknown) => {
        console.warn("[Archive] Clearing failed:", e);
        toast.error(socketI18n.t("socketFull.localHistoryProblem_7980859039"));
      })
      .finally(() => setBusy(null));
  };

  return (
    <div
      role="alert"
      className={compact ? "mb-1.5 flex flex-col gap-1.5 px-1 text-xs leading-snug" : "flex flex-col gap-2 text-sm"}
      style={{ color: "var(--gryt-neutral-11)" }}
    >
      <div className="flex items-start gap-1.5">
        <PiWarningFill aria-hidden="true" size={compact ? 13 : 15} style={{ flexShrink: 0, marginTop: "1px", color: "var(--gryt-warning-11)" }} />
        <span>
          {[localHistoryProblemText(status.code, where), compact && socketI18n.t("socketFull.localHistoryProblem_a3d3383dd4"), socketI18n.t("socketFull.localHistoryProblem_1a6271a501")]
            .filter(Boolean)
            .join(" ")}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {canRetry && (
          <Button size="xsmall" tone="neutral" disabled={busy !== null} onClick={retry}>
            {busy === "retry" ? socketI18n.t("socketFull.localHistoryProblem_0e23ebd58f") : socketI18n.t("ui.tryAgain")}
          </Button>
        )}
        <Button size="xsmall" tone="danger" disabled={busy !== null} onClick={() => setConfirming(true)}>
          {busy === "clear" ? socketI18n.t("socketFull.localHistoryProblem_a99c7b96bc") : socketI18n.t(CLEAR_LOCAL_HISTORY)}
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={socketI18n.t(CLEAR_CONFIRM_TITLE)}
        description={socketI18n.t(CLEAR_CONFIRM_TEXT)}
        confirmLabel={socketI18n.t("socketFull.localHistoryProblem_d07e4e1e32")}
        focusCancel
        onConfirm={clear}
      />
    </div>
  );
}
