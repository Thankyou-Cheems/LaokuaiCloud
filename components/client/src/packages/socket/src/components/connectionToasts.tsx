/* eslint-disable react-refresh/only-export-components -- Toast factories intentionally return subscribed React bodies. */
import toast from "react-hot-toast";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { DismissibleToast } from "./DismissibleToast";

/* Long enough to read and to cover the usual blip, short enough that a server
   that is gone does not leave a spinner sitting on your screen. */
export const RECONNECT_TOAST_MS = 6_000;

function ReconnectingToastBody({ toastId, serverName }: { toastId: string; serverName: string }) {
  useSocketTranslation();
  return (
    <DismissibleToast
      message={socketI18n.t("socketFull.connectionToasts_60dc1983ee", { p0: serverName })}
      onDismiss={() => toast.dismiss(toastId)}
    />
  );
}

function ReconnectGaveUpToastBody({ serverName }: { serverName: string }) {
  useSocketTranslation();
  return <>{socketI18n.t("socketFull.connectionToasts_23627c155c", { p0: serverName })}</>;
}

/* Raised from useSockets, which is a .ts file and cannot hold the markup. */
export function showReconnectingToast(toastId: string, serverName: string): void {
  toast.loading(
    () => <ReconnectingToastBody toastId={toastId} serverName={serverName} />,
    { id: toastId, duration: RECONNECT_TOAST_MS },
  );
}

export function showReconnectGaveUpToast(toastId: string, serverName: string): void {
  toast.error(() => <ReconnectGaveUpToastBody serverName={serverName} />, {
    id: toastId,
    duration: 8_000,
  });
}
