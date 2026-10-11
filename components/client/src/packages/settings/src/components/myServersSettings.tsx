import { Accordion, Alert, Avatar, Button, Checkbox, Chip, Spinner, Surface, TextField } from "@gryt/ui";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Trans } from "react-i18next";

import { GeneratedServerIcon, normalizeHost } from "@/common";
import { i18n, useTranslation } from "@/i18n";

import type { EmbeddedServerState } from "../../../../lib/electron";
import {
  PiHardDrivesFill,
  PiPlayFill,
  PiPlusBold,
  PiStopFill,
  PiTrashFill,
  PiWarningFill,
  PiX,
} from "../../../../lib/icons";
import { ConfirmDialog } from "../../../socket/src/components/ConfirmDialog";
import { useServerManagement } from "../../../socket/src/hooks/useServerManagement";
import { useEmbeddedServer } from "../hooks/useEmbeddedServer";
import { useSettings } from "../hooks/useSettings";
import { railEntriesFor } from "../hostedServerRail";
import { serverToManage } from "../hostedServers";
import { EmbeddedServerLogs } from "./embeddedServerLogs";
import { HIGHLIGHT_MS, SettingsContainer } from "./settingsComponents";
import { settingsMessage } from "./settingsMessage";

/**
 * The servers you run, as opposed to the ones you have joined. They share one
 * SFU, so a second one costs a server process and an image worker.
 */
export function MyServersSettings() {
  useTranslation();
  const {
    isAvailable,
    servers,
    lanIp,
    autoStart,
    setAutoStart,
    startServer,
    stopServer,
    updateAdvertisedAddresses,
    updatePorts,
    deleteServer,
    isBusy,
    dismissError,
  } = useEmbeddedServer();
  const { setShowSettings, settingsTab, setSettingsTab } = useSettings();
  const { setShowAddServer, servers: joinedServers, removeServers } =
    useServerManagement();
  /** The server Manage server was pressed on, until its card has been shown. */
  const managing = serverToManage(settingsTab);
  const managingShown = useCallback(() => setSettingsTab("my-servers"), [setSettingsTab]);

  function hostAServer() {
    setShowSettings(false);
    setShowAddServer(true);
  }

  if (!isAvailable) {
    return (
      <SettingsContainer>
        <h2 className="text-lg">{i18n.t("ui.myServers")}</h2>
        <span className="text-sm">{i18n.t("settingsFull.m36eba7425b")}</span>
      </SettingsContainer>
    );
  }

  return (
    <SettingsContainer>
      <h2 className="text-lg">{i18n.t("ui.myServers")}</h2>

      <div className="flex flex-col gap-3">
        <span className="text-xs">{i18n.t("settingsFull.ma96e0b5194")}</span>

        {servers.length === 0 ? (
          <div className="flex flex-col gap-3 items-start">
            <span className="text-sm">{i18n.t("settingsFull.m4d84c167b3")}</span>
            <Button size="small" onClick={hostAServer}>
              <PiHardDrivesFill size={16} />{i18n.t("settingsFull.m6abc03961e")}</Button>
          </div>
        ) : (
          <>
            {servers.map((server) => (
              <ManageTarget
                key={server.id}
                id={server.id}
                managing={server.id === managing}
                onShown={managingShown}
              >
                <HostedServerCard
                  server={server}
                  lanIp={lanIp}
                  autoStart={autoStart[server.id] ?? false}
                  busy={isBusy(server.id)}
                  onAutoStart={(enabled) => setAutoStart(server.id, enabled)}
                  onStart={() => {
                    void startServer(server.id);
                  }}
                  onStop={() => {
                    void stopServer(server.id);
                  }}
                  onUpdateAdvertisedAddresses={(addresses) =>
                    updateAdvertisedAddresses(server.id, addresses)
                  }
                  onUpdatePorts={(ports) => updatePorts(server.id, ports)}
                  onDelete={() => {
                    // The rail entries go with it. Left behind they point at an
                    // address nothing answers on, and look merely offline.
                    removeServers(railEntriesFor(server, joinedServers));
                    void deleteServer(server.id);
                  }}
                  onDismissError={() => {
                    void dismissError(server.id);
                  }}
                />
              </ManageTarget>
            ))}

            <div className="flex w-fit">
              <Button size="small" onClick={hostAServer}>
                <PiPlusBold size={14} />{i18n.t("settingsFull.m44da1c984e")}</Button>
            </div>
          </>
        )}
      </div>
    </SettingsContainer>
  );
}

/**
 * Where Manage server lands. The card is brought into view and flashed the way a
 * settings search hit is, which needs data-setting; the radius matches the card's.
 */
function ManageTarget({
  id,
  managing,
  onShown,
  children,
}: {
  id: string;
  managing: boolean;
  onShown: () => void;
  children: ReactNode;
}) {
  useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!managing) return;
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setFlash(true);
    onShown();
  }, [managing, onShown]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(false), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);

  return (
    <div
      ref={ref}
      data-setting={`hosted-server-${id}`}
      className={flash ? "gryt-setting-hit" : undefined}
      style={{ borderRadius: "var(--gryt-radius-surface)", scrollMargin: 16 }}
    >
      {children}
    </div>
  );
}

/**
 * Every control is passed in rather than pulled from useEmbeddedServer here: the
 * hook opens an IPC subscription and fetches the list when it mounts.
 */
function HostedServerCard({
  server,
  lanIp,
  autoStart,
  busy,
  onAutoStart,
  onStart,
  onStop,
  onUpdateAdvertisedAddresses,
  onUpdatePorts,
  onDelete,
  onDismissError,
}: {
  server: EmbeddedServerState;
  lanIp: string;
  autoStart: boolean;
  busy: boolean;
  onAutoStart: (enabled: boolean) => void;
  onStart: () => void;
  onStop: () => void;
  onUpdateAdvertisedAddresses: (addresses: string[]) => Promise<boolean>;
  onUpdatePorts: (ports: {
    serverPort?: number;
    sfuPort?: number;
    mediaPort?: number;
  }) => Promise<string | null>;
  onDelete: () => void;
  onDismissError: () => void;
}) {
  useTranslation();
  const { servers: joinedServers, addServer, switchToServer } =
    useServerManagement();
  const { setShowSettings } = useSettings();

  /** Which accordion sections are open. Logs are not fetched until theirs is. */
  const [logsOpen, setLogsOpen] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Typed back before Delete works. This destroys a database. */
  const [customAddresses, setCustomAddresses] = useState("");
  const [addressSaveFailed, setAddressSaveFailed] = useState(false);
  /** Which accordion sections are open, ports included. */
  const [portsOpen, setPortsOpen] = useState<string[]>([]);
  /** The fields, as typed. Empty until the panel is opened and seeded. */
  const [portDraft, setPortDraft] = useState({ server: "", sfu: "", media: "" });
  const [portError, setPortError] = useState<string | null>(null);
  const [portsSaved, setPortsSaved] = useState(false);

  const isRunning = server.status === "running";
  const isStarting = server.status === "starting";
  const hasError = server.status === "error";
  const name = server.config?.serverName ?? i18n.t("settingsFull.m5ddbad1831");
  const port = server.config?.serverPort;
  const host = server.serverUrl ? normalizeHost(server.serverUrl) : "";

  useEffect(() => {
    setCustomAddresses(
      server.config?.customAdvertisedAddresses.join(", ") ?? "",
    );
    setAddressSaveFailed(false);
  }, [server.config?.customAdvertisedAddresses]);

  /** Put this server in the rail and go look at it. */
  function openServer() {
    if (!host) return;

    if (joinedServers[host]) switchToServer(host);
    else addServer({ name, host }, true);

    setShowSettings(false);
  }

  return (
    <Surface className="p-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Avatar fallback={<GeneratedServerIcon seed={name} />} />

          <div className="flex flex-col gap-1" style={{ minWidth: 0 }}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold truncate">
                {name}
              </span>
              <Chip tone="neutral"
                color={isRunning ? "green" : isStarting ? "amber" : "gray"}
              >
                {isRunning ? i18n.t("settingsFull.m73989d9c59") : isStarting ? i18n.t("settingsFull.me5f58095ac") : i18n.t("settingsFull.m51e9111b87")}
              </Chip>
            </div>

            {/* Both addresses, because they answer different questions: the
                first is where this machine reaches it, the second is what you
                give somebody else. */}
            <div className="flex flex-col gap-1">
              <span className="text-xs">
                <code className="font-mono text-xs text-gryt-muted">
                  127.0.0.1:{port}
                </code>
              </span>
              {server.config?.lanDiscoverable && (
                <span className="text-xs">{i18n.t("settingsFull.m7fcb2fb048")}{" "}
                  <code className="font-mono text-xs text-gryt-muted">
                    {lanIp}:{port}
                  </code>
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-2 items-center ml-auto">
            {isRunning || isStarting ? (
              <Button size="small"
                onClick={onStop}
                disabled={busy}
              >
                {busy ? <Spinner size={16} /> : <PiStopFill size={16} />}{i18n.t("settingsFull.m9e253470c8")}</Button>
            ) : (
              <Button size="small"
                onClick={onStart}
                disabled={busy}
              >
                {busy ? <Spinner size={16} /> : <PiPlayFill size={16} />}{i18n.t("settingsFull.m952f375412")}</Button>
            )}

            <Button size="small" onClick={openServer} disabled={!isRunning}>{i18n.t("settingsFull.mcf9b77061f")}</Button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex gap-2 items-center">
              <Checkbox
                checked={autoStart}
                onCheckedChange={(c) => onAutoStart(c === true)}
              />
              <span className="text-xs">{i18n.t("settingsFull.m19daf37f58")}</span>
            </label>

          <Button
            tone="ghost"
            size="xsmall"
            className="ml-auto"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            <PiTrashFill size={12} />{i18n.t("ui.delete")}</Button>

          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title={i18n.t("settingsFull.m9b216b8c0c", { value0: name })}
            description={
              <>{i18n.t("settingsFull.m0e8aa19b28")}</>
            }
            confirmLabel={i18n.t("settingsFull.m9c02b4c6ff")}
            confirmPhrase={name}
            confirmPhraseLabel={<><Trans i18n={i18n} i18nKey="settingsFull.m9832f94e89" values={{ name }} components={{ name: <strong /> }} /></>}
            onConfirm={onDelete}
          >
            {/* Said separately because it is the part nobody expects.
                Everyone who joined pinned this server's identity key, so a
                new server with the same name and port is a different server
                to them, and they are turned away rather than let back in. */}
            <span className="text-sm">{i18n.t("settingsFull.m7c8ee544fe")}</span>
          </ConfirmDialog>
        </div>

        <div className="flex flex-col gap-2 border-t border-gryt-border pt-3">
          <span className="text-sm font-bold">{i18n.t("settingsFull.mdfcff72435")}</span>
          <span className="text-xs"><Trans i18n={i18n} i18nKey="settingsFull.m5aacce11a5" components={{ addresses: <AdvertisedAddressList addresses={server.config?.advertisedAddresses} /> }} /></span>
          {/* Where the symptom is, next to the thing that causes it.
              
              A wrong address here does not look like a network fault, it looks
              like broken audio: chat goes over the address people joined on and
              keeps working, while media goes direct to whatever is advertised
              here. Nothing else in the app connects those two facts. GRYT-297.
              
              The app deliberately does not claim these addresses work. It
              cannot tell from in here — a machine behind NAT may or may not
              reach its own public IP depending on the router, and neither
              answer describes what somebody outside sees. */}
          <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m71de7496c1")}</span>
          <div className="flex gap-2 items-end">
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-xs">{i18n.t("settingsFull.m30191bd832")}</span>
              <TextField
                value={customAddresses}
                onChange={(event) => {
                  setCustomAddresses(event.target.value);
                  setAddressSaveFailed(false);
                }}
                placeholder="203.0.113.10, voice.example.com"
                disabled={isRunning || isStarting || busy}
              />
            </label>
            <Button
              size="small"
              disabled={isRunning || isStarting || busy}
              onClick={() => {
                const addresses = customAddresses
                  .split(",")
                  .map((address) => address.trim())
                  .filter(Boolean);
                void onUpdateAdvertisedAddresses(addresses).then((saved) =>
                  setAddressSaveFailed(!saved),
                );
              }}
            >{i18n.t("settingsFull.mefc007a393")}</Button>
          </div>
          {(isRunning || isStarting) && (
            <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.mb2e3e62b8b")}</span>
          )}
          {addressSaveFailed && (
            <Alert severity="info" role="alert"><Trans i18n={i18n} i18nKey="settingsFull.m510cf2c952" components={{ wildcard: <code className="font-mono text-xs" />, loopback: <code className="font-mono text-xs" /> }} /></Alert>
          )}
        </div>

          {/* The ports, behind an accordion, and editable.
              
              The paragraph above has said for a while that a UDP port not
              being forwarded is what breaks audio, without ever saying which
              port — which told the reader exactly what was wrong and nothing
              about what to type into a router. GRYT-459 put the numbers here.
              
              They are fields rather than text because the app no longer moves
              a port when something else takes it. It refuses to start and says
              so, and this is where that gets fixed. GRYT-469. */}
          <Accordion
            value={portsOpen}
            onValueChange={(value: unknown) => {
              const next = value as string[];
              // Seed from the config on open rather than on every render, so
              // typing is not overwritten by a status broadcast mid-edit.
              if (next.includes("ports") && !portsOpen.includes("ports")) {
                setPortDraft({
                  server: String(server.config?.serverPort ?? ""),
                  sfu: String(server.config?.sfuPort ?? ""),
                  media: String(server.config?.mediaPort ?? ""),
                });
                setPortError(null);
                setPortsSaved(false);
              }
              setPortsOpen(next);
            }}
          >
            <Accordion.Item value="ports">
              <Accordion.Trigger>{i18n.t("settingsFull.m8424551d48")}</Accordion.Trigger>
              <Accordion.Panel>
                <div className="flex flex-col gap-3 pt-2">
                  <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m090900c3d9")}</span>

                  <div className="flex gap-2 items-end">
                    <label className="flex flex-col gap-1 flex-1">
                      <span className="text-xs">{i18n.t("settingsFull.m839194221f")}</span>
                      <TextField
                        value={portDraft.server}
                        inputMode="numeric"
                        onChange={(event) => {
                          setPortDraft((d) => ({ ...d, server: event.target.value }));
                          setPortError(null);
                          setPortsSaved(false);
                        }}
                        disabled={isRunning || isStarting || busy}
                      />
                    </label>
                    <label className="flex flex-col gap-1 flex-1">
                      <span className="text-xs">{i18n.t("settingsFull.mbf3f6bb93d")}</span>
                      <TextField
                        value={portDraft.sfu}
                        inputMode="numeric"
                        onChange={(event) => {
                          setPortDraft((d) => ({ ...d, sfu: event.target.value }));
                          setPortError(null);
                          setPortsSaved(false);
                        }}
                        disabled={isRunning || isStarting || busy}
                      />
                    </label>
                    <label className="flex flex-col gap-1 flex-1">
                      <span className="text-xs">{i18n.t("settingsFull.medb097168a")}</span>
                      <TextField
                        value={portDraft.media}
                        inputMode="numeric"
                        onChange={(event) => {
                          setPortDraft((d) => ({ ...d, media: event.target.value }));
                          setPortError(null);
                          setPortsSaved(false);
                        }}
                        disabled={isRunning || isStarting || busy}
                      />
                    </label>
                    <Button
                      size="small"
                      disabled={isRunning || isStarting || busy}
                      onClick={() => {
                        const parsed = {
                          serverPort: Number(portDraft.server),
                          sfuPort: Number(portDraft.sfu),
                          mediaPort: Number(portDraft.media),
                        };
                        void onUpdatePorts(parsed).then((error) => {
                          setPortError(error);
                          setPortsSaved(!error);
                        });
                      }}
                    >{i18n.t("settingsFull.mefc007a393")}</Button>
                  </div>

                  {/* Said here as well as under the addresses, because this
                      panel is collapsed by default and somebody who opens it
                      to change a port has not necessarily read that. */}
                  {(isRunning || isStarting) && (
                    <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.md86b93d4b7")}</span>
                  )}

                  {portError && (
                    <Alert severity="info" role="alert">
                      {settingsMessage(portError)}
                    </Alert>
                  )}

                  {portsSaved && (
                    <Alert severity="success" role="status">{i18n.t("settingsFull.mecac4524bb")}</Alert>
                  )}

                  <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m32b7297f6f")}</span>
                </div>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>

        {/* Behind an accordion, and genuinely unmounted when shut.
            EmbeddedServerLogs pulls the whole history and opens a live
            subscription the moment it mounts, so hiding it with CSS would have
            kept both running for a panel nobody had asked to see. Closed means
            not fetching. */}
        {(isRunning || isStarting) && (
          <Accordion
            value={logsOpen}
            onValueChange={(value: unknown) => setLogsOpen(value as string[])}
          >
            <Accordion.Item value="logs">
              <Accordion.Trigger>{i18n.t("settingsFull.mfc2965d6b6")}</Accordion.Trigger>
              <Accordion.Panel>
                {logsOpen.includes("logs") && (
                  <EmbeddedServerLogs serverId={server.id} />
                )}
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        )}

        {hasError && server.error && (
          <div className="flex flex-col gap-2">
            <Alert severity="info" role="alert"><span className="inline-flex items-start gap-2"><PiWarningFill size={16} />{settingsMessage(server.error)}</span></Alert>
            <div className="flex justify-end">
              <Button tone="ghost" size="xsmall" onClick={onDismissError}>
                <PiX size={14} />{i18n.t("settingsFull.m70afe9eff3")}</Button>
            </div>
          </div>
        )}
      </div>
    </Surface>
  );
}

/** An atomic Trans component keeps hostnames as React text, independent of translated markup. */
function AdvertisedAddressList({ addresses }: { addresses: readonly string[] | undefined }) {
  useTranslation();
  return <>{addresses?.length ? addresses.map((address, index) => (
    <span key={address}>
      {index > 0 ? ", " : ""}
      <code className="font-mono text-xs text-gryt-muted">{address}</code>
    </span>
  )) : i18n.t("settingsFull.m7859584400")}</>;
}
