import { Button, Select, TextField } from "@gryt/ui";
import { useEffect, useState } from "react";

import { i18n, useTranslation } from "@/i18n";

import { isMacAppStoreBuild, type WatchedProgram } from "../../../../lib/electron";
import { useWatchedPrograms } from "../hooks/useWatchedPrograms";
import { HowItWorks } from "./howItWorks";

/**
 * The programs you want seen, under the line you type yourself. Gryt looks at
 * what is running and tells anybody only about this list (GRYT-931).
 */
export function WatchedPrograms() {
  useTranslation();
  const { supported, watched, running, setWatched, listRunning, consentedAt, setConsent } =
    useWatchedPrograms();

  const [open, setOpen] = useState<string[]>([]);
  const [picked, setPicked] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);

  // Only once the section is on screen and reading has been allowed — this
  // spawns a `ps`, and used to do it before anybody had agreed to it.
  useEffect(() => {
    if (!supported || !consentedAt) return;
    setLoading(true);
    void listRunning().then((names) => {
      setOpen(names);
      setLoading(false);
    });
  }, [supported, consentedAt, listRunning]);

  if (!supported) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm font-bold">{i18n.t("settingsFull.m9e1a71e91c")}</span>
        <span className="text-xs text-gryt-muted">
          {isMacAppStoreBuild() ? (
            <>{i18n.t("settingsFull.me3a3808a32")}</>
          ) : (
            <>{i18n.t("settingsFull.md691d6b3e8")}</>
          )}
        </span>
      </div>
    );
  }

  const add = async () => {
    const match = picked.trim();
    if (!match) return;

    // Default the label to the executable minus its extension, which is right
    // often enough — `Factorio.exe` becomes `Factorio`.
    const name = label.trim() || match.replace(/\.exe$/i, "");

    await setWatched([...watched, { match, name }]);
    setPicked("");
    setLabel("");
  };

  const remove = (entry: WatchedProgram) =>
    setWatched(watched.filter((w) => w.match !== entry.match));

  const refresh = async () => {
    setLoading(true);
    setOpen(await listRunning());
    setLoading(false);
  };

  if (!consentedAt) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold">{i18n.t("settingsFull.m9e1a71e91c")}</span>
        <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.ma87f57cd0f")}</span>
        <HowItWorks>
          <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m5b97524993")}</span>
          <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m6796b0be4c")}</span>
        </HowItWorks>
        <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
          <Button size="small" onClick={() => void setConsent(true)}>{i18n.t("settingsFull.m3ad0e36982")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-bold">{i18n.t("settingsFull.m9e1a71e91c")}</span>
      <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.mbc442bd619")}</span>

      {watched.length > 0 && (
        <ul className="flex flex-col gap-1 m-0 p-0 list-none">
          {watched.map((entry) => (
            <li
              key={entry.match}
              className="flex items-center gap-2 rounded-md px-2 py-1"
              style={{ background: "var(--gryt-neutral-3)" }}
            >
              <span className="text-sm font-medium">{entry.name}</span>
              <span className="text-xs text-gryt-muted" style={{ flex: 1, minWidth: 0 }}>
                {entry.match}
              </span>
              {running.includes(entry.name) && (
                <span className="text-xs" style={{ color: "var(--gryt-success-9)" }}>{i18n.t("settingsFull.m3c49d9cc3c")}</span>
              )}
              <Button size="xsmall" tone="neutral" onClick={() => void remove(entry)}>{i18n.t("ui.remove")}</Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 0 }}>
          <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m303759e0a3")}</span>
          <Select
            value={picked}
            onValueChange={(value) => setPicked(String(value ?? ""))}
            /* Anything already listed is gone from the picker rather than shown
               and refused: an option that does nothing is worse than none. */
            options={open
              .filter((name) => !watched.some((w) => w.match === name))
              .map((name) => ({ value: name, label: name }))}
            placeholder={loading ? i18n.t("settingsFull.m5e65f10e67") : i18n.t("settingsFull.m00621b896c")}
          />
        </div>

        <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 0 }}>
          <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m82928d5e26")}</span>
          <TextField
            placeholder={picked ? picked.replace(/\.exe$/i, "") : "Factorio"}
            value={label}
            maxLength={80}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>

        <Button size="small" onClick={() => void add()} disabled={!picked}>{i18n.t("settingsFull.m61cc55aa04")}</Button>
        <Button size="small" tone="neutral" onClick={() => void refresh()} disabled={loading}>{i18n.t("settingsFull.m56e3badc4e")}</Button>
      </div>

      {open.length === 0 && !loading && (
        <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m5398c03c29")}</span>
      )}
      <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
        <Button
          size="xsmall"
          tone="neutral"
          onClick={() => void setConsent(false)}
        >{i18n.t("settingsFull.m192e670547")}</Button>
        <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m38a12c962b")}</span>
      </div>

    </div>
  );
}
