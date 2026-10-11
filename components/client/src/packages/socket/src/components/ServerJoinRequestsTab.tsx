import { Button, Surface } from "@gryt/ui";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Trans } from "react-i18next";
import type { Socket } from "socket.io-client";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { useSocketEvent } from "../hooks/useSocketEvent";

type JoinRequestItem = {
  grytUserId: string;
  nickname: string;
  note: string | null;
  createdAt: string | Date;
};

function fmt(v: string | Date): string {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toLocaleString(socketI18n.resolvedLanguage) : String(v || "");
}

/**
 * People waiting to be let in. Approving does not admit anybody on its own: the
 * server records the decision and they get in the next time they try.
 */
export function ServerJoinRequestsTab({
  host,
  socket,
  accessToken,
}: {
  host: string;
  socket?: Socket;
  accessToken: string | null;
}) {
  useSocketTranslation();
  const [requests, setRequests] = useState<JoinRequestItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);

  const refresh = () => {
    if (!socket || !socket.connected) return toast.error(socketI18n.t("socketFull.serverJoinRequestsTab_213e89eca7"));
    if (!accessToken) return toast.error(socketI18n.t("socketFull.serverJoinRequestsTab_097a88ed92"));
    socket.emit("server:joinRequests:list", { accessToken });
  };

  useSocketEvent<{ requests: JoinRequestItem[] }>(socket, "server:joinRequests", (payload) => {
    setRequests(Array.isArray(payload?.requests) ? payload.requests : []);
    setLoaded(true);
    setDeciding(null);
  });

  // The decision is answered on its own, and two moderators can be looking at the
  // same queue — so ask for the list again rather than dropping the row.
  useSocketEvent<{ grytUserId: string; decision: string }>(
    socket,
    "server:joinRequest:decided",
    (payload) => {
      toast.success(payload?.decision === "approved" ? socketI18n.t("socketFull.serverJoinRequestsTab_fca9d1d74c") : socketI18n.t("socketFull.serverJoinRequestsTab_8f8fabbb24"));
      refresh();
    },
  );

  useEffect(() => {
    if (!host || !socket?.connected || !accessToken) return;
    socket.emit("server:joinRequests:list", { accessToken });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, socket?.connected, accessToken]);

  const decide = (grytUserId: string, decision: "approved" | "denied") => {
    if (!socket?.connected || !accessToken) return toast.error(socketI18n.t("socketFull.serverJoinRequestsTab_213e89eca7"));
    setDeciding(grytUserId);
    socket.emit("server:joinRequests:decide", { accessToken, grytUserId, decision });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gryt-muted">
          {loaded
            ? socketI18n.t("socketHooksFull.peopleWaiting", { count: requests.length })
            : socketI18n.t("settingsFull.m33ce417454")}
        </span>
        <Button tone="neutral" size="xsmall" onClick={refresh}>{socketI18n.t("settingsFull.m56e3badc4e")}</Button>
      </div>

      <span className="text-xs text-gryt-muted" style={{ lineHeight: 1.4 }}><Trans i18n={socketI18n} i18nKey="socketFull.joinRequestPolicyExplanation" components={{ policy: <strong /> }} /></span>

      {loaded && requests.length === 0 && (
        <span className="text-sm text-gryt-muted">{socketI18n.t("socketFull.serverJoinRequestsTab_5a2c59b132")}</span>
      )}

      {requests.map((request) => (
        <Surface key={request.grytUserId}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1" style={{ minWidth: 0 }}>
              <span className="text-sm font-medium truncate">
                {request.nickname}
              </span>
              {request.note && (
                <span className="text-xs" style={{ overflowWrap: "anywhere" }}>
                  {request.note}
                </span>
              )}
              <span className="text-xs text-gryt-muted">
                {fmt(request.createdAt)}
              </span>
            </div>
            <div className="flex gap-2" style={{ flexShrink: 0 }}>
              <Button tone="neutral" size="xsmall"
                disabled={deciding === request.grytUserId}
                onClick={() => decide(request.grytUserId, "denied")}
              >{socketI18n.t("socketFull.serverJoinRequestsTab_fcbfdca1bd")}</Button>
              <Button tone="neutral" size="xsmall"
                disabled={deciding === request.grytUserId}
                onClick={() => decide(request.grytUserId, "approved")}
              >{socketI18n.t("socketFull.serverJoinRequestsTab_b606000286")}</Button>
            </div>
          </div>
        </Surface>
      ))}
    </div>
  );
}
