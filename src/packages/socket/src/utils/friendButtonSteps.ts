import { i18n as socketI18n } from "@/i18n";

import type { FriendAction } from "../hooks/friendsStore";
import type { FriendState } from "./friendList";

/** Which icon a step draws. FriendButton.tsx owns the mapping to a component. */
export type FriendStepIcon = "add" | "clock" | "check" | "close" | "confirm";

export interface FriendStepConfirm {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
}

export interface FriendStep {
  /** "confirm" isn't a server action -- it only ever runs confirmServerFriend. */
  action: FriendAction | "confirm";
  label: string;
  icon: FriendStepIcon;
  tone: "primary" | "ghost";
  /** The longer explanation: a tooltip where there's no room for a caption, a caption where there is. */
  hint: string;
  /** Set only for an action that shouldn't fire on the first click. */
  confirm?: FriendStepConfirm;
}

/**
 * What a friend state offers next, and what each offer should say (GRYT-1573).
 * `name` is the other person's nickname, or "them" where the caller has none.
 */
export function friendButtonSteps(state: FriendState, name: string): FriendStep[] {
  switch (state) {
    case "none":
      return [{ action: "request", label: socketI18n.t("socketFull.friendButtonSteps_5a4eae4cab"), icon: "add", tone: "ghost", hint: socketI18n.t("socketFull.friendButtonSteps_27fdf5a22a", { p0: (name) }) }];

    case "outgoing":
      return [{
        action: "cancel",
        label: socketI18n.t("socketFull.friendButtonSteps_8d5177eedb"),
        icon: "clock",
        tone: "ghost",
        hint: socketI18n.t("socketFull.friendButtonSteps_ac44752d57", { p0: (name) }),
        confirm: {
          title: socketI18n.t("socketFull.friendButtonSteps_b7b272e97f"),
          description: socketI18n.t("socketFull.friendButtonSteps_390620f75f", { p0: (name) }),
          confirmLabel: socketI18n.t("socketFull.friendButtonSteps_e215b55da4"),
          cancelLabel: socketI18n.t("socketFull.friendButtonSteps_caee5ae47a"),
        },
      }];

    case "incoming":
      return [
        { action: "accept", label: socketI18n.t("socketFull.friendButtonSteps_022daab84c"), icon: "check", tone: "primary", hint: socketI18n.t("socketFull.friendButtonSteps_5db7366d4f", { p0: (name) }) },
        { action: "decline", label: socketI18n.t("socketFull.friendButtonSteps_dd75a6be62"), icon: "close", tone: "ghost", hint: socketI18n.t("socketFull.friendButtonSteps_9004e65f69", { p0: (name) }) },
      ];

    case "unconfirmed":
      return [{
        action: "confirm",
        label: socketI18n.t("socketFull.friendButtonSteps_a29d1d192b"),
        icon: "confirm",
        tone: "ghost",
        hint: socketI18n.t("socketFull.friendButtonSteps_b8072053c3", { p0: (name) }),
      }];

    case "friend":
      return [];
  }
}
