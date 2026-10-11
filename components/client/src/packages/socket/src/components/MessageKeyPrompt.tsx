import { Button, TextField } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import {
  adoptSealedIdentity,
  getAccountProfile,
  hasMessageKeyHere,
  readSealedVault,
  rememberMessageKeyHere,
  sealCurrentIdentity,
  type SealedVault,
  shouldOfferMessageKey,
  writeSealedVault,
} from "@/common";
import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { PiKey } from "../../../../lib/icons";
import {
  type MessagePasswordChoice,
  MessagePasswordSetup,
} from "../../../settings/src/components/messagePasswordSetup";

/**
 * The message key, above a direct message. Either taking the account's copy, or
 * making one on an account that has none (GRYT-783, GRYT-1130).
 */
export function MessageKeyPrompt() {
  useSocketTranslation();
  const [grytUserId, setGrytUserId] = useState<string | null>(null);
  const [vault, setVault] = useState<SealedVault | null | undefined>(undefined);
  const [keyIsHere, setKeyIsHere] = useState(true);
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Who is signed in, and whether they have a sealed copy. Both from the
    // account, so this can be dropped in wherever a DM is drawn.
    void (async () => {
      let sub: string | null = null;
      try {
        sub = (await getAccountProfile()).sub ?? null;
      } catch {
        // Not signed in. A guest has the 24 words and is never offered this.
      }
      if (cancelled) return;
      setGrytUserId(sub);
      if (!sub) {
        setVault(null);
        return;
      }

      setKeyIsHere(hasMessageKeyHere(sub));
      try {
        const v = await readSealedVault();
        if (!cancelled) setVault(v);
      } catch {
        // Treated as "nothing to offer". A network hiccup should not put a
        // password prompt in front of somebody mid-conversation.
        if (!cancelled) setVault(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const unlock = useCallback(async (choice?: MessagePasswordChoice) => {
    if (!grytUserId) return;
    if (vault && !secret) return toast.error(socketI18n.t("settingsFull.m34d4d514e8"));

    setBusy(true);
    try {
      if (vault) {
        await adoptSealedIdentity(vault, secret);
        toast.success(socketI18n.t("socketFull.messageKeyPrompt_28fcfc2073"));
      } else if (choice) {
        const sealed = await sealCurrentIdentity(choice.password, choice.recoveryKey);
        await writeSealedVault(sealed);
        setVault(sealed);
        toast.success(socketI18n.t("socketFull.messageKeyPrompt_91a33e19aa"));
      } else {
        return;
      }
      rememberMessageKeyHere(grytUserId);
      setKeyIsHere(true);
      setOpen(false);
      setSecret("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : socketI18n.t("settingsFull.md6bdc481f8"));
    } finally {
      setBusy(false);
    }
  }, [vault, secret, grytUserId]);

  const offer = shouldOfferMessageKey({
    signedIn: grytUserId !== null,
    vaultExists: vault === undefined ? null : vault !== null,
    keyIsHere,
  });
  if (!offer || dismissed) return null;

  return (
    <div
      className="flex flex-col gap-2"
      style={{
        marginBottom: "12px",
        padding: "10px 12px",
        borderRadius: "var(--gryt-radius-md)",
        border: "1px solid var(--gryt-neutral-6)",
        background: "var(--gryt-surface-raised)",
      }}
    >
      <div className="flex items-start gap-2">
        <PiKey aria-hidden="true" size={14} style={{ color: "var(--gryt-accent)", flexShrink: 0, marginTop: "2px" }} />
        <p className="m-0 text-xs" style={{ color: "var(--gryt-neutral-11)", lineHeight: 1.5 }}>
          {offer === "adopt" ? (
            <>{socketI18n.t("socketFull.messageKeyPrompt_cac94a2820")}</>
          ) : (
            <>{socketI18n.t("socketFull.messageKeyPrompt_9b4b2f2b4a")}</>
          )}
        </p>
      </div>

      {!open ? (
        <div className="flex gap-2">
          <Button size="xsmall" onClick={() => setOpen(true)}>
            {offer === "adopt" ? socketI18n.t("socketFull.messageKeyPrompt_53d5938d05") : socketI18n.t("socketFull.messageKeyPrompt_00ea657a23")}
          </Button>
          {/* For the session only. Not persisted: it is still true tomorrow,
              and quietly agreeing never to mention it again is how somebody
              ends up with two halves of their history and no explanation. */}
          <Button tone="ghost" size="xsmall" onClick={() => setDismissed(true)}>{socketI18n.t("terms.notNow")}</Button>
        </div>
      ) : offer === "protect" ? (
        <MessagePasswordSetup
          submitLabel={socketI18n.t("settingsFull.mefc007a393")}
          busy={busy}
          onSubmit={(choice) => void unlock(choice)}
          onCancel={() => setOpen(false)}
        />
      ) : (
        <div className="flex items-end gap-2 flex-wrap">
          <TextField
            type="password"
            size="small"
            label={socketI18n.t("settingsFull.mddc04bda46")}
            autoComplete="current-password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <Button size="small" onClick={() => void unlock()} disabled={busy}>
            {busy ? socketI18n.t("settingsFull.m13b7bfcac4") : socketI18n.t("socketFull.messageKeyPrompt_29fa3bf27a")}
          </Button>
          <Button tone="ghost" size="small" onClick={() => { setOpen(false); setSecret(""); }} disabled={busy}>{socketI18n.t("ui.cancel")}</Button>
        </div>
      )}
    </div>
  );
}
