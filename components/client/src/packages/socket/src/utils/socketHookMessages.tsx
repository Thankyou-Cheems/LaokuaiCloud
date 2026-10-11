/* eslint-disable react-refresh/only-export-components -- Shared provider/factory and its consuming hook form one adapter. */
import { createElement, type ReactElement, type ReactNode } from "react";

import { i18n as socketHooksI18n, useTranslation as useSocketHooksTranslation } from "@/i18n";

// Only known local display wording is mapped. The originating Error.message,
// retry classifications, remote details and protocol values remain untouched.
const LOCAL_MESSAGE_KEYS: Readonly<Record<string, string>> = {
"The server refused.": "socketHooksFull.serverRefused",
"Import failed.": "socketHooksFull.importFailed",
"Couldn't edit that message.": "socketHooksFull.mlsEditFailed",
"Couldn't delete that message.": "socketHooksFull.mlsDeleteFailed",
"Couldn't react to that message.": "socketHooksFull.mlsReactFailed",
"Not sent. A file wasn't encrypted.": "socketHooksFull.mlsUnencryptedFile",
"Not sent. Their keys couldn't be checked.": "socketHooksFull.mlsPeerUnverified",
"Not sent. This browser hasn't been added to the conversation yet.": "socketHooksFull.mlsBrowserAwaitingWelcome",
"Not sent. This device hasn't been added to the conversation yet.": "socketHooksFull.mlsDeviceAwaitingWelcome",
"Not sent.": "socketHooksFull.mlsNotSent",
"That profile has more than this import will read in one go — the newest are listed.": "socketHooksFull.emoteListingTruncated",
  "Not authenticated with this server": "socketHooksFull.localError_0862db0dee",
  "Not authenticated. Join the server first.": "socketHooksFull.useEmojiUpload_853cdb4018",
  "Invalid payload": "socketHooksFull.localError_29b8f13594",
  "Identity verification failed": "socketHooksFull.localError_8ac9c47a0b",
  "Message is empty": "socketHooksFull.localError_fe51263c35",
  "User not found": "socketHooksFull.localError_01eb946954",
  "You must be connected": "socketHooksFull.localError_a5ce6c0d2a",
  "Server returned an invalid emoji payload.": "socketHooksFull.localError_592fdb5a6f",
  "Upload failed.": "socketHooksFull.localError_144debaf18",
  "This server needs an update before you can change a webhook's avatar.": "socketHooksFull.localError_90ea5fe67f",
  "Failed to upload avatar": "socketHooksFull.localError_65dabbbcaf",
  "Name is required.": "socketHooksFull.localError_d7659e2c4a",
  "2-32 letters (case-sensitive), numbers, or underscores.": "socketHooksFull.localError_3c042e71ce",
  "Duplicate name — the animated one is imported.": "socketHooksFull.localError_b417ad9d4c",
  "Duplicate in selection — last one wins.": "socketHooksFull.localError_fd5f7651c7",
  "Already exists — will replace.": "socketHooksFull.localError_93c50e7e77",
  "BetterTTV returned an invalid emote payload.": "socketHooksFull.localError_ca7c428fc4",
  "Not a BetterTTV link.": "socketHooksFull.localError_533d69810c",
  "Not an emoji.gg link.": "socketHooksFull.localError_8f1ce6e3bf",
  "This server needs an update before groups can have their own picture.": "socketHooksFull.localError_0146e1ae19",
  "The server would not take that picture": "socketHooksFull.localError_4e37403079",
  "eSports mode activated": "socketHooksFull.localError_afdceb7a04",
  "Push to Talk enabled": "socketHooksFull.localError_2b9938b44f",
  "RNNoise disabled": "socketHooksFull.localError_41aa6e17fc",
  "This server has no public address, so there's no link to copy.": "socketHooksFull.localError_3991162784",
  "Failed to upload file(s)": "socketHooksFull.useThreads_9cac2cf38f",
  "Something went wrong.": "socketHooksFull.useThreads_bee54c9cc3",
  "The server refused that topic.": "socketHooksFull.localError_029aa38f9c",
  "Not connected to this server.": "socketHooksFull.localError_cad868311c",
  "Upload failed ({{status}})": "socketHooksFull.localError_ee30c67abd",
  "Attachment fetch failed ({{status}})": "socketHooksFull.localError_275a0a062b",
  "Failed to fetch emote file ({{status}})": "socketHooksFull.localError_cd3c82fa25",
  "Failed to fetch ({{status}})": "socketHooksFull.localError_ae79223c73",
  "HTTP {{status}}": "socketHooksFull.localError_25eb201d92",
  "{{host}} has not proved its identity, so nothing that carries your token goes to it.": "socketHooksFull.localError_ac77397dfe",
  "{{host}} did not prove its identity in time.": "socketHooksFull.localError_7112807e60"
};
const LOCAL_MESSAGE_PATTERNS = [
  {
    "regex": "^Upload failed \\((\\d+)\\)$",
    "key": "socketHooksFull.localError_ee30c67abd",
    "param": "status"
  },
  {
    "regex": "^Attachment fetch failed \\((\\d+)\\)$",
    "key": "socketHooksFull.localError_275a0a062b",
    "param": "status"
  },
  {
    "regex": "^Failed to fetch emote file \\((\\d+)\\)$",
    "key": "socketHooksFull.localError_cd3c82fa25",
    "param": "status"
  },
  {
    "regex": "^Failed to fetch \\((\\d+)\\)$",
    "key": "socketHooksFull.localError_ae79223c73",
    "param": "status"
  },
  {
    "regex": "^HTTP (\\d+)$",
    "key": "socketHooksFull.localError_25eb201d92",
    "param": "status"
  },
  {
    "regex": "^(.*?) has not proved its identity, so nothing that carries your token goes to it\\.$",
    "key": "socketHooksFull.localError_ac77397dfe",
    "param": "host"
  },
  {
    "regex": "^(.*?) did not prove its identity in time\\.$",
    "key": "socketHooksFull.localError_7112807e60",
    "param": "host"
  }
];

export function socketDisplayText(value: string, language?: string): string;
export function socketDisplayText(value: string | null, language?: string): string | null;
export function socketDisplayText(value: string | null, language?: string): string | null {
  if (value === null) return null;
  const emoteError = /^(:[A-Za-z0-9_]+: — )(.*)$/.exec(value);
  if (emoteError) return emoteError[1] + socketDisplayText(emoteError[2], language);
  const key = Object.prototype.hasOwnProperty.call(LOCAL_MESSAGE_KEYS, value) ? LOCAL_MESSAGE_KEYS[value] : undefined;
  if (key) return socketHooksI18n.t(key, { lng: language });
  for (const pattern of LOCAL_MESSAGE_PATTERNS) {
    const match = new RegExp(pattern.regex).exec(value);
    if (match) return socketHooksI18n.t(pattern.key, { lng: language, [pattern.param]: match[1] });
  }
  return value;
}

function SocketHookToastMessage({ read }: { read: () => ReactNode }) {
  useSocketHooksTranslation();
  const message = read();
  return <>{typeof message === "string" ? socketDisplayText(message) : message}</>;
}

/** A subscribed toast body; changing language never replays its business action. */
export function socketHookToast(read: () => ReactNode): ReactElement {
  return createElement(SocketHookToastMessage, { read });
}
