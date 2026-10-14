import { type DragEvent, type MouseEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

import { i18n } from "@/i18n";

import { requestVoiceMove } from "../utils/requestVoiceMove";
import { mayDropVoiceMember, mayMoveVoiceMember, type VoiceDragSnapshot, type VoiceDragTarget,voiceDragTarget } from "./voiceMemberDragPolicy";

const MIME = "application/x-laokuai-voice-member";
const INTERACTIVE = "button,input,select,textarea,a,[role=button],[role=slider],[contenteditable=true]";

/** Local drag identity only: never trust a member id supplied by another tab/community. */
export function useVoiceMemberDrag(snapshot: VoiceDragSnapshot, socket: Socket | undefined) {
  const current = useRef({ snapshot, socket });
  current.current = { snapshot, socket };
  const active = useRef<{ target: VoiceDragTarget; nonce: string; name: string } | null>(null);
  const [drag, setDrag] = useState<typeof active.current>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const mounted = useRef(true);
  const suppressClickUntil = useRef(0);
  const interactiveDragOrigin = useRef(false);
  const clear = useCallback(() => { active.current = null; setDrag(null); setOver(null); }, []);

  useEffect(() => {
    mounted.current = true;
    const cancel = () => { if (active.current) { suppressClickUntil.current = Date.now() + 250; clear(); } };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    window.addEventListener("dragend", cancel);
    window.addEventListener("drop", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
    return () => {
      mounted.current = false;
      active.current = null;
      window.removeEventListener("dragend", cancel);
      window.removeEventListener("drop", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [clear]);

  useEffect(() => {
    if (!active.current) return;
    const before = active.current.target;
    const after = voiceDragTarget(snapshot, before.clientId);
    if (!after || after.host !== before.host || after.generation !== before.generation ||
      after.source !== before.source || after.serverUserId !== before.serverUserId) clear();
    else if (over && !mayDropVoiceMember(snapshot, before, over)) setOver(null);
  }, [snapshot, over, clear]);

  const memberProps = (clientId: string) => {
    const canOffer = mayMoveVoiceMember(snapshot, clientId);
    const available = !pending && !!voiceDragTarget(snapshot, clientId) && snapshot.channels.some(channel =>
      mayDropVoiceMember(snapshot, voiceDragTarget(snapshot, clientId)!, channel.id));
    const name = snapshot.clients[clientId]?.nickname ?? "";
    const label = i18n.t(available ? "voiceRoom.dragMember" : "voiceRoom.moveUnavailable", { name });
    return {
      canOffer, available, label,
      props: {
        draggable: available,
        "data-voice-drag-member": canOffer ? clientId : undefined,
        "data-voice-move-pending": pending === clientId || undefined,
        style: { width: "100%", cursor: available ? "grab" : undefined, opacity: pending === clientId ? 0.65 : undefined },
        onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
          event.stopPropagation();
          // A new intentional press is not the click synthesized after a drop.
          suppressClickUntil.current = 0;
          const control = (event.target as HTMLElement).closest(INTERACTIVE);
          // Native dragstart targets the draggable ancestor, even when the
          // pointer actually started on its volume slider/button.
          interactiveDragOrigin.current = !!control && !control.hasAttribute("data-voice-drag-handle");
        },
        onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
          if (Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); }
        },
        onDragStart: (event: DragEvent<HTMLDivElement>) => {
          event.stopPropagation();
          const interactive = (event.target as HTMLElement).closest(INTERACTIVE);
          const target = voiceDragTarget(current.current.snapshot, clientId);
          if (!available || !target || interactiveDragOrigin.current || (interactive && !interactive.hasAttribute("data-voice-drag-handle"))) {
            event.preventDefault(); return;
          }
          const next = { target, nonce: crypto.randomUUID(), name };
          active.current = next; setDrag(next);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(MIME, next.nonce);
          // Cards include avatars and names; a single card is the native drag image.
          event.dataTransfer.setDragImage(event.currentTarget, 24, 12);
        },
        onDragEnd: (event: DragEvent<HTMLDivElement>) => {
          event.stopPropagation(); suppressClickUntil.current = Date.now() + 250; clear();
        },
      },
    };
  };

  const channelProps = (destination: string) => ({
    "data-voice-drop-channel": destination,
    "data-voice-drop-active": over === destination || undefined,
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (!active.current) return;
      event.stopPropagation();
      const valid = mayDropVoiceMember(current.current.snapshot, active.current.target, destination);
      event.dataTransfer.dropEffect = valid ? "move" : "none";
      if (valid) { event.preventDefault(); setOver(destination); }
      else setOver(null);
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(value => value === destination ? null : value);
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      const operation = active.current;
      if (!operation) return;
      event.preventDefault(); event.stopPropagation(); suppressClickUntil.current = Date.now() + 250;
      const { snapshot: latest, socket: liveSocket } = current.current;
      clear();
      if (!liveSocket?.connected || liveSocket.id !== operation.target.generation || pending ||
        event.dataTransfer.getData(MIME) !== operation.nonce || !mayDropVoiceMember(latest, operation.target, destination)) return;
      setPending(operation.target.clientId);
      // Roster changes remain entirely server-owned; this never joins the actor's room.
      const promise = requestVoiceMove(liveSocket, latest.host, operation.target, destination);
      void toast.promise(promise, {
        loading: i18n.t("pureVoice.movePending"), success: i18n.t("pureVoice.moveCommitted"),
        error: (error: Error) => `${i18n.t("pureVoice.moveFailed")}: ${error.message}`,
      }).then(() => { if (mounted.current) setPending(null); }, () => { if (mounted.current) setPending(null); });
    },
  });
  return { memberProps, channelProps, over, drag, pending };
}
