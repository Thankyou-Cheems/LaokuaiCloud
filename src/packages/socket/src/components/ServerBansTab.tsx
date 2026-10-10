import { Button, Chip, Surface } from "@gryt/ui";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { useSocketEvent } from "../hooks/useSocketEvent";
import { describeActor } from "../lib/actorName";

type BanItem = {
  gryt_user_id: string;
  banned_by_server_user_id: string;
  reason: string | null;
  created_at: string | Date;
  expires_at: string | Date | null;
  nickname: string | null;
  banned_by_nickname: string | null;
};

function fmt(v: string | Date): string {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toLocaleString(socketI18n.resolvedLanguage) : String(v || "");
}

/**
 * The bans list, and the only way to undo one — the events existed and nothing
 * emitted either, so a ban could only be lifted in the database.
 */
export function ServerBansTab({
  host,
  socket,
  accessToken,
  onUnban,
}: {
  host: string;
  socket?: Socket;
  accessToken: string | null;
  onUnban: (grytUserId: string) => void;
}) {
  useSocketTranslation();
  const [bans, setBans] = useState<BanItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = () => {
    if (!socket || !socket.connected) return toast.error(socketI18n.t("socketFull.serverBansTab_213e89eca7"));
    if (!accessToken) return toast.error(socketI18n.t("socketFull.serverBansTab_097a88ed92"));
    socket.emit("server:bans:list", { accessToken });
  };

  useSocketEvent<{ bans: BanItem[] }>(socket, "server:bans", (payload) => {
    setBans(Array.isArray(payload?.bans) ? payload.bans : []);
    setLoaded(true);
  });

  // Unbanning is answered by server:unban:success, not by a fresh list, so ask
  // for one rather than removing the row locally and hoping.
  useSocketEvent(socket, "server:unban:success", () => refresh());

  useEffect(() => {
    if (!host || !socket?.connected || !accessToken) return;
    socket.emit("server:bans:list", { accessToken });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, socket?.connected, accessToken]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gryt-muted">
          {loaded ? socketI18n.t("socketHooksFull.banCount", { count: bans.length }) : socketI18n.t("settingsFull.m33ce417454")}
        </span>
        <Button tone="neutral" size="xsmall" onClick={refresh}>{socketI18n.t("settingsFull.m56e3badc4e")}</Button>
      </div>

      {loaded && bans.length === 0 && (
        <span className="text-sm text-gryt-muted">{socketI18n.t("socketFull.serverBansTab_1478704468")}</span>
      )}

      {bans.map((ban) => (
        <Surface key={ban.gryt_user_id}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1" style={{ minWidth: 0 }}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">
                  {ban.nickname || ban.gryt_user_id}
                </span>
                {ban.expires_at ? (
                  <Chip tone="warning">{socketI18n.t("socketFull.serverBansTab_7aa87e4db7")}{" "}{fmt(ban.expires_at)}
                  </Chip>
                ) : (
                  <Chip tone="danger" label={socketI18n.t("socketFull.serverBansTab_2808e8eddc")} />
                )}
              </div>
              {ban.reason && <span className="text-xs">{ban.reason}</span>}
              <span className="text-xs text-gryt-muted">
                {fmt(ban.created_at)}
                {socketI18n.t("socketFull.serverBansTab_91bc247009", { p0: (describeActor(ban.banned_by_server_user_id, ban.banned_by_nickname).label) })}
              </span>
            </div>
            <Button tone="neutral" size="xsmall"
              onClick={() => onUnban(ban.gryt_user_id)}
              style={{ flexShrink: 0 }}
            >{socketI18n.t("socketFull.serverBansTab_2b4209c017")}</Button>
          </div>
        </Surface>
      ))}
    </div>
  );
}
