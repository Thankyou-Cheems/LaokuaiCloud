import { i18n } from "@/i18n";

import type { RichPresenceLogEntry } from "../../../../lib/electron";

// Explicit fixed-version display allowlist. Never reinterpret unknown native detail.
const UPDATE_MESSAGES = [
  {
    "key": "nativeFull.second_9407971d8963",
    "en": "The update file was not found. A new release may not have all artifacts uploaded yet — try again in a few minutes.",
    "zh": "未找到更新文件。新版本的文件可能尚未全部上传，请过几分钟再试。"
  },
  {
    "key": "nativeFull.second_dd64ba81e545",
    "en": "No update available for this channel yet. The release may still be building — try again in a few minutes.",
    "zh": "此更新通道暂时没有可用更新。新版本可能仍在构建，请过几分钟再试。"
  },
  {
    "key": "nativeFull.second_3b13e17a40ac",
    "en": "GitHub is rate limiting this machine, so the update could not be fetched. It clears on its own, so try again in a few minutes.",
    "zh": "GitHub 正在限制这台设备的请求频率，因此无法获取更新。限制会自动解除，请过几分钟再试。"
  },
  {
    "key": "nativeFull.second_f1725a617c92",
    "en": "The update could not be fetched. The connection to GitHub closed before it finished. This is usually temporary, so try again in a few minutes.",
    "zh": "无法获取更新，连接在下载完成前已被 GitHub 关闭。这通常是暂时的，请过几分钟再试。"
  },
  {
    "key": "nativeFull.second_6afa7147d24c",
    "en": "Could not reach the update server. Check your internet connection and try again.",
    "zh": "无法连接更新服务器。请检查网络连接后重试。"
  },
  {
    "key": "nativeFull.second_f1a73356fc04",
    "en": "Access denied while checking for updates. The release may be private or your token has expired.",
    "zh": "检查更新时访问被拒绝。版本可能是私有的，或你的令牌已过期。"
  },
  {
    "key": "nativeFull.second_2d94088bae0a",
    "en": "Downloaded update failed integrity check. Try checking for updates again.",
    "zh": "下载的更新未通过完整性校验。请重新检查更新。"
  },
  {
    "key": "nativeFull.second_83ddf9e450dd",
    "en": "The Mac App Store keeps this version up to date.",
    "zh": "此版本由 Mac App Store 保持更新。"
  },
  {
    "key": "nativeFull.second_4dbaca095983",
    "en": "The Microsoft Store keeps this version up to date.",
    "zh": "此版本由 Microsoft Store 保持更新。"
  },
  {
    "key": "nativeFull.second_b1810a09d4f5",
    "en": "Couldn't check GitHub for updates right now. Try again in a few minutes.",
    "zh": "暂时无法通过 GitHub 检查更新。请过几分钟再试。"
  }
] as const;

/** Old English and new native-language payloads resolve again at render time. */
export function nativeUpdateMessage(value: string | undefined): string {
  if (value === undefined) return "";
  for (const row of UPDATE_MESSAGES) {
    if (value === row.en || value === row.zh) return i18n.t(row.key);
    // Older main processes used a lowercase store name in this complete sentence.
    if (row.en.includes("keeps this version") && value === row.en[0].toLowerCase() + row.en.slice(1)) return i18n.t(row.key);
  }
  const retry = /^(?:Couldn't check GitHub for updates right now\. Try again after (.+)\.|暂时无法通过 GitHub 检查更新。请在 (.+) 后重试。)$/.exec(value);
  return retry ? i18n.t("nativeFull.second_abc5705e68e5", { time: retry[1] ?? retry[2] }) : value;
}

export function nativeHelperProblem(value: string): string {
  if (value === "macOS can't find its login item in this copy of Gryt.") return i18n.t("settingsNativeDisplay.helperMissing");
  const reg = /^reg\.exe add exited (-?\d+)$/.exec(value);
  if (reg) return i18n.t("settingsNativeDisplay.helperReg", { code: reg[1] });
  const mac = /^macOS reports its login item as (enabled|enabled-by-policy|registered|not-found|requires-approval|not-registered|unknown)\.$/.exec(value);
  return mac ? i18n.t("settingsNativeDisplay.helperMacState", { status: mac[1] }) : value;
}

/** Translate only source-marked app events; raw game text and old payloads stay intact. */
export function richPresenceLogText(entry: RichPresenceLogEntry): string {
  const { text, appEventKey, appEventValues } = entry;
  const fixed: Record<string, string> = { cleared: "cleared its activity", detected: "is running (spotted by its program)", empty: "sent an activity with no details", emptyHidden: "sent an activity with no details (hidden by you)" };
  if (appEventKey && Object.prototype.hasOwnProperty.call(fixed, appEventKey)) {
    return text === fixed[appEventKey] ? i18n.t("settingsNativeDisplay." + appEventKey) : text;
  }
  if (appEventKey === "hidden" && text.endsWith(" (hidden by you)")) {
    return text.slice(0, -" (hidden by you)".length) + i18n.t("settingsNativeDisplay.hiddenSuffix");
  }
  if (appEventKey !== "connection" || entry.appId !== null || !appEventValues || typeof appEventValues !== "object") return text;
  const own = (key: string) => Object.prototype.hasOwnProperty.call(appEventValues, key) ? appEventValues[key] : undefined;
  const state = own("state"), via = own("via"), holder = own("holder");
  if (!["off", "holding", "yielded"].includes(state ?? "") || !["", "app", "helper"].includes(via ?? "") || typeof holder !== "string") return text;
  const canonical = `connection: ${state}${via ? ` via ${via}` : ""}${holder ? `, held by ${holder}` : ""}`;
  if (canonical !== text) return text;
  return i18n.t("settingsNativeDisplay.connection", {
    state: i18n.t("settingsNativeDisplay." + state),
    via: via ? i18n.t("settingsNativeDisplay.via", { source: i18n.t("settingsNativeDisplay." + via) }) : "",
    holder: holder ? i18n.t("settingsNativeDisplay.holder", { name: holder }) : "",
  });
}
