import { Alert, Button, Switch } from "@gryt/ui";
import { useEffect, useState } from "react";

import { useTranslation } from "@/i18n";

import {
  COMMUNITY_NETWORK_BOOLEAN_KEYS,
  communityNetworkPreferenceChanges,
  type CommunityNetworkPreferences,
  DEFAULT_COMMUNITY_NETWORK_PREFERENCES,
  exportCommunityNetworkPreferences,
  parseCommunityNetworkPreferences,
} from "../../../../lib/communityNetworkPreferences";
import { MemberRelaySettings } from "./memberRelaySettings";
import { SettingsContainer } from "./settingsComponents";

export function CommunityNetworkSettings() {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<CommunityNetworkPreferences>({...DEFAULT_COMMUNITY_NETWORK_PREFERENCES});
  const [draft, setDraft] = useState<CommunityNetworkPreferences>({...DEFAULT_COMMUNITY_NETWORK_PREFERENCES});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [restartRequired, setRestartRequired] = useState(false);
  const [imported, setImported] = useState<CommunityNetworkPreferences | null>(null);

  useEffect(() => {
    let retired = false;
    const api = window.easyTierCommunity;
    if (!api?.getNetworkPreferences || !api.setNetworkPreferences) { setError("communityNetwork.unavailable"); return; }
    void api.getNetworkPreferences().then(value => {
      if (retired) return;
      const preferences = parseCommunityNetworkPreferences(value);
      setSaved(preferences); setDraft(preferences); setReady(true);
    }).catch(() => { if (!retired) setError("communityNetwork.loadFailed"); });
    return () => { retired = true; };
  }, []);

  async function save(preferences: CommunityNetworkPreferences) {
    const api = window.easyTierCommunity;
    if (!ready || busy || !api?.setNetworkPreferences) return;
    setBusy(true); setError("");
    try {
      const result = await api.setNetworkPreferences(parseCommunityNetworkPreferences(preferences));
      const value = parseCommunityNetworkPreferences(result.preferences);
      setSaved(value); setDraft(value); setImported(null); setRestartRequired(true);
    } catch { setError("communityNetwork.saveFailed"); }
    finally { setBusy(false); }
  }

  function exportSaved() {
    let url: string | undefined;
    try {
      const text = exportCommunityNetworkPreferences(saved);
      url = URL.createObjectURL(new Blob([text], {type: "application/json;charset=utf-8"}));
      const link = document.createElement("a"); link.href = url; link.download = "laokuai-network-preferences.v1.json";
      link.click(); setError("");
    } catch { setError("communityNetwork.exportFailed"); }
    finally { if (url) URL.revokeObjectURL(url); }
  }

  const changed = communityNetworkPreferenceChanges(saved, draft).length > 0;
  const importChanges = imported ? communityNetworkPreferenceChanges(saved, imported) : [];
  return <SettingsContainer>
    <div data-setting="community-network" id="community-network" className="flex flex-col gap-2">
      <h2>{t("communityNetwork.title")}</h2>
      <p className="text-sm text-gryt-muted">{t("communityNetwork.description")}</p>
      <Alert severity="info">{t("communityNetwork.restartNotice")}</Alert>
    </div>
    {error && <Alert severity="error" role="alert">{t(error)}</Alert>}
    {restartRequired && <Alert severity="info" role="status">{t("communityNetwork.saved")}</Alert>}
    <div className="flex flex-col gap-5">
      {COMMUNITY_NETWORK_BOOLEAN_KEYS.map(key => <div key={key} className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor={`community-network-${key}`}>{t(`communityNetwork.options.${key}.title`)}</label>
          <span className="text-xs text-gryt-muted">{t(`communityNetwork.options.${key}.description`)}</span>
        </div>
        <Switch id={`community-network-${key}`} aria-label={t(`communityNetwork.options.${key}.title`)} checked={draft[key]} disabled={!ready || busy}
          onCheckedChange={value => { setDraft(previous => ({...previous, [key]: value})); setImported(null); }} />
      </div>)}
    </div>
    <div className="flex flex-wrap justify-end gap-2">
      <Button size="small" tone="neutral" disabled={!ready || busy} onClick={() => {setDraft({...DEFAULT_COMMUNITY_NETWORK_PREFERENCES});setImported(null);}}>{t("communityNetwork.restore")}</Button>
      <Button size="small" disabled={!ready || busy || !changed} onClick={() => void save(draft)}>{t("communityNetwork.save")}</Button>
    </div>
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{t("communityNetwork.portableTitle")}</h3>
      <p className="text-xs text-gryt-muted">{t("communityNetwork.portableDescription")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="small" tone="neutral" disabled={!ready || busy} onClick={exportSaved}>{t("communityNetwork.export")}</Button>
        <label className="flex flex-col gap-1 text-sm">
          {t("communityNetwork.import")}
          <input type="file" accept=".json,application/json" disabled={!ready || busy} aria-label={t("communityNetwork.import")}
            onChange={event => {
              const file = event.target.files?.[0]; event.target.value = "";
              setImported(null); if (!file) return;
              if (file.size > 8192) {setError("communityNetwork.invalidImport");return;}
              setBusy(true); setError("");
              void file.text().then(text => setImported(parseCommunityNetworkPreferences(text)))
                .catch(() => setError("communityNetwork.invalidImport")).finally(() => setBusy(false));
            }} />
        </label>
      </div>
      {imported && <div className="flex flex-col gap-3 rounded border border-gryt-neutral-6 p-3">
        <h4 className="text-sm font-medium">{t("communityNetwork.preview")}</h4>
        <ul className="flex flex-col gap-1 text-xs">
          {COMMUNITY_NETWORK_BOOLEAN_KEYS.map(key => <li key={key}>
            {t(`communityNetwork.options.${key}.title`)}: {t(saved[key] ? "communityNetwork.on" : "communityNetwork.off")} → {t(imported[key] ? "communityNetwork.on" : "communityNetwork.off")}
          </li>)}
        </ul>
        <p className="text-xs text-gryt-muted">{t(importChanges.length ? "communityNetwork.restartNotice" : "communityNetwork.noChanges")}</p>
        <div className="flex justify-end gap-2">
          <Button size="small" tone="neutral" disabled={busy} onClick={() => setImported(null)}>{t("ui.cancel")}</Button>
          <Button size="small" disabled={busy || !importChanges.length} onClick={() => void save(imported)}>{t("communityNetwork.applyImport")}</Button>
        </div>
      </div>}
    </div>
    <MemberRelaySettings />
  </SettingsContainer>;
}
