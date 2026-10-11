import { useEffect, useRef, useState } from "react";

import { useServerManagement } from "@/socket";

import { publishCommunityLanState as publish, useEasyTierCommunityState } from "../lib/communityLanState";
import { easyTierCommunityAction, EasyTierCommunitySubscriptions } from "../lib/easyTierCommunitySubscriptions";

export function CommunityLanSession() {
  const { servers, currentlyViewingServer } = useServerManagement();
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem("community-lan-enabled") !== "off"; } catch { return true; }
  });
  const [preparing, setPreparing] = useState(false);
  const [prepareFailed, setPrepareFailed] = useState(false);
  const subscription = useRef<EasyTierCommunitySubscriptions | null>(null);
  // Persist through signaling reconnects. Pending approval entries are not memberships.
  const key = JSON.stringify([...new Set(Object.values(servers).filter(s => !s.approvalRequestedAt && s.serverId).map(s => s.serverId!))].sort());
  useEffect(() => {
    const api = window.easyTierCommunity;
    if (!api) return;
    const owner = new EasyTierCommunitySubscriptions(api, publish);
    subscription.current = owner;
    const unlisten = api.onState(publish);
    owner.reconcile(JSON.parse(key) as string[]);
    return () => { unlisten(); owner.dispose(); subscription.current = null; };
    // One owner for the application. Membership changes reconcile below, never in cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { subscription.current?.reconcile(JSON.parse(key) as string[]); }, [key]);
  useEffect(() => {
    const api = window.easyTierCommunity;
    if (!api) return;
    void api.setEnabled(enabled).then(values => values.forEach(publish), () => undefined);
    try { localStorage.setItem("community-lan-enabled", enabled ? "on" : "off"); } catch { /* Preference storage does not affect voice. */ }
  }, [enabled]);
  const serverId = currentlyViewingServer?.serverId;
  const state = useEasyTierCommunityState(serverId);
  if (!window.easyTierCommunity || !serverId) return null;
  const action = easyTierCommunityAction(state);
  const prepare = async () => {
    setPreparing(true); setPrepareFailed(false);
    try {
      const result = await window.easyTierCommunity!.prepareRuntime();
      if (result.ready) subscription.current?.retry(serverId);
      else setPrepareFailed(true);
    } catch { setPrepareFailed(true); }
    finally { setPreparing(false); }
  };
  return <aside aria-label="社区联机" className="fixed bottom-3 left-3 z-30 max-w-sm rounded-lg bg-gryt-background p-3 text-sm shadow">
    <p role="status">{preparing ? "正在准备联机组件…" : prepareFailed ? "组件下载未完成，请检查网络后重试。语音聊天可继续使用。" : action.message}</p>
    <div className="mt-2 flex gap-3">
      <button type="button" onClick={() => setEnabled(value => !value)}>{enabled ? "关闭联机" : "开启联机"}</button>
      {enabled && action.prepare && <button type="button" disabled={preparing} onClick={() => void prepare()}>准备组件</button>}
      {enabled && action.retry && !action.prepare && <button type="button" onClick={() => subscription.current?.retry(serverId)}>重试</button>}
    </div>
  </aside>;
}
