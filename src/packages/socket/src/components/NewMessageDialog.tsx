import { Avatar, Button, Checkbox, Dialog, Spinner, TextField } from "@gryt/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { getOwnServerUserId, getUploadsFileUrl, resolveAvatarSrc, serverIconSrc } from "@/common";
import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { useDirectory, useDmsOffHosts } from "../hooks/dmDirectory";
import { requestConversation } from "../hooks/dmSpace";
import { setNewMessageOpen, useNewMessageOpen } from "../hooks/newMessageDialog";
import { conversationTitle } from "../hooks/useDirectMessages";
import { canOnServer } from "../hooks/usePermissions";
import { useServerManagement } from "../hooks/useServerManagement";
import { useSockets } from "../hooks/useSockets";
import {
  type Candidate,
  candidatesFor,
  createdGroup,
  directWith,
  matching,
  type NewMessageMode,
} from "../lib/newMessage";
import { emitAuthenticated } from "../utils/tokenManager";
import { EmojiText } from "./EmojiText";
import { GroupFaceFields } from "./GroupDialog";
import { ServerMark } from "./ServerChip";

/**
 * The + next to Messages: somebody on any of your servers, or a group on one of them.
 * Mounted once above the server view, which a conversation on another server moves.
 */

/** Long enough for a slow server, short enough that a dead one doesn't look like a hang. */
const ANSWER_MS = 10_000;

type Waiting =
  | { kind: "dm"; host: string; serverUserId: string }
  | { kind: "group"; host: string; picked: string[]; before: ReadonlySet<string> };

export function NewMessageDialog() {
  useSocketTranslation();
  const open = useNewMessageOpen();
  const { sockets, memberLists, serverDetailsList, serverConnectionStatus } = useSockets();
  const { servers, currentlyViewingServer, viewServerBehindDmSpace } = useServerManagement();
  const entries = useDirectory();
  const dmsOff = useDmsOffHosts();

  const [mode, setMode] = useState<NewMessageMode>("message");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  /** The server a group goes on, fixed by the first person picked. */
  const [groupHost, setGroupHost] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [problem, setProblem] = useState<string | { key: string; values?: Record<string, string | number> } | null>(null);
  /** The group just made, once the server has sent it: the name and picture step. */
  const [made, setMade] = useState<{ host: string; conversationId: string } | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const sentName = useRef("");

  useEffect(() => {
    if (!open) return;
    setMode("message");
    setQuery("");
    setPicked([]);
    setGroupHost(null);
    setWaiting(null);
    setProblem(null);
    setMade(null);
    setName("");
    setIcon(null);
    sentName.current = "";
  }, [open]);

  const serverName = (host: string) => servers[host]?.name || host;

  const people = useMemo(
    () =>
      Object.keys(sockets)
        .filter((host) => sockets[host] && serverConnectionStatus[host] === "connected")
        .map((host) => {
          const info = serverDetailsList[host]?.server_info;
          return {
            host,
            selfId: getOwnServerUserId(host),
            members: memberLists[host] ?? [],
            canMessage: canOnServer(info, "send_direct_messages") && !dmsOff.has(host),
            canGroup: canOnServer(info, "create_groups"),
          };
        }),
    [sockets, serverConnectionStatus, serverDetailsList, memberLists, dmsOff],
  );

  const everyone = useMemo(() => candidatesFor(people, mode), [people, mode]);
  const severalServers = useMemo(() => new Set(everyone.map((c) => c.host)).size > 1, [everyone]);
  const inScope = groupHost ? everyone.filter((c) => c.host === groupHost) : everyone;
  const shown = matching(inScope, query, serverName);
  const canGroupSomewhere = people.some((p) => p.canMessage && p.canGroup);
  const canMessageSomewhere = people.some((p) => p.canMessage);

  /* The same way a row in the list opens one. A conversation on another server moves
     the view underneath to it, and the view claims the conversation when it gets there. */
  const show = (host: string, conversationId: string) => {
    requestConversation(host, conversationId);
    if (host !== currentlyViewingServer?.host) viewServerBehindDmSpace(host);
  };

  /* The answer is the conversation turning up in the directory: neither `dm:open` nor
     `dm:group:create` replies to the one who asked with anything else. */
  useEffect(() => {
    if (!waiting) return;
    if (waiting.kind === "dm") {
      const found = directWith(entries, waiting.host, waiting.serverUserId);
      if (!found) return;
      setWaiting(null);
      show(waiting.host, found.conversation_id);
      setNewMessageOpen(false);
      return;
    }
    const found = createdGroup(entries, waiting.host, waiting.before, waiting.picked);
    if (!found) return;
    setWaiting(null);
    show(waiting.host, found.conversation_id);
    setMade({ host: waiting.host, conversationId: found.conversation_id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, entries]);

  /* A refusal is toasted where it arrives. Here it only stops the wait, so what was
     picked is still picked when it clears. */
  useEffect(() => {
    if (!waiting) return;
    const host = waiting.host;
    const socket = sockets[host];
    if (!socket) return;
    const stop = () => setWaiting(null);
    const refused = (payload: { error?: string } | undefined) => {
      if (payload?.error === "forbidden" || payload?.error === "rate_limited") stop();
    };
    socket.on("dm:error", stop);
    socket.on("server:error", refused);
    const timer = setTimeout(() => {
      stop();
      setProblem({ key: "socketFull.newMessageDialog_c97f9444ae", values: { p0: (serverName(host)) } });
    }, ANSWER_MS);
    return () => {
      socket.off("dm:error", stop);
      socket.off("server:error", refused);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, sockets]);

  const message = (candidate: Candidate) => {
    setProblem(null);
    const existing = directWith(entries, candidate.host, candidate.serverUserId);
    if (existing) {
      show(candidate.host, existing.conversation_id);
      setNewMessageOpen(false);
      return;
    }
    const socket = sockets[candidate.host];
    if (!socket) return;
    setWaiting({ kind: "dm", host: candidate.host, serverUserId: candidate.serverUserId });
    void emitAuthenticated(socket, "dm:open", { targetServerUserId: candidate.serverUserId }, candidate.host)
      .then((sent) => {
        if (sent) return;
        setWaiting(null);
        setProblem({ key: "socketFull.newMessageDialog_55523232f3", values: { p0: (serverName(candidate.host)) } });
      });
  };

  const toggle = (candidate: Candidate) => {
    const next = picked.includes(candidate.serverUserId)
      ? picked.filter((id) => id !== candidate.serverUserId)
      : [...picked, candidate.serverUserId];
    setPicked(next);
    setGroupHost(next.length > 0 ? candidate.host : null);
  };

  const createGroup = () => {
    if (!groupHost || picked.length < 2) return;
    const socket = sockets[groupHost];
    if (!socket) return;
    setProblem(null);
    const before = new Set(
      entries.filter((e) => e.host === groupHost).map((e) => e.conversation.conversation_id),
    );
    setWaiting({ kind: "group", host: groupHost, picked, before });
    void emitAuthenticated(socket, "dm:group:create", { memberIds: picked }, groupHost).then((sent) => {
      if (sent) return;
      setWaiting(null);
      setProblem({ key: "socketFull.newMessageDialog_55523232f3", values: { p0: (serverName(groupHost)) } });
    });
  };

  const madeGroup = made
    ? entries.find((e) => e.host === made.host && e.conversation.conversation_id === made.conversationId)
      ?.conversation
    : undefined;

  const update = (changes: { name?: string | null; iconFileId?: string | null }) => {
    const socket = made ? sockets[made.host] : undefined;
    if (!made || !socket) return;
    void emitAuthenticated(socket, "dm:group:update", { conversationId: made.conversationId, ...changes }, made.host);
  };

  /* Sent when the field is left, and on the way out, so closing never loses a name. */
  const sendName = () => {
    const trimmed = name.trim();
    if (trimmed === sentName.current) return;
    sentName.current = trimmed;
    update({ name: trimmed || null });
  };

  /* Cancelling while a server is still answering drops the answer, or the
     conversation would open by itself after the dialog had gone. */
  const close = () => {
    if (made) sendName();
    setWaiting(null);
    setNewMessageOpen(false);
  };

  const row = (candidate: Candidate) => {
    const avatar = (
      <Avatar
        size="small"
        fallback={candidate.nickname[0]}
        src={resolveAvatarSrc(
          candidate.avatarFileId
            ? getUploadsFileUrl(candidate.host, candidate.avatarFileId, { thumb: true })
            : undefined,
          candidate.nickname,
          candidate.avatarWorn,
        )}
      />
    );
    const server = severalServers && !groupHost ? (
      <span className="flex shrink-0 items-center gap-1 text-xs" style={{ color: "var(--gryt-neutral-10)" }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, overflow: "hidden", display: "block" }}>
          <ServerMark
            src={serverIconSrc(candidate.host, servers[candidate.host]?.name || "", serverDetailsList)}
            seed={serverName(candidate.host)}
          />
        </span>
        {serverName(candidate.host)}
      </span>
    ) : null;
    const key = `${candidate.host}/${candidate.serverUserId}`;

    if (mode === "group") {
      return (
        <label
          key={key}
          className="flex cursor-pointer items-center gap-2 rounded-(--gryt-radius-md) px-2 py-1 hover:bg-gryt-surface-raised"
        >
          <Checkbox
            checked={picked.includes(candidate.serverUserId)}
            disabled={waiting !== null}
            onCheckedChange={() => toggle(candidate)}
          />
          {avatar}
          <span className="min-w-0 flex-1 truncate text-sm">
            <EmojiText text={candidate.nickname} />
          </span>
          {server}
        </label>
      );
    }

    const asking = waiting?.kind === "dm" && waiting.host === candidate.host
      && waiting.serverUserId === candidate.serverUserId;
    return (
      <Button
        key={key}
        tone="ghost"
        disabled={waiting !== null}
        style={{ width: "100%", justifyContent: "start", overflow: "hidden", gap: "10px" }}
        onClick={() => message(candidate)}
      >
        {avatar}
        <span className="min-w-0 flex-1 truncate" style={{ textAlign: "left" }}>
          <EmojiText text={candidate.nickname} />
        </span>
        {asking ? <Spinner size={14} aria-label={socketI18n.t("socketFull.newMessageDialog_c8d03e148e")} /> : server}
      </Button>
    );
  };

  const emptyText = !canMessageSomewhere
    ? socketI18n.t("socketFull.newMessageDialog_ee9935239b")
    : mode === "group" && !canGroupSomewhere
      ? socketI18n.t("socketFull.newMessageDialog_8b92c796b6")
      : inScope.length === 0
        ? socketI18n.t("socketFull.newMessageDialog_32e292e49f")
        : socketI18n.t("socketFull.newMessageDialog_2e6b520838", { p0: (query) });

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          {made ? (
            <>
              <Dialog.Title>{socketI18n.t("socketFull.newMessageDialog_06e5294227")}</Dialog.Title>
              <Dialog.Description>{socketI18n.t("socketFull.newMessageDialog_035b58755c")}</Dialog.Description>
              <div className="flex flex-col gap-4">
                <GroupFaceFields
                  serverHost={made.host}
                  seed={name.trim() || (madeGroup ? conversationTitle(madeGroup) : "New group")}
                  icon={icon}
                  onIcon={(fileId) => {
                    setIcon(fileId);
                    update({ iconFileId: fileId });
                  }}
                  name={name}
                  onName={setName}
                  onNameDone={sendName}
                  placeholder={madeGroup ? conversationTitle(madeGroup) : socketI18n.t("ui.optional")}
                  autoFocus
                />
              </div>
              <Dialog.Footer>
                <Button onClick={close}>{socketI18n.t("shellFull.approveDevice_tsx_e9b450d14b")}</Button>
              </Dialog.Footer>
            </>
          ) : (
            <>
              <Dialog.Title>{mode === "group" ? socketI18n.t("socketFull.newMessageDialog_6d72a912d8") : socketI18n.t("socketFull.newMessageDialog_199aa9bf73")}</Dialog.Title>
              <Dialog.Description>
                {mode === "group"
                  ? groupHost && severalServers
                    ? socketI18n.t("socketFull.newMessageDialog_2a6ca4054c", { p0: (serverName(groupHost)) })
                    : socketI18n.t("socketFull.newMessageDialog_842deb87a5")
                  : severalServers
                    ? socketI18n.t("socketFull.newMessageDialog_a2e1edb768")
                    : socketI18n.t("socketFull.newMessageDialog_0f72f9eac2")}
              </Dialog.Description>

              <div className="flex flex-col gap-3">
                <TextField
                  autoFocus
                  size="small"
                  placeholder={socketI18n.t("socketFull.newMessageDialog_2734d2413c")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />

                <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                  {shown.length === 0 ? (
                    <p className="px-2 py-1 text-xs" style={{ color: "var(--gryt-neutral-10)" }}>{emptyText}</p>
                  ) : (
                    shown.map(row)
                  )}
                </div>

                {mode === "group" && picked.length === 1 && (
                  <span className="text-xs text-gryt-muted">{socketI18n.t("socketFull.newMessageDialog_f84150fed5")}</span>
                )}
                {problem && <span className="text-xs text-gryt-danger">{typeof problem === "string" ? problem : socketI18n.t(problem.key, problem.values)}</span>}
              </div>

              <Dialog.Footer className="flex-wrap justify-between">
                {mode === "group" ? (
                  <Button
                    tone="ghost"
                    disabled={waiting !== null}
                    onClick={() => {
                      setMode("message");
                      setPicked([]);
                      setGroupHost(null);
                      setProblem(null);
                    }}
                  >{socketI18n.t("ui.back")}</Button>
                ) : canGroupSomewhere ? (
                  <Button
                    tone="ghost"
                    onClick={() => {
                      setMode("group");
                      setProblem(null);
                    }}
                  >{socketI18n.t("socketFull.newMessageDialog_99a5bf1704")}</Button>
                ) : (
                  <span />
                )}
                <div className="flex flex-wrap gap-2">
                  <Button tone="ghost" onClick={close}>{socketI18n.t("ui.cancel")}</Button>
                  {mode === "group" && (
                    <Button onClick={createGroup} disabled={picked.length < 2 || waiting !== null}>
                      {waiting?.kind === "group" ? socketI18n.t("settingsFull.m94d7d8ee47") : socketI18n.t("socketFull.newMessageDialog_99a5bf1704")}
                    </Button>
                  )}
                </div>
              </Dialog.Footer>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
