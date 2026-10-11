import { Button, Surface } from "@gryt/ui";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { useSocketEvent } from "../hooks/useSocketEvent";
import { describeActor } from "../lib/actorName";

type AuditItem = {
  createdAt: string | Date;
  eventId: string;
  actorServerUserId: string | null;
  action: string;
  target: string | null;
  meta: Record<string, unknown> | string | null;
};

function fmt(v: string | Date): string {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toLocaleString(socketI18n.resolvedLanguage) : String(v || "");
}

export function ServerAuditTab({
  host,
  socket,
  accessToken,
}: {
  host: string;
  socket?: Socket;
  accessToken: string | null;
}) {
  useSocketTranslation();
  const [items, setItems] = useState<AuditItem[]>([]);

  const refresh = () => {
    if (!socket || !socket.connected) return toast.error(socketI18n.t("socketFull.serverAuditTab_213e89eca7"));
    if (!accessToken) return toast.error(socketI18n.t("socketFull.serverAuditTab_097a88ed92"));
    socket.emit("server:audit:list", { accessToken, limit: 100 });
  };

  useSocketEvent<{ items: AuditItem[] }>(socket, "server:audit", (payload) => {
    setItems(Array.isArray(payload?.items) ? payload.items : []);
  });

  useEffect(() => {
    if (!host) return;
    if (!socket?.connected) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, socket?.connected]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end gap-2">
        <Button tone="neutral" size="small" onClick={refresh}>{socketI18n.t("settingsFull.m56e3badc4e")}</Button>
      </div>

      <div className="flex flex-col gap-2">
        {items.length === 0 ? (
          <span className="text-sm text-gryt-muted">{socketI18n.t("socketFull.serverAuditTab_33b409dfd4")}</span>
        ) : (
          items.map((it) => (
            <Surface key={it.eventId}>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-bold">
                  {it.action}
                  {it.target ? ` · ${it.target}` : ""}
                </span>
                <span className="text-xs text-gryt-muted">
                  {fmt(it.createdAt)}{" "}{socketI18n.t("socketFull.serverAuditTab_92acf39403")}{" "}{describeActor(it.actorServerUserId).label}
                </span>
                {it.meta ? (
                  <span className="text-xs text-gryt-muted" style={{ whiteSpace: "pre-wrap" }}>
                    {typeof it.meta === "string" ? it.meta : JSON.stringify(it.meta, null, 2)}
                  </span>
                ) : null}
              </div>
            </Surface>
          ))
        )}
      </div>
    </div>
  );
}

