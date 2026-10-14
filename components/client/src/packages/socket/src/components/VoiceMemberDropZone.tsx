import type { ReactNode } from "react";

import { useTranslation } from "@/i18n";

import type { useVoiceMemberDrag } from "./useVoiceMemberDrag";

export function VoiceMemberDropZone({ drag, channelId, channelName, children }: {
  drag: ReturnType<typeof useVoiceMemberDrag>; channelId: string; channelName?: string; children: ReactNode;
}) {
  const { t } = useTranslation();
  return <div {...drag.channelProps(channelId)} className="flex flex-col items-start w-full relative"
    style={drag.over === channelId ? { outline: "2px solid var(--gryt-accent-9)", borderRadius: "var(--gryt-radius-md)", background: "var(--gryt-accent-3)" } : undefined}>
    {drag.over === channelId && drag.drag && <div role="status" className="px-2 py-1 text-xs text-gryt-accent">
      {t("voiceRoom.dropMember", { name: drag.drag.name, channel: channelName })}
    </div>}
    {children}
  </div>;
}
