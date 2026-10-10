import { Alert, Avatar, Button, Chip, Divider, IconButton, Spinner, Surface, Tooltip } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";

import { GeneratedServerIcon, getServerHttpBase, normalizeHost } from "@/common";
import { i18n, LocalizedText, useTranslation } from "@/i18n";
import { useLanDiscovery } from "@/settings/src/hooks/useLanDiscovery";
import { fetchServerInfo, useServerJoin } from "@/settings/src/hooks/useServerJoin";
import {
  lanServerAddr,
  lanServerKey,
  useServerManagement,
} from "@/socket/src/hooks/useServerManagement";

import type { LanServer } from "../lib/electron";
import {
  PiArrowsClockwiseBold,
  PiBroadcastFill,
  PiWarningFill,
} from "../lib/icons";

/**
 * How long the pane looks before admitting it has found nothing. Discovery never
 * stops; servers that appear later replace the empty state.
 */
const EMPTY_AFTER_MS = 4000;

/**
 * Servers on this network, as a destination rather than a section of a modal. In
 * the join dialog the list fought the address field for the same column.
 */
export function Discovery() {
  useTranslation();
  const { lanServers, rescan } = useLanDiscovery();
  const { servers, setShowAddServer, markLanServersSeen, newLanServers } =
    useServerManagement();
  const { join, joiningHost } = useServerJoin();

  const [searchExpired, setSearchExpired] = useState(false);
  /** Whichever row's join failed, and why. Keyed so only that row says it. */
  const [rowErrors, setRowErrors] = useState<Record<string, { message: string; messageKey?: string; requiresInvite: boolean } | undefined>>({});
  const [connecting, setConnecting] = useState<string | null>(null);

  // Arriving here is the "look" the badge counts against, servers arriving while
  // it is open included. Flattened to a string: the array is fresh every render.
  const visibleKeys = lanServers.map(lanServerKey).join("|");

  // Which of these were new when we got here. Read before the effect marks them
  // seen and only added to, so a server keeps its mark for the visit.
  const newKeys = newLanServers.map(lanServerKey).join("|");
  const [newThisVisit, setNewThisVisit] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!newKeys) return;
    setNewThisVisit((prev) => {
      const next = new Set(prev);
      for (const key of newKeys.split("|")) next.add(key);
      return next.size === prev.size ? prev : next;
    });
  }, [newKeys]);

  useEffect(() => {
    if (!visibleKeys) return;
    markLanServersSeen(visibleKeys.split("|"));
  }, [visibleKeys, markLanServersSeen]);

  // A fresh scan on arrival rather than whatever was found at launch: discovery
  // announces each server once.
  useEffect(() => {
    rescan();

    setSearchExpired(false);
    const timer = window.setTimeout(() => setSearchExpired(true), EMPTY_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [rescan]);

  const handleJoin = useCallback(
    async (server: LanServer) => {
      const key = lanServerKey(server);
      const host = normalizeHost(lanServerAddr(server));

      setRowErrors((prev) => ({ ...prev, [key]: undefined }));
      setConnecting(key);

      try {
        const result = await fetchServerInfo(host);
        if (result.kind === "superseded") return;
        if (result.kind === "error") {
          setRowErrors((prev) => ({ ...prev, [key]: { get message() { return result.message; }, messageKey: result.messageKey, requiresInvite: false } }));
          return;
        }

        const outcome = await join({
          host,
          info: result.kind === "info" ? result.info : null,
        });

        if (!outcome.ok) {
          setRowErrors((prev) => ({ ...prev, [key]: { get message() { return outcome.message; }, messageKey: outcome.messageKey, requiresInvite: outcome.kind === "invite_required" } }));
        }
      } finally {
        setConnecting(null);
      }
    },
    [join],
  );

  const busy = connecting !== null || joiningHost !== null;

  // Servers already in the rail are not discoveries. Listed with a "Joined" chip
  // they put six local servers at the top of the what-is-new pane (GRYT-290).
  const isJoined = useCallback(
    (server: LanServer) => {
      // The address, and only the address. Comparing the TXT record's `server_id`
      // with `/info`'s hid every unjoined server on Windows and Linux (GRYT-527).
      const host = normalizeHost(lanServerAddr(server));
      return !!servers[host];
    },
    [servers],
  );

  const undiscovered = lanServers.filter((s) => !isJoined(s));
  const hiddenCount = lanServers.length - undiscovered.length;

  return (
    <div className="flex flex-col grow gap-4 p-6 overflow-auto">
      <div className="flex items-center gap-3">
        <PiBroadcastFill size={20} />
        <h2 className="text-xl">{<LocalizedText translationKey="shellFull.discovery_tsx_cffed7a2ef" />}</h2>

        <Tooltip title={i18n.t("shellFull.discovery_tsx_c394e963c1")}>
          <IconButton
            tone="neutral"
            size="xsmall"
            className="ml-auto"
            aria-label={i18n.t("shellFull.discovery_tsx_c394e963c1")}
            onClick={() => {
              setSearchExpired(false);
              setRowErrors({});
              rescan();
              window.setTimeout(() => setSearchExpired(true), EMPTY_AFTER_MS);
            }}
          >
            <PiArrowsClockwiseBold size={14} />
          </IconButton>
        </Tooltip>
      </div>

      <span className="text-gryt-muted">{<LocalizedText translationKey="shellFull.discovery_tsx_b2bd563070" />}</span>

      <Divider />

      {undiscovered.length === 0 && !searchExpired && (
        <div className="flex items-center gap-2">
          <Spinner />
          <span className="text-gryt-muted">{<LocalizedText translationKey="shellFull.discovery_tsx_1a6a5ba8c2" />}</span>
        </div>
      )}

      {undiscovered.length === 0 && searchExpired && (
        <div className="flex flex-col gap-2 items-start">
          {/* These conditions count what is left after the joined ones are
              filtered out, not what was found. Keying them off lanServers
              meant that once you had joined everything on the network the
              grid was empty and no empty state qualified, so the pane just
              went blank. */}
          <span className="text-gryt-muted">
            {hiddenCount > 0
              ? i18n.t("shellFull.noNewServers", { count: hiddenCount })
              : i18n.t("shellFull.discovery_tsx_ca91ae8868")}
          </span>
          <span className="text-gryt-muted">{<LocalizedText translationKey="shellFull.discovery_tsx_325e2918ab" />}</span>
          <Button tone="neutral" size="small" className="mt-2"
            onClick={() => setShowAddServer(true)}
          >{<LocalizedText translationKey="shellFull.discovery_tsx_5ee1e41320" />}</Button>
        </div>
      )}

      {/* A grid, not a list.
          
          Every card used to be full width with the join button shoved right by
          ml-auto, so on a wide screen it was a name, a few thousand pixels of
          nothing, and a button. auto-fill with a minmax track means the column
          count follows the window and the cards keep a sane width. */}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
      >
        {undiscovered.map((server) => {
          const key = lanServerKey(server);
          const addr = lanServerAddr(server);
          const host = normalizeHost(addr);

          const error = rowErrors[key];
          const isConnectingThis = connecting === key;
          const isNew = newThisVisit.has(key);

          return (
            <Surface key={key}>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  {/*
                    Streamed from the server's own /icon endpoint. Most servers
                    have never uploaded one and return 404, so the fallback is
                    the common case rather than the exception.
                  */}
                  {/* Squircle rather than a circle: a server is a place, and
                      the round ones in this app are people. */}
                  <Avatar
                    className="rounded-(--gryt-radius-md)"
                    src={`${getServerHttpBase(host)}/icon`}
                    fallback={<GeneratedServerIcon seed={server.name || host} />}
                  />

                  <div className="flex flex-col" style={{ minWidth: 0 }}>
                    <span className="font-bold truncate flex items-center gap-2">
                      <span className="truncate">{server.name}</span>
                      {/* Only for this visit. Arriving here marks everything
                          seen, so without the visit-scoped set above this would
                          flash once and vanish before it was read. */}
                      {isNew && <Chip tone="primary" label={i18n.t("shellFull.discovery_tsx_6403f2b7eb")} />}
                    </span>
                    {/*
                      Address only. The version is deliberately not shown:
                      surfacing it makes it trivial to scan a network for hosts
                      on a build with a known vulnerability. It is still in the
                      mDNS TXT record and in /info, so this is not a fix for
                      that — see GRYT-42.
                    */}
                    <span className="text-gryt-muted truncate">
                      {addr}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 ml-auto shrink-0">
                    <Button
                      size="xsmall"
                      disabled={busy || isConnectingThis}
                      startIcon={isConnectingThis ? <Spinner /> : undefined}
                      onClick={() => {
                        void handleJoin(server);
                      }}
                    >
                      {isConnectingThis ? i18n.t("shellFull.discovery_tsx_0bffd159bb") : i18n.t("shellFull.discovery_tsx_e0d73143de")}
                    </Button>
                  </div>
                </div>

                {error && (
                  <Alert severity="error" role="alert">
                    <span className="inline-flex items-center gap-2">
                      <PiWarningFill size={14} />
                      {error.messageKey ? i18n.t(error.messageKey) : error.message}
                      {/* An invite cannot be typed here, and saying so without
                          offering the field that takes one is a dead end. */}
                      {error.requiresInvite && (
                        <>
                          {" "}
                          <Button tone="ghost" size="xsmall"
                            onClick={() => setShowAddServer(true)}
                          >{<LocalizedText translationKey="shellFull.discovery_tsx_8b0a79458c" />}</Button>
                        </>
                      )}
                    </span>
                  </Alert>
                )}
              </div>
            </Surface>
          );
        })}
      </div>
    </div>
  );
}
