/* eslint-disable react-refresh/only-export-components -- Toast factories intentionally return subscribed React bodies. */
import { Button } from "@gryt/ui";
import toast from "react-hot-toast";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

/**
 * The warning that a server holds a message key this device did not publish, and
 * what somebody can do about it. Which repair shows depends on the account.
 */

/** What this device can actually do about the mismatch. */
export type DmKeyFix =
  /** The account has a sealed copy; this device can take it. */
  | "unlock"
  /** Signed in with no sealed copy, so there is nothing for a second device
      to take. Setting a message password is what creates one. */
  | "set-up"
  /** A guest, or the account could not be read. Nothing to offer, so the
      warning is only a warning. */
  | "none";

/**
 * Open the person's own settings from outside React. The socket layer is plain
 * modules, and `server_settings_open` next to it already does this.
 */
export function openUserSettings(tab: string): void {
  window.dispatchEvent(new CustomEvent("user_settings_open", { detail: { tab } }));
}

/** "Gryt Chat has", "Gryt Chat and Home have", "Gryt Chat, Home and 2 more servers have". */
export function serversHave(names: readonly string[]): string {
  if (names.length <= 1) return socketI18n.t("socketFull.dmKeyWarningToast_6f6aa32231", { p0: (names[0] ?? socketI18n.t("ui.thisServer")) });
  if (names.length === 2) return socketI18n.t("socketFull.dmKeyWarningToast_a3dc38673e", { p0: (names[0]), p1: (names[1]) });
  return socketI18n.t("socketFull.dmKeyWarningToast_861695bf9f", { p0: (names[0]), p1: (names[1]), p2: (names.length - 2), count: (names.length - 2) });
}

/* "I don't care", for people whose direct messages don't need to be private from the server.
   Per device, like the key the warning is about; Security settings turns it back on. */
const WARNINGS_OFF_KEY = "gryt_dm_key_warnings_off";

export function dmKeyWarningsOff(): boolean {
  try {
    return localStorage.getItem(WARNINGS_OFF_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDmKeyWarningsOff(off: boolean): void {
  try {
    if (off) localStorage.setItem(WARNINGS_OFF_KEY, "1");
    else localStorage.removeItem(WARNINGS_OFF_KEY);
  } catch {
    // No storage: it warns again next launch, the safe direction.
  }
}

const BODY: Record<DmKeyFix, (servers: readonly string[]) => string> = {
  unlock: (servers) => socketI18n.t("socketFull.dmKeyMismatchUnlock", { p0: serversHave(servers) }),
  "set-up": (servers) => socketI18n.t("socketFull.dmKeyMismatchSetUp", { p0: serversHave(servers) }),
  none: (servers) => socketI18n.t("socketFull.dmKeyMismatchWarning", { p0: serversHave(servers) }),
};

const ACTION: Record<DmKeyFix, string | null> = {
  get unlock() { return socketI18n.t("socketFull.dmKeyWarningToast_dd6e0d4fd6"); },
  get "set-up"() { return socketI18n.t("settingsFull.m33d3bea662"); },
  none: null,
};

interface DmKeyWarningProps {
  id: string;
  /** Every server with the mismatch, in one toast rather than one each. */
  serverNames: readonly string[];
  fix: DmKeyFix;
  /** Called when Dismiss is pressed, so the warning stays gone. */
  onDismiss: () => void;
}

function DmKeyWarningBody({ id, serverNames, fix, onDismiss }: DmKeyWarningProps) {
  useSocketTranslation();
  const action = ACTION[fix];
  return (
      <div className="flex flex-col gap-2" style={{ minWidth: 0 }}>
        <span className="text-sm" style={{ lineHeight: 1.5 }}>
          {BODY[fix](serverNames)}
        </span>

        <div className="flex items-center gap-2" style={{ alignSelf: "flex-end" }}>
          <Button
            tone="neutral"
            size="xsmall"
            onClick={() => {
              toast.dismiss(id);
              onDismiss();
            }}
          >{socketI18n.t("shellFull.serviceStatusBanner_tsx_70afe9eff3")}</Button>
          <Button
            tone="ghost"
            size="xsmall"
            onClick={() => {
              toast.dismiss(id);
              setDmKeyWarningsOff(true);
              onDismiss();
            }}
          >{socketI18n.t("socketFull.dmKeyWarningToast_64e90c3c30")}</Button>
          {action && (
            <Button
              size="xsmall"
              onClick={() => {
                toast.dismiss(id);
                openUserSettings("security");
              }}
            >
              {action}
            </Button>
          )}
        </div>
      </div>
  );
}

export function showDmKeyWarning({ id, serverNames, fix, onDismiss }: DmKeyWarningProps): void {
  /* The subscribed component also updates a warning that stays open while the
     language changes. Keep repair actions and toast lifetime independent of it. */
  toast.error(
    () => <DmKeyWarningBody id={id} serverNames={serverNames} fix={fix} onDismiss={onDismiss} />,
    { id, duration: Infinity },
  );
}
