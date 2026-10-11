import type { MlsOwnDevice } from "@gryt/core";

import { i18n as socketI18n } from "@/i18n";

/* The device list's wording and order. The phone has the same in src/mls/ownDevices.ts. */

/** This device first, then the rest oldest first, as the server lists them. */
export function orderOwnDevices(devices: readonly MlsOwnDevice[]): MlsOwnDevice[] {
  return [...devices.filter((d) => d.thisDevice), ...devices.filter((d) => !d.thisDevice)];
}

/** A device that's in none of your DMs with this one yet has no certificate here to name it. */
export function ownDeviceLabel(device: MlsOwnDevice): string {
  return device.name ?? socketI18n.t("socketFull.ownDevices_2c42172e82");
}

export function ownDeviceAdded(device: MlsOwnDevice): string | null {
  const at = device.addedAt ? new Date(device.addedAt) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  return socketI18n.t("socketFull.ownDevices_331e23d4ef", { p0: (at.toLocaleDateString(socketI18n.resolvedLanguage, { year: "numeric", month: "short", day: "numeric" })) });
}

/* True because the server refuses that device id from now on, and the app on it wipes
   that server's history when it hears so (GRYT-1555). */
export function removeOwnDeviceWarning(device: Pick<MlsOwnDevice, "name">, serverName: string): string {
  const which = device.name ? `“${device.name}”` : socketI18n.t("socketFull.ownDevices_8af9f8b1bc");
  return socketI18n.t("socketFull.ownDevices_ebfeeda2c7", { p0: (which), p1: (serverName) });
}

/** What a removed device says, wherever it would have shown DMs from that server. */
export function removedHereLine(home: "browser" | "app", how: "sign_in" | "recovery_key"): string {
  const here = home === "browser" ? socketI18n.t("socketFull.ownDevices_e9f0cb6410") : socketI18n.t("settingsFull.mfa5a6dd9d2");
  const again =
    how === "sign_in" ? socketI18n.t("socketFull.ownDevices_abc9220031") : socketI18n.t("socketFull.ownDevices_9378ae1695");
  return socketI18n.t("socketFull.ownDevices_74400723bd", { p0: (here), p1: (again) });
}
