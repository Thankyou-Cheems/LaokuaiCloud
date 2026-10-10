import { Avatar, Button, Dialog } from "@gryt/ui";
import type { ReactNode } from "react";

import { getUploadsFileUrl, resolveAvatarSrc, serverIconSrc } from "@/common";
import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import {
  confirmServerFriend,
  friendAction,
  type HostFriends,
  setFriendsOpen,
  useAllFriends,
  useFriendsOpen,
} from "../hooks/friendsStore";
import { useServerManagement } from "../hooks/useServerManagement";
import { useSockets } from "../hooks/useSockets";
import type { ServerFriendPerson } from "../utils/friendList";
import { EmojiText } from "./EmojiText";
import { ServerMark } from "./ServerChip";

/**
 * Your friends, requests and sent requests, one server at a time (GRYT-1471).
 * Friends never cross servers, so neither does a row here.
 */
export function FriendsDialog() {
  useSocketTranslation();
  const open = useFriendsOpen();
  const all = useAllFriends();
  const { servers } = useServerManagement();
  const { memberLists, serverDetailsList } = useSockets();

  const shown = all.filter((h) => h.friends.length + h.incoming.length + h.outgoing.length > 0);

  function person(host: string, p: ServerFriendPerson, actions: ReactNode, note?: string) {
    const member = memberLists[host]?.find((m) => m.serverUserId === p.serverUserId);
    const name = member?.nickname || p.nickname || socketI18n.t("socketFull.friendsDialog_9d801edd77");
    return (
      <div key={`${host}/${p.serverUserId}`} data-gryt="friend-row" data-server-user-id={p.serverUserId} className="flex items-center gap-2 px-2 py-1">
        <Avatar
          size="small"
          fallback={name[0]}
          src={resolveAvatarSrc(
            member?.avatarFileId ? getUploadsFileUrl(host, member.avatarFileId, { thumb: true }) : undefined,
            name,
            member?.avatarWorn,
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">
            <EmojiText text={name} />
          </span>
          {note && <span className="text-xs text-gryt-muted">{note}</span>}
        </span>
        <span className="flex shrink-0 gap-1">{actions}</span>
      </div>
    );
  }

  function section(title: string, rows: ReactNode[]) {
    if (rows.length === 0) return null;
    return (
      <div className="flex flex-col gap-0.5">
        <span className="px-2 pt-1 text-xs font-semibold text-gryt-muted">{title}</span>
        {rows}
      </div>
    );
  }

  function server(h: HostFriends) {
    const name = servers[h.host]?.name || h.host;
    const act = (action: Parameters<typeof friendAction>[1], id: string) => () => friendAction(h.host, action, id);
    return (
      <section key={h.host} data-gryt="friends-server" data-host={h.host} className="flex flex-col gap-1">
        <h3 className="flex items-center gap-2 text-sm" style={{ fontWeight: 600 }}>
          <span style={{ width: 16, height: 16, borderRadius: 4, overflow: "hidden", display: "block" }}>
            <ServerMark src={serverIconSrc(h.host, servers[h.host]?.name || "", serverDetailsList)} seed={name} />
          </span>
          {name}
        </h3>
        {section(
          socketI18n.t("socketFull.friendsDialog_f20d1732b9"),
          h.incoming.map((p) =>
            person(h.host, p, (
              <>
                <Button size="xsmall" onClick={act("accept", p.serverUserId)}>{socketI18n.t("socketFull.friendsDialog_022daab84c")}</Button>
                <Button size="xsmall" tone="ghost" onClick={act("decline", p.serverUserId)}>{socketI18n.t("socketFull.friendsDialog_dd75a6be62")}</Button>
              </>
            )),
          ),
        )}
        {section(
          socketI18n.t("shellFull.ContactPrivacyMenu_tsx_c11d5e1d35"),
          h.friends.map((p) =>
            person(
              h.host,
              p,
              <>
                {!p.confirmed && (
                  <Button size="xsmall" onClick={() => confirmServerFriend(h.host, p)}>{socketI18n.t("ui.confirm")}</Button>
                )}
                <Button size="xsmall" tone="ghost" onClick={act("remove", p.serverUserId)}>{socketI18n.t("ui.remove")}</Button>
              </>,
              p.confirmed ? undefined : socketI18n.t("socketFull.friendsDialog_27a9759a3d"),
            ),
          ),
        )}
        {section(
          socketI18n.t("socketFull.friendsDialog_0d86bade93"),
          h.outgoing.map((p) =>
            person(h.host, p, <Button size="xsmall" tone="ghost" onClick={act("cancel", p.serverUserId)}>{socketI18n.t("ui.cancel")}</Button>),
          ),
        )}
      </section>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => setFriendsOpen(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup data-gryt="friends-dialog">
          <Dialog.Title>{socketI18n.t("shellFull.ContactPrivacyMenu_tsx_c11d5e1d35")}</Dialog.Title>
          <Dialog.Description>{socketI18n.t("socketFull.friendsDialog_c17e398359")}</Dialog.Description>
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            {shown.length === 0 ? (
              <p className="text-sm text-gryt-muted">{socketI18n.t("socketFull.friendsDialog_0c1e2f37a5")}</p>
            ) : (
              shown.map(server)
            )}
          </div>
          <Dialog.Footer>
            <Button tone="ghost" onClick={() => setFriendsOpen(false)}>{socketI18n.t("ui.close")}</Button>
          </Dialog.Footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
