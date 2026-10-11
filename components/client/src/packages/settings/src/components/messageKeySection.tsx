import { Alert, Button, TextField } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Trans } from "react-i18next";

import {
  adoptSealedIdentity,
  getAccountProfile,
  guestIdentitiesAtRisk,
  hasMessageKeyHere,
  readSealedVault,
  rememberMessageKeyHere,
  resealCurrentIdentity,
  resetMessageIdentity,
  sealCurrentIdentity,
  type SealedVault,
  vaultHasRecoverySlot,
  vaultNeedsUpgrade,
  writeSealedVault,
} from "@/common";
import { i18n, useTranslation } from "@/i18n";

import { phraseMatches } from "../../../socket/src/lib/confirmPhrase";
import { type MessagePasswordChoice, MessagePasswordSetup } from "./messagePasswordSetup";
import { AccountWordsReveal } from "./recoveryWords";

/**
 * The message password, for signed-in accounts. A second device used to publish
 * its key over the first's, which then warned about the server (GRYT-783).
 */

/**
 * Typed back before the key is replaced. Named once so the check and the label
 * cannot drift, which is how they came to disagree.
 */
const RESET_PHRASE = "start again";

// Adopting drops every server session and clears the derived keys, so sending
// breaks until a restart, not only reading. GRYT-1068.
function showAdoptedToast(lead: string): void {
  toast.success(
    () => (
      <div className="flex flex-col gap-2" style={{ minWidth: 0 }}>
        <span className="text-sm" style={{ lineHeight: 1.5 }}>{i18n.t("settingsFull.m8113949e44", { lead })}</span>
        <Button
          size="small"
          style={{ alignSelf: "flex-end" }}
          onClick={() => window.location.reload()}
        >{i18n.t("settingsFull.maf2c3d8ef2")}</Button>
      </div>
    ),
    { duration: 30000 },
  );
}

export function MessageKeySection() {
  useTranslation();
  const [vault, setVault] = useState<SealedVault | null | undefined>(undefined);
  const [open, setOpen] = useState<"set" | "use" | "forgot" | "reset" | null>(null);
  const [keyIsHere, setKeyIsHere] = useState(false);
  const [confirmReset, setConfirmReset] = useState("");
  const [resetWords, setResetWords] = useState(false);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAccountProfile()
      .then((p) => { if (!cancelled && p.sub) setKeyIsHere(hasMessageKeyHere(p.sub)); })
      .catch(() => {});
    readSealedVault()
      .then((v) => { if (!cancelled) setVault(v); })
      // Not surfaced. Failing to read this says nothing the person can act on,
      // and the section still offers to set one.
      .catch(() => { if (!cancelled) setVault(null); });
    return () => { cancelled = true; };
  }, []);

  const close = useCallback(() => {
    setOpen(null);
    setSecret("");
    setConfirmReset("");
    setResetWords(false);
  }, []);

  const save = useCallback(async ({ password, recoveryKey }: MessagePasswordChoice) => {
    setBusy(true);
    try {
      const sealed = await sealCurrentIdentity(password, recoveryKey);
      await writeSealedVault(sealed);
      // This device sealed it, so it plainly has the key. Without this the DM
      // prompt would offer to fetch a copy of what it just sent.
      const sub = await getAccountProfile().then((p) => p.sub).catch(() => null);
      if (sub) rememberMessageKeyHere(sub);
      setKeyIsHere(true);
      setVault(sealed);
      close();
      toast.success(i18n.t("settingsFull.md6d8ef107b"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : i18n.t("settingsFull.mec79231789"));
    } finally {
      setBusy(false);
    }
  }, [close]);

  /** A new password from this device's own key, for "Change it" and "Forgotten it?". */
  const reseal = useCallback(async ({ password, recoveryKey }: MessagePasswordChoice) => {
    if (!vault) return;
    setBusy(true);
    try {
      const outcome = await resealCurrentIdentity(vault, password, recoveryKey);
      setVault(await readSealedVault().catch(() => vault));
      if (outcome === "changed") {
        toast.error(i18n.t("settingsFull.m67c24d541b"));
      } else if (outcome === "restored") {
        toast.error(i18n.t("settingsFull.m763a791089"));
      } else {
        const sub = await getAccountProfile().then((p) => p.sub).catch(() => null);
        if (sub) rememberMessageKeyHere(sub);
        setKeyIsHere(true);
        close();
        toast.success(i18n.t("settingsFull.md974dd4afb"));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : i18n.t("settingsFull.mec79231789"));
    } finally {
      setBusy(false);
    }
  }, [vault, close]);

  /**
   * Take on the identity the account already has. Without it a sealed copy is
   * stored and never used, and the promise would be about nothing.
   */
  const use = useCallback(async () => {
    if (!vault) return;
    if (!secret) return toast.error(i18n.t("settingsFull.m34d4d514e8"));

    setBusy(true);
    try {
      const outcome = await adoptSealedIdentity(vault, secret);
      if (outcome === "upgraded") setVault(await readSealedVault().catch(() => vault));
      const sub = await getAccountProfile().then((p) => p.sub).catch(() => null);
      if (sub) rememberMessageKeyHere(sub);
      setKeyIsHere(true);
      close();
      showAdoptedToast(i18n.t("settingsFull.m87bcbc5db5"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : i18n.t("settingsFull.md6bdc481f8"));
    } finally {
      setBusy(false);
    }
  }, [vault, secret, close]);

  const reset = useCallback(async ({ password, recoveryKey }: MessagePasswordChoice) => {
    if (!phraseMatches(confirmReset, RESET_PHRASE)) {
      return toast.error(i18n.t("settingsFull.m3921e568b9", { value0: RESET_PHRASE }));
    }

    setBusy(true);
    try {
      const sealed = await resetMessageIdentity(password, recoveryKey);
      await writeSealedVault(sealed);
      const sub = await getAccountProfile().then((p) => p.sub).catch(() => null);
      if (sub) rememberMessageKeyHere(sub);
      setKeyIsHere(true);
      setVault(sealed);
      close();
      showAdoptedToast(i18n.t("settingsFull.ma77c076172"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : i18n.t("settingsFull.m636f3e40e3"));
    } finally {
      setBusy(false);
    }
  }, [confirmReset, close]);

  const guests = guestIdentitiesAtRisk();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="font-medium text-sm">{i18n.t("settingsFull.md71ea51285")}</span>
        <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m214311b280")}</span>
      </div>

      {vault && !open && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.me01fea89b8")}</span>
          <Button size="small" onClick={() => setOpen("use")}>{i18n.t("settingsFull.md53b3c164f")}</Button>
          <Button tone="neutral" size="small" onClick={() => setOpen("set")}>{i18n.t("settingsFull.m0b2cad8a7f")}</Button>
          <Button tone="ghost" size="small" onClick={() => setOpen(keyIsHere ? "forgot" : "reset")}>{i18n.t("settingsFull.mf0fbb48ad4")}</Button>
        </div>
      )}

      {/* Decision 5's third moment: a device that already holds the key never
          unlocks, so nothing else would ever move its old bundle forward. */}
      {vault && !open && vaultNeedsUpgrade(vault) && (
        <Alert severity="warning">{i18n.t("settingsFull.maf96734898")}</Alert>
      )}

      {keyIsHere && !open && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <span className="font-medium text-sm">{i18n.t("settingsFull.m94183cc134")}</span>
            <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.mbeeeac0f28")}</span>
          </div>
          <AccountWordsReveal keyIsHere={keyIsHere} />
        </div>
      )}

      {vault === null && !open && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m2d13293ed2")}</span>
          <Button size="small" onClick={() => setOpen("set")}>{i18n.t("settingsFull.m33d3bea662")}</Button>
        </div>
      )}

      {/* Decision 3: a device that holds the key needs no old password, so this
          comes before the reset, which loses every conversation. */}
      {open === "forgot" && vault && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="font-medium text-sm">{i18n.t("settingsFull.m1e83ae49d1")}</span>
            <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m48e8d91500")}</span>
          </div>

          <MessagePasswordSetup
            submitLabel={i18n.t("settingsFull.m25c6fc7ca6")}
            busy={busy}
            replacesRecoveryKey={vaultHasRecoverySlot(vault)}
            onSubmit={(choice) => void reseal(choice)}
            onCancel={close}
          />

          <div>
            <Button tone="ghost" size="small" onClick={() => setOpen("reset")} disabled={busy}>{i18n.t("settingsFull.m94c0c487dd")}</Button>
          </div>
        </div>
      )}

      {open === "reset" && (
        <div className="flex flex-col gap-3">
          <Alert severity="error">
            <div className="flex flex-col gap-2">
              <span>{i18n.t("settingsFull.m7aae6e23be")}</span>
              {/* Three cases, and the third is the one that matters. A count
                  of zero used to print nothing at all, so somebody whose
                  history could not be read — or who set this device up from a
                  24-word phrase, which carries no history — was told nothing
                  about the guest servers they were about to lose. */}
              {guests.certain ? (
                <span>
                  <strong>{i18n.t("settingsFull.m9f082aaa1c", { count: guests.count })}</strong>{" "}{i18n.t("settingsFull.mf688347ef9")}{" "}
                  <SaveWordsFirst keyIsHere={keyIsHere} onClick={() => setResetWords(true)} />
                </span>
              ) : (
                <span>
                  <strong>{i18n.t("settingsFull.m949456ac18")}</strong>{" "}{i18n.t("settingsFull.me9fe389231")}{" "}
                  <SaveWordsFirst keyIsHere={keyIsHere} onClick={() => setResetWords(true)} />
                </span>
              )}
            </div>
          </Alert>

          {resetWords && <AccountWordsReveal keyIsHere={keyIsHere} startAt="confirming" />}

          <MessagePasswordSetup
            submitLabel={i18n.t("settingsFull.mb6fffc5ab7")}
            tone="danger"
            busy={busy}
            onSubmit={(choice) => void reset(choice)}
            onCancel={close}
          >
            <TextField
              label={i18n.t("settingsFull.m9d890757b0", { value0: RESET_PHRASE })}
              value={confirmReset}
              onChange={(e) => setConfirmReset(e.target.value)}
            />
          </MessagePasswordSetup>
        </div>
      )}

      {open === "use" && (
        <div className="flex flex-col gap-3">
          <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m7d7adef47b")}</span>

          <TextField
            type="password"
            label={i18n.t("settingsFull.mddc04bda46")}
            autoComplete="current-password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />

          <div className="flex gap-2">
            <Button size="small" onClick={use} disabled={busy}>
              {busy ? i18n.t("settingsFull.mb1b8530bbd") : i18n.t("settingsFull.m4b20e9d734")}
            </Button>
            <Button tone="neutral" size="small" onClick={close} disabled={busy}>{i18n.t("ui.cancel")}</Button>
          </div>
        </div>
      )}

      {open === "set" && (
        <MessagePasswordSetup
          submitLabel={i18n.t("settingsFull.mefc007a393")}
          busy={busy}
          replacesRecoveryKey={!!vault && vaultHasRecoverySlot(vault)}
          onSubmit={(choice) => void (vault ? reseal(choice) : save(choice))}
          onCancel={close}
        />
      )}
    </div>
  );
}

/** The reset warning's advice, as a link where this device can actually show the words. */
function SaveWordsFirst({ keyIsHere, onClick }: { keyIsHere: boolean; onClick(): void }) {
  useTranslation();
  if (!keyIsHere) return <><Trans i18n={i18n} i18nKey="settingsFull.m237aeb7b8c" components={{ words: <button type="button" className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-inherit underline" onClick={onClick} /> }} /></>;
  return (
    <><Trans i18n={i18n} i18nKey="settingsFull.m237aeb7b8c" components={{ words: <button type="button" className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-inherit underline" onClick={onClick} /> }} /></>
  );
}
