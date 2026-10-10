/** Dependency-free default for helpers also imported by Node-only checks. */
export interface CopyI18n {
  t: (key: string, values?: Record<string, unknown>) => string;
  resolvedLanguage?: string;
}
const english: Record<string, string> = {
  "pairingFull.newDeviceWords_ts_e21a2a1635": "It was cancelled on the other device.",
  "pairingFull.newDeviceWords_ts_7516884617": "You said the emoji didn't match, so nothing was linked. Someone may have been in the middle of the connection.",
  "pairingFull.newDeviceWords_ts_e2e217b234": "The other device didn't approve in time.",
  "pairingFull.newDeviceWords_ts_0189f86d90": "The code ran out before anyone used it.",
  "pairingFull.newDeviceWords_ts_97d5600c77": "A message from the other device didn't check out, so nothing was linked.",
  "pairingFull.newDeviceWords_ts_5e084632b2": "You got signed in as a different account from the one on your other device. Nothing was kept.",
  "pairingFull.newDeviceWords_ts_99a3769b56": "Signing in didn't finish, so nothing was kept on this device.",
  "pairingFull.newDeviceWords_ts_5bdb39eca6": "Your other device is on a newer version of Gryt. Update this one first.",
  "pairingFull.newDeviceWords_ts_0f4f6abfef": "Too many tries. Wait a while and try again.",
  "pairingFull.newDeviceWords_ts_a771214cc9": "Couldn't reach the linking service. Check your connection.",
  "pairingFull.newDeviceWords_ts_d27b0fe687": "You're linked, but this device couldn't save your message history. Link again from the other device to get it.",
  "pairingFull.newDeviceWords_ts_c7676e8973": "The sign-in was turned down, so nothing was kept. Try again.",
  "pairingFull.newDeviceWords_ts_11331ff845": "The sign-in ran out before the other device approved it, so nothing was kept. Try again.",
  "pairingFull.newDeviceWords_ts_bf7f016246": "Linking stopped before it finished.",
  "pairingFull.newDeviceWords_ts_316f22979a": "Getting your message history: {{value0}} so far",
  "pairingFull.newDeviceWords_ts_7b2dc373fd": "Getting your message history: {{value0}} of {{value1}}",
  "pairingFull.newDeviceWords_ts_01f239c1b7": "The oldest messages didn't fit, so your history starts on {{value0}}.",
  "pairingFull.newDeviceWords_ts_2692af5bf9": "Your message history goes back to {{value0}}.",
  "pairingFull.missingBatches_one": "1 batch of messages couldn't be downloaded.",
  "pairingFull.missingBatches_other": "{{count}} batches of messages couldn't be downloaded.",
  "pairingFull.approverWords_ts_2add4b9127": "Nothing was linked.",
  "pairingFull.approverWords_ts_3792ef81d0": "It was cancelled on the new device.",
  "pairingFull.approverWords_ts_ef6f723ba8": "You said the emoji didn't match, so nothing was sent. Someone may have been in the middle of the connection.",
  "pairingFull.approverWords_ts_a50c1d0ab0": "It wasn't approved in time, so nothing was sent.",
  "pairingFull.approverWords_ts_ac018cccfe": "That code ran out. The new device shows a fresh one.",
  "pairingFull.approverWords_ts_b56c6374dc": "Somebody else already entered this code. If that wasn't you, cancel on the new device.",
  "pairingFull.approverWords_ts_fcdca414ce": "No device is showing that code. Check it, or wait for the new device to show a fresh one.",
  "pairingFull.approverWords_ts_b3150ae24f": "That code is for a different linking service from the one this device uses.",
  "pairingFull.approverWords_ts_fde627cc2c": "That isn't a Gryt linking code.",
  "pairingFull.approverWords_ts_0a91791463": "The new device is on a newer version of Gryt. Update this one first.",
  "pairingFull.approverWords_ts_14193210e6": "A message from the new device didn't check out, so nothing was sent.",
  "pairingFull.approverWords_ts_0f4f6abfef": "Too many tries. Wait a while and try again.",
  "pairingFull.approverWords_ts_a771214cc9": "Couldn't reach the linking service. Check your connection.",
  "pairingFull.approverWords_ts_cd51ecf9a2": "That sign-in was already answered. Start again from the new device.",
  "pairingFull.approverWords_ts_e342ca5a18": "The new device's sign-in ran out before you approved it. Start again from the new device.",
  "pairingFull.approverWords_ts_07022e3391": "Your account has something to finish first, like verifying your email. Do that in your account settings, then try again.",
  "pairingFull.approverWords_ts_e60a53fbf1": "This device's sign-in is too old to approve with. Sign in again, then try again.",
  "pairingFull.approverWords_ts_a8451ac1cb": "The sign-in service turned the new device down. Start again from the new device.",
  "pairingFull.approverWords_ts_dd297ef6a1": "Couldn't reach the sign-in server to approve the new device.",
  "pairingFull.approverWords_ts_cd66f5d13c": "Your account is locked for now after too many sign-in attempts.",
  "pairingFull.approverWords_ts_ec1dc1aaa5": "The sign-in service turned this down ({{value0}}). Start again from the new device.",
  "pairingFull.approverWords_ts_bf7f016246": "Linking stopped before it finished.",
  "pairingFull.approverWords_ts_2adfdc7317": "Sending your message history…",
  "pairingFull.approverWords_ts_4a663e3685": "Sending your message history: {{value0}} so far",
  "pairingFull.approverWords_ts_83ed1d5300": "Sending your message history: {{value0}} of {{value1}}",
  "pairingFull.historySent_one": "1 message of history came across.",
  "pairingFull.historySent_other": "{{count}} messages of history came across.",
  "pairingFull.deviceCap_ts_e3fc2f39bb": "{{value0}} already has {{value1}} of your devices, so the new one won't get your DMs there. Remove one first.",
  "shellFull.screenShareAudio_ts_f58c34eac3": "Shares this window's audio only. Anything else playing stays out of it.",
  "shellFull.screenShareAudio_ts_8c7de971bf": "Shares every sound on this machine except Gryt, including any other voice app you are in. Pick a single window to send just that app.",
  "shellFull.screenShareAudio_ts_56d777418f": "Shares every sound on this machine except Gryt, including any other voice app you are in.",
  "shellFull.screenShareAudio_ts_b84a397cd3": "Your screen share has no sound. macOS hasn't let Gryt record the screen. Turn on Gryt Chat in System Settings > Privacy & Security > Screen & System Audio Recording, then share again.",
  "shellFull.screenShareAudio_ts_5b6a127816": "Your screen share has no sound. Gryt couldn't record it. Try sharing again.",
  "shellFull.screenShareAudio_ts_3358f4d515": "Your screen share has no sound. Gryt isn't getting any audio from macOS, so people only see your screen. Try sharing again."
};
export const englishCopy: CopyI18n = {
  t(key, values = {}) {
    const plural = typeof values.count === "number" ? `${key}_${values.count === 1 ? "one" : "other"}` : key;
    return (english[plural] ?? english[key] ?? key).replace(/\{\{(\w+)\}\}/g, (token, name: string) =>
      Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : token);
  },
};
