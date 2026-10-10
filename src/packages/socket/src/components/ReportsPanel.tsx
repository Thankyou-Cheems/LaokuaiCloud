import { Button, Chip, Dialog, IconButton, ScrollArea, Spinner, Tooltip } from "@gryt/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Trans } from "react-i18next";
import type { Socket } from "socket.io-client";

import { getServerAccessToken } from "@/common";
import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { PiBootFill, PiCheck, PiProhibitFill, PiTrashFill, PiWarningCircle, PiWarningFill } from "../../../../lib/icons";
import { useServerPermissions } from "../hooks/usePermissions";
import { useStableFileUrl } from "../hooks/useStableFileUrl";
import { ChatMediaPlayer } from "./ChatMediaPlayer";
import type { AttachmentMeta } from "./chatUtils";
import { ConfirmDialog } from "./ConfirmDialog";
import { FileCard } from "./FileCard";
import { ImageLightbox } from "./ImageLightbox";

/**
 * A person somebody reported, with every open report about them folded in. One
 * card per person, so six reports about one person is one row.
 */
export interface AggregatedUserReport {
  reportedServerUserId: string;
  reportedNickname: string | null;
  reportCount: number;
  reporters: string[];
  reasons: Array<{
    reporterServerUserId: string;
    /** Snapshotted server-side, so it survives the reporter leaving. */
    reporterNickname: string | null;
    reason: string;
    createdAt: string;
  }>;
  firstReportedAt: string;
  reportIds: string[];
}

export interface AggregatedReport {
  messageId: string;
  conversationId: string;
  messageText: string | null;
  attachments: string[] | null;
  enrichedAttachments: AttachmentMeta[] | null;
  senderServerUserId: string;
  senderNickname: string | null;
  reportCount: number;
  reporters: string[];
  firstReportedAt: string;
  reportIds: string[];
  /** From an encrypted DM: the reporter's own copy, which the server can't check (decision 11). */
  unverified?: boolean;
}

export function ReportsPanel({
  isOpen,
  onClose,
  socket,
  serverHost,
  memberList,
}: {
  isOpen: boolean;
  onClose: () => void;
  socket: Socket | null;
  serverHost: string;
  memberList?: Array<{ nickname: string; serverUserId: string }>;
}) {
  useSocketTranslation();
  const [reports, setReports] = useState<AggregatedReport[]>([]);
  const [userReports, setUserReports] = useState<AggregatedUserReport[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  /**
   * Why the queue is not here, when it is not here. The spinner was cleared in
   * one place — the reply — so a refusal or a dead socket left it turning.
   */
  const [loadError, setLoadError] = useState<string | { key: string; values?: Record<string, string | number> } | null>(null);

  /* The handlers below outlive the render they were attached in, so they ask a
     ref rather than a closure over `isLoading` from whenever that was. */
  const loadingRef = useRef(false);
  loadingRef.current = isLoading;
  /* Same reason as loadingRef: onResolved needs to know whether the report it
     just closed was unverified, and the effect below only subscribes once. */
  const reportsRef = useRef<AggregatedReport[]>([]);
  reportsRef.current = reports;
  const [confirmAction, setConfirmAction] = useState<{
    report: AggregatedReport;
    action: "delete" | "delete_all_and_ban";
  } | null>(null);
  const [confirmUserAction, setConfirmUserAction] = useState<{
    report: AggregatedUserReport;
    action: "kick" | "ban";
  } | null>(null);

  /* The buttons follow the same permissions the server checks, so a role that may
     work the queue but not ban is not shown a button that answers "forbidden". */
  const { has } = useServerPermissions(serverHost || "");

  const fetchReports = useCallback(() => {
    setLoadError(null);

    /* Said rather than shown as an empty queue. There is nothing to wait for
       here — no socket, or no token — so a spinner would wait for nothing. */
    if (!socket || !socket.connected || !serverHost) {
      setIsLoading(false);
      setLoadError({ key: "socketFull.reportsPanel_98395f15d6" });
      return;
    }
    const accessToken = getServerAccessToken(serverHost);
    if (!accessToken) {
      setIsLoading(false);
      setLoadError({ key: "socketFull.reportsPanel_273b1f7251" });
      return;
    }

    setIsLoading(true);
    socket.emit("reports:list", { accessToken });
  }, [socket, serverHost]);

  useEffect(() => {
    if (!socket) return;

    const onReportsList = (payload: {
      reports: AggregatedReport[];
      userReports?: AggregatedUserReport[];
    }) => {
      setReports(payload.reports || []);
      /* Absent on a server that predates user reports, which is not the same as
         an empty queue — but it renders the same, and the section is left out. */
      setUserReports(payload.userReports || []);
      setIsLoading(false);
      setLoadError(null);
    };

    /*
     * A refusal, or the socket going away, ends the wait. `server:error` is the
     * one error channel, so this listens only while something is being waited for.
     */
    const onServerError = (payload?: { message?: string }) => {
      if (!loadingRef.current) return;
      setIsLoading(false);
      setLoadError(payload?.message || { key: "socketFull.reportsPanel_687974530b" });
    };

    const onDisconnect = () => {
      if (!loadingRef.current) return;
      setIsLoading(false);
      setLoadError({ key: "socketFull.reportsPanel_a4c2dbf991" });
    };

    const onResolved = (payload: { messageId: string; action: string; deletedCount?: number }) => {
      if (payload.action === "delete_all_and_ban") {
        setReports((prev) => {
          const target = prev.find((r) => r.messageId === payload.messageId);
          if (!target) return prev.filter((r) => r.messageId !== payload.messageId);
          return prev.filter(
            (r) => r.senderServerUserId !== target.senderServerUserId,
          );
        });
        toast.success(socketI18n.t("socketFull.reportsPanel_1ed2d2d055", { p0: (payload.deletedCount ?? 0) }));
      } else {
        const wasUnverified = reportsRef.current.find(
          (r) => r.messageId === payload.messageId,
        )?.unverified;
        setReports((prev) => prev.filter((r) => r.messageId !== payload.messageId));
        if (payload.action === "approve") {
          toast.success(socketI18n.t("socketFull.reportsPanel_9d0988b45a"));
        } else if (payload.action === "delete") {
          toast.success(wasUnverified ? socketI18n.t("socketFull.reportsPanel_fabfcf3d72") : socketI18n.t("socketFull.reportsPanel_dcfa20cac1"));
        }
      }
      setConfirmAction(null);
    };

    const onUserResolved = (payload: {
      reportedServerUserId: string;
      action: "dismiss" | "kick" | "ban";
    }) => {
      setUserReports((prev) =>
        prev.filter((r) => r.reportedServerUserId !== payload.reportedServerUserId),
      );
      if (payload.action === "dismiss") toast.success(socketI18n.t("socketFull.reportsPanel_9d0988b45a"));
      else if (payload.action === "kick") toast.success(socketI18n.t("socketFull.reportsPanel_82715fe9b5"));
      else toast.success(socketI18n.t("socketFull.reportsPanel_3790d0dcf9"));
      setConfirmUserAction(null);
    };

    socket.on("reports:list", onReportsList);
    socket.on("reports:resolved", onResolved);
    socket.on("reports:user_resolved", onUserResolved);
    socket.on("server:error", onServerError);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("reports:list", onReportsList);
      socket.off("reports:resolved", onResolved);
      socket.off("reports:user_resolved", onUserResolved);
      socket.off("server:error", onServerError);
      socket.off("disconnect", onDisconnect);
    };
  }, [socket]);

  useEffect(() => {
    if (isOpen) fetchReports();
  }, [isOpen, fetchReports]);

  const handleApprove = useCallback(
    (report: AggregatedReport) => {
      if (!socket || !serverHost) return;
      const accessToken = getServerAccessToken(serverHost);
      if (!accessToken) return;
      socket.emit("reports:resolve", {
        accessToken,
        messageId: report.messageId,
        conversationId: report.conversationId,
        action: "approve",
      });
    },
    [socket, serverHost],
  );

  const handleDelete = useCallback(
    (report: AggregatedReport) => {
      if (!socket || !serverHost) return;
      const accessToken = getServerAccessToken(serverHost);
      if (!accessToken) return;
      socket.emit("reports:resolve", {
        accessToken,
        messageId: report.messageId,
        conversationId: report.conversationId,
        action: "delete",
      });
    },
    [socket, serverHost],
  );

  const handleDeleteAllAndBan = useCallback(
    (report: AggregatedReport) => {
      if (!socket || !serverHost) return;
      const accessToken = getServerAccessToken(serverHost);
      if (!accessToken) return;
      socket.emit("reports:resolve", {
        accessToken,
        messageId: report.messageId,
        conversationId: report.conversationId,
        action: "delete_all_and_ban",
        senderServerUserId: report.senderServerUserId,
      });
    },
    [socket, serverHost],
  );

  const resolveUser = useCallback(
    (report: AggregatedUserReport, action: "dismiss" | "kick" | "ban") => {
      if (!socket || !serverHost) return;
      const accessToken = getServerAccessToken(serverHost);
      if (!accessToken) return;
      socket.emit("reports:resolve_user", {
        accessToken,
        reportedServerUserId: report.reportedServerUserId,
        action,
      });
    },
    [socket, serverHost],
  );

  const getNickname = (serverUserId: string): string => {
    const member = memberList?.find((m) => m.serverUserId === serverUserId);
    return member?.nickname || serverUserId.slice(0, 8) + "...";
  };

  return (
    <>
      <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup className="w-[43.75rem] max-h-[80vh]">
          <Dialog.Title>
            <div className="flex items-center gap-2">
              <PiWarningFill size={16} />{socketI18n.t("ui.reports")}{reports.length + userReports.length > 0 && (
                <Chip tone="danger">
                  {reports.length + userReports.length}
                </Chip>
              )}
            </div>
          </Dialog.Title>
          <Dialog.Description>{socketI18n.t("socketFull.reportsPanel_d316b2d8ba")}</Dialog.Description>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size={24} />
            </div>
          ) : loadError ? (
            /* Not the empty state. An empty queue is good news; this is the
               panel admitting it does not know. */
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <PiWarningCircle size={32} style={{ color: "var(--gryt-warning-9)" }} />
              <span className="text-base text-gryt-muted">{typeof loadError === "string" ? loadError : socketI18n.t(loadError.key, loadError.values)}</span>
              <Button tone="neutral" size="small" onClick={fetchReports}>{socketI18n.t("ui.tryAgain")}</Button>
            </div>
          ) : reports.length === 0 && userReports.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <PiCheck size={32} style={{ color: "var(--gryt-success-9)" }} />
              <span className="text-base text-gryt-muted">{socketI18n.t("socketFull.reportsPanel_77a1513187")}</span>
            </div>
          ) : (
            <ScrollArea.Root className="max-h-[55vh]">
              <ScrollArea.Viewport className="max-h-[55vh]">
               {/* Base UI lets content grow past the viewport, and a 480px player pushed the moderation buttons out of view. */}
               <ScrollArea.Content style={{ minWidth: 0 }}>
              <div className="flex flex-col gap-3">
                {/* People first. A report about a person is the one with a
                    reader waiting on it — there is no message sitting in a
                    channel doing the work of being the evidence. */}
                {userReports.length > 0 && (
                  <>
                    <span className="text-xs font-bold text-gryt-muted">{socketI18n.t("socketFull.reportsPanel_a0c70300f9")}{" "}{userReports.length}
                    </span>
                    {userReports.map((report) => (
                      <UserReportCard
                        key={report.reportedServerUserId}
                        report={report}
                        getNickname={getNickname}
                        canKick={has("kick_members")}
                        canBan={has("ban_members")}
                        onDismiss={() => resolveUser(report, "dismiss")}
                        onKick={() => setConfirmUserAction({ report, action: "kick" })}
                        onBan={() => setConfirmUserAction({ report, action: "ban" })}
                      />
                    ))}
                  </>
                )}

                {reports.length > 0 && (
                  <span
                    className="text-xs font-bold text-gryt-muted"
                    style={{ marginTop: userReports.length > 0 ? 8 : undefined }}
                  >{socketI18n.t("socketFull.reportsPanel_8b6d08edb9")}{" "}{reports.length}
                  </span>
                )}
                {reports.map((report) => (
                  <ReportCard
                    key={report.messageId}
                    report={report}
                    getNickname={getNickname}
                    serverHost={serverHost}
                    onApprove={() => handleApprove(report)}
                    onDelete={() => setConfirmAction({ report, action: "delete" })}
                    onDeleteAllAndBan={() =>
                      setConfirmAction({ report, action: "delete_all_and_ban" })
                    }
                  />
                ))}
              </div>
              </ScrollArea.Content>
              </ScrollArea.Viewport>
              <ScrollArea.Scrollbar orientation="vertical" />
            </ScrollArea.Root>
          )}

          <div className="flex justify-end mt-4">
            <Dialog.Close>
              <Button tone="neutral" size="small">{socketI18n.t("ui.close")}</Button>
            </Dialog.Close>
          </div>
        </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title={
          confirmAction?.action === "delete_all_and_ban"
            ? socketI18n.t("socketFull.reportsPanel_1cea99f001")
            : confirmAction?.report.unverified
              ? socketI18n.t("socketFull.reportsPanel_b2090b103d")
              : socketI18n.t("socketFull.reportsPanel_5c6f7e3163")
        }
        description={
          confirmAction?.action === "delete_all_and_ban" ? (
            <><Trans i18n={socketI18n} i18nKey="socketFull.deleteAllAndBanDescription" values={{ name: confirmAction.report.senderNickname || socketI18n.t("socketFull.reportsPanel_4ae773f31c") }} components={{ all: <strong />, name: <strong /> }} /></>
          ) : confirmAction?.report.unverified ? (
            socketI18n.t("socketFull.reportsPanel_0c6c287cb6")
          ) : (
            socketI18n.t("socketFull.reportsPanel_fa4eac669f")
          )
        }
        confirmLabel={
          confirmAction?.action === "delete_all_and_ban"
            ? socketI18n.t("socketFull.reportsPanel_5cb690b0d7")
            : confirmAction?.report.unverified
              ? socketI18n.t("socketFull.reportsPanel_e2101cff8e")
              : socketI18n.t("socketFull.reportsPanel_3f719800c2")
        }
        onConfirm={() => {
          if (!confirmAction) return;
          if (confirmAction.action === "delete_all_and_ban") {
            handleDeleteAllAndBan(confirmAction.report);
          } else {
            handleDelete(confirmAction.report);
          }
        }}
      />

      <ConfirmDialog
        open={!!confirmUserAction}
        onOpenChange={(open) => !open && setConfirmUserAction(null)}
        title={
          <>
            {confirmUserAction?.action === "ban" ? socketI18n.t("socketFull.reportsPanel_19b2282d14") : socketI18n.t("socketFull.reportsPanel_cf95f06020")}{" "}
            {confirmUserAction?.report.reportedNickname ||
              (confirmUserAction ? getNickname(confirmUserAction.report.reportedServerUserId) : "")}
            ?
          </>
        }
        description={
          <>
            {confirmUserAction?.action === "ban"
              ? socketI18n.t("socketFull.reportsPanel_3cb0084e3f")
              : socketI18n.t("socketFull.reportsPanel_f789489538")}{" "}{socketI18n.t("socketFull.reportsPanel_216ea21c4c")}</>
        }
        confirmLabel={confirmUserAction?.action === "ban" ? socketI18n.t("socketFull.reportsPanel_19b2282d14") : socketI18n.t("socketFull.reportsPanel_cf95f06020")}
        onConfirm={() => {
          if (!confirmUserAction) return;
          resolveUser(confirmUserAction.report, confirmUserAction.action);
        }}
      />
    </>
  );
}

function UserReportCard({
  report,
  getNickname,
  canKick,
  canBan,
  onDismiss,
  onKick,
  onBan,
}: {
  report: AggregatedUserReport;
  getNickname: (id: string) => string;
  canKick: boolean;
  canBan: boolean;
  onDismiss: () => void;
  onKick: () => void;
  onBan: () => void;
}) {
  useSocketTranslation();
  const name = report.reportedNickname || getNickname(report.reportedServerUserId);

  return (
    <div style={{
        border: "1px solid var(--gryt-neutral-6)",
        borderRadius: "var(--gryt-radius-lg)",
        padding: "14px",
        background: "var(--gryt-neutral-2)",
      }}>
      <div className="flex gap-3 items-start">
        <div className="flex flex-col gap-2" style={{ flex: 1, minWidth: 0 }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold" style={{ color: "var(--gryt-neutral-12)" }}>
              {name}
            </span>
            <Chip tone="danger">
              {report.reportCount} {report.reportCount === 1 ? socketI18n.t("socketFull.reportsPanel_4fd06eef30") : socketI18n.t("socketFull.reportsPanel_e7ccabb120")}
            </Chip>
          </div>

          {/* Every reason, each with the person who wrote it. Two people
              describing the same evening differently is the thing a moderator
              most needs to see, so they are not merged or truncated. */}
          <div className="flex flex-col gap-2">
            {report.reasons.map((entry, idx) => (
              <div
                key={`${entry.reporterServerUserId}-${idx}`}
                style={{
                  background: "var(--gryt-neutral-3)",
                  borderRadius: "var(--gryt-radius-md)",
                  padding: "10px 12px",
                  borderLeft: "3px solid var(--gryt-danger-8)",
                }}
              >
                <span className="text-sm" style={{
                    color: "var(--gryt-neutral-11)",
                    wordBreak: "break-word",
                    whiteSpace: "pre-wrap",
                  }}>
                  {entry.reason}
                </span>
                {/* The snapshot first. `getNickname` reads the live member
                    list, which no longer holds somebody who has left — and the
                    reporter leaving is the ordinary case here. */}
                <div className="text-xs text-gryt-muted" style={{ marginTop: 6 }}>
                  {entry.reporterNickname || getNickname(entry.reporterServerUserId)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2 items-center" style={{ flexShrink: 0 }}>
          {/* Named as well as tooltipped. A tooltip is not an accessible name,
              and three unlabelled icons on a moderation card are three
              identical buttons to a screen reader. */}
          <Tooltip title={socketI18n.t("socketFull.reportsPanel_76e8df43b2")}>
            <IconButton
              tone="neutral"
              size="medium"
              aria-label={socketI18n.t("socketFull.reportsPanel_2f337b855e", { p0: (name) })}
              onClick={onDismiss}
              style={{ cursor: "pointer" }}
            >
              <PiCheck size={18} />
            </IconButton>
          </Tooltip>

          {canKick && (
            <Tooltip title={socketI18n.t("socketFull.reportsPanel_8e9553b5ed")}>
              <IconButton
                tone="danger"
                size="medium"
                aria-label={socketI18n.t("socketFull.reportsPanel_4877ca3b43", { p0: (name) })}
                onClick={onKick}
                style={{ cursor: "pointer" }}
              >
                <PiBootFill size={18} />
              </IconButton>
            </Tooltip>
          )}

          {canBan && (
            <Tooltip title={socketI18n.t("socketFull.reportsPanel_1e0cb74777")}>
              <IconButton
                tone="danger"
                size="medium"
                aria-label={socketI18n.t("socketFull.reportsPanel_bfe9009f51", { p0: (name) })}
                onClick={onBan}
                style={{ cursor: "pointer" }}
              >
                <PiProhibitFill size={18} />
              </IconButton>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}

/** One attachment on a reported message. Its own component so its URLs survive a file token refresh. */
function ReportAttachment({
  fileId,
  meta,
  serverHost,
  onOpenImage,
}: {
  fileId: string;
  meta: AttachmentMeta | undefined;
  serverHost: string;
  onOpenImage: (src: string, alt: string) => void;
}) {
  useSocketTranslation();
  const { chatMediaVolume, setChatMediaVolume } = useSettings();
  const [url, refreshUrl] = useStableFileUrl(serverHost, fileId);
  const [thumbUrl, refreshThumb] = useStableFileUrl(serverHost, fileId, true);
  const mime = meta?.mime || "";
  const name = meta?.original_name || socketI18n.t("socketFull.reportsPanel_6f6cfef69c");

  if (mime.startsWith("image/")) {
    return (
      <img
        src={url}
        alt={name}
        style={{
          maxWidth: "100%",
          maxHeight: 200,
          borderRadius: "var(--gryt-radius-md)",
          cursor: "pointer",
          objectFit: "contain",
        }}
        onError={refreshUrl}
        onClick={() => onOpenImage(url, name)}
      />
    );
  }

  if (mime.startsWith("video/")) {
    return (
      <ChatMediaPlayer
        src={url}
        type="video"
        poster={meta?.has_thumbnail ? thumbUrl : undefined}
        fileName={meta?.original_name}
        size={meta?.size}
        width={meta?.width}
        height={meta?.height}
        volume={chatMediaVolume}
        onVolumeChange={setChatMediaVolume}
        onError={refreshUrl}
        onPosterError={refreshThumb}
      />
    );
  }

  return (
    <FileCard
      fileId={fileId}
      mime={meta?.mime ?? null}
      size={meta?.size ?? null}
      originalName={meta?.original_name ?? null}
      serverHost={serverHost}
    />
  );
}

function ReportCard({
  report,
  getNickname,
  serverHost,
  onApprove,
  onDelete,
  onDeleteAllAndBan,
}: {
  report: AggregatedReport;
  getNickname: (id: string) => string;
  serverHost: string;
  onApprove: () => void;
  onDelete: () => void;
  onDeleteAllAndBan: () => void;
}) {
  useSocketTranslation();
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);

  return (
    <>
      <div style={{
          border: "1px solid var(--gryt-neutral-6)",
          borderRadius: "var(--gryt-radius-lg)",
          padding: "14px",
          background: "var(--gryt-neutral-2)",
        }}>
        <div className="flex gap-3 items-start">
          <div className="flex flex-col gap-2" style={{ flex: 1, minWidth: 0 }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold" style={{ color: "var(--gryt-neutral-12)" }}>
                {report.senderNickname || getNickname(report.senderServerUserId)}
              </span>
              <Chip tone="danger">
                {report.reportCount} {report.reportCount === 1 ? socketI18n.t("socketFull.reportsPanel_4fd06eef30") : socketI18n.t("socketFull.reportsPanel_e7ccabb120")}
              </Chip>
              {report.unverified && (
                <Tooltip title={socketI18n.t("socketFull.reportsPanel_8eb68441d2")}>
                  <Chip>{socketI18n.t("socketFull.reportsPanel_0cfa33c017")}</Chip>
                </Tooltip>
              )}
            </div>

            <div style={{
                background: "var(--gryt-neutral-3)",
                borderRadius: "var(--gryt-radius-md)",
                padding: "10px 12px",
                borderLeft: "3px solid var(--gryt-danger-8)",
              }}>
              {report.messageText && (
                <span className="text-sm" style={{
                    color: "var(--gryt-neutral-11)",
                    wordBreak: "break-word",
                    whiteSpace: "pre-wrap",
                  }}>
                  {report.messageText}
                </span>
              )}

              {report.attachments && report.attachments.length > 0 && serverHost && (
                <div className="flex gap-2 flex-wrap flex-col" style={{ marginTop: report.messageText ? "8px" : undefined }}>
                  {report.attachments.map((fileId, idx) => (
                    <ReportAttachment
                      key={fileId}
                      fileId={fileId}
                      meta={report.enrichedAttachments?.[idx]}
                      serverHost={serverHost}
                      onOpenImage={(src, alt) => setLightboxImage({ src, alt })}
                    />
                  ))}
                </div>
              )}

              {!report.messageText && (!report.attachments || report.attachments.length === 0) && (
                <span className="text-sm text-gryt-muted" style={{ fontStyle: "italic" }}>{socketI18n.t("socketFull.reportsPanel_e9075af20b")}</span>
              )}
            </div>

            <div className="flex items-center gap-1">
              <span className="text-xs text-gryt-muted">{socketI18n.t("socketFull.reportsPanel_60b2027d89")}{" "}
                {report.reporters.map((r) => getNickname(r)).join(", ")}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 items-center" style={{ flexShrink: 0 }}>
            <Tooltip title={socketI18n.t("socketFull.reportsPanel_3c8ede906a")}>
              <IconButton tone="neutral" size="medium"
                onClick={onApprove}
                style={{ cursor: "pointer" }}
              >
                <PiCheck size={18} />
              </IconButton>
            </Tooltip>

            <Tooltip title={report.unverified ? socketI18n.t("socketFull.reportsPanel_14de4ff717") : socketI18n.t("socketFull.reportsPanel_ff3107fd9b")}>
              <IconButton tone="danger" size="medium"
                onClick={onDelete}
                style={{ cursor: "pointer" }}
              >
                <PiTrashFill size={18} />
              </IconButton>
            </Tooltip>

            <Tooltip title={socketI18n.t("socketFull.reportsPanel_0d7d105f19")}>
              <IconButton tone="danger" size="medium"
                onClick={onDeleteAllAndBan}
                style={{ cursor: "pointer" }}
              >
                <PiProhibitFill size={18} />
              </IconButton>
            </Tooltip>
          </div>
        </div>
      </div>
      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </>
  );
}
