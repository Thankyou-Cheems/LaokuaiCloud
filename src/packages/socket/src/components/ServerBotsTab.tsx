import { Button, Checkbox, IconButton, Surface, Switch } from "@gryt/ui";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Trans } from "react-i18next";
import type { Socket } from "socket.io-client";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { PiCopyBold, PiTrashBold } from "../../../../lib/icons";
import { useSocketEvent } from "../hooks/useSocketEvent";
import { describePermission } from "../lib/permissions";

type BotStatus = "pending" | "approved" | "denied";

type BotEntry = {
  registrationId: string;
  botId: string | null;
  nickname: string;
  description: string | null;
  requested: string[];
  granted: string[];
  rank: number;
  status: BotStatus;
  awaitingClaim: boolean;
  createdAt: string | Date;
  decidedAt: string | Date | null;
};

/**
 * Bots, and what they have been allowed to do. **You are agreeing to a list, and
 * the list is the bot's** — there is no way to add to it from this side.
 */
export function ServerBotsTab({
  host,
  socket,
  accessToken,
}: {
  host: string;
  socket?: Socket;
  accessToken: string | null;
}) {
  useSocketTranslation();
  const [bots, setBots] = useState<BotEntry[] | null>(null);
  const [policy, setPolicy] = useState<"request" | "disabled">("disabled");
  const [ticked, setTicked] = useState<Record<string, Set<string>>>({});
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ nickname: string; token: string } | null>(null);

  const refresh = () => {
    if (!socket?.connected || !accessToken) return;
    socket.emit("server:bots:list", { accessToken });
  };

  useSocketEvent<{ bots: BotEntry[]; policy: "request" | "disabled" }>(
    socket,
    "server:bots",
    (payload) => {
    const list = Array.isArray(payload?.bots) ? payload.bots : [];
    setBots(list);
    setPolicy(payload?.policy === "request" ? "request" : "disabled");
    setBusy(false);
    // Everything a pending bot asked for starts ticked. The operator takes things
    // away, which makes the shorter grant the easy one.
    setTicked((prev) => {
      const next = { ...prev };
      for (const b of list) {
        if (b.status === "pending" && !next[b.registrationId]) {
          next[b.registrationId] = new Set(b.requested);
        }
      }
      return next;
    });
    },
  );

  useSocketEvent<{ claimToken: string; nickname: string }>(
    socket,
    "server:bot:registered",
    (payload) => {
      if (!payload?.claimToken) return;
      // Shown once and never again — the server does not include it in the
      // list, so there is nowhere to go back and read it.
      setIssued({ nickname: payload.nickname, token: payload.claimToken });
    },
  );

  useEffect(() => {
    if (!host || !socket?.connected || !accessToken) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, socket?.connected, accessToken]);

  const emit = (event: string, payload: Record<string, unknown>) => {
    if (!socket?.connected) return toast.error(socketI18n.t("socketFull.serverBotsTab_213e89eca7"));
    if (!accessToken) return toast.error(socketI18n.t("socketFull.serverBotsTab_097a88ed92"));
    setBusy(true);
    socket.emit(event, { accessToken, ...payload });
  };

  const toggle = (registrationId: string, permission: string, on: boolean) => {
    setTicked((prev) => {
      const set = new Set(prev[registrationId] ?? []);
      if (on) set.add(permission);
      else set.delete(permission);
      return { ...prev, [registrationId]: set };
    });
  };

  const pending = useMemo(() => (bots ?? []).filter((b) => b.status === "pending"), [bots]);
  const settled = useMemo(() => (bots ?? []).filter((b) => b.status !== "pending"), [bots]);

  if (!bots) {
    return <span className="text-sm text-gryt-muted">{socketI18n.t("socketFull.serverBotsTab_ac51e53197")}</span>;
  }

  return (
    <div className="flex flex-col gap-6">
      <span className="text-sm text-gryt-muted">{socketI18n.t("socketFull.serverBotsTab_623c38d83a")}</span>

      <Surface>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex flex-col" style={{ maxWidth: "34rem" }}>
            <span className="text-sm font-bold">{socketI18n.t("socketFull.serverBotsTab_58920e6ccc")}</span>
            <span className="text-xs text-gryt-muted">{socketI18n.t("socketFull.serverBotsTab_fdf1ef2074")}</span>
          </div>
          <Switch
            checked={policy === "request"}
            disabled={busy}
            onCheckedChange={(on: boolean) =>
              emit("server:bots:policy:set", { policy: on ? "request" : "disabled" })
            }
          />
        </div>
      </Surface>

      {issued && (
        <Surface>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-bold">{issued.nickname}{" "}{socketI18n.t("socketFull.serverBotsTab_3445197b2e")}</span>
            <span className="text-xs text-gryt-muted"><Trans i18n={socketI18n} i18nKey="socketFull.botTokenInstructions" components={{ token: <code /> }} /></span>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-xs" style={{ wordBreak: "break-all" }}>{issued.token}</code>
              <IconButton
                tone="neutral"
                size="xsmall"
                aria-label={socketI18n.t("socketFull.serverBotsTab_70f703ba75")}
                onClick={() => {
                  navigator.clipboard.writeText(issued.token).then(
                    () => toast.success(socketI18n.t("settingsFull.m8e3df45a49")),
                    () => toast.error(socketI18n.t("settingsFull.m4dfbe46077")),
                  );
                }}
              >
                <PiCopyBold size={14} />
              </IconButton>
              <Button tone="ghost" size="xsmall" onClick={() => setIssued(null)}>{socketI18n.t("socketFull.serverBotsTab_b55ea16820")}</Button>
            </div>
          </div>
        </Surface>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col">
          <span className="text-sm font-bold">{socketI18n.t("socketFull.serverBotsTab_ff6e6c9a18")}</span>
          <span className="text-xs text-gryt-muted">{socketI18n.t("socketFull.serverBotsTab_b4300ee3d0")}</span>
        </div>

        {pending.length === 0 ? (
          <span className="text-sm text-gryt-muted">{socketI18n.t("socketFull.serverBotsTab_adb3211d9c")}</span>
        ) : (
          pending.map((bot) => {
            const chosen = ticked[bot.registrationId] ?? new Set<string>();
            return (
              <Surface key={bot.registrationId}>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-bold">{bot.nickname}</span>
                    {bot.description && (
                      <span className="text-xs text-gryt-muted">{bot.description}</span>
                    )}
                    <span className="text-xs text-gryt-muted" style={{ wordBreak: "break-all" }}>
                      {bot.botId}
                    </span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-gryt-muted"><Trans i18n={socketI18n} i18nKey="socketFull.botPermissionRequest" values={{ count: bot.requested.length }} count={bot.requested.length} /></span>
                    {bot.requested.length === 0 ? (
                      <span className="text-sm text-gryt-muted">{socketI18n.t("socketFull.serverBotsTab_50b6f1689a")}</span>
                    ) : (
                      bot.requested.map((permission) => {
                        const meta = describePermission(permission);
                        return (
                          <label
                            key={permission}
                            className="flex items-start gap-2 text-sm"
                            style={{ cursor: "pointer" }}
                          >
                            <Checkbox
                              checked={chosen.has(permission)}
                              onCheckedChange={(checked) =>
                                toggle(bot.registrationId, permission, checked)
                              }
                              style={{ marginTop: "0.3em" }}
                            />
                            <span className="flex flex-col">
                              <span>{meta.label}</span>
                              {meta.description && (
                                <span className="text-xs text-gryt-muted">{meta.description}</span>
                              )}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      tone="neutral"
                      size="small"
                      disabled={busy}
                      onClick={() => emit("server:bots:decide", { botId: bot.botId, decision: "denied" })}
                    >{socketI18n.t("socketFull.serverBotsTab_43aacd97da")}</Button>
                    <Button
                      size="small"
                      disabled={busy}
                      onClick={() =>
                        emit("server:bots:decide", {
                          botId: bot.botId,
                          decision: "approved",
                          permissions: [...chosen],
                        })
                      }
                    >{socketI18n.t("socketFull.serverBotsTab_45645b65b8")}{" "}{chosen.size}
                    </Button>
                  </div>
                </div>
              </Surface>
            );
          })
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col">
          <span className="text-sm font-bold">{socketI18n.t("socketFull.serverBotsTab_1094b7db86")}</span>
          <span className="text-xs text-gryt-muted">{socketI18n.t("socketFull.serverBotsTab_7bb745022f")}</span>
        </div>
        <RegisterBot busy={busy} onCreate={(nickname) => emit("server:bots:register", { nickname, permissions: [] })} />
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-sm font-bold">{socketI18n.t("socketFull.serverBotsTab_193b8769b3")}</span>
        {settled.length === 0 ? (
          <span className="text-sm text-gryt-muted">{socketI18n.t("socketFull.serverBotsTab_8404f67dac")}</span>
        ) : (
          settled.map((bot) => (
            <Surface key={bot.registrationId}>
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-bold">
                    {bot.nickname}{" "}
                    <span className="text-xs text-gryt-muted">
                      {bot.status === "approved" ? socketI18n.t("socketFull.serverBotsTab_e9fba9e004") : socketI18n.t("socketFull.serverBotsTab_df0a7cbd03")}
                      {bot.awaitingClaim ? socketI18n.t("socketFull.serverBotsTab_ae40dc8300") : ""}
                    </span>
                  </span>
                  <span className="text-xs text-gryt-muted">
                    {bot.granted.length > 0
                      ? bot.granted.map((p) => describePermission(p).label).join(", ")
                      : socketI18n.t("socketFull.serverBotsTab_8ad616eb54")}
                  </span>
                </div>
                <IconButton
                  tone="danger"
                  size="xsmall"
                  aria-label={socketI18n.t("socketFull.serverBotsTab_ded7599589")}
                  disabled={busy}
                  onClick={() => emit("server:bots:revoke", { registrationId: bot.registrationId })}
                >
                  <PiTrashBold size={14} />
                </IconButton>
              </div>
            </Surface>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Naming a bot that does not exist yet. Created with no permissions on purpose: a
 * half-filled form leaves a bot that can do nothing.
 */
function RegisterBot({ busy, onCreate }: { busy: boolean; onCreate: (nickname: string) => void }) {
  useSocketTranslation();
  const [nickname, setNickname] = useState("");

  return (
    <Surface>
      <div className="flex items-end gap-2 flex-wrap">
        <label className="flex flex-col gap-1 text-sm" style={{ flex: "1 1 12rem" }}>
          <span className="text-gryt-muted text-xs">{socketI18n.t("socketFull.serverBotsTab_9baa3497a7")}</span>
          <input
            value={nickname}
            maxLength={32}
            placeholder={socketI18n.t("socketFull.serverBotsTab_041725430c")}
            onChange={(e) => setNickname(e.target.value)}
            className="bg-transparent border-b border-gryt-border outline-none"
          />
        </label>
        <Button
          size="small"
          disabled={busy || !nickname.trim()}
          onClick={() => {
            onCreate(nickname.trim());
            setNickname("");
          }}
        >{socketI18n.t("socketFull.serverBotsTab_5f8434b698")}</Button>
      </div>
    </Surface>
  );
}
