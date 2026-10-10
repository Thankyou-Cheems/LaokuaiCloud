import { Alert, Button } from "@gryt/ui";
import { type ReactNode, useCallback, useState } from "react";
import toast from "react-hot-toast";

import { getIdentityWords } from "@/common";
import { i18n, useTranslation } from "@/i18n";

import { PiCopySimple, PiEyeFill, PiWarningFill } from "../../../../lib/icons";
import { HIDDEN, nextWordsView, type WordsAction, type WordsView } from "./recoveryWordsStep";

/** The 24 words on screen with a copy button. The guest section and the account one share it. */
export function RecoveryWordsPanel({
  words,
  note,
  copyLabel,
  onHide,
}: {
  words: string;
  note: ReactNode;
  copyLabel: string;
  onHide(): void;
}) {
  useTranslation();
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-gryt-border p-4">
      <span className="text-xs text-gryt-muted">{note}</span>
      <code className="select-all break-words rounded-md bg-gryt-surface-raised p-3 font-mono text-sm leading-relaxed text-gryt-text">
        {words}
      </code>
      <div className="flex gap-2 flex-wrap">
        <Button
          tone="neutral"
          size="small"
          onClick={() => {
            navigator.clipboard
              .writeText(words)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2500);
              })
              .catch(() => toast.error(i18n.t("settingsFull.m4dfbe46077")));
          }}
        >
          <PiCopySimple size={16} />
          <span aria-live="polite">{copied ? i18n.t("settingsFull.m8e3df45a49") : copyLabel}</span>
        </Button>
        <Button tone="neutral" size="small" onClick={onHide}>{i18n.t("settingsFull.m34d8b60fe2")}</Button>
      </div>
    </div>
  );
}

/**
 * "Show my 24 words" for a signed-in account, behind a confirmation. Renders nothing
 * unless this device holds the message key: the words are that key.
 */
export function AccountWordsReveal({
  keyIsHere,
  startAt = "hidden",
  label = i18n.t("settingsFull.m1bb042aee4"),
}: {
  keyIsHere: boolean;
  startAt?: "hidden" | "confirming";
  label?: string;
}) {
  useTranslation();
  const [view, setView] = useState<WordsView>(startAt === "confirming" ? { step: "confirming" } : HIDDEN);
  const [busy, setBusy] = useState(false);

  const act = useCallback(
    async (action: WordsAction) => {
      setBusy(true);
      try {
        setView(await nextWordsView(view, action, { keyIsHere, readWords: getIdentityWords }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : i18n.t("settingsFull.m6b77f51d53"));
      } finally {
        setBusy(false);
      }
    },
    [view, keyIsHere],
  );

  if (!keyIsHere) return null;

  if (view.step === "shown") {
    return (
      <RecoveryWordsPanel
        words={view.words}
        copyLabel={i18n.t("settingsFull.m1e5945e246")}
        onHide={() => void act("hide")}
        note={
          <>{i18n.t("settingsFull.mf2022c10f1")}</>
        }
      />
    );
  }

  if (view.step === "confirming") {
    return (
      <div className="flex flex-col gap-3">
        <Alert severity="warning">
          <span className="inline-flex items-start gap-2">
            <PiWarningFill className="mt-0.5 shrink-0" size={15} />{i18n.t("settingsFull.mf9cc988186")}</span>
        </Alert>
        <div className="flex gap-2">
          <Button size="small" disabled={busy} onClick={() => void act("confirm")}>{i18n.t("settingsFull.mbaa5b3ad9a")}</Button>
          <Button tone="neutral" size="small" disabled={busy} onClick={() => void act("hide")}>{i18n.t("ui.cancel")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Button tone="neutral" size="small" disabled={busy} onClick={() => void act("show")}>
        <PiEyeFill size={16} />
        {label}
      </Button>
    </div>
  );
}
