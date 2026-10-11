import { i18n } from "@/i18n";

import { nativeHelperProblem } from "./nativeDisplayCopy";

/** Resolve app-owned error keys at render time; preserve unknown diagnostic detail. */
export function settingsMessage(value: string | null | undefined): string {
  if (!value) return "";
  const helperProblem = nativeHelperProblem(value);
  if (helperProblem !== value) return helperProblem;
  const known = Object.prototype.hasOwnProperty.call(EMBEDDED_MESSAGES, value) ? EMBEDDED_MESSAGES[value] : undefined;
  if (known) return i18n.t(known);
  const port = /^(TCP|UDP) (\d+) is already in use$/.exec(value);
  if (port) return i18n.t("settingsFull.embedded.portBusy", { protocol: port[1], port: port[2] });
  const exited = /^(SFU|Media worker|Server) process exited unexpectedly \(code (null|-?\d+)\)(?:: ([\s\S]*))?$/.exec(value);
  if (exited) return i18n.t(exited[3] === undefined ? "settingsFull.embedded.processExit" : "settingsFull.embedded.processExitDetail", {
    process: exited[1] === "SFU" ? "SFU" : i18n.t(exited[1] === "Server" ? "settingsFull.embedded.server" : "settingsFull.embedded.worker"),
    code: exited[2], detail: exited[3] ?? "",
  });
  const conflicts = /^Something else on this machine is using (.+)\. Close it, or change the port under Open these ports in My servers\.$/.exec(value);
  if (conflicts) {
    const parts = [...conflicts[1].matchAll(/(TCP|UDP) (\d+) \((the server|voice signalling|voice and video)\)/g)];
    // Only translate the application's exact format; unfamiliar detail stays verbatim.
    const canonical = parts.length === 1 ? parts[0][0] : parts.slice(0, -1).map((part) => part[0]).join(", ") + " and " + (parts[parts.length - 1]?.[0] ?? "");
    if (parts.length && canonical === conflicts[1]) {
      const roles: Record<string, string> = { "the server": "serverRole", "voice signalling": "sfuRole", "voice and video": "mediaRole" };
      const labels = parts.map((part) => i18n.t("settingsFull.embedded.portPart", { protocol: part[1], port: part[2], role: i18n.t("settingsFull.embedded." + roles[part[3]]) }));
      return i18n.t("settingsFull.embedded.conflicts", { ports: labels.join(i18n.resolvedLanguage?.startsWith("zh") ? "、" : ", ") });
    }
  }
  return value.startsWith("settingsFull.") && i18n.exists(value) ? i18n.t(value) : value;
}

/** Translate only known validator messages, preserving the authoritative minimum. */
export function settingsPasswordProblem(problem: string): string {
  if (problem === "Choose a password.") return i18n.t("settingsFull.m9df31ef2c4");
  const minimum = /^Use at least (\d+) characters, or the six generated words\.$/.exec(problem);
  return minimum ? i18n.t("settingsFull.mc0bc5f7320", { min: minimum[1] }) : problem;
}

/** IPC messages remain unchanged in the main process; only their known UI forms map here. */
const EMBEDDED_MESSAGES: Record<string, string> = {
  "No free port": "settingsFull.embedded.noFreePort",
  "Ports must be whole numbers between 1 and 65535": "settingsFull.embedded.wholePorts",
  "The server and voice signalling cannot share a TCP port": "settingsFull.embedded.tcpShared",
  "Stop the server before changing its ports": "settingsFull.embedded.stopPorts",
  "Stop the server before changing its advertised addresses": "settingsFull.embedded.stopAddresses",
  "Failed to start SFU (binary not found)": "settingsFull.embedded.missingSfu",
  "Failed to start server (bundle not found)": "settingsFull.embedded.missingServer",
  "Use IPv4 addresses or fully qualified hostnames without ports, and an address other machines can reach — not 0.0.0.0 or a loopback address": "settingsFull.embedded.invalidAddresses"
};
