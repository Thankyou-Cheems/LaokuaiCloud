import { useEffect, useRef } from "react";

import { useTranslation } from "@/i18n";
import { Controls } from "@/webRTC";

/** One persistent control owner, independent of media visibility and fullscreen. */
export function RoomCallBar({ onDisconnect }: { onDisconnect?: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = ref.current;
    const room = bar?.closest<HTMLElement>('[data-gryt="server-view"]');
    if (!bar || !room) return;
    const update = () => room.style.setProperty("--room-call-bar-height", `${bar.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => { observer.disconnect(); room.style.removeProperty("--room-call-bar-height"); };
  }, []);
  return <div ref={ref} role="toolbar" aria-label={t("layout.callControls")} data-gryt="room-call-bar"
    className="flex shrink-0 flex-wrap items-center justify-center gap-2 px-2 py-2"
    style={{ borderTop: "1px solid var(--gryt-neutral-6)", background: "var(--gryt-neutral-3)", borderRadius: "var(--gryt-radius-md)" }}>
    <Controls onDisconnect={onDisconnect} />
  </div>;
}
