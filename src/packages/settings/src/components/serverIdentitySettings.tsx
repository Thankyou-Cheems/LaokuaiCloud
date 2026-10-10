import { Alert, Button, Chip, IconButton, Tooltip } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import type { BlockedServer, ServerPin } from "@/common";
import { forgetPin, listBlocked, listHostExpectations, listPins, unblockServer } from "@/common";
import { i18n, useTranslation } from "@/i18n";

import { PiHardDrivesFill, PiShieldCheckFill, PiTrashFill, PiWarningFill } from "../../../../lib/icons";
import { ConfirmDialog } from "../../../socket/src/components/ConfirmDialog";
import { SettingsContainer } from "./settingsComponents";

function formatDate(epoch: number): string {
  return new Date(epoch).toLocaleDateString(i18n.resolvedLanguage, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Key ids are 43 characters of base64url, which nobody reads. Grouping them the
 * way SSH does makes two of them comparable at a glance.
 */
function Fingerprint({ value }: { value: string }) {
  useTranslation();
  const grouped = (value.match(/.{1,8}/g) || [value]).join(" ");
  return (
    <Tooltip title={i18n.t("settingsFull.m8ef07790d3")}>
      <code className="font-mono text-xs text-gryt-muted"
        style={{ cursor: "pointer", wordBreak: "break-all" }}
        onClick={() => {
          navigator.clipboard?.writeText(value).then(
            () => toast.success(i18n.t("settingsFull.macb67f395d")),
            () => toast.error(i18n.t("settingsFull.m4dfbe46077")),
          );
        }}
      >
        {grouped}
      </code>
    </Tooltip>
  );
}

function BlockedRow({
  entry,
  firstPinnedAt,
  onUnblock,
}: {
  entry: BlockedServer;
  firstPinnedAt?: number;
  onUnblock: (entry: BlockedServer) => void;
}) {
  useTranslation();
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="flex flex-col gap-3 p-3" style={{ borderRadius: "var(--gryt-radius-sm)", background: "color-mix(in oklab, var(--gryt-danger-9) 5%, transparent)" }}>
      <div className="flex items-center gap-2">
        <PiWarningFill size={18} style={{ color: "var(--gryt-danger-11)", flexShrink: 0 }} />
        <span className="text-sm font-medium truncate" style={{ flex: 1, minWidth: 0 }}>
          {entry.host}
        </span>
        <Chip tone="danger">{i18n.t("settingsFull.m5dd0f07770", { date: formatDate(entry.blockedAt) })}</Chip>
      </div>

      <span className="text-xs text-gryt-muted">
        {entry.reason === "key_mismatch"
          ? i18n.t("settingsFull.m4824e72af3")
          : i18n.t("settingsFull.m625c81f33d")}
      </span>

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gryt-muted">{firstPinnedAt ? i18n.t("settingsFull.m7ac7d822e1", { date: formatDate(firstPinnedAt) }) : i18n.t("settingsFull.m6ac87f3446")}</span>
          <Fingerprint value={entry.expectedKeyId} />
        </div>

        {entry.keyId ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m045682060d")}</span>
            <Fingerprint value={entry.keyId} />
          </div>
        ) : (
          <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.meceb13be23")}</span>
        )}
      </div>

      {/* The whole point of blocking is that someone makes an informed choice
          here. Telling them where to find the real answer beats asking them to
          guess from two strings. */}
      <Alert severity="info">
          {entry.keyId
            ? i18n.t("settingsFull.m2079cd604e")
            : i18n.t("settingsFull.m73ffb7326c")}
        </Alert>

      <Button tone="danger" size="xsmall"
        style={{ alignSelf: "flex-start" }}
        onClick={() => setConfirm(true)}
      >{i18n.t("settingsFull.m12aabd251c")}</Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={i18n.t("settingsFull.m444e1678aa", { value0: entry.host })}
        description={i18n.t("settingsFull.mf81354f36c")}
        confirmLabel={i18n.t("settingsFull.m12aabd251c")}
        onConfirm={() => onUnblock(entry)}
      />
    </div>
  );
}

function KnownRow({ pin, onForget }: { pin: ServerPin; onForget: (keyId: string) => void }) {
  useTranslation();
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="flex items-center gap-3 py-3 px-3" style={{ borderRadius: "var(--gryt-radius-sm)", background: "var(--gryt-neutral-a2)" }}>
      <div className="flex items-center justify-center" style={{
          width: 36,
          height: 36,
          borderRadius: "var(--gryt-radius-sm)",
          background: "var(--gryt-accent-a3)",
          flexShrink: 0,
        }}>
        <PiShieldCheckFill size={18} style={{ color: "var(--gryt-accent-11)" }} />
      </div>

      <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 0 }}>
        <span className="text-sm font-medium truncate">
          {pin.lastHost}
        </span>
        <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m979c1fbfa2", { date: formatDate(pin.firstSeenAt) })}</span>
        <Fingerprint value={pin.keyId} />
      </div>

      <Tooltip title={i18n.t("settingsFull.m874edaf6b6")}>
        <IconButton tone="danger" size="xsmall" onClick={() => setConfirm(true)}>
          <PiTrashFill size={16} />
        </IconButton>
      </Tooltip>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={i18n.t("settingsFull.mc20791ab11", { value0: pin.lastHost })}
        description={i18n.t("settingsFull.m5010bd916d")}
        confirmLabel={i18n.t("ui.forget")}
        onConfirm={() => onForget(pin.keyId)}
      />
    </div>
  );
}

export function ServerIdentitySettings() {
  useTranslation();
  const [pins, setPins] = useState<ServerPin[]>([]);
  const [blocked, setBlocked] = useState<BlockedServer[]>([]);

  const refresh = useCallback(() => {
    setPins(Object.values(listPins()).sort((a, b) => b.lastSeenAt - a.lastSeenAt));
    setBlocked(listBlocked().slice().sort((a, b) => b.blockedAt - a.blockedAt));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleUnblock = useCallback(
    (entry: BlockedServer) => {
      unblockServer(entry);

      // Unblocking is someone saying "this server was replaced", so the identity
      // it replaced is retired too — but only when nothing else expects that key.
      const stillInUse = Object.values(listHostExpectations()).includes(entry.expectedKeyId);
      if (!stillInUse) forgetPin(entry.expectedKeyId);

      refresh();
      toast.success(i18n.t("settingsFull.md204aee12b", { value0: entry.host }));
    },
    [refresh],
  );

  const handleForget = useCallback(
    (keyId: string) => {
      forgetPin(keyId);
      refresh();
      toast.success(i18n.t("settingsFull.m1744c92770"));
    },
    [refresh],
  );

  return (
    <SettingsContainer>
      <h2 className="text-lg">{i18n.t("ui.serverIdentities")}</h2>

      <div className="flex flex-col gap-3">
        <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.mccd8de3070")}</span>

        {blocked.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{i18n.t("settingsFull.m99613c74ce")}</span>
              <Chip tone="danger">
                {blocked.length}
              </Chip>
            </div>
            {blocked.map((entry) => (
              <BlockedRow
                key={`${entry.host}:${entry.keyId ?? "none"}`}
                entry={entry}
                firstPinnedAt={pins.find((p) => p.keyId === entry.expectedKeyId)?.firstSeenAt}
                onUnblock={handleUnblock}
              />
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="font-medium text-sm">{i18n.t("settingsFull.mff8d8431ee")}</span>
          <Chip tone="neutral">
            {pins.length}
          </Chip>
        </div>

        {pins.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8" style={{ borderRadius: "var(--gryt-radius-sm)", border: "1px dashed var(--gryt-neutral-a6)" }}>
            <PiHardDrivesFill size={32} style={{ color: "var(--gryt-neutral-a8)" }} />
            <span className="text-sm text-gryt-muted">{i18n.t("settingsFull.m82f8bbc6da")}</span>
          </div>
        ) : (
          pins.map((pin) => <KnownRow key={pin.keyId} pin={pin} onForget={handleForget} />)
        )}
      </div>
    </SettingsContainer>
  );
}
