import { type CopyI18n,englishCopy } from "../copyI18n.ts";
/* The server allows five MLS devices per person (`too_many_devices`). A sixth isn't added to
   that server's DMs, so the approving side says so before Approve (GRYT-1582). */

export const MAX_DEVICES_PER_SERVER = 5;

/** Servers where the new device would be one too many, in the order given. */
export function serversAtDeviceCap<T extends { deviceCount: number | null }>(servers: readonly T[]): T[] {
  return servers.filter((s) => s.deviceCount !== null && s.deviceCount >= MAX_DEVICES_PER_SERVER);
}

export function deviceCapLine(serverName: string, i18n: CopyI18n = englishCopy): string {
  return i18n.t("pairingFull.deviceCap_ts_e3fc2f39bb", { value0: serverName, value1: MAX_DEVICES_PER_SERVER });
}
