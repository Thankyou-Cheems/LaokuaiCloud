import { Button, Dialog, TextField } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import {
  getAccountProfile,
  hasMessageKeyHere,
  readSealedVault,
  resealCurrentIdentity,
  type SealedVault,
  upgradeAccountVault,
  useAccount,
  vaultHasRecoverySlot,
} from "@/common";
import { i18n, LocalizedText, useTranslation } from "@/i18n";

import {
  type MessagePasswordChoice,
  MessagePasswordSetup,
} from "../packages/settings/src/components/messagePasswordSetup";
import { AccountWordsReveal } from "../packages/settings/src/components/recoveryWords";
import {
  chooseNewPassword,
  dismissUpgradePrompt,
  shouldPromptUpgrade,
  type UpgradeCalls,
  upgradeWithPassword,
} from "./vaultUpgradeState";

const TOAST_ID = "vault-upgrade";

const calls: UpgradeCalls = {
  upgrade: upgradeAccountVault,
  reseal: resealCurrentIdentity,
  read: readSealedVault,
};

type Step = "password" | "short" | "forgot";

/**
 * Asks once, after updating, to move an old message backup to the new lock. A toast
 * rather than a dialog, so it never stands between somebody and the app (GRYT-1498).
 */
export function VaultUpgradePrompt() {
  useTranslation();
  const { isSignedIn } = useAccount();
  const [grytUserId, setGrytUserId] = useState<string | null>(null);
  const [keyIsHere, setKeyIsHere] = useState(false);
  const [vault, setVault] = useState<SealedVault | null | undefined>(undefined);
  const [answered, setAnswered] = useState(false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("password");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    void (async () => {
      try {
        const sub = (await getAccountProfile()).sub ?? null;
        if (cancelled || !sub) return;
        setGrytUserId(sub);
        setKeyIsHere(hasMessageKeyHere(sub));
        const v = await readSealedVault();
        if (!cancelled) setVault(v);
      } catch {
        // Nothing to ask about if the account can't be read. Settings says the rest.
      }
    })();
    return () => { cancelled = true; };
  }, [isSignedIn]);

  /** Any way out counts as the answer, and it is kept on this device. */
  const finish = useCallback(() => {
    if (grytUserId) dismissUpgradePrompt(grytUserId);
    toast.dismiss(TOAST_ID);
    setAnswered(true);
    setOpen(false);
    setSecret("");
  }, [grytUserId]);

  const asking = !answered && shouldPromptUpgrade({ grytUserId, keyIsHere, vault });

  useEffect(() => {
    if (!asking || open) return;
    toast(
      () => (
        <div className="flex flex-col gap-2" style={{ minWidth: 0 }}>
          <span className="text-sm font-medium">{<LocalizedText translationKey="shellFull.vaultUpgradePrompt_tsx_bebcb05d85" />}</span>
          <span className="text-xs text-gryt-muted" style={{ lineHeight: 1.5 }}>{<LocalizedText translationKey="shellFull.vaultUpgradePrompt_tsx_53d23be19b" />}</span>
          <div className="flex gap-2 justify-end">
            <Button tone="ghost" size="xsmall" onClick={finish}>{<LocalizedText translationKey="shellFull.vaultUpgradePrompt_tsx_e457149073" />}</Button>
            <Button
              size="xsmall"
              onClick={() => {
                toast.dismiss(TOAST_ID);
                setStep("password");
                setOpen(true);
              }}
            >{<LocalizedText translationKey="shellFull.vaultUpgradePrompt_tsx_a6f47e00e0" />}</Button>
          </div>
        </div>
      ),
      { id: TOAST_ID, duration: Infinity },
    );
  }, [asking, open, finish]);

  useEffect(() => () => toast.dismiss(TOAST_ID), []);

  const upgrade = useCallback(async () => {
    if (!vault) return;
    if (!secret) return void toast.error(<LocalizedText translationKey="shellFull.vaultUpgradePrompt_tsx_b3cf186213" />);
    setBusy(true);
    try {
      const next = await upgradeWithPassword(vault, secret, calls);
      if (next.kind === "short") {
        setVault(next.vault);
        setSecret("");
        setStep("short");
      } else if (next.kind === "done") {
        toast.success(<LocalizedText translationKey="shellFull.vaultUpgradePrompt_tsx_8a4a4ff907" />);
        finish();
      } else if (next.kind === "changed") {
        toast.error(<LocalizedText translationKey="shellFull.vaultUpgradePrompt_tsx_67c24d541b" />);
        finish();
      } else {
        toast.error(<LocalizedText translationKey="shellFull.vaultUpgradePrompt_tsx_9b99f50809" />);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : i18n.t("shellFull.vaultUpgradePrompt_tsx_095c618420"));
    } finally {
      setBusy(false);
    }
  }, [vault, secret, finish]);

  const choose = useCallback(async (choice: MessagePasswordChoice) => {
    if (!vault) return;
    setBusy(true);
    try {
      const outcome = await chooseNewPassword(vault, choice, calls);
      if (outcome === "resealed") {
        toast.success(<LocalizedText translationKey="shellFull.vaultUpgradePrompt_tsx_d974dd4afb" />);
        finish();
      } else if (outcome === "changed") {
        toast.error(<LocalizedText translationKey="shellFull.vaultUpgradePrompt_tsx_67c24d541b" />);
        finish();
      } else {
        toast.error(<LocalizedText translationKey="shellFull.vaultUpgradePrompt_tsx_763a791089" />);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : i18n.t("shellFull.vaultUpgradePrompt_tsx_12f3b45d67"));
    } finally {
      setBusy(false);
    }
  }, [vault, finish]);

  if (!open || !vault) return null;

  return (
    <Dialog.Root open onOpenChange={(next) => { if (!next && !busy) finish(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[36rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <Dialog.Title>{<LocalizedText translationKey="shellFull.vaultUpgradePrompt_tsx_bebcb05d85" />}</Dialog.Title>

          {step === "password" && (
            <div className="flex flex-col gap-3">
              <Dialog.Description className="mt-2">{<LocalizedText translationKey="shellFull.vaultUpgradePrompt_tsx_9c76e9059c" />}</Dialog.Description>
              <TextField
                type="password"
                label={i18n.t("shellFull.vaultUpgradePrompt_tsx_d71ea51285")}
                autoComplete="current-password"
                value={secret}
                disabled={busy}
                onChange={(e) => setSecret(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void upgrade(); }}
              />
              <div className="flex gap-2 flex-wrap">
                <Button size="small" onClick={() => void upgrade()} disabled={busy}>
                  {busy ? i18n.t("shellSecond.upgrading") : i18n.t("shellFull.vaultUpgradePrompt_tsx_a6f47e00e0")}
                </Button>
                <Button tone="neutral" size="small" onClick={finish} disabled={busy}>{<LocalizedText translationKey="shellFull.vaultUpgradePrompt_tsx_e457149073" />}</Button>
                <Button tone="ghost" size="small" onClick={() => setStep("forgot")} disabled={busy}>{<LocalizedText translationKey="shellFull.vaultUpgradePrompt_tsx_f0fbb48ad4" />}</Button>
              </div>
              <div className="flex flex-col gap-2 border-t border-gryt-border pt-3">
                <AccountWordsReveal keyIsHere label={i18n.t("shellFull.vaultUpgradePrompt_tsx_a7f35ffb59")} />
              </div>
              <span className="text-xs text-gryt-muted">{<LocalizedText translationKey="shellFull.vaultUpgradePrompt_tsx_18e4bc3b36" />}</span>
            </div>
          )}

          {step === "short" && (
            <div className="flex flex-col gap-3">
              <Dialog.Description className="mt-2">{<LocalizedText translationKey="shellFull.vaultUpgradePrompt_tsx_a8365b3940" />}</Dialog.Description>
              <MessagePasswordSetup
                submitLabel={i18n.t("shellFull.vaultUpgradePrompt_tsx_25c6fc7ca6")}
                busy={busy}
                replacesRecoveryKey={vaultHasRecoverySlot(vault)}
                onSubmit={(choice) => void choose(choice)}
                onCancel={finish}
              />
            </div>
          )}

          {step === "forgot" && (
            <div className="flex flex-col gap-3">
              <Dialog.Description className="mt-2">{<LocalizedText translationKey="shellFull.vaultUpgradePrompt_tsx_ded595d86d" />}</Dialog.Description>
              <MessagePasswordSetup
                submitLabel={i18n.t("shellFull.vaultUpgradePrompt_tsx_25c6fc7ca6")}
                busy={busy}
                replacesRecoveryKey={vaultHasRecoverySlot(vault)}
                onSubmit={(choice) => void choose(choice)}
                onCancel={() => setStep("password")}
              />
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
