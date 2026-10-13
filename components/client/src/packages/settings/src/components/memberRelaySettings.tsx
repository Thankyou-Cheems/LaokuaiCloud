import { Alert, Button, Switch } from '@gryt/ui';
import { useEffect, useRef, useState } from 'react';

import { useTranslation } from '@/i18n';
import { useServerManagement } from '@/socket';

import { type CommunityRelayState, DEFAULT_MEMBER_RELAY_BYTES_PER_SECOND, parseCommunityRelayState } from '../../../../lib/communityRelay';

/** Optional member assistance; this never owns ordinary community enrollment. */
export function MemberRelaySettings() {
  const {t} = useTranslation();
  const {currentlyViewingServer} = useServerManagement();
  const serverId = currentlyViewingServer?.serverId;
  const [state, setState] = useState<CommunityRelayState | null>(null);
  const [budget, setBudget] = useState(DEFAULT_MEMBER_RELAY_BYTES_PER_SECOND);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const epoch = useRef(0), mutation = useRef(0);
  useEffect(() => {
    const generation = ++epoch.current;
    setState(null); setFailed(false); setBusy(false); setBudget(DEFAULT_MEMBER_RELAY_BYTES_PER_SECOND);
    if (!serverId || !window.easyTierCommunity?.getRelayState) return;
    let pending = false, first = true;
    const refresh = async () => {
      if (pending) return; pending = true; const revision = mutation.current;
      try {
        const result = parseCommunityRelayState(await window.easyTierCommunity!.getRelayState!(serverId), serverId);
        if (epoch.current === generation && revision === mutation.current) {
          setState(result); setFailed(false);
          if (first) {first = false; if (result.desiredEnabled) setBudget(result.desiredBytesPerSecond);}
        }
      } catch {if (epoch.current === generation && revision === mutation.current) {setState(null); setFailed(true);}}
      finally {pending = false;}
    };
    void refresh(); const timer = setInterval(() => void refresh(), 2000);
    // This ref is a logical request generation, not a DOM element reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => {epoch.current++; clearInterval(timer);};
  }, [serverId]);
  async function update(enabled: boolean) {
    const api = window.easyTierCommunity, generation = epoch.current;
    if (!serverId || !api?.setRelayPreference || busy) return;
    mutation.current++; setBusy(true); setFailed(false);
    try {
      const result = parseCommunityRelayState(await api.setRelayPreference({v: 1, serverId, enabled, bytesPerSecond: enabled ? budget : 0}), serverId);
      if (epoch.current === generation) setState(result);
    } catch {if (epoch.current === generation) setFailed(true);}
    finally {if (epoch.current === generation) {mutation.current++; setBusy(false);}}
  }
  return <section className="flex flex-col gap-3 border-t border-gryt-neutral-6 pt-4">
    <h3 className="text-sm font-medium">{t('memberRelay.title')}</h3>
    <p className="text-xs text-gryt-muted">{t('memberRelay.description')}</p>
    {!serverId ? <p className="text-sm text-gryt-muted">{t('memberRelay.chooseCommunity')}</p> : <>
      <div className="flex items-center justify-between gap-4">
        <label htmlFor="member-relay-enabled" className="text-sm">{t('memberRelay.enable')}</label>
        <Switch id="member-relay-enabled" aria-label={t('memberRelay.enable')} checked={state?.desiredEnabled ?? false}
          disabled={!state || busy} onCheckedChange={value => void update(value)} />
      </div>
      <label className="flex items-center justify-between gap-4 text-sm">
        {t('memberRelay.budget')}
        <select aria-label={t('memberRelay.budget')} value={budget} disabled={!state || busy}
          className="rounded bg-gryt-neutral-3 px-2 py-1" onChange={event => setBudget(Number(event.target.value))}>
          {[16000, 32000, 64000, 125000, 250000, 500000, 1000000].map(value => <option key={value} value={value}>{value * 8 / 1000} kbps</option>)}
        </select>
      </label>
      {state?.desiredEnabled && budget !== state.desiredBytesPerSecond && <Button size="small" disabled={busy} onClick={() => void update(true)}>{t('memberRelay.applyBudget')}</Button>}
      <p className="text-sm" role="status">{state ? t(`memberRelay.status.${state.status}`) : t('memberRelay.unavailable')}</p>
      {state?.reason && <p className="text-xs text-gryt-muted">{t(`memberRelay.reason.${state.reason}`)}</p>}
      <p className="text-xs text-gryt-muted">{t('memberRelay.separateConsent')}</p>
    </>}
    {failed && <Alert severity="error">{t('memberRelay.failed')}</Alert>}
  </section>;
}
