import { useEffect, useState } from "react";

import {
  hasRoomForMemberList,
  hasRoomForSettingsRail,
  hasRoomForThreadBeside,
  hasRoomForVoicePanel,
  isTinyWindow,
} from "../lib/narrowLayout";

/**
 * The window's width, and whether the thing pointing at it is a mouse. The
 * decisions are in `lib/narrowLayout.ts`, so a check can assert them.
 */
function useWindowWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

/**
 * Whether a mouse or trackpad is the pointer — the guard on the tiny window.
 * Watched rather than read once: a keyboard on a tablet changes it.
 */
function usePointerFine() {
  const [fine, setFine] = useState(
    () => window.matchMedia?.("(pointer: fine)").matches ?? true,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(pointer: fine)");
    if (!mq) return;
    const onChange = () => setFine(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return fine;
}

/**
 * Whether the member list fits, given what the voice and thread panels have
 * taken. Pass the widths they are drawing at, not the ones they would like.
 */
export function useRoomForMemberList(voicePanelWidth: number, threadPanelWidth = 0, channelSidebarWidth = 240): boolean {
  const windowWidth = useWindowWidth();
  return hasRoomForMemberList({ windowWidth, voicePanelWidth, threadPanelWidth, channelSidebarWidth });
}

/**
 * Whether an open thread is drawn beside the conversation rather than over the
 * whole chat pane. Pass the width the voice panel is drawing at, as above.
 */
export function useRoomForThreadBeside(voicePanelWidth: number, channelSidebarWidth = 240): boolean {
  const windowWidth = useWindowWidth();
  return hasRoomForThreadBeside({ windowWidth, voicePanelWidth, channelSidebarWidth });
}

/**
 * Whether the voice panel fits beside a channel list and a usable chat. Below
 * this the voice view minimizes itself.
 */
export function useRoomForVoicePanel(channelSidebarWidth = 240): boolean {
  return hasRoomForVoicePanel(useWindowWidth(), channelSidebarWidth);
}

/** One channel and nothing else. Desktop only; see `usePointerFine`. */
export function useIsTinyWindow(): boolean {
  const windowWidth = useWindowWidth();
  const pointerFine = usePointerFine();
  return isTinyWindow({ windowWidth, pointerFine });
}

/** Whether a settings dialog can keep its tab rail. `chrome` is its `*_SETTINGS_CHROME` from `lib/narrowLayout.ts`. */
export function useRoomForSettingsRail(chrome: number): boolean {
  return hasRoomForSettingsRail(useWindowWidth(), chrome);
}
