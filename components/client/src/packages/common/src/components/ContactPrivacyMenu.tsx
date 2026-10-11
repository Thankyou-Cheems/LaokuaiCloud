import { ContextMenu } from "@gryt/ui";
import { useSyncExternalStore } from "react";

import { i18n, useTranslation } from "@/i18n";

import {
  type ContactPrefs,
  type ContactRule,
  getContactPrefsSnapshot,
  setServerContactRule,
  subscribeToContactPrefs,
} from "../hooks/contactPrefs";

const WORDS: Record<keyof ContactPrefs, Record<ContactRule, string>> = {
  messages: { get everyone() { return i18n.t("shellFull.ContactPrivacyMenu_tsx_22e4c60058"); }, get friends() { return i18n.t("shellFull.ContactPrivacyMenu_tsx_c11d5e1d35"); }, get nobody() { return i18n.t("shellFull.ContactPrivacyMenu_tsx_148ba2d236"); } },
  calls: { get everyone() { return i18n.t("shellFull.ContactPrivacyMenu_tsx_94ea1ddb7c"); }, get friends() { return i18n.t("shellFull.ContactPrivacyMenu_tsx_c11d5e1d35"); }, get nobody() { return i18n.t("shellFull.ContactPrivacyMenu_tsx_148ba2d236"); } },
};

const TITLES: Record<keyof ContactPrefs, string> = {
  get messages() { return i18n.t("shellFull.ContactPrivacyMenu_tsx_0424662b37"); },
  get calls() { return i18n.t("shellFull.ContactPrivacyMenu_tsx_4e6838764c"); },
};

/** One server's own answer, or Default to follow Settings → Privacy (GRYT-1470). */
function ContactRuleSubmenu({ host, kind }: { host: string; kind: keyof ContactPrefs }) {
  useTranslation();
  const stored = useSyncExternalStore(subscribeToContactPrefs, getContactPrefsSnapshot, getContactPrefsSnapshot);
  const own = stored.servers[host]?.[kind] ?? null;
  const inherited = stored.global[kind];
  const words = WORDS[kind];

  return (
    <ContextMenu.SubmenuRoot>
      <ContextMenu.SubmenuTrigger>{TITLES[kind]}</ContextMenu.SubmenuTrigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup>
            <ContextMenu.RadioGroup
              value={own ?? "default"}
              onValueChange={(value) =>
                setServerContactRule(host, kind, value === "default" ? null : (value as ContactRule))
              }
            >
              {(["everyone", "friends", "nobody"] as const).map((rule) => (
                <ContextMenu.RadioItem key={rule} value={rule}>
                  {words[rule]}
                </ContextMenu.RadioItem>
              ))}
              <ContextMenu.RadioItem value="default">
                {i18n.t("shellFull.ContactPrivacyMenu_tsx_3fd86a2e5e", { value0: words[inherited].toLowerCase() })}
              </ContextMenu.RadioItem>
            </ContextMenu.RadioGroup>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.SubmenuRoot>
  );
}

/** Both settings, for a server's right-click menus. */
export function ContactPrivacyMenu({ host }: { host: string }) {
  useTranslation();
  return (
    <>
      <ContactRuleSubmenu host={host} kind="messages" />
      <ContactRuleSubmenu host={host} kind="calls" />
    </>
  );
}
