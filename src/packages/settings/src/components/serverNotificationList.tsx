import { Avatar, Select } from "@gryt/ui";
import { useSyncExternalStore } from "react";

import {
  GeneratedServerIcon,
  getOwnLevel,
  getStoredSnapshot,
  globalOverrules,
  type NotificationLevel,
  serverIconSrc,
  setNotificationLevel,
  subscribeToPrefs,
} from "@/common";
import { i18n, useTranslation } from "@/i18n";
import { useServerManagement, useSockets } from "@/socket";

/**
 * "Default" is a real answer, not a synonym for Everything: a server set back to
 * default hears everything *unless* the global level says otherwise.
 */
const CHOICES: { label: string; value: string }[] = [
  { get label() { return i18n.t("ui.default"); }, value: "default" },
  { get label() { return i18n.t("settingsFull.m4a66d14807"); }, value: "all" },
  { get label() { return i18n.t("settingsFull.me7be45b885"); }, value: "mentions" },
  { get label() { return i18n.t("settingsFull.m4481948392"); }, value: "none" },
];

/**
 * Every server in the rail, and how loud each one is. The levels were only ever
 * reachable by right-clicking one icon at a time, with no way to see the set.
 */
export function ServerNotificationList() {
  useTranslation();
  useSyncExternalStore(subscribeToPrefs, getStoredSnapshot, getStoredSnapshot);

  const { servers, orderedServerHosts } = useServerManagement();
  const { serverDetailsList } = useSockets();
  const global = getStoredSnapshot().global;

  if (orderedServerHosts.length === 0) {
    return (
      <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.mc0c7a2b20c")}</span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {orderedServerHosts.map((host) => {
        const name = servers[host]?.name || host;
        const own = getOwnLevel(host, { kind: "server" });
        // What the server comes out as before the ceiling, which is what the
        // ceiling is compared against. Unset means everything.
        const overruled = globalOverrules(global, own ?? "all");

        return (
          <div
            key={host}
            className="flex flex-wrap items-center gap-3 rounded-(--gryt-radius-md) px-2 py-1.5"
          >
            <Avatar
              size="small"
              className="rounded-(--gryt-radius-md) p-0"
              fallback={<GeneratedServerIcon seed={name} />}
              src={serverIconSrc(host, servers[host]?.name || "", serverDetailsList)}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">{name}</span>
              {/* Only where it changes the answer. Saying "limited by your
                  global setting" under a server that is already quieter than
                  the ceiling would be noise on every row. */}
              <span className="truncate text-xs text-gryt-muted">
                {overruled
                  ? global === "none"
                    ? i18n.t("settingsFull.m45c18aa687")
                    : i18n.t("settingsFull.mb66e9851e8")
                  : host}
              </span>
            </div>
            <Select
              size="small"
              className="w-40 shrink-0 max-[339px]:w-full"
              value={own ?? "default"}
              onValueChange={(value) =>
                setNotificationLevel(
                  host,
                  { kind: "server" },
                  value === "default" ? null : (value as NotificationLevel),
                )
              }
              options={CHOICES.map((choice) => ({ ...choice }))}
            />
          </div>
        );
      })}
    </div>
  );
}
