import { Tooltip } from "@gryt/ui";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

/** The number after a name somebody else here also uses (GRYT-1674): #1 joined
    first. Muted, so the name still reads first; the fingerprint is on the card. */
export function NameTag({
  tag,
  tooltip = true,
  color = "var(--gryt-neutral-10)",
}: {
  tag: string | undefined;
  tooltip?: boolean;
  color?: string;
}) {
  useSocketTranslation();
  if (!tag) return null;
  const text = (
    <span
      className="gryt-name-tag"
      style={{
        fontFamily: "var(--gryt-font-mono, ui-monospace, monospace)",
        fontSize: "0.85em",
        fontWeight: 500,
        color,
        whiteSpace: "nowrap",
      }}
    >
      {tag}
    </span>
  );
  if (!tooltip) return text;
  return (
    <Tooltip title={socketI18n.t("socketFull.nameTag_564714d749")}>
      {text}
    </Tooltip>
  );
}
