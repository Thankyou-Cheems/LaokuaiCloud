import { createElement, useCallback, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

import { i18n as socketHooksI18n } from "@/i18n";

import { PiInfoFill } from "../../../../lib/icons";
import { socketHookToast } from "../utils/socketHookMessages";

/**
 * Reporting a person to the moderators of the server you are both on. This waits
 * for an answer: the entire report is what somebody just typed.
 */

const NO_ANSWER_MS = 6_000;

export interface UseReportUserResult {
  reportUser: (args: { serverUserId: string; reason: string }) => void;
}

export function useReportUser({
  socket,
  accessToken,
}: {
  socket: Socket | null;
  accessToken: string | null;
}): UseReportUserResult {
  const waiting = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const settle = useCallback((serverUserId: string) => {
    const timer = waiting.current.get(serverUserId);
    if (timer) {
      clearTimeout(timer);
      waiting.current.delete(serverUserId);
    }
    return !!timer;
  }, []);

  useEffect(() => {
    if (!socket) return;

    const onSubmitted = (payload: { serverUserId?: string }) => {
      if (!payload?.serverUserId) return;
      if (settle(payload.serverUserId)) toast.success(socketHookToast(() => socketHooksI18n.t("socketHooksFull.useReportUser_92c29dd23e")));
    };

    const onAlready = (payload: { serverUserId?: string }) => {
      if (!payload?.serverUserId) return;
      if (settle(payload.serverUserId)) {
        toast(socketHookToast(() => socketHooksI18n.t("socketHooksFull.useReportUser_369e357795")), { icon: createElement(PiInfoFill, { size: 18 }) });
      }
    };

    socket.on("report:user_submitted", onSubmitted);
    socket.on("report:user_already_reported", onAlready);

    return () => {
      socket.off("report:user_submitted", onSubmitted);
      socket.off("report:user_already_reported", onAlready);
    };
  }, [socket, settle]);

  /* Every outstanding timer is dropped when the socket goes. A disconnect is not
     evidence that the server is too old. */
  useEffect(() => {
    const timers = waiting.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, [socket]);

  const reportUser = useCallback(
    ({ serverUserId, reason }: { serverUserId: string; reason: string }) => {
      if (!socket || !accessToken) return;

      const existing = waiting.current.get(serverUserId);
      if (existing) clearTimeout(existing);

      waiting.current.set(
        serverUserId,
        setTimeout(() => {
          waiting.current.delete(serverUserId);
          toast.error(socketHookToast(() => socketHooksI18n.t("socketHooksFull.useReportUser_aa45053920")));
        }, NO_ANSWER_MS),
      );

      socket.emit("user:report", { accessToken, serverUserId, reason });
    },
    [socket, accessToken],
  );

  return { reportUser };
}
