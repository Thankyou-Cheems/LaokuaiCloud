import type { GrytAppearance, GrytTheme } from "@gryt/ui";
import {
  Alert,
  Button,
  Chip,
  createGrytTheme,
  decodeGrytTheme,
  Dialog,
  GrytProvider,
  grytThemeToOptions,
  MessageBubble,
  Switch,
  TextField,
} from "@gryt/ui";
import { useState } from "react";

import { useCustomThemes, useTheme } from "@/common";
import { i18n, useTranslation } from "@/i18n";

import { settingsMessage } from "../settingsMessage";

const GENERATOR = "https://ui.gryt.chat/theme/generator";

/**
 * Take a theme somebody sent you. The whole exchange is a link, read by the same
 * parser both ends. Nothing is saved until it has been looked at.
 */
export function ImportThemeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  useTranslation();
  const { saveTheme } = useCustomThemes();
  const { resolvedAppearance } = useTheme();

  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<GrytTheme | null>(null);
  const [name, setName] = useState("");
  // What the sender was looking at, worth previewing even when this app is in the
  // other one — a theme designed light and only seen dark is the case.
  const [preview, setPreview] = useState<GrytAppearance>(resolvedAppearance);

  function reset() {
    setInput("");
    setError(null);
    setIncoming(null);
    setName("");
  }

  function read(text: string) {
    const decoded = decodeGrytTheme(text);
    if (decoded === null) {
      setIncoming(null);
      setError(
        text.trim().startsWith("{")
          ? "settingsFull.maf8ad04e9d"
          : "settingsFull.ma60c163cdf",
      );
      return;
    }
    setIncoming(decoded.theme);
    setPreview(decoded.appearance);
    setError(null);
    // Whoever built it named it, and the name rides in the link, so the field is
    // filled in and stays editable rather than being one more thing to type.
    setName(decoded.theme.name ?? "Imported theme");
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <Dialog.Title>{i18n.t("settingsFull.mbeb1a9c2f4")}</Dialog.Title>
          <Dialog.Description>{i18n.t("settingsFull.m17385d8351")}</Dialog.Description>

          <div className="mt-4 flex flex-col gap-3">
            <TextField
              aria-label={i18n.t("settingsFull.m659cc5b49b")}
              multiline
              minRows={2}
              placeholder={`${GENERATOR}?accent=…`}
              spellCheck={false}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setError(null);
              }}
            />

            <div className="flex items-center gap-3">
              <Button
                size="small"
                disabled={input.trim() === ""}
                onClick={() => read(input)}
              >{i18n.t("settingsFull.m90b1fdef30")}</Button>
              <a
                className="gryt-link text-xs"
                href={GENERATOR}
                rel="noreferrer"
                target="_blank"
              >{i18n.t("settingsFull.m9431f6222c")}</a>
            </div>

            {error ? <Alert severity="error">{settingsMessage(error)}</Alert> : null}

            {incoming ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{i18n.t("settingsFull.mf1fbb2b43d")}</span>
                  <label className="flex items-center gap-2 text-xs text-gryt-muted">{i18n.t("settingsFull.ma36ef8aba2")}<Switch
                      checked={preview === "light"}
                      onCheckedChange={(next) =>
                        setPreview(next ? "light" : "dark")
                      }
                    />
                  </label>
                </div>

                <ThemePreview appearance={preview} theme={incoming} />

                <TextField
                  label={i18n.t("settingsFull.m709a23220f")}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={i18n.t("settingsFull.mafa61d75a2")}
                />
              </>
            ) : null}
          </div>

          <Dialog.Footer className="flex-wrap justify-between">
            <Dialog.Close render={<span />}>
              <Button size="small" tone="ghost">{i18n.t("ui.cancel")}</Button>
            </Dialog.Close>
            <Button
              size="small"
              disabled={incoming === null}
              onClick={() => {
                if (incoming === null) return;
                saveTheme(name, incoming);
                onOpenChange(false);
                reset();
              }}
            >{i18n.t("settingsFull.mc2001efc5f")}</Button>
          </Dialog.Footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The theme, on things that are actually in the app. What people want to know is
 * whether a message is readable and whether buttons still look like buttons.
 */
function ThemePreview({
  theme,
  appearance,
}: {
  theme: GrytTheme;
  appearance: GrytAppearance;
}) {
  useTranslation();
  return (
    <GrytProvider
      className="rounded-(--gryt-radius-lg) border border-gryt-border bg-gryt-bg p-4"
      theme={createGrytTheme(grytThemeToOptions(theme, appearance))}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="small">{i18n.t("ui.join")}</Button>
          <Button size="small" tone="secondary">{i18n.t("settingsFull.mb136609f06")}</Button>
          <Button size="small" tone="neutral">{i18n.t("ui.cancel")}</Button>
          <Button size="small" tone="danger">{i18n.t("ui.leave")}</Button>
          <Chip label="3" tone="danger" />
        </div>

        <MessageBubble from="assistant">{i18n.t("settingsFull.m0ca55d888c")}</MessageBubble>
        <MessageBubble from="user">{i18n.t("settingsFull.mfd7ce53a67")}</MessageBubble>

        <p className="m-0 text-xs text-gryt-muted">{i18n.t("settingsFull.m64e790dc42")}</p>
      </div>
    </GrytProvider>
  );
}
