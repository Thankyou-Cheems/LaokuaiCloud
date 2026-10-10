import { IconButton, Popover } from "@gryt/ui";

import { useTranslation } from "@/i18n";

import { PiUsersFill } from "../../../../lib/icons";
import { VoiceView } from "./VoiceView";

/** Participant sheet has no media hooks, capture, video elements or call controls. */
export function VoiceSheetButton({ connected, ...voice }: { connected: boolean } & Omit<Parameters<typeof VoiceView>[0], "showVoiceView" | "voiceWidth">) {
  const { t } = useTranslation();
  if (!connected) return null;
  return <Popover.Root>
    <Popover.Trigger render={<IconButton size="small" aria-label={t("pureVoice.participants")} />}><PiUsersFill size={20}/></Popover.Trigger>
    <Popover.Portal><Popover.Positioner side="top" collisionPadding={8}><Popover.Popup>
      <Popover.Title>{t("pureVoice.participants")}</Popover.Title>
      <VoiceView showVoiceView voiceWidth="280px" {...voice}/>
    </Popover.Popup></Popover.Positioner></Popover.Portal>
  </Popover.Root>;
}
