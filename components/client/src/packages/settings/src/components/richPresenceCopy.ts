type SettingsCopyTranslator = (key: string, values?: Record<string, string | number>) => string;

function copyText(translate: SettingsCopyTranslator | undefined, key: string, english: string, values: Record<string, string | number> = {}): string {
  return translate ? translate(key, { defaultValue: english, ...values }) : english.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ""));
}

import type { RichPresenceSocketStatus } from "../../../../lib/electron";

/** What settings says about the game connection. Kept apart so a test can read every case. */
export function socketLine({ state, holder, helper }: RichPresenceSocketStatus, translate?: SettingsCopyTranslator): { text: string; warn: boolean; fix?: string } {
  if (state === "holding" && helper) {
    return { text: copyText(translate, "settingsFull.m20e24c2a23", "The Gryt helper has the game connection. Games you start now report to Gryt instead of Discord.", {}), warn: false };
  }
  if (state === "holding") {
    return { text: copyText(translate, "settingsFull.m57f57f79aa", "Gryt has the game connection. Games you start now report to Gryt instead of Discord.", {}), warn: false };
  }
  if (state === "off") return { text: "", warn: false };
  if (holder?.isDiscord) {
    return {
      text: copyText(translate, "settingsFull.m4f3cc2f37d", "{{value0}} is holding the game connection, so games report to {{value1}} instead of Gryt.", { value0: holder.name, value1: holder.name }),
      warn: true,
      fix: copyText(translate, "settingsFull.md8088e1e75", "Quit {{value0}} and Gryt takes the connection over a few seconds later. No restart needed.", { value0: holder.name }),
    };
  }
  if (holder) {
    return {
      text: copyText(translate, "settingsFull.m7d443bfd5d", "{{value0}} is holding the game connection, so games can't reach Gryt.", { value0: holder.name }),
      warn: true,
      fix: copyText(translate, "settingsFull.mf95c37f621", "Quit {{value0}} and Gryt takes the connection over a few seconds later.", { value0: holder.name }),
    };
  }
  return {
    text: copyText(translate, "settingsFull.mfd26e503a2", "Another program is holding the game connection, so games can't reach Gryt.", {}),
    warn: true,
    fix: copyText(translate, "settingsFull.m95f0b46eb1", "Gryt keeps checking, and takes the connection as soon as it's free.", {}),
  };
}

/** The one-time notice, for the first time Discord is found holding it after turning this on. */
export function heldNotice(name: string, translate?: SettingsCopyTranslator): string {
  return copyText(translate, "settingsFull.mb04b13541f", "{{value0}} got to the game connection first, so games report to {{value1}} instead of Gryt. Settings, under Profile, says how to fix it.", { value0: name, value1: name });
}
