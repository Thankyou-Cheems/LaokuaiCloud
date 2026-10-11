import { Button, Divider } from "@gryt/ui";
import { nameToEmoji } from "gemoji";
import { useCallback, useMemo } from "react";

import { i18n, useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { SMILEY_ENTRIES } from "../../../socket/src/utils/remarkEmoji";
import { ToggleSetting } from "./settingsComponents";

const CATEGORY_ORDER: { label: string; shortcodes: string[] }[] = [
  {
    get label() { return i18n.t("settingsFull.mbe31a86c98"); },
    shortcodes: [
      "slightly_smiling_face", "smile", "grin", "blush", "smirk",
      "laughing", "joy", "sweat_smile", "wink",
    ],
  },
  {
    get label() { return i18n.t("settingsFull.m4f61ec4d2d"); },
    shortcodes: ["kissing_heart", "heart", "broken_heart"],
  },
  {
    get label() { return i18n.t("settingsFull.m2c0af9c54f"); },
    shortcodes: [
      "stuck_out_tongue", "stuck_out_tongue_winking_eye", "stuck_out_tongue_closed_eyes",
    ],
  },
  {
    get label() { return i18n.t("settingsFull.mc3e740eefe"); },
    shortcodes: ["sunglasses", "innocent"],
  },
  {
    get label() { return i18n.t("settingsFull.m8057f8b2a5"); },
    shortcodes: [
      "disappointed", "pensive", "cry", "sob", "anguished", "weary",
    ],
  },
  {
    get label() { return i18n.t("settingsFull.ma0ac356226"); },
    shortcodes: ["angry", "rage", "smiling_imp", "imp"],
  },
  {
    get label() { return i18n.t("settingsFull.md46346ef89"); },
    shortcodes: ["open_mouth", "astonished", "scream"],
  },
  {
    get label() { return i18n.t("settingsFull.mba1c495376"); },
    shortcodes: [
      "confused", "neutral_face", "expressionless", "persevere",
      "flushed", "dizzy_face", "star_struck",
    ],
  },
  {
    get label() { return i18n.t("settingsFull.m3358d7c703"); },
    shortcodes: ["zipper_mouth_face", "no_mouth", "sleeping", "tired_face", "skull"],
  },
  {
    get label() { return i18n.t("settingsFull.m6e6a6f2086"); },
    shortcodes: ["smiley_cat", "raised_hands", "wave"],
  },
];

const entryByShortcode = new Map(SMILEY_ENTRIES.map((e) => [e.shortcode, e]));

function primarySmiley(shortcode: string): string {
  const entry = entryByShortcode.get(shortcode);
  if (!entry) return "";
  return entry.smileys.find((s) => s.length <= 3) ?? entry.smileys[0];
}

export function SmileySettings() {
  useTranslation();
  const {
    smileyConversion,
    setSmileyConversion,
    disabledSmileys,
    setDisabledSmileys,
  } = useSettings();

  const allShortcodes = useMemo(
    () => CATEGORY_ORDER.flatMap((c) => c.shortcodes),
    [],
  );

  const toggleOne = useCallback(
    (shortcode: string) => {
      const next = new Set(disabledSmileys);
      if (next.has(shortcode)) next.delete(shortcode);
      else next.add(shortcode);
      setDisabledSmileys(next);
    },
    [disabledSmileys, setDisabledSmileys],
  );

  const enableAll = useCallback(
    () => setDisabledSmileys(new Set()),
    [setDisabledSmileys],
  );

  const disableAll = useCallback(
    () => setDisabledSmileys(new Set(allShortcodes)),
    [setDisabledSmileys, allShortcodes],
  );

  return (
    <div className="flex flex-col gap-3">
      <ToggleSetting
        anchorId="smiley-conversion"
        title={i18n.t("settingsFull.macd06aaa47")}
        description={i18n.t("settingsFull.mc605f4e325")}
        checked={smileyConversion}
        onCheckedChange={setSmileyConversion}
      />

      {smileyConversion && (
        <div className="flex flex-col gap-3 pl-1">
          <div className="flex gap-2">
            <Button tone="neutral" size="xsmall" onClick={enableAll}>{i18n.t("settingsFull.m5193d0205e")}</Button>
            <Button tone="neutral" size="xsmall" onClick={disableAll}>{i18n.t("settingsFull.m6ce769b555")}</Button>
          </div>

          {CATEGORY_ORDER.map((cat) => (
            <div className="flex flex-col gap-1" key={cat.shortcodes[0]}>
              <span className="text-gryt-muted font-medium">
                {cat.label}
              </span>
              <div className="flex gap-2 flex-wrap">
                {cat.shortcodes.map((sc) => {
                  const emoji = nameToEmoji[sc];
                  if (!emoji) return null;
                  const active = !disabledSmileys.has(sc);
                  return (
                    <button
                      key={sc}
                      type="button"
                      onClick={() => toggleOne(sc)}
                      title={`:${sc}: ${primarySmiley(sc)}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "3px 8px",
                        borderRadius: 6,
                        border: "1px solid var(--gryt-neutral-a6)",
                        background: active ? "var(--gryt-accent-a3)" : "var(--gryt-neutral-a2)",
                        opacity: active ? 1 : 0.4,
                        cursor: "pointer",
                        fontSize: 13,
                        lineHeight: 1.4,
                        transition: "opacity 0.15s, background 0.15s",
                      }}
                    >
                      <span style={{ fontSize: 16 }}>{emoji}</span>
                      <span style={{ color: "var(--gryt-neutral-11)", fontFamily: "var(--code-font-family, monospace)" }}>
                        {primarySmiley(sc)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <Divider />
          <span className="text-gryt-muted">{i18n.t("settingsFull.mc283d46b0c")}</span>
        </div>
      )}
    </div>
  );
}
