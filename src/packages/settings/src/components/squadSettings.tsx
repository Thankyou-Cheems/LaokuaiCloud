import { Button } from "@gryt/ui";
import { type TransmissionState, useMicrophone } from "@gryt/voice";
import { useEffect, useState } from "react";

import { useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { getElectronAPI } from "../../../../lib/electron";
import { normalizeSquadKey, SQUAD_DEFAULTS, type SquadConfig, type SquadSnapshot, validateSquadConfig } from "../../../../lib/squadMode";
import { useSquadSnapshot } from "../../../../lib/squadRuntime";
import { HotkeyCapture } from "./hotkeySettings";
import { SettingGroup, ToggleSetting } from "./settingsComponents";

export function SquadStatusText({ state, transmission }: { state: SquadSnapshot; transmission: TransmissionState }) {
  const { t } = useTranslation();
  const actual = state.status === "off" ? state.status
    : ["failed", "suspended"].includes(transmission.status) ? transmission.status
    : state.suppressed && transmission.status !== "suppressed" && !["failed", "suspended"].includes(transmission.status) ? "pending"
    : transmission.status === "recovering" ? "recovering" : state.status;
  return <div role="status" data-testid="squad-status" className="text-xs text-gryt-muted break-words">
    {t(`squad.${actual}`, { count: state.heldCount })}
    {(state.reason || transmission.reason) && <span> · {t("squad.reason", { reason: state.reason ?? transmission.reason })}</span>}
  </div>;
}

export function SquadControl({ config, onChange, otherKeys, state, transmission, retry }: {
  config: SquadConfig; onChange: (config: SquadConfig) => void; otherKeys: string[];
  state: SquadSnapshot; transmission: TransmissionState; retry: () => void;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState(config.processTarget);
  const [error, setError] = useState("");
  const [validating, setValidating] = useState(false);
  const [adding, setAdding] = useState(false);
  useEffect(() => { setTarget(config.processTarget); }, [config.processTarget]);
  function update(next: SquadConfig) {
    next = { ...next, keys: next.keys.map(key => normalizeSquadKey(key) ?? key) };
    const problem = validateSquadConfig(next, otherKeys);
    if (problem) { setError(problem); return false; }
    setError(""); onChange(next); return true;
  }
  async function validateTarget() {
    const next = { ...config, processTarget: target.trim() };
    const problem = validateSquadConfig(next, otherKeys);
    if (problem) { setError(problem); return; }
    setValidating(true);
    try {
      const result = await getElectronAPI()?.validateSquadProcess(next.processTarget);
      if (result && !result.valid) setError(result.reason ?? "invalid-process");
      else update(next);
    } catch { setError("validation-failed"); }
    finally { setValidating(false); }
  }
  return <div className="flex min-w-0 flex-col gap-5" data-testid="squad-settings">
    <ToggleSetting anchorId="squad-mode" title={t("squad.title")} description={t("squad.description")}
      checked={config.enabled} onCheckedChange={enabled => update({ ...config, enabled })} />
    <SquadStatusText state={state} transmission={transmission} />
    <ToggleSetting anchorId="squad-process" title={t("squad.processTitle")} description={t("squad.processDescription")}
      checked={config.processDetection} onCheckedChange={processDetection => update({ ...config, processDetection })} />
    {!config.processDetection && <p role="alert" className="text-amber-500 text-sm">{t("squad.globalWarning")}</p>}
    <SettingGroup anchorId="squad-target" title={t("squad.targetTitle")} description={t("squad.targetDescription")}>
      <input aria-label={t("squad.targetTitle")} value={target} onChange={e => setTarget(e.target.value)}
        className="w-full rounded border border-gryt-border bg-gryt-surface p-2 text-sm" placeholder={t("squad.automatic")} />
      <Button size="xsmall" disabled={validating} onClick={validateTarget}>{t("squad.validate")}</Button>
    </SettingGroup>
    {!config.keys.length && <p role="status">{t("squad.emptyKeys")}</p>}
    <div id="squad-keys" data-setting="squad-keys" className="flex flex-col gap-5">{config.keys.map((key, index) => <HotkeyCapture key={key} anchorId={`squad-key-${index + 1}`}
      label={t("squad.keyTitle", { count: index + 1 })} description={t("squad.keyDescription")}
      clearLabel={t("squad.removeKey")}
      value={key} onChange={value => update({ ...config, keys: value
        ? config.keys.map((old, i) => i === index ? value : old) : config.keys.filter((_, i) => i !== index) })} />)}</div>
    {adding && <HotkeyCapture key="new-binding" anchorId="squad-key-new" startListening
      label={t("squad.newKey")} description={t("squad.keyDescription")} value=""
      onChange={value => { if (value && update({ ...config, keys: [...config.keys, value] })) setAdding(false); }} />}
    <Button size="xsmall" onClick={() => { setError(""); setAdding(!adding); }}>{t(adding ? "ui.cancel" : "squad.addKey")}</Button>
    <Button size="xsmall" onClick={() => update({ ...config, keys: [...SQUAD_DEFAULTS.keys] })}>{t("squad.resetKeys")}</Button>
    <p className="text-xs text-gryt-muted break-words">{t("squad.boundary")}</p>
    {error && <p role="alert" data-testid="squad-error">{t(`squad.errors.${error}`)}</p>}
    {(state.status === "unavailable" || transmission.status === "failed") && <Button size="xsmall" onClick={retry}>{t("squad.retry")}</Button>}
  </div>;
}

export function SquadSettings() {
  const s = useSettings();
  const state = useSquadSnapshot();
  const { transmissionState, retryTransmission } = useMicrophone(false);
  const otherKeys = [s.inputMode === "push_to_talk" ? s.pushToTalkKey : "", s.muteHotkey, s.deafenHotkey, s.disconnectHotkey];
  return <SquadControl config={s.squadConfig} onChange={s.setSquadConfig} otherKeys={otherKeys} state={state}
    transmission={transmissionState} retry={() => {
      getElectronAPI()?.configureSquad(s.squadConfig).then(() => retryTransmission()).catch(() => {});
    }} />;
}

export function SquadLiveStatus() {
  const { squadConfig } = useSettings();
  const state = useSquadSnapshot();
  const { transmissionState } = useMicrophone(false);
  if (!squadConfig.enabled && !state.gateEnabled && ["ready", "disabled"].includes(transmissionState.status)) return null;
  return <SquadStatusText state={state} transmission={transmissionState} />;
}
