import { Alert, Button, Checkbox, TextField } from "@gryt/ui";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import toast from "react-hot-toast";

import {
  describePasswordProblem,
  formatRecoveryKey,
  generateRecoveryKey,
  generateVaultPassword,
} from "@/common";
import { i18n, useTranslation } from "@/i18n";

import { settingsPasswordProblem } from "./settingsMessage";

/**
 * Choosing the message password, with the warning decision 2 of the design asks for at
 * this moment. Six words by default, a recovery key offered and skippable (GRYT-1473).
 */
export interface MessagePasswordChoice {
  password: string;
  recoveryKey?: Uint8Array;
}

interface Props {
  submitLabel: string;
  busy: boolean;
  /** Said when a recovery key already exists, because sealing again replaces it. */
  replacesRecoveryKey?: boolean;
  /** Anything the caller needs above the password, like the reset's typed phrase. */
  children?: ReactNode;
  tone?: "danger";
  onSubmit(choice: MessagePasswordChoice): void;
  onCancel(): void;
}

const copy = (text: string, what: string) =>
  navigator.clipboard.writeText(text).then(
    () => toast.success(i18n.t("settingsFull.mf1e9fed570", { value0: what })),
    () => toast.error(i18n.t("settingsFull.m1bc6aed2ef")),
  );

export function MessagePasswordSetup({
  submitLabel,
  busy,
  replacesRecoveryKey,
  children,
  tone,
  onSubmit,
  onCancel,
}: Props) {
  useTranslation();
  const [words, setWords] = useState(() => generateVaultPassword());
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [again, setAgain] = useState("");
  const recoveryKey = useMemo(() => generateRecoveryKey(), []);
  const [skipRecovery, setSkipRecovery] = useState(false);
  const [saved, setSaved] = useState(false);

  const submit = useCallback(() => {
    let password = words;
    if (typing) {
      const problem = describePasswordProblem(typed);
      if (problem) return void toast.error(settingsPasswordProblem(problem));
      if (typed !== again) return void toast.error(i18n.t("settingsFull.md624e5037b"));
      password = typed;
    }
    if (!saved) return void toast.error(i18n.t("settingsFull.m9ad125abc9"));
    onSubmit({ password, recoveryKey: skipRecovery ? undefined : recoveryKey });
  }, [words, typing, typed, again, saved, skipRecovery, recoveryKey, onSubmit]);

  const shownKey = formatRecoveryKey(recoveryKey);
  const mono = { fontFamily: "var(--gryt-font-mono, monospace)", userSelect: "all" as const };

  return (
    <div className="flex flex-col gap-3">
      <Alert severity="warning">{i18n.t("settingsFull.ma1f28abc16")}</Alert>

      {children}

      {!typing ? (
        <div className="flex flex-col gap-2">
          <span className="font-medium text-sm">{i18n.t("settingsFull.m46f1aa41da")}</span>
          <code className="text-sm" style={mono} data-testid="message-password-words">
            {words}
          </code>
          <div className="flex gap-2 flex-wrap">
            <Button size="small" tone="neutral" onClick={() => void copy(words, i18n.t("settingsFull.m8be3c943b1"))}>{i18n.t("settingsFull.maf74f7c536")}</Button>
            <Button size="small" tone="neutral" onClick={() => setWords(generateVaultPassword())}>{i18n.t("settingsFull.m2748136064")}</Button>
            <Button size="small" tone="ghost" onClick={() => setTyping(true)}>{i18n.t("settingsFull.m7d9e1d81ab")}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <TextField
            type="password"
            label={i18n.t("settingsFull.md71ea51285")}
            autoComplete="new-password"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            helperText={i18n.t("settingsFull.mda6ad279f9")}
          />
          <TextField
            type="password"
            label={i18n.t("settingsFull.mfcd7610540")}
            autoComplete="new-password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
          <div>
            <Button size="small" tone="ghost" onClick={() => setTyping(false)}>{i18n.t("settingsFull.me995f16a6f")}</Button>
          </div>
        </div>
      )}

      {!skipRecovery ? (
        <div className="flex flex-col gap-2">
          <span className="font-medium text-sm">{i18n.t("ui.recoveryKey")}</span>
          <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m6acbb063b6")}</span>
          <code className="text-sm" style={mono} data-testid="message-recovery-key">
            {shownKey}
          </code>
          <div className="flex gap-2 flex-wrap">
            <Button size="small" tone="neutral" onClick={() => void copy(shownKey, i18n.t("ui.recoveryKey"))}>{i18n.t("settingsFull.maf74f7c536")}</Button>
            <Button size="small" tone="ghost" onClick={() => setSkipRecovery(true)}>{i18n.t("settingsFull.m57c63f49ea")}</Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m70f5715e56")}</span>
          <Button size="small" tone="ghost" onClick={() => setSkipRecovery(false)}>{i18n.t("settingsFull.mfca03576f8")}</Button>
        </div>
      )}

      {replacesRecoveryKey && (
        <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m143b82e8e6")}</span>
      )}

      <span className="text-xs text-gryt-muted">{i18n.t(skipRecovery ? "shellSecond.storePassword" : "shellSecond.storePasswordAndRecovery")}
      </span>

      <label className="flex cursor-pointer items-start gap-2 text-xs">
        <Checkbox checked={saved} onCheckedChange={(v) => setSaved(v === true)} />
        <span>
          {skipRecovery
            ? i18n.t("settingsFull.m93c1185eee")
            : i18n.t("settingsFull.m6d953135ea")}
        </span>
      </label>

      <div className="flex gap-2">
        <Button size="small" tone={tone} onClick={submit} disabled={busy}>
          {busy ? i18n.t("settingsFull.m13b7bfcac4") : submitLabel}
        </Button>
        <Button tone="neutral" size="small" onClick={onCancel} disabled={busy}>{i18n.t("ui.cancel")}</Button>
      </div>
    </div>
  );
}
