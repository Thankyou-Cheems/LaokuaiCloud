import { Avatar, Button, Select, Switch, TextField } from "@gryt/ui";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Trans } from "react-i18next";

import { GeneratedServerIcon, getServerAccessToken, getServerHttpBase } from "@/common";
import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";
import { useSettings } from "@/settings";
import type { Channel } from "@/settings/src/types/server";

import { PiCameraFill, PiTrashFill } from "../../../../lib/icons";
import { useServerPermissions } from "../hooks/usePermissions";
import { ConfirmDialog } from "./ConfirmDialog";

type ProfanityMode = "off" | "flag" | "censor" | "block";

/** Mirrors the server's. Anything else reads as `normal`, as it does there. */
type SpamSensitivity = "low" | "normal" | "high";
function normalizeSpamSensitivity(v: unknown): SpamSensitivity {
  return v === "low" || v === "high" ? v : "normal";
}

/** Mirrors the server's `JoinPolicy`. `approval` exists there as room to grow. */
type JoinPolicy = "invite" | "request" | "open";

/**
 * Anything unrecognised reads as `invite`, matching the server's own
 * normaliseJoinPolicy. A newer value must leave a server harder to get into.
 */
function normalizeJoinPolicy(v: unknown): JoinPolicy {
  return v === "open" ? "open" : v === "request" ? "request" : "invite";
}
type CensorStyle = "grawlix" | "emoji" | "asterisks" | "block" | "hearts";

type ServerSettingsPayload = {
  serverId: string;
  isOwner: boolean;
  isConfigured: boolean;
  displayName: string;
  description: string;
  iconUrl: string | null;
  avatarMaxBytes?: number | null;
  uploadMaxBytes?: number | null;
  emojiMaxBytes?: number | null;
  profanityMode?: ProfanityMode;
  profanityCensorStyle?: CensorStyle;
  systemChannelId?: string | null;
  lanOpen?: boolean;
  joinPolicy?: JoinPolicy;
  discoverable?: boolean;
  spamFilter?: boolean;
  spamSensitivity?: SpamSensitivity;
  videoProfiles?: boolean;
  /** Absent on a server from before the setting, which then shows no switch. */
  externalEmojis?: boolean;
  /** What this host can do with uploads; an older server sends nothing. */
  media?: { checked?: boolean; video?: boolean };
};

export type ServerOverviewInitialSettings = {
  displayName?: string;
  description?: string;
};

export function ServerOverviewTab({
  host,
  socket,
  accessToken,
  initialSettings,
  channels = [],
}: {
  host: string;
  socket?: {
    connected: boolean;
    emit: (event: string, data?: unknown) => void;
    on: (event: string, handler: (payload: unknown) => void) => void;
    off: (event: string, handler: (payload: unknown) => void) => void;
  };
  accessToken: string | null;
  initialSettings?: ServerOverviewInitialSettings;
  channels?: Channel[];
}) {
  useSocketTranslation();
  const { nickname } = useSettings();

  const MAX_ICON_SIZE_BYTES = 25 * 1024 * 1024;

  /**
   * Whether this member may change any of this. `manage_server` is owner-only by
   * default, so an owner who grants it should get a form that works.
   */
  const { can } = useServerPermissions(host);
  const canEdit = can("manage_server");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [isUploadingIcon, setIsUploadingIcon] = useState(false);
  const [isClearingIcon, setIsClearingIcon] = useState(false);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [iconCacheBuster, setIconCacheBuster] = useState(0);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const [showClearIconConfirm, setShowClearIconConfirm] = useState(false);

  const iconBusy = isUploadingIcon || isClearingIcon;

  const [profanityMode, setProfanityMode] = useState<ProfanityMode>("censor");
  const [censorStyle, setCensorStyle] = useState<CensorStyle>("emoji");
  const [systemChannelId, setSystemChannelId] = useState<string | null>(null);
  const [lanOpen, setLanOpen] = useState(false);
  const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>("invite");
  const [discoverable, setDiscoverable] = useState(true);
  const [spamFilter, setSpamFilter] = useState(true);
  const [spamSensitivity, setSpamSensitivity] = useState<SpamSensitivity>("normal");
  const [videoProfiles, setVideoProfiles] = useState(true);
  const [externalEmojis, setExternalEmojis] = useState<boolean | null>(null);
  const [media, setMedia] = useState<{ checked: boolean; video: boolean } | null>(null);

  const [autosaving, setAutosaving] = useState(false);
  const pendingSaveCountRef = useRef(0);
  const lastSettingsRef = useRef<{
    displayName: string;
    description: string;
    avatarMaxBytes: number | null;
    uploadMaxBytes: number | null;
    emojiMaxBytes: number | null;
    profanityMode: ProfanityMode;
    profanityCensorStyle: CensorStyle;
    systemChannelId: string | null;
    lanOpen: boolean;
    joinPolicy: JoinPolicy;
    discoverable: boolean;
    spamFilter: boolean;
    spamSensitivity: SpamSensitivity;
    videoProfiles: boolean;
    externalEmojis: boolean;
  } | null>(null);

  const [avatarMaxMb, setAvatarMaxMb] = useState<string>("");
  const [uploadMaxMb, setUploadMaxMb] = useState<string>("");
  const [emojiMaxMb, setEmojiMaxMb] = useState<string>("");

  const effectiveAccessToken = useMemo(() => accessToken || getServerAccessToken(host), [accessToken, host]);

  const textChannels = useMemo(
    () => channels.filter((c) => c.type === "text"),
    [channels],
  );

  // Apply any initial settings when host changes (best-effort prefill).
  useEffect(() => {
    if (!initialSettings) return;
    if (typeof initialSettings.displayName === "string") setDisplayName(initialSettings.displayName);
    if (typeof initialSettings.description === "string") setDescription(initialSettings.description);
  }, [host, initialSettings]);

  const isServerSettingsPayload = (x: unknown): x is ServerSettingsPayload => {
    if (!x || typeof x !== "object") return false;
    const p = x as Partial<ServerSettingsPayload>;
    return typeof p.serverId === "string" &&
      typeof p.isOwner === "boolean" &&
      typeof p.isConfigured === "boolean" &&
      typeof p.displayName === "string" &&
      typeof p.description === "string" &&
      typeof p.iconUrl !== "undefined";
  };

  // Fetch current settings when opened/host changes.
  useEffect(() => {
    if (!host) return;
    if (!socket) return;
    if (!socket.connected) return;

    const onSettings = (payload: unknown) => {
      if (!isServerSettingsPayload(payload)) return;
      const wasSaving = pendingSaveCountRef.current > 0;

      setIconUrl(payload.iconUrl || null);

      const toMbString = (bytes?: number | null) => {
        if (!bytes || !Number.isFinite(bytes)) return "";
        const mb = bytes / (1024 * 1024);
        return (Math.round(mb * 10) / 10).toString();
      };

      setProfanityMode(payload.profanityMode ?? "censor");
      setCensorStyle(payload.profanityCensorStyle ?? "emoji");
      setSystemChannelId(payload.systemChannelId ?? null);
      setLanOpen(!!payload.lanOpen);
      setJoinPolicy(normalizeJoinPolicy(payload.joinPolicy));
      setDiscoverable(payload.discoverable !== false);
      setSpamFilter(payload.spamFilter !== false);
      setSpamSensitivity(normalizeSpamSensitivity(payload.spamSensitivity));
      setVideoProfiles(payload.videoProfiles !== false);
      setExternalEmojis(typeof payload.externalEmojis === "boolean" ? payload.externalEmojis : null);
      setMedia(payload.media ? { checked: !!payload.media.checked, video: !!payload.media.video } : null);

      if (!wasSaving) {
        setDisplayName(payload.displayName || "");
        setDescription(payload.description || "");
        setAvatarMaxMb(toMbString(payload.avatarMaxBytes));
        setUploadMaxMb(toMbString(payload.uploadMaxBytes));
        setEmojiMaxMb(toMbString(payload.emojiMaxBytes));
      } else {
        toast.success(socketI18n.t("socketFull.serverOverviewTab_61c54cbc75"));
      }

      pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1);
      if (pendingSaveCountRef.current === 0) setAutosaving(false);

      lastSettingsRef.current = {
        displayName: payload.displayName || "",
        description: payload.description || "",
        avatarMaxBytes: (typeof payload.avatarMaxBytes === "number" && Number.isFinite(payload.avatarMaxBytes)) ? payload.avatarMaxBytes : null,
        uploadMaxBytes: (typeof payload.uploadMaxBytes === "number" && Number.isFinite(payload.uploadMaxBytes)) ? payload.uploadMaxBytes : null,
        emojiMaxBytes: (typeof payload.emojiMaxBytes === "number" && Number.isFinite(payload.emojiMaxBytes)) ? payload.emojiMaxBytes : null,
        profanityMode: payload.profanityMode ?? "censor",
        profanityCensorStyle: payload.profanityCensorStyle ?? "emoji",
        systemChannelId: payload.systemChannelId ?? null,
        lanOpen: !!payload.lanOpen,
        joinPolicy: normalizeJoinPolicy(payload.joinPolicy),
        discoverable: payload.discoverable !== false,
        spamFilter: payload.spamFilter !== false,
        spamSensitivity: normalizeSpamSensitivity(payload.spamSensitivity),
        videoProfiles: payload.videoProfiles !== false,
        externalEmojis: payload.externalEmojis === true,
      };
    };

    const onError = (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const err = payload as { error?: string; message?: string };
      if (err.error === "settings_update_failed" || err.error === "forbidden" || err.error === "token_invalid") {
        if (pendingSaveCountRef.current > 0) {
          pendingSaveCountRef.current = 0;
          setAutosaving(false);
          toast.error(err.message || socketI18n.t("socketFull.serverOverviewTab_8dc1c01a8e"));
          socket.emit("server:settings:get");
        }
      }
    };

    socket.on("server:settings", onSettings);
    socket.on("server:error", onError);
    socket.emit("server:settings:get");

    const retryTimer = setTimeout(() => {
      if (!lastSettingsRef.current) {
        socket.emit("server:settings:get");
      }
    }, 3000);

    return () => {
      socket.off("server:settings", onSettings);
      socket.off("server:error", onError);
      clearTimeout(retryTimer);
    };
  }, [host, socket]);


  const ensureJoined = () => {
    if (!socket?.connected) return;
    if (!nickname) return;
    socket.emit("server:join", { nickname });
  };

  const parseMbToBytes = (s: string): number | null => {
    const raw = (s || "").trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n * 1024 * 1024);
  };
  const emitSettingsUpdate = (patch: Partial<{
    displayName: string;
    description: string;
    avatarMaxBytes: number | null;
    uploadMaxBytes: number | null;
    emojiMaxBytes: number | null;
    profanityMode: ProfanityMode;
    profanityCensorStyle: CensorStyle;
    systemChannelId: string | null;
    lanOpen: boolean;
    joinPolicy: JoinPolicy;
    discoverable: boolean;
    spamFilter: boolean;
    spamSensitivity: SpamSensitivity;
    videoProfiles: boolean;
    externalEmojis: boolean;
  }>): boolean => {
    if (!host || !socket || !socket.connected) {
      toast.error(socketI18n.t("socketFull.serverOverviewTab_1358ba8f73"));
      return false;
    }
    if (!effectiveAccessToken) {
      ensureJoined();
      toast.error(socketI18n.t("socketFull.serverOverviewTab_55bd9f5ecf"));
      return false;
    }
    if (!canEdit) {
      toast.error(socketI18n.t("socketFull.serverOverviewTab_728652d8c0"));
      return false;
    }

    if (lastSettingsRef.current) {
      lastSettingsRef.current = { ...lastSettingsRef.current, ...patch };
    }

    pendingSaveCountRef.current += 1;
    setAutosaving(true);
    socket.emit("server:settings:update", {
      accessToken: effectiveAccessToken,
      ...patch,
    });
    return true;
  };

  const saveIfChanged = (patch: Parameters<typeof emitSettingsUpdate>[0]): boolean => {
    const last = lastSettingsRef.current;
    if (last) {
      const entries = Object.entries(patch) as Array<[keyof typeof patch, string | number | null | boolean | undefined]>;
      const changed = entries.some(([k, v]) => last[k] !== v);
      if (!changed) return true;
    }
    return emitSettingsUpdate(patch);
  };

  const uploadIcon = async (file: File) => {
    if (!host) return;
    if (!socket || !socket.connected) {
      toast.error(socketI18n.t("socketFull.serverOverviewTab_1358ba8f73"));
      return;
    }
    if (!effectiveAccessToken) {
      await ensureJoined();
      return;
    }
    if (!canEdit) {
      toast.error(socketI18n.t("socketFull.serverOverviewTab_5f90ca4958"));
      return;
    }
    if (file.size > MAX_ICON_SIZE_BYTES) {
      toast.error(socketI18n.t("socketFull.serverOverviewTab_c54eb4aab5"));
      return;
    }
    if (!/^image\/(png|jpeg|webp|gif|avif)$/i.test(file.type || "")) {
      toast.error(socketI18n.t("socketFull.serverOverviewTab_768b43c377"));
      return;
    }
    setIsUploadingIcon(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const resp = await fetch(`${getServerHttpBase(host)}/api/server/icon`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${effectiveAccessToken}`,
        },
        body: form,
      });
      const raw = await resp.text().catch(() => "");
      let data: Record<string, unknown> = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = {};
      }
      if (!resp.ok) {
        const msg =
          (typeof data?.message === "string" && data.message.trim().length > 0)
            ? data.message
            : (typeof data?.error === "string" && data.error.trim().length > 0)
              ? data.error
              : (raw && raw.trim().length > 0)
                ? raw.trim()
                : `HTTP ${resp.status} ${resp.statusText || ""}`.trim();
        throw new Error(msg);
      }
      toast.success(socketI18n.t("socketFull.serverOverviewTab_7548966300"));
      setIconCacheBuster((v) => v + 1);
      socket?.emit("server:settings:get");
      socket?.emit("server:details");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : socketI18n.t("socketFull.serverOverviewTab_9d18cad0bd"));
    } finally {
      setIsUploadingIcon(false);
    }
  };

  const clearIcon = async () => {
    if (!host) return;
    if (!socket || !socket.connected) {
      toast.error(socketI18n.t("socketFull.serverOverviewTab_1358ba8f73"));
      return;
    }
    if (!effectiveAccessToken) {
      await ensureJoined();
      return;
    }
    if (!canEdit) {
      toast.error(socketI18n.t("socketFull.serverOverviewTab_5f90ca4958"));
      return;
    }

    setIsClearingIcon(true);
    try {
      const resp = await fetch(`${getServerHttpBase(host)}/api/server/icon`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${effectiveAccessToken}`,
        },
      });
      const raw = await resp.text().catch(() => "");
      let data: Record<string, unknown> = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = {};
      }
      if (!resp.ok) {
        const msg =
          (typeof data?.message === "string" && data.message.trim().length > 0)
            ? data.message
            : (typeof data?.error === "string" && data.error.trim().length > 0)
              ? data.error
              : (raw && raw.trim().length > 0)
                ? raw.trim()
                : `HTTP ${resp.status} ${resp.statusText || ""}`.trim();
        throw new Error(msg);
      }

      setIconUrl(null);
      setIconCacheBuster((v) => v + 1);
      toast.success(socketI18n.t("socketFull.serverOverviewTab_ebd61b916e"));
      socket?.emit("server:settings:get");
      socket?.emit("server:details");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : socketI18n.t("socketFull.serverOverviewTab_18cfcc7449"));
    } finally {
      setIsClearingIcon(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <span className="text-sm">
        {canEdit
          ? socketI18n.t("socketFull.serverOverviewTab_2d5a0f2556")
          : socketI18n.t("socketFull.serverOverviewTab_07c458fbeb")}
      </span>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{socketI18n.t("settingsFull.mcb0cb170d1")}</span>
        <span className="text-sm">
          {host}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{socketI18n.t("socketFull.serverOverviewTab_b1b305be1b")}</span>
        <TextField
          value={displayName}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDisplayName(e.target.value)}
          onBlur={() => saveIfChanged({ displayName: displayName.trim() })}
          placeholder={socketI18n.t("socketFull.serverOverviewTab_87f0cdb725")}
          disabled={!canEdit}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{socketI18n.t("socketFull.serverOverviewTab_644c263467")}</span>
        <TextField
          multiline
          minRows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => saveIfChanged({ description: description.trim() })}
          placeholder={socketI18n.t("socketFull.serverOverviewTab_04e98abb55")}
          disabled={!canEdit}
          style={{ minHeight: 90 }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{socketI18n.t("socketFull.serverOverviewTab_ca2a2c61c9")}</span>
        {/** Only the avatar is clickable (not whitespace). */}
        <div className="flex flex-col items-center gap-2" style={{
            cursor: "default",
            opacity: iconBusy ? 0.6 : 1,
            transition: "opacity 200ms",
            paddingTop: 8,
            paddingBottom: 4,
          }}>
          <button
            type="button"
            disabled={!canEdit || iconBusy}
            onClick={() => iconInputRef.current?.click()}
            aria-label={socketI18n.t("socketFull.serverOverviewTab_2ca4b5b99a")}
            style={{
              all: "unset",
              cursor: canEdit && !iconBusy ? "pointer" : "default",
              borderRadius: 9999,
            }}
          >
            <div style={{ position: "relative" }}>
              <Avatar
                size="large"
                className="h-24 w-24 text-3xl"
                src={iconUrl ? `${getServerHttpBase(host)}/icon?v=${iconCacheBuster}` : undefined}
                fallback={displayName || host ? <GeneratedServerIcon seed={displayName || host} /> : "S"}
              />
              {canEdit && (
                <div className="flex items-center justify-center" style={{
                    position: "absolute",
                    bottom: 0,
                    right: 0,
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "var(--gryt-accent-9)",
                    color: "var(--gryt-on-accent)",
                    boxShadow: "0 1px 4px var(--gryt-neutral-a5)",
                  }}>
                  <PiCameraFill size={14} />
                </div>
              )}
            </div>
          </button>
          <span className="text-xs">
            {isUploadingIcon
              ? socketI18n.t("ui.uploading")
              : isClearingIcon
                ? socketI18n.t("socketFull.serverOverviewTab_bcb85dcfbc")
                : canEdit
                  ? socketI18n.t("socketFull.serverOverviewTab_d6b23cb01e")
                  : socketI18n.t("socketFull.serverOverviewTab_ca2a2c61c9")}
          </span>
        </div>

        {canEdit && iconUrl ? (
          <>
            <Button size="small"
              disabled={isUploadingIcon || isClearingIcon}
              onClick={() => setShowClearIconConfirm(true)}
              style={{ alignSelf: "center" }}
            >
              <PiTrashFill size={16} />{socketI18n.t("socketFull.serverOverviewTab_61cd62f50a")}</Button>
            <ConfirmDialog
              open={showClearIconConfirm}
              onOpenChange={(open) => { if (!open) setShowClearIconConfirm(false); }}
              title={socketI18n.t("socketFull.serverOverviewTab_de703a311e")}
              description={socketI18n.t("socketFull.serverOverviewTab_78f7c9d85c")}
              confirmLabel={socketI18n.t("socketFull.serverOverviewTab_61cd62f50a")}
              onConfirm={clearIcon}
            />
          </>
        ) : null}
        <input
          ref={iconInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          style={{ display: "none" }}
          disabled={!canEdit || isUploadingIcon || isClearingIcon}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadIcon(f);
            e.currentTarget.value = "";
          }}
        />
      </div>

      {media && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{socketI18n.t("socketFull.serverOverviewTab_38fbbee40d")}</span>
          <span className="text-xs" style={{ lineHeight: 1.4 }}>
            {media.checked
              ? socketI18n.t("socketFull.serverOverviewTab_ed0659075f")
              : socketI18n.t("socketFull.serverOverviewTab_6374a2570c")}
          </span>
          <div className="flex items-center gap-2">
            <Switch
              checked={media.video && videoProfiles}
              onCheckedChange={(v) => {
                setVideoProfiles(v);
                if (!saveIfChanged({ videoProfiles: v })) setVideoProfiles(!v);
              }}
              disabled={!canEdit || !media.video}
            />
            <span className="text-sm">{socketI18n.t("socketFull.serverOverviewTab_931a5027c5")}</span>
          </div>
          <span className="text-xs text-gryt-muted" style={{ lineHeight: 1.4 }}>
            {media.video
              ? socketI18n.t("socketFull.serverOverviewTab_9111906747")
              : socketI18n.t("socketFull.serverOverviewTab_9a3ed44267")}
          </span>
        </div>
      )}

      {externalEmojis !== null && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{socketI18n.t("socketFull.serverOverviewTab_0f3e089f3c")}</span>
          <div className="flex items-center gap-2">
            <Switch
              checked={externalEmojis}
              onCheckedChange={(v) => {
                setExternalEmojis(v);
                if (!saveIfChanged({ externalEmojis: v })) setExternalEmojis(!v);
              }}
              disabled={!canEdit}
            />
            <span className="text-sm">{socketI18n.t("socketFull.serverOverviewTab_f6b60fc60d")}</span>
          </div>
          <span className="text-xs text-gryt-muted" style={{ lineHeight: 1.4 }}>{socketI18n.t("socketFull.serverOverviewTab_355d3082ff")}</span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{socketI18n.t("socketFull.serverOverviewTab_a89b7d285d")}</span>
        <span className="text-sm">{socketI18n.t("socketFull.serverOverviewTab_9497e5bfdd")}</span>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{socketI18n.t("socketFull.serverOverviewTab_b03db383f9")}</span>
          <TextField
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            value={avatarMaxMb}
            onChange={(e) => setAvatarMaxMb(e.target.value)}
            onBlur={() => saveIfChanged({ avatarMaxBytes: parseMbToBytes(avatarMaxMb) })}
            placeholder={socketI18n.t("socketFull.serverOverviewTab_54949e6cd7")}
            disabled={!canEdit}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{socketI18n.t("socketFull.serverOverviewTab_b95fe865e0")}</span>
          <TextField
            type="number"
            inputMode="decimal"
            step="1"
            min="0"
            value={uploadMaxMb}
            onChange={(e) => setUploadMaxMb(e.target.value)}
            onBlur={() => saveIfChanged({ uploadMaxBytes: parseMbToBytes(uploadMaxMb) })}
            placeholder={socketI18n.t("socketFull.serverOverviewTab_9fb8b76998")}
            disabled={!canEdit}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{socketI18n.t("socketFull.serverOverviewTab_ce0fb2eddd")}</span>
          <TextField
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            value={emojiMaxMb}
            onChange={(e) => setEmojiMaxMb(e.target.value)}
            onBlur={() => saveIfChanged({ emojiMaxBytes: parseMbToBytes(emojiMaxMb) })}
            placeholder={socketI18n.t("socketFull.serverOverviewTab_54949e6cd7")}
            disabled={!canEdit}
          />
        </div>

      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{socketI18n.t("socketFull.serverOverviewTab_96e3f9a807")}</span>
        <span className="text-xs" style={{ lineHeight: 1.4 }}>{socketI18n.t("socketFull.serverOverviewTab_5a56d5d4cb")}</span>
        <div className="flex gap-2 flex-wrap">
          <div style={{ flex: "1 1 180px", minWidth: 0 }}>
            <Select
              value={profanityMode}
              onValueChange={(v) => {
                const mode = v as ProfanityMode;
                setProfanityMode(mode);
                saveIfChanged({ profanityMode: mode });
              }}
              disabled={!canEdit}
              options={[
                { label: socketI18n.t("socketFull.serverOverviewTab_e73ca35045"), value: "off" },
                {
                  label: socketI18n.t("socketFull.serverOverviewTab_6785ec70d8"),
                  value: "flag",
                },
                { label: socketI18n.t("socketFull.serverOverviewTab_70da520252"), value: "censor" },
                { label: socketI18n.t("socketFull.serverOverviewTab_cbd69e2ce9"), value: "block" },
              ]}
            />
          </div>
          {profanityMode === "censor" && (
            <div style={{ flex: "1 1 180px", minWidth: 0 }}>
              <Select
                value={censorStyle}
                onValueChange={(v) => {
                  const style = v as CensorStyle;
                  setCensorStyle(style);
                  saveIfChanged({ profanityCensorStyle: style });
                }}
                disabled={!canEdit}
                placeholder={socketI18n.t("socketFull.serverOverviewTab_ec0bc0de2d")}
                options={[
                  { label: socketI18n.t("socketFull.serverOverviewTab_1244c3a760"), value: "grawlix" },
                  { label: socketI18n.t("socketFull.serverOverviewTab_b9f27f52a7"), value: "asterisks" },
                  { label: socketI18n.t("socketFull.serverOverviewTab_0a38666b9a"), value: "emoji" },
                  { label: socketI18n.t("socketFull.serverOverviewTab_5c8e136099"), value: "block" },
                  { label: socketI18n.t("socketFull.serverOverviewTab_571fda399f"), value: "hearts" },
                ]}
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{socketI18n.t("socketFull.serverOverviewTab_b815dea119")}</span>
        <span className="text-xs" style={{ lineHeight: 1.4 }}>{socketI18n.t("socketFull.serverOverviewTab_47cf092ec0")}</span>
        <div className="flex items-center gap-2">
          <Switch
            checked={spamFilter}
            onCheckedChange={(v) => {
              setSpamFilter(v);
              if (!saveIfChanged({ spamFilter: v })) setSpamFilter(!v);
            }}
            disabled={!canEdit}
          />
          <span className="text-sm">{socketI18n.t("socketFull.serverOverviewTab_aa53196344")}</span>
        </div>
        {spamFilter && (
          <Select
            className="max-w-80"
            value={spamSensitivity}
            onValueChange={(v) => {
              const next = normalizeSpamSensitivity(String(v));
              const previous = spamSensitivity;
              setSpamSensitivity(next);
              if (!saveIfChanged({ spamSensitivity: next })) setSpamSensitivity(previous);
            }}
            disabled={!canEdit}
            options={[
              { label: socketI18n.t("socketFull.serverOverviewTab_e08d81365f"), value: "low" },
              { label: socketI18n.t("socketFull.serverOverviewTab_336cd5f6db"), value: "normal" },
              { label: socketI18n.t("socketFull.serverOverviewTab_238995ce00"), value: "high" },
            ]}
          />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{socketI18n.t("socketFull.serverOverviewTab_6bfa4b2b5e")}</span>
        <span className="text-xs" style={{ lineHeight: 1.4 }}>{socketI18n.t("socketFull.serverOverviewTab_5e42a3c5cb")}</span>
        <Select
          className="max-w-80"
          value={systemChannelId ?? "__auto__"}
          onValueChange={(v) => {
            const id = v === "__auto__" ? null : String(v);
            setSystemChannelId(id);
            saveIfChanged({ systemChannelId: id });
          }}
          disabled={!canEdit}
          options={[
            { label: socketI18n.t("socketFull.serverOverviewTab_2358221b86"), value: "__auto__" },
            ...textChannels.map((ch) => ({ label: `#${ch.name}`, value: ch.id })),
          ]}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{socketI18n.t("socketFull.serverOverviewTab_43ed71596e")}</span>
        <span className="text-xs" style={{ lineHeight: 1.4 }}>{socketI18n.t("socketFull.serverOverviewTab_2d7c2b6c26")}</span>
        <Select
          className="max-w-80"
          value={joinPolicy}
          onValueChange={(v) => {
            const next = normalizeJoinPolicy(String(v));
            const previous = joinPolicy;
            setJoinPolicy(next);
            if (!saveIfChanged({ joinPolicy: next })) setJoinPolicy(previous);
          }}
          disabled={!canEdit}
          options={[
            { label: socketI18n.t("socketFull.serverOverviewTab_0e56106ca5"), value: "invite" },
            { label: socketI18n.t("socketFull.serverOverviewTab_bfe4da3545"), value: "request" },
            { label: socketI18n.t("socketFull.serverOverviewTab_1dcb6d8cc9"), value: "open" },
          ]}
        />
        {joinPolicy === "request" && (
          <span className="text-xs" style={{ lineHeight: 1.4 }}><Trans i18n={socketI18n} i18nKey="socketFull.whereJoinRequestsAppear" components={{ requests: <strong /> }} /></span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{socketI18n.t("socketFull.serverOverviewTab_fbf5cba9f8")}</span>
        <span className="text-xs" style={{ lineHeight: 1.4 }}>{socketI18n.t("socketFull.serverOverviewTab_0bcb459db2")}</span>
        <div className="flex items-center gap-2">
          <Switch
            checked={lanOpen}
            onCheckedChange={(v) => {
              setLanOpen(v);
              if (!saveIfChanged({ lanOpen: v })) setLanOpen(!v);
            }}
            disabled={!canEdit}
          />
          <span className="text-sm">{socketI18n.t("socketFull.serverOverviewTab_5f0685c61a")}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{socketI18n.t("socketFull.serverOverviewTab_5492d66b78")}</span>
        <span className="text-xs" style={{ lineHeight: 1.4 }}>{socketI18n.t("socketFull.serverOverviewTab_a3f533cac4")}</span>
        <div className="flex items-center gap-2">
          <Switch
            checked={discoverable}
            onCheckedChange={(v) => {
              setDiscoverable(v);
              if (!saveIfChanged({ discoverable: v })) setDiscoverable(!v);
            }}
            disabled={!canEdit}
          />
          <span className="text-sm">{socketI18n.t("socketFull.serverOverviewTab_235b297c08")}</span>
        </div>
      </div>


      {autosaving ? (
        <div className="flex justify-end">
          <span className="text-sm">{socketI18n.t("socketFull.serverOverviewTab_a0f752322b")}</span>
        </div>
      ) : null}
    </div>
  );
}

