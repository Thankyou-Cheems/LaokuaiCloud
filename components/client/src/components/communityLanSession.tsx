import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";

import { getServerAccessToken } from "@/common";
import { useServerManagement, useSockets } from "@/socket";

import { publishCommunityLanState as publish, useEasyTierCommunityState } from "../lib/communityLanState";
import { easyTierCommunityAction, EasyTierCommunitySubscriptions } from "../lib/easyTierCommunitySubscriptions";
import { CommunityLanStatusControl, type CommunityLanStatusControlProps } from "./CommunityLanStatusControl";

const CommunityLanControlsContext = createContext<CommunityLanStatusControlProps | null>(null);

/** One app-wide membership owner, independent of viewing server, rooms and voice. */
export function CommunityLanSession({ children }: { children?: ReactNode }) {
  const { servers, currentlyViewingServer } = useServerManagement();
  const { sockets, serverConnectionStatus, serverDetailsList } = useSockets();
  const [previewDisabled, setPreviewDisabled] = useState(false);
  const [consentNeeded, setConsentNeeded] = useState(false);
  useEffect(() => {
    let retired = false;
    void window.easyTierCommunity?.getRuntimeMode?.().then(mode => {if (!retired) {setPreviewDisabled(mode === "preview-disabled");setConsentNeeded(mode === "needs-consent");}}).catch(() => {});
    return () => {retired = true;};
  }, []);
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem("community-lan-enabled") !== "off"; } catch { return true; }
  });
  const [preparing, setPreparing] = useState(false);
  const [prepareFailed, setPrepareFailed] = useState(false);
  const [operationFailed, setOperationFailed] = useState(false);
  const [subscriptionFailed, setSubscriptionFailed] = useState(false);
  const subscription = useRef<EasyTierCommunitySubscriptions | null>(null);
  const authInputs = useRef(new Map<string, {host: string; accessToken: string | null}>());
  const authSync = useRef<(() => void) | null>(null);
  // Persist through signaling reconnects. Pending approval entries are not memberships.
  const key = JSON.stringify([...new Set(Object.values(servers).filter(s => !s.approvalRequestedAt && s.serverId).map(s => s.serverId!))].sort());
  useEffect(() => {
    const api = window.easyTierCommunity;
    if (!api) return;
    const observed = (state: Parameters<typeof publish>[0]) => { publish(state); setOperationFailed(false); };
    const owner = new EasyTierCommunitySubscriptions(api, observed, () => setOperationFailed(true));
    subscription.current = owner;
    let unlisten: () => void = () => undefined;
    try { unlisten = api.onState(observed); } catch { setSubscriptionFailed(true); }
    owner.reconcile(JSON.parse(key) as string[]);
    return () => { try { unlisten(); } catch { /* Unavailable ET must not tear down community/voice. */ } owner.dispose(); subscription.current = null; };
    // One owner for the application. Membership changes reconcile below, never in cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { subscription.current?.reconcile(JSON.parse(key) as string[]); }, [key]);
  useEffect(() => {
    const api = window.easyTierCommunity;
    if (!api?.setAuthenticatedSession) return;
    let retired = false;
    const sync = () => {
      const memberships = new Map<string, {host: string; accessToken: string | null}>();
      for (const [host, server] of Object.entries(servers)) if (!server.approvalRequestedAt && server.serverId) {
        const accessToken = getServerAccessToken(host);
        const old = memberships.get(server.serverId);
        if (!old || (!old.accessToken && accessToken)) memberships.set(server.serverId, {host, accessToken});
      }
      for (const [id, old] of authInputs.current) if (!memberships.has(id)) memberships.set(id, {host: old.host, accessToken: null});
      for (const [serverId, input] of memberships) {
        const old = authInputs.current.get(serverId);
        if (old?.host === input.host && old.accessToken === input.accessToken) continue;
        authInputs.current.set(serverId, input);
        void api.setAuthenticatedSession!({serverId, ...input}).then(state => { if (!retired) publish(state); })
          .catch(() => { if (!retired) { authInputs.current.delete(serverId); setOperationFailed(true); } });
      }
    };
    authSync.current = sync;
    sync(); window.addEventListener("community-member-token-changed", sync);
    return () => { retired = true; if (authSync.current === sync) authSync.current = null; window.removeEventListener("community-member-token-changed", sync); };
  }, [servers]);
  useEffect(() => {
    const api = window.easyTierCommunity;
    if (!api) return;
    let retired = false;
    try { void api.setEnabled(enabled).then(values => { if (!retired) values.forEach(publish); }).catch(() => { if (!retired) setOperationFailed(true); }); }
    catch { setOperationFailed(true); }
    try { localStorage.setItem("community-lan-enabled", enabled ? "on" : "off"); } catch { /* Preference storage does not affect voice. */ }
    return () => { retired = true; };
  }, [enabled]);
  const serverId = currentlyViewingServer?.serverId;
  const publicConsentNeeded = consentNeeded && currentlyViewingServer?.host === "voice.ruikang.wang";
  const consent = async () => {
    if (!serverId || !window.easyTierCommunity?.approveCommunity) return;
    try {
      const result = await window.easyTierCommunity.approveCommunity(serverId);
      if (!result.accepted) return;
      setConsentNeeded(false);setEnabled(true);setOperationFailed(false);setPrepareFailed(false);
      authInputs.current.delete(serverId);authSync.current?.();subscription.current?.retry(serverId);
    } catch {setOperationFailed(true);}
  };
  const state = useEasyTierCommunityState(serverId);
  const action = easyTierCommunityAction(state, enabled);
  useEffect(() => { setPrepareFailed(false); }, [serverId]);
  const prepare = async () => {
    if (!serverId || !window.easyTierCommunity) return;
    setPreparing(true); setPrepareFailed(false);
    try {
      const result = await window.easyTierCommunity!.prepareRuntime();
      if (result.ready) subscription.current?.retry(serverId);
      else setPrepareFailed(true);
    } catch { setPrepareFailed(true); }
    finally { setPreparing(false); }
  };
  const shownAction = publicConsentNeeded ? { ...action, label: "待本人授权", kind: "attention" as const,
    message: "首次联机请以同一 Windows 用户的管理员权限启动，再点击开启联机并确认本机授权。设备使用自己的登录身份与短期凭据。", prepare: false, retry: false }
    : previewDisabled ? { ...action, label: "测试模式：联机未启用", kind: "disabled" as const,
    message: "本轮测试预览未启用联机。联机入口已禁用，不会尝试连接。", prepare: false, retry: false }
    : operationFailed || subscriptionFailed ? { ...action, label: "组件不可用", kind: "error" as const,
    message: "联机组件操作未完成，请重试。社区与语音鉴权不依赖此组件，请分别查看社区和频道状态。", prepare: false, retry: true }
    : preparing ? { ...action, label: "准备中", kind: "pending" as const, message: "正在准备联机组件…联机与社区语音独立。" }
    : prepareFailed && enabled ? { ...action, label: "准备失败", kind: "error" as const,
      message: "组件下载未完成，请检查网络后重试。联机与社区语音独立。", prepare: true }
    : action;
  const host = currentlyViewingServer?.host;
  const connection = host ? serverConnectionStatus[host] : undefined;
  const communityLabel = connection === "refused" ? "社区认证或权限被拒绝" : host && sockets[host]?.connected
    ? "社区服务已连接" : connection === "connecting" || connection === "reconnecting" ? "社区服务连接中" : "社区服务未连接";
  const channelsReceived = Boolean(host && Array.isArray(serverDetailsList[host]?.channels));
  return <CommunityLanControlsContext.Provider value={window.easyTierCommunity && serverId ? {
    enabled: previewDisabled || publicConsentNeeded ? false : enabled, toggleDisabled: previewDisabled, preparing, action: shownAction, communityLabel, channelsReceived,
    onToggle: () => {if(publicConsentNeeded)void consent();else setEnabled(value => !value);}, onPrepare: () => void prepare(),
    onRetry: () => { authInputs.current.delete(serverId); authSync.current?.(); subscription.current?.retry(serverId); },
  } : null}>{children}</CommunityLanControlsContext.Provider>;
}

export function CommunityLanControls() {
  const controls = useContext(CommunityLanControlsContext);
  return controls ? <CommunityLanStatusControl {...controls} /> : null;
}
