import { Button, Surface, Switch, TextField } from "@gryt/ui";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Trans } from "react-i18next";
import type { Socket } from "socket.io-client";

import {
  ADD_PUBLIC_ADDRESS,
  hostedAdvertisement,
  inviteLink,
  NO_PUBLIC_ADDRESS,
  openServerLink,
  pickShareableHost,
} from "@/common";
import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";
import { useEmbeddedServer } from "@/settings/src/hooks/useEmbeddedServer";

import { PiCopyFill, PiInfoFill, PiPlus } from "../../../../lib/icons";
import { useOpenInviteLink } from "../hooks/useOpenInviteLink";
import { useServerJoinPolicy } from "../hooks/useServerJoinPolicy";
import { useSocketEvent } from "../hooks/useSocketEvent";
import {
  DEFAULT_INVITE_HOURS,
  invitationLimits,
  inviteAvailability,
} from "../lib/inviteManagement";

export type InviteItem = {
  code: string;
  createdAt?: string | Date;
  expiresAt?: string | Date | null;
  maxUses?: number;
  usesRemaining?: number;
  usesConsumed?: number;
  revoked?: boolean;
  passwordBypass?: boolean;
  note?: string | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isInviteItem(v: unknown): v is InviteItem {
  if (!isRecord(v)) return false;
  return typeof v.code === "string" && v.code.trim().length > 0;
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatExpiry(d: Date | null): string {
  if (!d) return socketI18n.t("socketFull.serverInvitesTab_d8b568313d");
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return socketI18n.t("socketFull.serverInvitesTab_414c2efcb5");
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(" ");
}

function formatUses(remaining: number | undefined, max: number | undefined): string {
  const isInfinite = typeof max === "number" && max < 0;
  if (isInfinite) return "∞";
  if (remaining === undefined) return "?";
  if (typeof max === "number") return `${remaining} / ${max}`;
  return String(remaining);
}

export function ServerInvitesTab({
  host,
  socket,
  accessToken,
}: {
  host: string;
  socket?: Socket;
  accessToken: string | null;
}) {
  useSocketTranslation();
  const { servers: embeddedServers } = useEmbeddedServer();

  /* The embedded server this host is, if it is one. Matched on the port, since a
     locally hosted server is only reached over loopback. */
  const advertised = useMemo(
    () => hostedAdvertisement(host, embeddedServers),
    [host, embeddedServers],
  );

  /* On a server anyone can join, the address is enough, and the codes below are for roles and limits. */
  const isOpen = useServerJoinPolicy(host) === "open";
  const openLink = useMemo(() => openServerLink(host, advertised), [host, advertised]);
  const { copy: copyOpenLink } = useOpenInviteLink(host);

  const [invites, setInvites] = useState<InviteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const [maxUses, setMaxUses] = useState<string>("1");
  const [infiniteUses, setInfiniteUses] = useState(false);
  const [expiresInHours, setExpiresInHours] = useState<string>(String(DEFAULT_INVITE_HOURS));
  const [note, setNote] = useState<string>("");
  const [, setTick] = useState(0);

  useEffect(() => {
    const hasExpiring = invites.some((i) => !i.revoked && i.expiresAt);
    if (!hasExpiring) return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [invites]);

  const refresh = async () => {
    if (!socket || !socket.connected) {
      toast.error(socketI18n.t("socketFull.serverInvitesTab_213e89eca7"));
      return;
    }
    if (!accessToken) {
      toast.error(socketI18n.t("socketFull.serverInvitesTab_097a88ed92"));
      return;
    }
    setLoading(true);
    try {
      socket.emit("server:invites:list", { accessToken });
    } finally {
      setLoading(false);
    }
  };

  useSocketEvent<unknown>(socket, "server:invites", (payload) => {
    const raw = isRecord(payload) ? payload.invites : undefined;
    const items = Array.isArray(raw) ? raw.filter(isInviteItem) : [];
    setInvites(items);
  });

  useSocketEvent<unknown>(socket, "server:invite:created", (payload) => {
    const raw = isRecord(payload) ? payload.invite : undefined;
    if (!isInviteItem(raw)) return;
    setInvites((prev) => [raw, ...prev.filter((p) => p.code !== raw.code)]);
    toast.success(socketI18n.t("socketFull.serverInvitesTab_be10774a2b"));
  });

  useSocketEvent<unknown>(socket, "server:invite:revoked", (payload) => {
    if (!isRecord(payload)) return;
    const code = payload.code;
    const revoked = payload.revoked;
    if (typeof code !== "string" || typeof revoked !== "boolean") return;
    setInvites((prev) => prev.map((i) => (i.code === code ? { ...i, revoked } : i)));
  });

  useEffect(() => {
    if (!host) return;
    if (!socket?.connected) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, socket?.connected]);

  const create = async () => {
    if (!socket || !socket.connected) return toast.error(socketI18n.t("socketFull.serverInvitesTab_213e89eca7"));
    if (!accessToken) return toast.error(socketI18n.t("socketFull.serverInvitesTab_097a88ed92"));

    const limits = invitationLimits(maxUses, expiresInHours, infiniteUses);
    if (!limits.ok) return toast.error(socketI18n.t(limits.messageKey));

    setCreating(true);
    try {
      socket.emit("server:invites:create", {
        accessToken,
        ...(limits.infinite ? { infinite: true } : { maxUses: limits.maxUses }),
        expiresInHours: limits.expiresInHours,
        note: note.trim().length ? note.trim() : null,
        passwordBypass: true,
        grantsRole: null,
      });
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (code: string) => {
    if (!socket || !socket.connected) return toast.error(socketI18n.t("socketFull.serverInvitesTab_213e89eca7"));
    if (!accessToken) return toast.error(socketI18n.t("socketFull.serverInvitesTab_097a88ed92"));
    socket.emit("server:invites:revoke", { accessToken, code });
  };

  const copy = async (code: string) => {
    // A server started from the desktop app is connected to on 127.0.0.1, and a
    // link naming that tells the receiver to connect to their own machine (GRYT-135).
    const shareable = pickShareableHost(host, advertised);

    if (shareable.kind === "loopback-only") {
      toast.error(socketI18n.t("socketFull.serverInvitesTab_907bd4ff3e"), { duration: 7000 });
      toast(
        socketI18n.t("socketFull.serverInvitesTab_7655eed2b8"),
        { duration: 10000, icon: <PiInfoFill size={18} /> },
      );
      return;
    }

    try {
      const url = inviteLink(shareable.host, code);
      await navigator.clipboard.writeText(url);
      toast.success(
        shareable.host === host
          ? socketI18n.t("socketFull.serverInvitesTab_020ddde956")
          : socketI18n.t("socketFull.serverInvitesTab_f25019db34", { p0: (shareable.host) }),
      );
    } catch {
      toast.error(socketI18n.t("ui.failedToCopy"));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <span className="text-sm">
        {socketI18n.t("invite.adminAdmission")}
      </span>

      {isOpen && (
        <Surface>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{socketI18n.t("socketFull.serverInvitesTab_2b9f187864")}</span>
            {openLink.kind === "ok" ? (
              <>
                <div className="flex items-center gap-2">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <TextField readOnly aria-label={socketI18n.t("socketFull.serverInvitesTab_2b9f187864")} value={openLink.url} />
                  </div>
                  <Button size="small" onClick={() => void copyOpenLink()}>
                    <PiCopyFill size={16} />{socketI18n.t("settingsFull.maf74f7c536")}</Button>
                </div>
                <span className="text-xs text-gryt-muted">{socketI18n.t("socketFull.serverInvitesTab_c8c29e3d73")}</span>
              </>
            ) : (
              <span className="text-xs text-gryt-muted">
                {openLink.hosted ? `${NO_PUBLIC_ADDRESS} ${ADD_PUBLIC_ADDRESS}` : NO_PUBLIC_ADDRESS}
              </span>
            )}
          </div>
        </Surface>
      )}

      <Surface>
        <div className="flex flex-col gap-3">
          <div className="flex gap-3 flex-wrap">
            <div className="flex items-center gap-2" style={{ minWidth: 170, paddingTop: 22 }}>
              <Switch checked={infiniteUses} onCheckedChange={setInfiniteUses} />
              <span className="text-sm font-medium">{socketI18n.t("socketFull.serverInvitesTab_71b17d42c3")}</span>
            </div>
            <div className="flex flex-col gap-1" style={{ minWidth: 140 }}>
              <span className="text-sm font-medium">{socketI18n.t("socketFull.serverInvitesTab_be07e6d79f")}</span>
              <TextField
                value={infiniteUses ? "∞" : maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder="1"
                disabled={infiniteUses}
              />
            </div>
            <div className="flex flex-col gap-1" style={{ minWidth: 180 }}>
              <span className="text-sm font-medium">{socketI18n.t("socketFull.serverInvitesTab_1506db9c93")}</span>
              <TextField
                value={expiresInHours}
                onChange={(e) => setExpiresInHours(e.target.value)}
                placeholder={String(DEFAULT_INVITE_HOURS)}
              />
            </div>
            <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 220 }}>
              <span className="text-sm font-medium">{socketI18n.t("socketFull.serverInvitesTab_4f584cbf09")}</span>
              <TextField value={note} onChange={(e) => setNote(e.target.value)} placeholder={socketI18n.t("ui.optional")} />
            </div>
          </div>
          <span className="text-xs text-gryt-muted">{socketI18n.t("invite.ordinaryMember")}</span>
          <div className="flex justify-end gap-2">
            <Button size="small" onClick={refresh} disabled={creating || loading}>{socketI18n.t("settingsFull.m56e3badc4e")}</Button>
            <Button size="small" onClick={create} disabled={creating}>
              <PiPlus size={16} />{socketI18n.t("socketFull.serverInvitesTab_67e3875baa")}</Button>
          </div>
        </div>
      </Surface>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{socketI18n.t("socketFull.serverInvitesTab_2acd975afd")}</span>
        {invites.length === 0 ? (
          <span className="text-sm">{socketI18n.t("socketFull.serverInvitesTab_68f30dfa30")}</span>
        ) : (
          invites.map((i) => {
            const expiry = formatExpiry(toDate(i.expiresAt));
            const availability = inviteAvailability(i);
            const isInfinite = typeof i.maxUses === "number" && i.maxUses < 0;
            const uses = isInfinite
              ? `${typeof i.usesConsumed === "number" ? i.usesConsumed : 0} / ∞`
              : formatUses(i.usesRemaining, i.maxUses);
            return (
              <Surface key={i.code}>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-bold">
                        {i.code}
                      </span>
                      <span className="text-xs"><Trans i18n={socketI18n} i18nKey="socketFull.inviteUsageAndExpiry" values={{ uses, expiry, revoked: i.revoked ? socketI18n.t("socketFull.serverInvitesTab_2ee887aa5f") : "" }} /></span>
                      <span className="text-xs">{socketI18n.t(`invite.status.${availability}`)}{i.passwordBypass ? ` · ${socketI18n.t("invite.passwordFree")}` : ""}</span>
                      {i.note ? (
                        <span className="text-xs">
                          {i.note}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      <Button size="small" disabled={availability !== "active"} onClick={() => copy(i.code)}>
                        <PiCopyFill size={16} />{socketI18n.t("settingsFull.maf74f7c536")}</Button>
                      <Button size="small"
                        disabled={!!i.revoked}
                        onClick={() => revoke(i.code)}
                      >{socketI18n.t("socketFull.serverInvitesTab_575a7c4074")}</Button>
                    </div>
                  </div>
                </div>
              </Surface>
            );
          })
        )}
      </div>
    </div>
  );
}

