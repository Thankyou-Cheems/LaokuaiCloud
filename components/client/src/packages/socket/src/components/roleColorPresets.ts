import { i18n as socketI18n } from "@/i18n";
/**
 * The colours a role can be given without opening a picker: ten hues at
 * `oklch(0.66 0.15 h)`. Every one clears AA once `readableRoleColor` banded it.
 */
export const ROLE_COLOR_PRESETS = [
  { get name() { return socketI18n.t("socketFull.roleColorPresets_882980614e"); }, value: "#df6862" },
  { get name() { return socketI18n.t("socketFull.roleColorPresets_e187f3625b"); }, value: "#d67523" },
  { get name() { return socketI18n.t("socketFull.roleColorPresets_47b68d717f"); }, value: "#af8f00" },
  { get name() { return socketI18n.t("socketFull.roleColorPresets_3264775192"); }, value: "#4ea954" },
  { get name() { return socketI18n.t("socketFull.roleColorPresets_6c41005059"); }, value: "#00aea6" },
  { get name() { return socketI18n.t("socketFull.roleColorPresets_30e3e394a3"); }, value: "#00a1db" },
  { get name() { return socketI18n.t("socketFull.roleColorPresets_3aa1e7ffa1"); }, value: "#648eed" },
  { get name() { return socketI18n.t("socketFull.roleColorPresets_8e3a5514a5"); }, value: "#a17adf" },
  { get name() { return socketI18n.t("socketFull.roleColorPresets_8ad4ee088f"); }, value: "#c46dbd" },
  { get name() { return socketI18n.t("socketFull.roleColorPresets_f13137b373"); }, value: "#d76797" },
] as const;

/**
 * A colour for a role that does not have one yet: the first preset nobody is
 * using, wrapping once all ten are spoken for. Case-insensitive.
 */
export function nextUnusedPreset(taken: (string | null | undefined)[]): string {
  const used = new Set(
    taken.filter((c): c is string => !!c).map((c) => c.toLowerCase()),
  );
  const free = ROLE_COLOR_PRESETS.find((p) => !used.has(p.value.toLowerCase()));
  return (free ?? ROLE_COLOR_PRESETS[used.size % ROLE_COLOR_PRESETS.length]).value;
}
