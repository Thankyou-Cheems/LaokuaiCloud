import { IconButton } from "@gryt/ui";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useTranslation } from "@/i18n";

import { PiPhoneCallFill } from "../../../../lib/icons";
import { useRoomMedia } from "../hooks/useRoomMedia";
import { VoiceView } from "./VoiceView";

/** A narrow-window media overlay within the room, above its persistent call bar. */
export function VoiceSheetButton({ connected, ...voice }: { connected: boolean } & Omit<Parameters<typeof VoiceView>[0], "showVoiceView" | "voiceWidth">) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [room, setRoom] = useState<HTMLElement | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const hasMedia = useRoomMedia(voice);
  useEffect(() => { setRoom(anchor.current?.closest<HTMLElement>('[data-gryt="server-view"]') ?? null); }, []);
  useEffect(() => { if (!connected || !hasMedia) setOpen(false); }, [connected, hasMedia]);
  return <span ref={anchor}>
    {connected && hasMedia && !open && <IconButton size="small"
      aria-label={t("socketFull.voiceSheetButton_dd8f227c3e")} onClick={() => setOpen(true)}
      style={{ position: "absolute", bottom: "calc(var(--room-call-bar-height, 80px) + 12px)", right: 16, zIndex: 3 }}>
      <PiPhoneCallFill size={22} />
    </IconButton>}
    {open && connected && hasMedia && room && createPortal(
      <div data-gryt="narrow-media" style={{ position: "absolute", inset: "0 0 calc(var(--room-call-bar-height, 80px) + 8px) 0",
        zIndex: 4, display: "flex", flexDirection: "column", minHeight: 0, padding: 8, background: "var(--gryt-neutral-2)" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
          <IconButton size="xsmall" aria-label={t("layout.closeMedia")} onClick={() => setOpen(false)}>×</IconButton>
        </div>
        <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
          <VoiceView showVoiceView voiceWidth="100%" {...voice} />
        </div>
      </div>, room)}
  </span>;
}
