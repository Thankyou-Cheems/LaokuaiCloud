import { ContextMenu, Slider } from "@gryt/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";
import { useSettings } from "@/settings";
import { useReceivePriors } from "@/webRTC/src/components/ReceivePriorAdapter";

import { PiAtFill, PiChatCircleFill, PiCheckBold, PiCopyFill, PiFlagFill, PiProhibitFill, PiUserPlusFill } from "../../../../lib/icons";
import { friendAction, useFriendState } from "../hooks/friendsStore";
import { useServerPermissions } from "../hooks/usePermissions";
import { useSockets } from "../hooks/useSockets";
import { makeRankOf } from "../lib/memberFacts";
import { requestVoiceMove } from "../utils/requestVoiceMove";
import { MemberConnectionDetailsDialog } from "./ConnectionDetailsDialog";

/** A role id. The server defines what they are; this only passes them around. */
type Role = string;

interface UserContextMenuProps {
  children: ReactNode;
  /**
   * Which server this menu belongs to, so permissions and roles can be looked up.
   * Without it the built-in ladder is used, which never over-offers.
   */
  serverHost?: string;
  serverUserId?: string;
  nickname: string;
  isSelf?: boolean;
  canDisconnect?: boolean;
  isInVoice?: boolean;
  onDisconnectFromVoice?: () => void;
  role?: Role;
  /** The role their name is drawn in: the highest ranked they hold. */
  targetRole?: Role;
  /**
   * Everything they hold. Absent on a server from before more than one was
   * representable, which is why the menu falls back to `targetRole`.
   */
  targetRoles?: Role[];
  isServerMuted?: boolean;
  isServerDeafened?: boolean;
  onKick?: () => void;
  onBan?: () => void;
  onServerMute?: (muted: boolean) => void;
  onServerDeafen?: (deafened: boolean) => void;
  /**
   * Give this role or take it away, `hold` saying which. Roles stack, so "make
   * them a moderator" and "stop them being an admin" are two different things.
   */
  onToggleRole?: (role: Role, hold: boolean) => void;
  onPopoutVideo?: () => void;
  /**
   * Open a direct message with this person, on this server. Absent outside a
   * server view and on a server too old for the events; the item is left out.
   */
  onOpenDm?: () => void;
  /**
   * Stop hearing from this person, or start again. Outside the moderator section:
   * blocking needs no permission and works against somebody who outranks you.
   */
  onToggleBlock?: () => void;
  isBlocked?: boolean;
  /**
   * Put this person in front of the moderators. Beside Block rather than among
   * the actions that check rank, but it does check `report_messages`.
   */
  onReport?: () => void;
}

export function UserContextMenu({
  children,
  serverHost,
  serverUserId,
  nickname,
  isSelf,
  canDisconnect,
  isInVoice,
  onDisconnectFromVoice,
  role,
  targetRole,
  targetRoles,
  isServerMuted,
  isServerDeafened,
  onKick,
  onBan,
  onServerMute,
  onServerDeafen,
  onToggleRole,
  onPopoutVideo,
  onOpenDm,
  onToggleBlock,
  isBlocked,
  onReport,
}: UserContextMenuProps) {
  useSocketTranslation();
  const { userVolumes, updateUserVolume, resetUserVolume, openSettings } = useSettings();
  const priorCache=useReceivePriors();
  const {sockets,clients,serverDetailsList}=useSockets();
  const { has, can, roles } = useServerPermissions(serverHost || "");
  const friendship = useFriendState(serverHost, isSelf ? undefined : serverUserId);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLDivElement>(null);
  const detailsReturnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => { setDetailsOpen(false); }, [serverHost, serverUserId]);
  const showDetails = Boolean(serverHost && serverUserId);
  const openDetails = () => { detailsReturnFocus.current = row.current; setDetailsOpen(true); };
  const detailsItem = showDetails ? <ContextMenu.Item data-gryt="connection-details-menu-item" onClick={openDetails}>{socketI18n.t("connectionDetails.menu")}</ContextMenu.Item> : null;
  const withDetails = (menu: ReactNode) => !showDetails ? menu : <div ref={row} tabIndex={0} data-gryt="member-context-actions"
    aria-label={socketI18n.t("connectionDetails.memberActions", { nickname })} aria-keyshortcuts="Shift+F10 ContextMenu"
    className="relative min-w-0 w-full" style={{ paddingRight: isInVoice ? 28 : undefined, boxSizing: "border-box" }}
    onKeyDown={event => {
      if (event.target !== event.currentTarget || !(event.key === "ContextMenu" || event.key === "F10" && event.shiftKey)) return;
      event.preventDefault(); event.stopPropagation();
      const bounds = event.currentTarget.getBoundingClientRect();
      menuTrigger.current?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: bounds.left + 8, clientY: bounds.top + 8 }));
    }}>
    {menu}
    {isInVoice && <button type="button" className="absolute right-0 top-1 h-6 w-6 rounded text-sm text-gryt-muted hover:bg-gryt-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-gryt-accent"
      data-gryt="connection-details-more" aria-haspopup="dialog" aria-label={socketI18n.t("connectionDetails.more", { nickname })} title={socketI18n.t("connectionDetails.more", { nickname })}
      onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); detailsReturnFocus.current = event.currentTarget; setDetailsOpen(true); }}>⋯</button>}
    {detailsOpen && serverHost && serverUserId && <MemberConnectionDetailsDialog open={detailsOpen} onOpenChange={setDetailsOpen}
      nickname={nickname} isSelf={isSelf} serverHost={serverHost} serverUserId={serverUserId} returnFocus={detailsReturnFocus} />}
  </div>;
  // One step at a time. Removing a friend lives in the Friends list, away from a quick right-click.
  const friendItem = !serverHost || !serverUserId ? null
    : friendship === "none" ? { label: socketI18n.t("socketFull.userContextMenu_5a4eae4cab"), onClick: () => friendAction(serverHost, "request", serverUserId) }
      : friendship === "incoming" ? { label: socketI18n.t("socketFull.userContextMenu_9e28013919"), onClick: () => friendAction(serverHost, "accept", serverUserId) }
        : friendship === "outgoing" ? { label: socketI18n.t("socketFull.userContextMenu_ea5bbca548"), onClick: () => friendAction(serverHost, "cancel", serverUserId) }
          : null;

  const handleCopyId = () => {
    if (!serverUserId) return;
    navigator.clipboard.writeText(serverUserId).then(
      () => toast.success(socketI18n.t("socketFull.userContextMenu_abc696f4c7")),
      () => toast.error(socketI18n.t("ui.failedToCopy")),
    );
  };

  const handleMention = () => {
    if (!serverUserId) return;
    window.dispatchEvent(
      new CustomEvent("mention_user", {
        detail: { serverUserId, nickname },
      }),
    );
  };

  if (isSelf) {
    return withDetails(
      <ContextMenu.Root>
        <ContextMenu.Trigger ref={menuTrigger} style={{ display: "contents" }}>{children}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner collisionPadding={8}>
            <ContextMenu.Popup className="min-w-45" finalFocus={detailsOpen ? false : undefined}>
          {/* The label names a group, and Base UI reads the group's id off
              context to point aria-labelledby at it. Without one it throws —
              which is what took the app down on a right-click. */}
          <ContextMenu.Group>
            <ContextMenu.GroupLabel>
              {nickname}
            </ContextMenu.GroupLabel>
          </ContextMenu.Group>
          <ContextMenu.Separator />
          {detailsItem}
          <ContextMenu.Item onClick={() => openSettings("profile")}>{socketI18n.t("socketFull.userContextMenu_45016325c7")}</ContextMenu.Item>
          {serverUserId && (
            <ContextMenu.Item onClick={handleCopyId}>
              <div className="flex items-center gap-2">
                <PiCopyFill size={14} />{" "}{socketI18n.t("socketFull.userContextMenu_2ff2e1d319")}</div>
            </ContextMenu.Item>
          )}
          {onPopoutVideo && (
            <>
              <ContextMenu.Separator />
              <ContextMenu.Item onClick={onPopoutVideo}>{socketI18n.t("socketFull.userContextMenu_3453cee4ca")}</ContextMenu.Item>
            </>
          )}
        </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    );
  }

  if (!serverUserId) {
    return <>{children}</>;
  }

  const volume = userVolumes[serverUserId] ?? 100;
  const showDisconnect = canDisconnect && isInVoice && onDisconnectFromVoice;

  const rankOf = makeRankOf(roles);

  // Rank decides who may be acted on; permissions decide what the action is. They
  // used to be one question asked of a four-rung ladder.
  const outranksTarget = !!role && !!targetRole && rankOf(role) > rankOf(targetRole);
  const canMute = has("mute_members") && outranksTarget;
  const canDeafen = has("deafen_members") && outranksTarget;
  const canKick = has("kick_members") && outranksTarget;
  const canBan = has("ban_members") && outranksTarget;
  const canAssignRoles = has("manage_roles") && outranksTarget;
  const details=serverHost ? serverDetailsList[serverHost] : undefined;
  const targetConnections=Object.entries(serverHost ? clients[serverHost]??{} : {}).filter(([,client])=>
    client.serverUserId===serverUserId && client.hasJoinedChannel && client.voiceChannelId && client.voiceMoveStagingSupported===true);
  const targetConnection=targetConnections.length===1 ? targetConnections[0] : undefined;
  const moveChannels=details?.server_info?.voice_atomic_move_enabled===true && has("disconnect_members") && outranksTarget && targetConnection ?
    details.channels.filter(channel=>channel.type==="voice" && channel.id!==targetConnection[1].voiceChannelId) : [];
  const canModerate = canMute || canDeafen || canKick || canBan || canAssignRoles;

  // Only roles this person could actually hand out. Offering one the server
  // would refuse is offering a click that ends in a red toast.
  const assignableRoles = roles
    .filter((r) => r.id !== "owner" && r.rank < rankOf(role))
    .sort((a, b) => b.rank - a.rank);

  const nameOfRole = (id: string) => roles.find((r) => r.id === id)?.name ?? id;

  /*
   * Everything they hold, or the one role a server too old to say sends. The
   * subtitle is the only place outside settings that says a member is two things.
   */
  const heldRoles = targetRoles ?? (targetRole ? [targetRole] : []);
  const targetRoleName = heldRoles.length > 0 ? heldRoles.map(nameOfRole).join(", ") : null;

  return withDetails(
    <ContextMenu.Root>
      <ContextMenu.Trigger ref={menuTrigger} style={{ display: "contents" }}>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner collisionPadding={8}>
          <ContextMenu.Popup className="min-w-55" finalFocus={detailsOpen ? false : undefined}>
        <ContextMenu.Group>
          <ContextMenu.GroupLabel>
            {nickname}
          </ContextMenu.GroupLabel>
        </ContextMenu.Group>
        {detailsItem}
        {targetRole && (
          // A subtitle rather than a second heading: one group, one label.
          <div className="px-3 pb-1">
            <span className="text-xs text-gryt-muted">{targetRoleName}</span>
          </div>
        )}
        {/* `can` rather than `has`: a server from before `send_direct_messages`
            existed does not list it anywhere, and asking `has` there hides the
            item on every server where DMs work perfectly well. `can` answers
            true for a permission the server has never heard of, so only a
            server that knows the permission and withheld it loses the item. */}
        {onOpenDm && can("send_direct_messages") && (
          <ContextMenu.Item onClick={onOpenDm}>
            <div className="flex items-center gap-2">
              <PiChatCircleFill size={14} />{" "}{socketI18n.t("socketFull.userContextMenu_7610962ecc")}</div>
          </ContextMenu.Item>
        )}
        {friendItem && (
          <ContextMenu.Item data-gryt="friend-menu-item" onClick={friendItem.onClick}>
            <div className="flex items-center gap-2">
              <PiUserPlusFill size={14} /> {friendItem.label}
            </div>
          </ContextMenu.Item>
        )}
        <ContextMenu.Item onClick={handleMention}>
          <div className="flex items-center gap-2">
            <PiAtFill size={14} />{" "}{socketI18n.t("socketFull.userContextMenu_1d5f6d9d7b")}</div>
        </ContextMenu.Item>
        <ContextMenu.Item onClick={handleCopyId}>
          <div className="flex items-center gap-2">
            <PiCopyFill size={14} />{" "}{socketI18n.t("socketFull.userContextMenu_2ff2e1d319")}</div>
        </ContextMenu.Item>
        {/* Above the volume slider and well above the moderator section, which
            is where it belongs on both counts: it is something anybody can do
            to anybody, and it is not a moderator act however much it looks like
            one. No permission is asked for, because a block that needed a role
            would not work for the person who needs it most.

            Unblocking is not in the danger colour. It only ever gives back. */}
        {onToggleBlock && (
          <ContextMenu.Item
            className={isBlocked ? undefined : "text-gryt-danger"}
            onClick={onToggleBlock}
          >
            <div className="flex items-center gap-2">
              <PiProhibitFill size={14} /> {isBlocked ? socketI18n.t("settingsFull.m12aabd251c") : socketI18n.t("socketFull.userContextMenu_49566fca19")}
            </div>
          </ContextMenu.Item>
        )}
        {/* Beside Block, and gated the same way reporting a message is. Left
            out rather than shown and refused when the role does not have it —
            an item that is always there and always says no teaches people to
            stop pressing it. */}
        {onReport && has("report_messages") && (
          <ContextMenu.Item className="text-gryt-danger" onClick={onReport}>
            <div className="flex items-center gap-2">
              <PiFlagFill size={14} />{" "}{socketI18n.t("socketFull.userContextMenu_654eb38dad")}</div>
          </ContextMenu.Item>
        )}
        <ContextMenu.Separator />
        <div className="flex flex-col gap-2 px-2 py-1" onPointerDown={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gryt-muted">{socketI18n.t("settingsFull.m3b18e8e332")}</span>
            <span className="text-xs font-medium" style={{ fontVariantNumeric: "tabular-nums" }}>
              {volume}%
            </span>
          </div>
          <Slider
            min={0}
            max={200}
            step={1}
            value={volume}
            onValueChange={(next) => updateUserVolume(serverUserId, Number(next))}
          />
        </div>
        {volume !== 100 && (
          <>
            <ContextMenu.Separator />
            <ContextMenu.Item onClick={() => resetUserVolume(serverUserId)}>{socketI18n.t("socketFull.userContextMenu_82407175c8")}</ContextMenu.Item>
          </>
        )}
        {serverHost && priorCache.available && <ContextMenu.Item onClick={()=>priorCache.clearMember(serverHost,serverUserId)}>
          {socketI18n.t("pureVoice.priorClearMember")}
        </ContextMenu.Item>}
        {!!moveChannels.length && <ContextMenu.SubmenuRoot>
          <ContextMenu.SubmenuTrigger>{socketI18n.t("pureVoice.moveMember")}</ContextMenu.SubmenuTrigger>
          <ContextMenu.Portal><ContextMenu.Positioner collisionPadding={8}><ContextMenu.Popup>
            {moveChannels.map(channel=><ContextMenu.Item key={channel.id} onClick={()=>{
              const socket=serverHost ? sockets[serverHost] : undefined;
              if(!socket || !serverHost || !targetConnection)return;
              const target={clientId:targetConnection[0],serverUserId,source:targetConnection[1].voiceChannelId!};
              void toast.promise(requestVoiceMove(socket,serverHost,target,channel.id),{
                loading:socketI18n.t("pureVoice.movePending"),success:socketI18n.t("pureVoice.moveCommitted"),
                error:(error:Error)=>`${socketI18n.t("pureVoice.moveFailed")}: ${error.message}`,
              });
            }}>{channel.name}</ContextMenu.Item>)}
          </ContextMenu.Popup></ContextMenu.Positioner></ContextMenu.Portal>
        </ContextMenu.SubmenuRoot>}
        {onPopoutVideo && (
          <>
            <ContextMenu.Separator />
            <ContextMenu.Item onClick={onPopoutVideo}>{socketI18n.t("socketFull.userContextMenu_3453cee4ca")}</ContextMenu.Item>
          </>
        )}
        {showDisconnect && (
          <>
            <ContextMenu.Separator />
            <ContextMenu.Item className="text-gryt-danger" onClick={onDisconnectFromVoice}>{socketI18n.t("socketFull.userContextMenu_96ee562d31")}</ContextMenu.Item>
          </>
        )}

        {canModerate && (
          <>
            <ContextMenu.Separator />

            {canMute && onServerMute && (
              <ContextMenu.Item onClick={() => onServerMute(!isServerMuted)}>
                {isServerMuted ? socketI18n.t("socketFull.userContextMenu_b46f7caf04") : socketI18n.t("socketFull.userContextMenu_c1f034cad5")}
              </ContextMenu.Item>
            )}

            {canDeafen && onServerDeafen && (
              <ContextMenu.Item onClick={() => onServerDeafen(!isServerDeafened)}>
                {isServerDeafened ? socketI18n.t("socketFull.userContextMenu_4482b6c0d4") : socketI18n.t("socketFull.userContextMenu_6c9349325d")}
              </ContextMenu.Item>
            )}

            {/* Toggles rather than a list of one-of-four. Picking a role a
                member already holds used to be disabled and say "(current)",
                which was the whole vocabulary a single-role server had; now it
                takes the role away again.

                One toggle per open — `closeOnClick={false}` does not survive a
                submenu, and the root closes with it. Handing somebody several
                roles at once is what the Members tab in settings is for. */}
            {canAssignRoles && onToggleRole && assignableRoles.length > 0 && (
              <ContextMenu.SubmenuRoot>
                <ContextMenu.SubmenuTrigger>{socketI18n.t("socketFull.userContextMenu_b6573859e9")}</ContextMenu.SubmenuTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.Positioner collisionPadding={8}>
                    <ContextMenu.Popup>
                  {assignableRoles.map((r) => {
                    const holds = heldRoles.includes(r.id);
                    return (
                      <ContextMenu.Item
                        key={r.id}
                        onClick={() => onToggleRole(r.id, !holds)}
                      >
                        <span className="flex items-center gap-2">
                          {/* A fixed-width slot, so the names line up whether
                              or not there is a tick beside them. */}
                          <span style={{ width: 14, display: "inline-block" }}>
                            {holds ? <PiCheckBold size={12} /> : null}
                          </span>
                          {r.name}
                        </span>
                      </ContextMenu.Item>
                    );
                  })}
                </ContextMenu.Popup>
                  </ContextMenu.Positioner>
                </ContextMenu.Portal>
              </ContextMenu.SubmenuRoot>
            )}

            <ContextMenu.Separator />

            {canKick && onKick && (
              <ContextMenu.Item className="text-gryt-danger" onClick={onKick}>{socketI18n.t("socketFull.userContextMenu_0dded5d6fe")}</ContextMenu.Item>
            )}

            {canBan && onBan && (
              <ContextMenu.Item className="text-gryt-danger" onClick={onBan}>{socketI18n.t("socketFull.userContextMenu_1548d2af72")}</ContextMenu.Item>
            )}
          </>
        )}
      </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
