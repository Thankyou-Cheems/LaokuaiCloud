import { Chip, Dialog, IconButton, Spinner, Tabs } from "@gryt/ui";
import { type ReactNode,useEffect, useMemo, useState } from "react";

import { getServerAccessToken } from "@/common";
import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { PiArrowsLeftRightFill, PiGearFill, PiHandWavingFill, PiLinkFill, PiListChecksFill, PiProhibitFill, PiRobotFill, PiShieldCheckFill, PiSmileyFill, PiUsersFill, PiWebhooksLogoFill, PiX } from "../../../../lib/icons";
import { useRoomForSettingsRail } from "../hooks/useNarrowWindow";
import { useServerPermissions } from "../hooks/usePermissions";
import { useSockets } from "../hooks/useSockets";
import { useVersionStatus } from "../hooks/useVersionStatus";
import { SERVER_SETTINGS_CHROME } from "../lib/narrowLayout";
import { ServerAuditTab } from "./ServerAuditTab";
import { ServerBansTab } from "./ServerBansTab";
import { ServerBotsTab } from "./ServerBotsTab";
import { ServerEmojisTab } from "./ServerEmojisTab";
import { ServerInvitesTab } from "./ServerInvitesTab";
import { ServerJoinRequestsTab } from "./ServerJoinRequestsTab";
import {
  type ServerOverviewInitialSettings,
  ServerOverviewTab,
} from "./ServerOverviewTab";
import { ServerPermissionTemplatesTab } from "./ServerPermissionTemplatesTab";
import { ServerReleaseNotes } from "./ServerReleaseNotes";
import { ServerRoleEditorTab } from "./ServerRoleEditorTab";
import { ServerRolesTab } from "./ServerRolesTab";
import { ServerUserReplaceTab } from "./ServerUserReplaceTab";
import { ServerWebhooksTab } from "./ServerWebhooksTab";
import { SettingsPicker } from "./SettingsPicker";

type SetupRequiredDetail = {
  host: string;
  serverId?: string;
  settings?: {
    displayName?: string;
    description?: string;
    iconUrl?: string | null;
    isConfigured?: boolean;
  };
};

/**
 * `tab` is a request, not an instruction. Which tabs exist depends on
 * permissions, so an unknown value drops back to overview.
 */
type SettingsOpenDetail = { host: string; tab?: string };

export function ServerSettingsModal() {
  useSocketTranslation();
  const { sockets, serverDetailsList, tokenRevision } = useSockets();

  const [isOpen, setIsOpen] = useState(false);
  const [host, setHost] = useState<string>("");
  const [tab, setTab] = useState<string>("overview");
  const [notesOpen, setNotesOpen] = useState(false);
  const [initialOverviewSettings, setInitialOverviewSettings] = useState<ServerOverviewInitialSettings | undefined>(undefined);

  const socket = useMemo(() => (host ? sockets[host] : undefined), [sockets, host]);
  const accessToken = useMemo(() => {
    void tokenRevision;
    return host ? getServerAccessToken(host) : null;
  }, [host, tokenRevision]);

  const serverInfo = host ? serverDetailsList[host]?.server_info : undefined;
  const { has: hasPermission, known: permissionKnown } = useServerPermissions(host);

  // Every tab needs one permission, and the modal opens if any of them do. The
  // old "owner or admin" gate kept a purpose-built role off the screen it lives on.
  const canManage =
    !permissionKnown ||
    [
      "manage_server",
      "create_invite",
      "manage_invites",
      "manage_join_requests",
      "manage_roles",
      "manage_emojis",
      "ban_members",
      "view_bans",
      "view_audit_log",
      "manage_webhooks",
      "manage_sidebar",
      "replace_identity",
      "manage_bots",
    ].some((p) => hasPermission(p));
  const allowTabs = canManage;
  const railFits = useRoomForSettingsRail(SERVER_SETTINGS_CHROME);


  function handleDialogChange(open: boolean) {
    setIsOpen(open);
    if (!open) {
      setNotesOpen(false);
      setHost("");
      setTab("overview");
      setInitialOverviewSettings(undefined);
    }
  }

  useEffect(() => {
    const handler = (event: CustomEvent<SettingsOpenDetail>) => {
      const h = event.detail?.host;
      if (!h) return;
      setHost(h);
      setInitialOverviewSettings(undefined);
      setTab(event.detail?.tab || "overview");
      setIsOpen(true);
    };
    window.addEventListener("server_settings_open", handler as EventListener);
    return () => window.removeEventListener("server_settings_open", handler as EventListener);
  }, []);

  useEffect(() => {
    const handler = (event: CustomEvent<SetupRequiredDetail>) => {
      const h = event.detail?.host;
      if (!h) return;

      // A server that is already configured must never force its settings modal
      // open merely because the socket reconnected during app startup.
      if (event.detail?.settings?.isConfigured === true) {
        return;
      }

      setHost(h);
      setInitialOverviewSettings({
        displayName: event.detail?.settings?.displayName,
        description: event.detail?.settings?.description,
      });
      setTab("overview");
      setIsOpen(true);
    };

    window.addEventListener("server_setup_required", handler as EventListener);

    return () =>
      window.removeEventListener("server_setup_required", handler as EventListener);
  }, []);

  const { status: versionStatus, loading: versionLoading } = useVersionStatus(
    socket,
    host,
    accessToken,
    // The server refuses this without the permission, so asking without it is
    // an error toast on every open of the settings dialog.
    isOpen && hasPermission("view_server_status"),
  );

  const ALL_TABS: {
    value: string;
    label: string;
    icon: typeof PiGearFill;
    /** Any one of these is enough. Absent means everybody who got this far. */
    needs?: string[];
    content: ReactNode;
  }[] = [
    {
      value: "overview",
      label: socketI18n.t("socketFull.serverSettingsModal_321184dd88"),
      icon: PiGearFill,
      content: (
        <ServerOverviewTab
          host={host}
          socket={socket}
          accessToken={accessToken}
          initialSettings={initialOverviewSettings}
          channels={host ? serverDetailsList[host]?.channels ?? [] : []}
        />
      ),
    },
    {
      value: "invites",
      label: socketI18n.t("socketFull.serverSettingsModal_348622f09e"),
      icon: PiLinkFill,
      needs: ["create_invite", "manage_invites"],
      content: <ServerInvitesTab host={host} socket={socket} accessToken={accessToken} />,
    },
    {
      value: "requests",
      label: socketI18n.t("socketFull.serverSettingsModal_7987524c57"),
      icon: PiHandWavingFill,
      needs: ["manage_join_requests"],
      content: <ServerJoinRequestsTab host={host} socket={socket} accessToken={accessToken} />,
    },
    {
      value: "roles",
      label: socketI18n.t("chat.membersTitle"),
      icon: PiUsersFill,
      needs: ["manage_roles"],
      content: <ServerRolesTab host={host} socket={socket} accessToken={accessToken} />,
    },
    {
      value: "role-editor",
      label: socketI18n.t("socketFull.serverSettingsModal_2ce5003e2a"),
      icon: PiShieldCheckFill,
      needs: ["manage_roles"],
      content: <ServerRoleEditorTab host={host} socket={socket} accessToken={accessToken} />,
    },
    {
      value: "permission-templates",
      label: socketI18n.t("socketFull.serverSettingsModal_1dd31b15e8"),
      icon: PiShieldCheckFill,
      needs: ["manage_roles"],
      content: <ServerPermissionTemplatesTab host={host} socket={socket} accessToken={accessToken} />,
    },
    {
      value: "emojis",
      label: socketI18n.t("socketFull.serverSettingsModal_5cd4f90b5d"),
      icon: PiSmileyFill,
      needs: ["manage_emojis"],
      content: <ServerEmojisTab host={host} socket={socket} accessToken={accessToken} />,
    },
    {
      value: "bans",
      label: socketI18n.t("socketFull.serverSettingsModal_b2eb93d442"),
      icon: PiProhibitFill,
      needs: ["view_bans", "ban_members"],
      content: (
        <ServerBansTab
          host={host}
          socket={socket}
          accessToken={accessToken}
          onUnban={(grytUserId) => socket?.emit("server:unban", { accessToken, grytUserId })}
        />
      ),
    },
    {
      value: "audit",
      label: socketI18n.t("socketFull.serverSettingsModal_3e96ecb671"),
      icon: PiListChecksFill,
      needs: ["view_audit_log"],
      content: <ServerAuditTab host={host} socket={socket} accessToken={accessToken} />,
    },
    {
      value: "bots",
      label: socketI18n.t("socketFull.serverSettingsModal_e1ef520a82"),
      icon: PiRobotFill,
      needs: ["manage_bots"],
      content: <ServerBotsTab host={host} socket={socket} accessToken={accessToken} />,
    },
    {
      value: "webhooks",
      get label() { return socketI18n.t("socketFull.webhooksTitle"); },
      icon: PiWebhooksLogoFill,
      needs: ["manage_webhooks"],
      content: (
        <ServerWebhooksTab
          host={host}
          channels={host ? serverDetailsList[host]?.channels ?? [] : []}
        />
      ),
    },
    {
      value: "replace-user",
      label: socketI18n.t("socketFull.serverSettingsModal_7c19d19f6b"),
      icon: PiArrowsLeftRightFill,
      // Was owner-only by role name. It has its own permission now, which the
      // owner still holds alone unless somebody deliberately grants it.
      needs: ["replace_identity"],
      content: <ServerUserReplaceTab host={host} socket={socket} accessToken={accessToken} />,
    },
  ];

  // A tab whose events the server would refuse is not shown. Against a server
  // that predates permissions nothing is filtered, because it sends no list.
  const TAB_CONFIG = ALL_TABS.filter(
    (t) => !permissionKnown || !t.needs || t.needs.some((p) => hasPermission(p)),
  );

  /*
   * Fall back when the selected tab is not one of the visible ones: the list
   * arrives with the server details, so the first render can be missing it.
   */

  // Keyed on the values rather than the array: TAB_CONFIG is rebuilt every
  // render, so depending on it directly would re-run this on every one.
  const visibleTabValues = TAB_CONFIG.map((t) => t.value).join(",");
  useEffect(() => {
    if (!isOpen || !visibleTabValues) return;
    const values = visibleTabValues.split(",");
    if (values.includes(tab)) return;
    setTab(values[0]);
  }, [isOpen, tab, visibleTabValues]);

  // One set of lines for both layouts: under the rail when it fits, under the picker when it does not.
  const versionLines = (
    <>
      {serverInfo?.version && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gryt-muted" style={{ opacity: 0.5 }}>{socketI18n.t("socketFull.serverSettingsModal_a951fc4fd2")}{serverInfo.version}
          </span>
          {versionLoading && <Spinner size={16} />}
          {versionStatus?.server.updateAvailable && (
            <button
              type="button"
              className="server-version-chip"
              data-server-release-notes
              aria-label={socketI18n.t("socketFull.serverSettingsModal_1f5f8479ab", { p0: (versionStatus.server.latest) })}
              onClick={() => setNotesOpen(true)}
            >
              <Chip tone="warning">
                v{versionStatus.server.latest}
              </Chip>
            </button>
          )}
        </div>
      )}
      {versionStatus?.sfu && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gryt-muted" style={{ opacity: 0.5 }}>
            SFU {versionStatus.sfu.current ? `v${versionStatus.sfu.current}` : "—"}
          </span>
          {versionStatus.sfu.updateAvailable && (
            <Chip tone="warning">
              v{versionStatus.sfu.latest}
            </Chip>
          )}
        </div>
      )}
      {/* Absent, not dashed, when there is no worker to ask.
          A server without one is a normal deployment, and a
          permanent "—" would read as something being broken. */}
      {versionStatus?.worker && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gryt-muted" style={{ opacity: 0.5 }}>{socketI18n.t("settingsFull.m81c85f251c")}{" "}
            {versionStatus.worker.current
              ? `v${versionStatus.worker.current}`
              : "—"}
          </span>
          {versionStatus.worker.updateAvailable && (
            <Chip tone="warning">
              v{versionStatus.worker.latest}
            </Chip>
          )}
        </div>
      )}
    </>
  );
  const serverUpdate = versionStatus?.server.updateAvailable ? versionStatus.server : null;
  const hasVersionLines = Boolean(serverInfo?.version || versionStatus?.sfu || versionStatus?.worker);

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleDialogChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        {/* Sized rather than bounded. max-width with no width leaves the
            dialog to its content, and a 200px rail beside a column of fields
            settles near the 600px minimum — narrow enough that a one-line
            description wrapped and the textarea was a slot. Both dimensions
            give way to the viewport before they clip.

            1040x700 was chosen for a column of fields and then inherited by
            the role editor, which is a table of every role against every
            permission. Measured on a 1600x1000 screen: 2222px of content in a
            618px window, with 280px of desktop going spare on either side.
            The widest thing in here decides the size, so these are its
            numbers now. */}
        <Dialog.Popup
          style={{
            width: "min(1320px, calc(100vw - 4rem))",
            height: "min(860px, calc(100vh - 4rem))",
          }}
        >
        <Dialog.Close
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
          }}
        >
          <IconButton tone="neutral" size="xsmall">
            <PiX size={16} />
          </IconButton>
        </Dialog.Close>

        <div className="flex flex-col gap-4 h-full">
          <Dialog.Title>{socketI18n.t("ui.serverSettings")}</Dialog.Title>

          {isOpen && (
            allowTabs ? (
              <Tabs
                value={tab}
                onValueChange={(v) => setTab(String(v))}
                orientation={railFits ? "vertical" : "horizontal"}
                style={{ flex: 1, minHeight: 0 }}
              >
                {/* min-w-0 because Tabs is a flex row: without it the widest page
                    set the width, and a webhook URL pushed everything off the edge. */}
                <div className={`flex gap-4 h-full min-w-0 flex-1 ${railFits ? "" : "flex-col"}`}>
                  {!railFits && <SettingsPicker value={tab} onValueChange={setTab} options={TAB_CONFIG} />}
                  {!railFits && hasVersionLines && (
                    <div
                      data-settings-versions="narrow"
                      className="flex flex-wrap gap-x-4 gap-y-1"
                      style={{ marginTop: "-8px", padding: "0 4px", fontFamily: "var(--code-font-family)" }}
                    >
                      {versionLines}
                    </div>
                  )}
                  <div hidden={!railFits} style={{ minWidth: "200px", flexShrink: 0, overflowY: "auto" }}>
                    <Tabs.List aria-label={socketI18n.t("ui.serverSettings")} className="gap-1">
                      {TAB_CONFIG.map(({ value, label, icon: Icon }) => (
                        <Tabs.Tab key={value} value={value}>
                          <Icon size={16} />
                          {label}
                        </Tabs.Tab>
                      ))}
                      <Tabs.Indicator />
                    </Tabs.List>
                    <div className="flex flex-col gap-1" style={{ padding: "12px 16px", fontFamily: "var(--code-font-family)" }}>
                      {versionLines}
                    </div>
                  </div>

                  <div style={{ flex: 1, overflow: "auto", minWidth: 0, minHeight: 0 }}>
                    {!permissionKnown ? (
                      <span className="text-sm text-gryt-muted" style={{ marginBottom: 12 }}>{socketI18n.t("socketFull.serverSettingsModal_026ae8b25d")}</span>
                    ) : null}
                    {TAB_CONFIG.map(({ value, content }) => (
                      <Tabs.Panel key={value} value={value}>
                        {content}
                      </Tabs.Panel>
                    ))}
                  </div>
                </div>
              </Tabs>
            ) : (
              <div className="flex flex-col gap-3">
                <span className="text-sm text-gryt-muted">{socketI18n.t("socketFull.serverSettingsModal_7a34da6166")}</span>
              </div>
            )
          )}
        </div>
        {/* Inside the popup, so it opens as a dialog nested in this one. */}
        {notesOpen && serverUpdate && (
          <ServerReleaseNotes
            host={host}
            running={serverUpdate.current}
            latest={serverUpdate.latest}
            beta={serverUpdate.channel === "beta"}
            onClose={() => setNotesOpen(false)}
          />
        )}
      </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

