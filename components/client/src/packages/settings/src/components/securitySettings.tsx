import { Button, Chip, IconButton, Spinner, Switch, TextField, Tooltip } from "@gryt/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import type { KeycloakCredential } from "@/common";
import {
  deleteCredential,
  fetchCredentials,
  getAccessTokenStorageMode,
  migrateAccessTokensToMode,
  openLocalArchive,
  startPasskeySetup,
  updateCredentialLabel,
  useAccount,
  useLocalArchive,
} from "@/common";
import { i18n, useTranslation } from "@/i18n";

import { PiCheck, PiKeyFill, PiPencilSimpleFill, PiPlus, PiTrashFill, PiX } from "../../../../lib/icons";
import { useApproveDevice } from "../../../../lib/pairing/useApproveDevice";
import { ConfirmDialog } from "../../../socket/src/components/ConfirmDialog";
import { dmKeyWarningsOff, setDmKeyWarningsOff } from "../../../socket/src/components/dmKeyWarningToast";
import { LocalHistoryProblem } from "../../../socket/src/components/LocalHistoryProblem";
import { LocalIdentitySection } from "./localIdentitySection";
import { MessageKeySection } from "./messageKeySection";
import { OwnDevicesSection } from "./ownDevicesSection";
import { SettingGroup, SettingsContainer } from "./settingsComponents";
import { settingsMessage } from "./settingsMessage";

const PASSKEY_TYPE = "webauthn-passwordless";

function formatDate(epoch: number): string {
  return new Date(epoch).toLocaleDateString(i18n.resolvedLanguage, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface PasskeyRowProps {
  credential: KeycloakCredential;
  onDelete: (id: string) => void;
  onRename: (id: string, label: string) => void;
  deleting: boolean;
}

function PasskeyRow({ credential, onDelete, onRename, deleting }: PasskeyRowProps) {
  useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(credential.userLabel);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const handleSave = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || trimmed === credential.userLabel) {
      setEditing(false);
      setDraft(credential.userLabel);
      return;
    }
    setSaving(true);
    try {
      onRename(credential.id, trimmed);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }, [draft, credential.userLabel, credential.id, onRename]);

  return (
    <div className="flex items-center gap-3 py-3 px-3" style={{
        borderRadius: "var(--gryt-radius-sm)",
        background: "var(--gryt-neutral-a2)",
      }}>
      <div className="flex items-center justify-center" style={{
          width: 36,
          height: 36,
          borderRadius: "var(--gryt-radius-sm)",
          background: "var(--gryt-accent-a3)",
          flexShrink: 0,
        }}>
        <PiKeyFill size={18} style={{ color: "var(--gryt-accent-11)" }} />
      </div>

      <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <div className="flex items-center gap-1">
            <TextField
              ref={inputRef} size="small"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") {
                  setEditing(false);
                  setDraft(credential.userLabel);
                }
              }}
              disabled={saving}
              style={{ flex: 1 }}
            />
            <IconButton size="xsmall" onClick={handleSave} disabled={saving}>
              <PiCheck size={14} />
            </IconButton>
            <IconButton size="xsmall"
              onClick={() => {
                setEditing(false);
                setDraft(credential.userLabel);
              }}
            >
              <PiX size={14} />
            </IconButton>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {credential.userLabel || i18n.t("settingsFull.md2cc549891")}
            </span>
            <Tooltip title={i18n.t("settingsFull.md3f4cb898f")}>
              <IconButton tone="ghost" size="xsmall"
                onClick={() => setEditing(true)}
              >
                <PiPencilSimpleFill size={12} />
              </IconButton>
            </Tooltip>
          </div>
        )}
        <span className="text-xs">{i18n.t("settingsFull.m32aaf86ba0", { date: formatDate(credential.createdDate) })}</span>
      </div>

      <Tooltip title={i18n.t("settingsFull.m988b1b7eef")}>
        <IconButton tone="ghost" size="xsmall"
          disabled={deleting}
          onClick={() => setConfirmDelete(true)}
        >
          <PiTrashFill size={16} />
        </IconButton>
      </Tooltip>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={i18n.t("settingsFull.m695a4e6909")}
        description={i18n.t("settingsFull.me17309d734")}
        confirmLabel={i18n.t("ui.remove")}
        onConfirm={() => onDelete(credential.id)}
      />
    </div>
  );
}

function LocalHistorySection() {
  useTranslation();
  const { status } = useLocalArchive();

  useEffect(() => {
    // Opening is how the problem is found. A failure shows below, so nothing to catch here.
    openLocalArchive().catch(() => undefined);
  }, []);

  const line =
    status.kind === "open"
      ? status.home === "browser"
        ? i18n.t("settingsFull.mdbe715eb07")
        : status.sealed
          ? i18n.t("settingsFull.mdf39c0c626")
          : i18n.t("settingsFull.m90007368c7")
      : status.kind === "failed"
        ? null
        : i18n.t("settingsFull.mb1b8530bbd");

  return (
    <SettingGroup
      anchorId="message-history-on-this-device"
      title={i18n.t("settingsFull.m8f62b57803")}
      description={i18n.t("settingsFull.ma4b874ec76")}
    >
      {line && <span className="text-sm">{line}</span>}
      <LocalHistoryProblem />
    </SettingGroup>
  );
}

export function SecuritySettings() {
  useTranslation();
  const [keyWarnings, setKeyWarnings] = useState(() => !dmKeyWarningsOff());
  const { isSignedIn } = useAccount();
  const { open: openApproveDevice } = useApproveDevice();
  const [credentials, setCredentials] = useState<KeycloakCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [persistTokens, setPersistTokens] = useState(true);

  useEffect(() => {
    setPersistTokens(getAccessTokenStorageMode() === "local");
  }, []);

  const loadCredentials = useCallback(async () => {
    try {
      const all = await fetchCredentials();
      setCredentials(all.filter((c) => c.type === PASSKEY_TYPE));
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "settingsFull.m8178412008";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Passkeys are a Keycloak credential, so without an account there is nothing
    // to fetch. Somebody without one saw a section that could only say "Retry".
    if (!isSignedIn) {
      setLoading(false);
      return;
    }
    loadCredentials();
  }, [isSignedIn, loadCredentials]);

  const handleAdd = useCallback(async () => {
    setAdding(true);
    try {
      await startPasskeySetup();
      await loadCredentials();
      toast.success(i18n.t("settingsFull.m8670ad0f8e"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "settingsFull.ma849b77933";
      toast.error(settingsMessage(msg));
    } finally {
      setAdding(false);
    }
  }, [loadCredentials]);

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        await deleteCredential(id);
        setCredentials((prev) => prev.filter((c) => c.id !== id));
        toast.success(i18n.t("settingsFull.ma3776d1a91"));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "settingsFull.mf3fbb56017";
        toast.error(settingsMessage(msg));
      } finally {
        setDeletingId(null);
      }
    },
    [],
  );

  const handleRename = useCallback(
    async (id: string, label: string) => {
      try {
        await updateCredentialLabel(id, label);
        setCredentials((prev) =>
          prev.map((c) => (c.id === id ? { ...c, userLabel: label } : c)),
        );
        toast.success(i18n.t("settingsFull.m82d32bdebf"));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "settingsFull.m1ec36b1759";
        toast.error(settingsMessage(msg));
      }
    },
    [],
  );

  return (
    <SettingsContainer>
      <h2 className="text-lg">{i18n.t("ui.security")}</h2>

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-sm">{i18n.t("settingsFull.m377ef34f56")}</span>
          <span className="text-xs">{i18n.t("settingsFull.m2fb093bdc8")}</span>
        </div>
        <Button size="small" style={{ alignSelf: "flex-start" }} onClick={openApproveDevice}>{i18n.t("settingsFull.me716356061")}</Button>
      </div>

      {!isSignedIn && <LocalIdentitySection />}

      {!isSignedIn ? null : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <span className="font-medium text-sm">{i18n.t("settingsFull.ma9698bfd64")}</span>
            <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m901a41e8f6")}</span>
          </div>

          <MessageKeySection />

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <span className="font-medium text-sm">{i18n.t("settingsFull.mcaab7827ab")}</span>
                <span className="text-xs">{i18n.t("settingsFull.mcabb37d097")}</span>
              </div>
              <Chip tone="neutral">{credentials.length}</Chip>
            </div>

            {loading && (
              <div className="flex items-center justify-center py-8">
                <Spinner size={24} />
              </div>
            )}

            {error && (
              <div className="flex flex-col items-center gap-2 py-4">
                <span className="text-sm">{settingsMessage(error)}</span>
                <Button size="xsmall" onClick={loadCredentials}>{i18n.t("ui.retry")}</Button>
              </div>
            )}

            {!loading && !error && credentials.length === 0 && (
              <div
                className="flex flex-col items-center gap-2 py-8"
                style={{
                  borderRadius: "var(--gryt-radius-sm)",
                  border: "1px dashed var(--gryt-neutral-a6)",
                }}
              >
                <PiKeyFill
                  size={32}
                  style={{ color: "var(--gryt-neutral-a8)" }}
                />
                <span className="text-sm">{i18n.t("settingsFull.m32a1d5f5b5")}</span>
              </div>
            )}

            {!loading &&
              !error &&
              credentials.map((cred) => (
                <PasskeyRow
                  key={cred.id}
                  credential={cred}
                  onDelete={handleDelete}
                  onRename={handleRename}
                  deleting={deletingId === cred.id}
                />
              ))}

            <Button
              size="small"
              onClick={handleAdd}
              disabled={adding}
              style={{ alignSelf: "flex-start" }}
            >
              <PiPlus size={16} />
              {adding ? i18n.t("settingsFull.ma7e1d420ae") : i18n.t("settingsFull.m24819ce814")}
            </Button>
          </div>
        </div>
      )}

      <LocalHistorySection />

      <OwnDevicesSection />

      <SettingGroup
        anchorId="message-key-warnings"
        title={i18n.t("settingsFull.m43097240bb")}
        description={i18n.t("settingsFull.m6e161a46a4")}
      >
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <Switch
            checked={keyWarnings}
            onCheckedChange={(on) => {
              setKeyWarnings(on);
              setDmKeyWarningsOff(!on);
            }}
          />{i18n.t("settingsFull.m65c3992e3a")}</label>
      </SettingGroup>

      <SettingGroup
        anchorId="persist-server-access-tokens"
        title={i18n.t("settingsFull.m532c2bfc5b")}
        description={i18n.t("settingsFull.mbedb3f74e9")}
      >
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <Switch
            checked={persistTokens}
            onCheckedChange={(enabled) => {
              setPersistTokens(enabled);
              migrateAccessTokensToMode(enabled ? "local" : "session");
            }}
          />{i18n.t("settingsFull.me6ffb406cd")}</label>
      </SettingGroup>
    </SettingsContainer>
  );
}
