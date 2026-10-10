import { i18n as socketI18n } from "@/i18n";
/**
 * How a key's history and a key's change are put into words. This is the part
 * that can be wrong without looking wrong — "same key for 0 days" (GRYT-728).
 */

/**
 * When a key was pinned, in words rather than a date nobody reads. A key seen
 * once yesterday and one seen daily for a year both verify.
 */
export function describePin(firstSeenAt: number): string {
  const days = Math.floor((Date.now() - firstSeenAt) / 86_400_000);
  if (days < 1) return socketI18n.t("socketFull.memberKeyWording_a2206b3df6");
  if (days === 1) return socketI18n.t("socketFull.memberKeyWording_b5c013eba9");
  if (days < 30) return socketI18n.t("socketFull.memberKeyWording_7acedbc621", { p0: (days) });

  return socketI18n.t("socketFull.memberKeyWording_a71e6b242c", { p0: (new Date(firstSeenAt).toLocaleDateString(socketI18n.resolvedLanguage, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })) });
}

/**
 * What changed, said without guessing why. A restored seed and a substituted key
 * produce the same event, and only a person can tell them apart.
 */
export function describeChange(changedIdentity: boolean, changedKey: boolean): string {
  if (changedIdentity && changedKey) {
    return socketI18n.t("socketFull.memberKeyWording_82551963a3");
  }
  if (changedIdentity) {
    return socketI18n.t("socketFull.memberKeyWording_6ebc03e560");
  }
  return socketI18n.t("socketFull.memberKeyWording_1b4cc20ef3");
}

