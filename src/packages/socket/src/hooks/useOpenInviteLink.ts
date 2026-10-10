import { createElement, useCallback } from "react";
import toast from "react-hot-toast";

import {
  hostedAdvertisement,
  isLoopbackHost,
  NO_PUBLIC_ADDRESS,
  openServerLink,
} from "@/common";
import { i18n as socketHooksI18n } from "@/i18n";

import { getElectronAPI } from "../../../../lib/electron";
import { PiInfoFill } from "../../../../lib/icons";
import { socketHookToast } from "../utils/socketHookMessages";
import { useServerJoinPolicy } from "./useServerJoinPolicy";

/** "Copy invite link", offered only where the server has said anyone can join. */
export function useOpenInviteLink(host: string | undefined) {
  const policy = useServerJoinPolicy(host);

  const copy = useCallback(async () => {
    if (!host) return;
    // Read at the press: every rail entry holding its own IPC listener costs more than one call.
    const embedded = isLoopbackHost(host)
      ? ((await getElectronAPI()?.getEmbeddedServerInfo().catch(() => null))?.servers ?? [])
      : [];
    const link = openServerLink(host, hostedAdvertisement(host, embedded));

    if (link.kind === "no-public-address") {
      toast.error(socketHookToast(() => NO_PUBLIC_ADDRESS), { duration: 7000 });
      if (link.hosted) {
        toast(socketHookToast(() => socketHooksI18n.t("socketHooksFull.addPublicInviteInstruction")), {
          duration: 10000,
          icon: createElement(PiInfoFill, { size: 18 }),
        });
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(link.url);
      toast.success(socketHookToast(() => socketHooksI18n.t("socketHooksFull.useOpenInviteLink_762220a924")));
    } catch {
      toast.error(socketHookToast(() => socketHooksI18n.t("socketHooksFull.useOpenInviteLink_7a456d6f43")));
    }
  }, [host]);

  return { available: !!host && policy === "open", copy };
}
