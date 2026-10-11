import en from "../src/packages/i18n/locales/en.json";
import zhCN from "../src/packages/i18n/locales/zh-CN.json";

let language: "en" | "zh-CN" = "en";
let applicationName = "Gryt";

export function setNativeApplicationName(name: string): void { applicationName = name; }

/** Same supported language choices as the renderer, without a DOM dependency. */
export function setNativeLanguagePreference(value: unknown, systemLanguages: readonly string[]): void {
  if (value === "en" || value === "zh-CN") {
    language = value;
    return;
  }
  language = "en";
  for (const entry of systemLanguages) {
    const code = entry.replace(/_/g, "-").toLowerCase();
    if (code === "zh" || /^zh-(cn|sg|hans)(-|$)/.test(code)) { language = "zh-CN"; return; }
    if (/^en(-|$)/.test(code)) return;
  }
}

export function nativeT(key: string, values: Record<string, unknown> = {}): string {
  const source = (language === "zh-CN" ? zhCN : en) as unknown as { nativeFull?: Record<string, string> };
  const fallback = en as unknown as { nativeFull?: Record<string, string> };
  const message = source.nativeFull?.[key] ?? fallback.nativeFull?.[key] ?? key;
  // Brand only catalog text, before inserting any user supplied server names.
  return message.replace(/\bGryt\b/g, applicationName).replace(/\{\{(\w+)\}\}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : token,
  );
}

/** Locale for native presentation, including an explicit in-app preference. */
export function nativeLanguage(): "en" | "zh-CN" { return language; }
