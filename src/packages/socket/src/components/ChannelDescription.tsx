import { Tooltip } from "@gryt/ui";

import { useTranslation } from "@/i18n";

/** What a channel is for, beside its name in the header. One line; the full text is in the tooltip. */
export function ChannelDescription({ text }: { text: string | undefined }) {
  const { t } = useTranslation();
  if (!text) return null;
  return (
    <Tooltip title={text}><span
      tabIndex={0}
      role="img"
      aria-label={`${t("layout.channelDetails")}: ${text}`}
      className="inline-flex shrink-0 items-center justify-center text-sm"
      data-gryt="channel-description"
      title={text}
      style={{ color: "var(--gryt-neutral-11)", width: 24, height: 24 }}
    >
      ⓘ
    </span></Tooltip>
  );
}
