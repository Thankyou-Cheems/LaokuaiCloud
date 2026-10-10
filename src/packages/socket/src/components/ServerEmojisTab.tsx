import { Button, Chip, IconButton, TextField } from "@gryt/ui";
import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Trans } from "react-i18next";

import { getServerAccessToken } from "@/common";
import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { PiUploadSimpleFill, PiX } from "../../../../lib/icons";
import { useEmojiUpload } from "../hooks/useEmojiUpload";
import {
  fetchCustomEmojis,
  setCustomEmojis,
} from "../utils/emojiData";
import type { EmojiItem } from "../utils/emojiFileUtils";
import { DEFAULT_MAX_EMOJI_BYTES, IMAGE_MIME_ACCEPT } from "../utils/emojiFileUtils";
import { EmojiList } from "./EmojiList";
import { EmoteImport } from "./EmoteImport";

type EmojiJobStatus = "queued" | "processing" | "done" | "error" | "superseded";

interface EmojiJobListItem {
  job_id: string;
  name: string;
  status: EmojiJobStatus;
  error_message: string | null;
}

interface EmojiQueueState {
  pendingCount: number;
  jobs: EmojiJobListItem[];
}

export function ServerEmojisTab({
  host,
  socket,
  accessToken,
}: {
  host: string;
  socket?: {
    connected: boolean;
    emit: (event: string, data?: unknown) => void;
    on: (event: string, handler: (payload: unknown) => void) => void;
    off: (event: string, handler: (payload: unknown) => void) => void;
  };
  accessToken: string | null;
}) {
  useSocketTranslation();
  const [emojis, setEmojis] = useState<EmojiItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [emojiMaxBytes, setEmojiMaxBytes] = useState<number>(DEFAULT_MAX_EMOJI_BYTES);
  const [queueJobs, setQueueJobs] = useState<EmojiJobListItem[]>([]);

  const effectiveAccessToken = useMemo(
    () => accessToken || getServerAccessToken(host),
    [accessToken, host],
  );

  const existingNames = useMemo(() => new Set(emojis.map((e) => e.name)), [emojis]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchCustomEmojis(host);
      // Null is a refused read rather than an empty server. This is the screen
      // somebody is on while importing, where empty reads as "they are gone".
      if (!list) {
        toast.error(socketI18n.t("socketFull.serverEmojisTab_7bf2a5cc70"));
        return;
      }
      setEmojis(list);
      setCustomEmojis(list, host);
    } catch (err) {
      console.error("[EmojiUpload] refresh: failed to fetch emojis:", err);
      toast.error(socketI18n.t("socketFull.serverEmojisTab_7e6eb42b87"));
    } finally {
      setLoading(false);
    }
  }, [host]);

  useEffect(() => {
    if (host) refresh();
  }, [host, refresh]);

  useEffect(() => {
    if (!socket || !socket.connected) return;

    const onEmojisUpdated = () => {
      void refresh();
    };

    const onSettings = (payload: unknown) => {
      const p = (payload && typeof payload === "object") ? (payload as Record<string, unknown>) : {};
      const v = p.emojiMaxBytes;
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        setEmojiMaxBytes(v);
      }
    };

    const onQueueState = (payload: unknown) => {
      const root = (payload && typeof payload === "object") ? (payload as EmojiQueueState) : null;
      if (root && Array.isArray(root.jobs)) {
        setQueueJobs(root.jobs.filter((j) => j.status === "queued" || j.status === "processing"));
      }
    };

    socket.on("server:settings", onSettings);
    socket.on("server:emojis:updated", onEmojisUpdated);
    socket.on("server:emojiQueue:state", onQueueState);
    socket.emit("server:settings:get");

    const token = effectiveAccessToken;
    if (token) socket.emit("server:emojiQueue:get", { accessToken: token });

    return () => {
      socket.off("server:settings", onSettings);
      socket.off("server:emojis:updated", onEmojisUpdated);
      socket.off("server:emojiQueue:state", onQueueState);
    };
  }, [socket, refresh, effectiveAccessToken]);

  const {
    pendingEmojis,
    uploading,
    lastSelectSummary,
    fileInputRef,
    uploadableCount,
    handleFileSelect,
    updatePendingName,
    removePending,
    handleUploadAll,
    handleUploadSingle,
    clearAllPending,
  } = useEmojiUpload({ host, socket, existingNames, emojiMaxBytes });

  return (
    <div className="flex flex-col gap-4">
      <span className="text-sm text-gryt-muted"><Trans i18n={socketI18n} i18nKey="socketFull.emojiSyntaxExplanation" components={{ code: <code /> }} /></span>

      <div className="flex flex-col gap-3 p-3" style={{
          border: "1px solid var(--gryt-neutral-a5)",
          borderRadius: "var(--gryt-radius-sm)",
        }}>
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium">{socketI18n.t("socketFull.serverEmojisTab_208f7f6909")}</span>
          <Button tone="neutral" size="xsmall"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >{socketI18n.t("socketFull.serverEmojisTab_818b505a3e")}</Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={IMAGE_MIME_ACCEPT}
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />
        </div>

        {lastSelectSummary && (() => {
          const skippedTotal = lastSelectSummary.skippedTooLarge +
            lastSelectSummary.skippedUnsupported +
            lastSelectSummary.skippedZipNonImage +
            lastSelectSummary.skippedZipTooLarge +
            lastSelectSummary.skippedZipEmpty;
          if (skippedTotal === 0) return null;
          const parts: string[] = [];
          if (lastSelectSummary.tooLargeExamples.length > 0) parts.push(socketI18n.t("socketFull.serverEmojisTab_075485e818", { p0: (lastSelectSummary.tooLargeExamples.join(", ")) }));
          if (lastSelectSummary.unsupportedExamples.length > 0) parts.push(socketI18n.t("socketFull.serverEmojisTab_d5402ff1c1", { p0: (lastSelectSummary.unsupportedExamples.join(", ")) }));
          return (
            <span className="text-xs" color="yellow"><Trans i18n={socketI18n} i18nKey="socketFull.skippedEmojiSelection" values={{ count: skippedTotal, details: parts.length > 0 ? ` (${parts.join(" · ")})` : "" }} count={skippedTotal} /></span>
          );
        })()}

        {pendingEmojis.length > 0 && (
          <div className="flex flex-col gap-2" style={{ maxHeight: 300, overflowY: "auto" }}>
            {pendingEmojis.map((p) => (
              <div className="flex items-center gap-2 py-1 px-2" key={p.id} style={{
                  border: "1px solid var(--gryt-neutral-a4)",
                  borderRadius: "var(--gryt-radius-sm)",
                }}>
                <div className="emoji-upload-preview-wrap"
                  aria-busy={p.status === "uploading" || p.status === "processing"}
                  data-status={p.status}
                >
                  <img
                    src={p.previewUrl}
                    alt={socketI18n.t("socketFull.serverEmojisTab_76ad887224")}
                    className="emoji-upload-preview-img"
                  />
                  {(p.status === "uploading" || p.status === "processing") && (
                    <div className="emoji-upload-preview-overlay" aria-hidden="true">
                      <div className="emoji-upload-preview-label">
                        {p.status === "processing" ? socketI18n.t("socketFull.serverEmojisTab_4067ea905e") : `${p.progress}%`}
                      </div>
                      <div className="emoji-upload-preview-bar">
                        <div className="emoji-upload-preview-bar-inner"
                          style={{ width: `${p.progress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 0 }}>
                  <TextField
                    size="small"
                    value={p.name}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => updatePendingName(p.id, e.target.value)}
                    placeholder={socketI18n.t("socketFull.serverEmojisTab_aaeb320dc5")}
                    disabled={uploading || p.status === "uploading"}
                  />
                  {p.nameError && (
                    <span className="text-xs text-gryt-danger" style={{ lineHeight: 1.2 }}>
                      {p.nameError}
                    </span>
                  )}
                  {!p.nameError && p.nameWarning && (
                    <span className="text-xs" color="yellow" style={{ lineHeight: 1.2 }}>
                      {p.nameWarning}
                    </span>
                  )}
                </div>
                {p.status === "uploading" && (
                  <span className="text-xs text-gryt-muted" style={{ flexShrink: 0, minWidth: 32, textAlign: "right" }}>
                    {p.progress}%
                  </span>
                )}
                {p.status === "error" && (
                  <span className="text-xs text-gryt-danger" style={{ flexShrink: 0 }}>{socketI18n.t("socketFull.serverEmojisTab_3add46c398")}</span>
                )}
                <IconButton tone="ghost" size="xsmall"
                  title={socketI18n.t("socketFull.serverEmojisTab_7c7911cdb0")}
                  disabled={uploading || !!p.nameError || p.status === "uploading"}
                  onClick={() => handleUploadSingle(p.id)}
                  style={{ cursor: "pointer", flexShrink: 0 }}
                >
                  <PiUploadSimpleFill size={14} />
                </IconButton>
                <IconButton tone="danger" size="xsmall"
                  title={socketI18n.t("ui.remove")}
                  disabled={uploading}
                  onClick={() => removePending(p.id)}
                  style={{ cursor: "pointer", flexShrink: 0 }}
                >
                  <PiX size={14} />
                </IconButton>
              </div>
            ))}
          </div>
        )}

        {pendingEmojis.length > 0 && (
          <div className="flex justify-end gap-2">
            <Button tone="neutral" size="xsmall"
              disabled={uploading}
              onClick={clearAllPending}
            >{socketI18n.t("socketFull.serverEmojisTab_4635d64ccf")}</Button>
            <Button size="xsmall"
              disabled={uploading || uploadableCount === 0}
              onClick={() => handleUploadAll(effectiveAccessToken)}
            >
              {uploading ? socketI18n.t("ui.uploading") : socketI18n.t("socketFull.serverEmojisTab_6768e97181", { p0: (uploadableCount) })}
            </Button>
          </div>
        )}
      </div>

      {queueJobs.length > 0 && (
        <div className="flex flex-col gap-2 p-3" style={{
            border: "1px solid color-mix(in oklab, var(--gryt-warning-9) 13%, transparent)",
            borderRadius: "var(--gryt-radius-sm)",
            background: "color-mix(in oklab, var(--gryt-warning-9) 5%, transparent)",
          }}>
          <span className="text-sm font-medium"><Trans i18n={socketI18n} i18nKey="socketFull.processingEmojiQueue" values={{ count: queueJobs.length }} count={queueJobs.length} /></span>
          {queueJobs.map((j) => (
            <div className="flex justify-between items-center gap-2" key={j.job_id}>
              <span className="text-sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                :{j.name}:
              </span>
              <Chip tone="neutral" color={j.status === "processing" ? "amber" : "gray"}>
                {j.status}
              </Chip>
            </div>
          ))}
        </div>
      )}

      <EmoteImport
        host={host}
        accessToken={effectiveAccessToken}
        socket={socket ?? null}
        existingNames={existingNames}
      />

      <EmojiList
        host={host}
        emojis={emojis}
        loading={loading}
        effectiveAccessToken={effectiveAccessToken}
        existingNames={existingNames}
        refresh={refresh}
      />
    </div>
  );
}
