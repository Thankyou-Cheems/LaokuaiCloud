import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { PiChatCircleFill, PiChatsFill, PiRobotFill, PiSpeakerHighFill } from "../../../../lib/icons";
import type { ChannelKind } from "./channelKind";

const KINDS: { key: ChannelKind; label: string; desc: string; Icon: typeof PiChatCircleFill }[] = [
  { key: "chat", get label() { return socketI18n.t("ui.chat"); }, get desc() { return socketI18n.t("socketFull.channelKindPicker_3708a43a21"); }, Icon: PiChatCircleFill },
  { key: "voice", get label() { return socketI18n.t("ui.voice"); }, get desc() { return socketI18n.t("socketFull.channelKindPicker_c9b5e5d0ef"); }, Icon: PiSpeakerHighFill },
  { key: "forum", get label() { return socketI18n.t("socketFull.channelKindPicker_ebed11a746"); }, get desc() { return socketI18n.t("socketFull.channelKindPicker_60c1ee4e31"); }, Icon: PiChatsFill },
  { key: "automated", get label() { return socketI18n.t("socketFull.channelKindPicker_2d062ce2ce"); }, get desc() { return socketI18n.t("socketFull.channelKindPicker_1de5fcaf46"); }, Icon: PiRobotFill },
];

export function ChannelKindPicker({
  value,
  onChange,
}: {
  value: ChannelKind;
  onChange: (kind: ChannelKind) => void;
}) {
  useSocketTranslation();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {KINDS.map(({ key, label, desc, Icon }) => {
        const selected = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={selected}
            style={{
              display: "flex", gap: 11, alignItems: "flex-start", textAlign: "left",
              padding: 12, borderRadius: "var(--gryt-radius-md)", cursor: "pointer",
              background: selected ? "var(--gryt-accent-3)" : "var(--gryt-neutral-3)",
              border: `1px solid ${selected ? "var(--gryt-accent-9)" : "var(--gryt-neutral-6)"}`,
            }}
          >
            <Icon size={22} style={{ color: "var(--gryt-accent-11)", flexShrink: 0, marginTop: 1 }} />
            <span>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "var(--gryt-neutral-12)" }}>{label}</span>
              <span style={{ display: "block", fontSize: 11.5, color: "var(--gryt-neutral-10)", marginTop: 2, lineHeight: 1.35 }}>{desc}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
