import { Button } from "@gryt/ui";
import { useEffect, useState } from "react";
import { Trans } from "react-i18next";

import { i18n, useTranslation } from "@/i18n";

import { getElectronAPI, isMacAppStoreBuild, type RichPresenceApp, type RichPresenceLogEntry } from "../../../../lib/electron";
import { GameIcon } from "../../../socket/src/components/GameIcon";
import { useGameDetection } from "../hooks/useGameDetection";
import { usePresenceHelper } from "../hooks/usePresenceHelper";
import { useRichPresence } from "../hooks/useRichPresence";
import { HowItWorks } from "./howItWorks";
import { richPresenceLogText } from "./nativeDisplayCopy";
import { PresenceHelperSettings } from "./presenceHelper";
import { helperCopy } from "./presenceHelperCopy";
import { socketLine } from "./richPresenceCopy";

/**
 * Games that report what you're doing through Discord's Rich Presence socket.
 * Off until somebody turns it on, since any program on the machine can talk to it (GRYT-1310).
 */
export function RichPresenceSettings() {
  useTranslation();
  const rp = useRichPresence();
  const helper = usePresenceHelper();

  if (!rp.supported) {
    // The browser can't open a local socket, and the web copy of this panel would promise something it can't do.
    if (!isMacAppStoreBuild()) return null;
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm font-bold">{i18n.t("settingsFull.m63608c4067")}</span>
        <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.mecce7ccee3")}</span>
      </div>
    );
  }

  if (!rp.consentedAt) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold">{i18n.t("settingsFull.m63608c4067")}</span>
        <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.mb092310f3f")}</span>
        <HowItWorks>
          <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m10f4d07391")}</span>
          <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m641fd5e574")}</span>
        </HowItWorks>
        <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
          <Button size="small" onClick={() => void rp.setConsent(true)}>{i18n.t("settingsFull.m26563efc2a")}</Button>
        </div>
      </div>
    );
  }

  const line = socketLine(rp, (key, values) => i18n.t(key, values));
  const hiddenIds = new Set(rp.hidden.map((app) => app.id));
  // Hidden apps stay listed after a restart, when nothing has connected yet.
  const apps: RichPresenceApp[] = [...rp.seen, ...rp.hidden.filter((h) => !rp.seen.some((s) => s.id === h.id))];

  // Opens the helper's own box rather than turning it on, since that's where it says what it costs.
  const showHelper = () => {
    document.getElementById("gryt-helper")?.scrollIntoView({ behavior: "smooth", block: "center" });
    document.getElementById("gryt-helper-on")?.focus({ preventScroll: true });
  };

  const toggle = (app: RichPresenceApp) =>
    void rp.setHidden(hiddenIds.has(app.id) ? rp.hidden.filter((h) => h.id !== app.id) : [...rp.hidden, app]);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-bold">{i18n.t("settingsFull.m63608c4067")}</span>

      {line.text && (
        <div
          className="flex flex-col gap-1 rounded-md px-2 py-1"
          role={line.warn ? "status" : undefined}
          style={line.warn ? { background: "var(--gryt-warning-3)", color: "var(--gryt-warning-11)" } : undefined}
        >
          <span className={line.warn ? "text-xs" : "text-xs text-gryt-muted"}>{line.text}</span>
          {line.fix && <span className="text-xs">{line.fix}</span>}
          {rp.holder?.isDiscord && helper.offered && !helper.enabledAt && (
            <div className="flex items-center gap-2" style={{ marginTop: 2 }}>
              <Button size="xsmall" onClick={showHelper}>
                {i18n.t("settingsFull.m4df5a435c2", { defaultValue: helperCopy.turnOn })}
              </Button>
              <span className="text-xs">{i18n.t("settingsFull.me0911290b5", { defaultValue: helperCopy.warningHint })}</span>
            </div>
          )}
        </div>
      )}

      {rp.current && (
        <span className="flex items-center gap-1.5 text-xs text-gryt-muted"><Trans i18n={i18n} i18nKey="settingsFull.m673c241bbb" values={{ name: rp.current.name }} components={{ name: <strong /> }} /></span>
      )}

      {apps.length > 0 && (
        <ul className="flex flex-col gap-1 m-0 p-0 list-none">
          {apps.map((app) => (
            <li
              key={app.id}
              className="flex items-center gap-2 rounded-md px-2 py-1"
              style={{ background: "var(--gryt-neutral-3)" }}
            >
              <span className="text-sm font-medium" style={{ flex: 1, minWidth: 0 }}>
                {rp.names?.[app.id] ?? app.name ?? i18n.t("settingsFull.mf53b7c1c3e", { value0: app.id })}
              </span>
              {hiddenIds.has(app.id) && <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m99d72c7fc3")}</span>}
              {(!app.name || rp.names?.[app.id]) && (
                <NameGame id={app.id} current={rp.names?.[app.id] ?? ""} onSave={(name) => void rp.setName(app.id, name)} />
              )}
              <Button size="xsmall" tone="neutral" onClick={() => toggle(app)}>
                {hiddenIds.has(app.id) ? i18n.t("settingsFull.md97d1ee339") : i18n.t("settingsFull.m34d8b60fe2")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ReceivedLog log={rp.log ?? []} refresh={rp.refresh} />

      <GameDetection />

      <PresenceHelperSettings helper={helper} />

      <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
        <Button size="xsmall" tone="neutral" onClick={() => void rp.setConsent(false)}>{i18n.t("settingsFull.m8807c2b3fd")}</Button>
        <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.mfc9fca1821")}</span>
      </div>
    </div>
  );
}

const time = (at: number) => new Date(at).toLocaleTimeString(i18n.resolvedLanguage, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** What games actually sent, so it's clear whether a game talks to Gryt at all. */
function ReceivedLog({ log, refresh }: { log: RichPresenceLogEntry[]; refresh: () => Promise<void> }) {
  useTranslation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [open, refresh]);

  return (
    <details onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="text-xs text-gryt-muted" style={{ cursor: "pointer", width: "fit-content" }}>{i18n.t("settingsFull.mcbde113b59")}</summary>
      <div className="flex flex-col gap-1" style={{ marginTop: 4 }}>
        {log.length === 0 ? (
          <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.md10fa1e928")}</span>
        ) : (
          <ol
            className="flex flex-col gap-0.5 m-0 p-2 list-none rounded-md"
            style={{ background: "var(--gryt-neutral-3)", fontFamily: "var(--font-mono, ui-monospace, monospace)", maxHeight: 220, overflowY: "auto" }}
          >
            {[...log].reverse().map((entry, i) => (
              <li key={`${entry.at}-${i}`} className="text-xs">
                <span className="text-gryt-muted">{time(entry.at)}</span>{" "}
                {entry.appId ? <strong>{entry.name ?? i18n.t("settingsFull.mf53b7c1c3e", { value0: entry.appId })}</strong> : null}
                {entry.appId ? " " : ""}
                {richPresenceLogText(entry)}
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}

/** Known games spotted by their program. Off until turned on, and asks once per game. */
function GameDetection() {
  useTranslation();
  const detect = useGameDetection();
  if (!detect.supported) return null;

  return (
    <div className="flex flex-col gap-1 rounded-md px-2 py-2" style={{ background: "var(--gryt-neutral-3)" }}>
      <span className="text-sm font-medium">{i18n.t("settingsFull.mbf433fb602")}</span>
      <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.maaf1836990")}</span>
      <HowItWorks>
        <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m40bc180b70")}</span>
        <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m5dad8f6bea")}</span>
      </HowItWorks>
      <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
        <Button size="xsmall" tone={detect.enabled ? "neutral" : undefined} onClick={() => void detect.setEnabled(!detect.enabled)}>
          {detect.enabled ? i18n.t("settingsFull.m8807c2b3fd") : i18n.t("settingsFull.m26563efc2a")}
        </Button>
      </div>
      {detect.answers.length > 0 && (
        <ul className="flex flex-col gap-1 m-0 p-0 list-none" style={{ marginTop: 6 }}>
          {detect.answers.map((game) => (
            <li key={game.id} className="flex items-center gap-2 rounded-md px-2 py-1" style={{ background: "var(--gryt-neutral-4)" }}>
              <GameIcon appId={game.id} name={game.name ?? i18n.t("shellSecond.aGame")} size={16} />
              <span className="text-sm" style={{ flex: 1, minWidth: 0 }}>{game.name ?? i18n.t("settingsFull.mf53b7c1c3e", { value0: game.id })}</span>
              <span className="text-xs text-gryt-muted">{game.answer === "show" ? i18n.t("shellSecond.gameShown") : i18n.t("settingsFull.m629b738680")}</span>
              <Button size="xsmall" tone="neutral" onClick={() => void detect.answer(game.id, game.answer === "show" ? "hide" : "show")}>
                {game.answer === "show" ? i18n.t("settingsFull.mf864aae810") : i18n.t("settingsFull.md97d1ee339")}
              </Button>
              {/* Takes it off the list; Gryt asks again the next time it spots the game. */}
              <Button size="xsmall" tone="neutral" onClick={() => void detect.answer(game.id, null)}>{i18n.t("ui.remove")}</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A name for a game no list knows. Kept on this device, with a way to add it for everyone. */
function NameGame({ id, current, onSave }: { id: string; current: string; onSave: (name: string | null) => void }) {
  useTranslation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const suggest = () => {
    const title = encodeURIComponent(i18n.t("settingsFull.m77466b4f11", { value0: value || current }));
    const body = encodeURIComponent(i18n.t("settingsFull.m074ad17f38", { value0: id, value1: value || current }));
    void getElectronAPI()?.openExternal?.(`https://github.com/Gryt-chat/rich-presence/issues/new?title=${title}&body=${body}`);
  };
  if (!editing) {
    return (
      <>
        <Button size="xsmall" tone="neutral" onClick={() => setEditing(true)}>
          {current ? i18n.t("settingsFull.md3f4cb898f") : i18n.t("settingsFull.m7f5060319b")}
        </Button>
        {current && (
          <Button size="xsmall" tone="neutral" onClick={suggest}>{i18n.t("settingsFull.m53273f712a")}</Button>
        )}
      </>
    );
  }
  const save = () => {
    onSave(value.trim() || null);
    setEditing(false);
  };
  return (
    <input
      autoFocus
      aria-label={i18n.t("settingsFull.me617db3548")}
      value={value}
      maxLength={64}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") setEditing(false);
      }}
      className="rounded-md border border-gryt-border bg-gryt-surface px-2 py-0.5 text-sm text-gryt-text"
      style={{ width: 140 }}
    />
  );
}
