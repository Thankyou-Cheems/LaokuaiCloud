import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";

import { getServerAccessToken } from "@/common";
import { useServerManagement, useSockets } from "@/socket";

import { publishCommunityLanState as publish, useEasyTierCommunityState } from "../lib/communityLanState";
import { easyTierCommunityAction, presentCommunityLanAction } from "../lib/easyTierCommunitySubscriptions";
import { nativeVoiceEnabled } from "../lib/voiceFacade";
import { CommunityLanStatusControl, type CommunityLanStatusControlProps } from "./CommunityLanStatusControl";

const CommunityLanControlsContext = createContext<CommunityLanStatusControlProps | null>(null);

/** The renderer supplies one member snapshot. Main owns enrollment ordering and prompts. */
export function CommunityLanSession({ children }: { children?: ReactNode }) {
  const { servers, currentlyViewingServer } = useServerManagement();
  const { sockets, serverConnectionStatus, serverDetailsList } = useSockets();
  const [previewDisabled, setPreviewDisabled] = useState(false);
  const [modeReady, setModeReady] = useState(false);
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem("community-lan-enabled") !== "off"; } catch { return true; }
  });
  const [preparing, setPreparing] = useState(false);
  const [operationFailed, setOperationFailed] = useState(false);
  const refresh = useRef<(retry?: string) => void>(() => undefined);
  useEffect(() => {
    let retired = false;
    const api = window.easyTierCommunity;
    if (!api) return;
    void api.getRuntimeMode?.().then(mode => {
      if (!retired) { setPreviewDisabled(mode === "preview-disabled"); setModeReady(true); }
    }).catch(() => { if (!retired) setOperationFailed(true); });
    let unlisten = () => undefined as void;
    try { unlisten = api.onState(state => {
      publish(state);
      if (!retired && state.phase === "connected") setOperationFailed(false);
    }); } catch { setOperationFailed(true); }
    return () => { retired = true; try { unlisten(); } catch { /* ET cannot tear down voice. */ } };
  }, []);
  useEffect(() => {
    try { localStorage.setItem("community-lan-enabled", enabled ? "on" : "off"); } catch { /* Optional preference. */ }
  }, [enabled]);
  useEffect(() => {
    const api = window.easyTierCommunity;
    if (!api?.reconcileEnrollment || !modeReady || previewDisabled) return;
    let retired = false, sequence = 0;
    const sync = (retry?: string) => {
      const flight = ++sequence;
      const members = new Map<string, { serverId: string; host: string; accessToken: string | null }>();
      for (const [host, server] of Object.entries(servers)) if (!server.approvalRequestedAt && server.serverId) {
        const accessToken = getServerAccessToken(host), old = members.get(server.serverId);
        if (!old || (!old.accessToken && accessToken)) members.set(server.serverId, { serverId: server.serverId, host, accessToken });
      }
      setPreparing(true);
      void api.reconcileEnrollment!({ members: [...members.values()], enabled, ...(retry ? { retry } : {}) })
        .then(states => { if (!retired && flight === sequence) { states.forEach(publish); setOperationFailed(false); } })
        .catch(() => { if (!retired && flight === sequence) setOperationFailed(true); })
        .finally(() => { if (!retired && flight === sequence) setPreparing(false); });
    };
    refresh.current = sync;
    const changed = () => sync();
    sync(); window.addEventListener("community-member-token-changed", changed);
    return () => { retired = true; window.removeEventListener("community-member-token-changed", changed); };
  }, [servers, enabled, modeReady, previewDisabled]);
  const serverId = currentlyViewingServer?.serverId;
  const state = useEasyTierCommunityState(serverId);
  const action = easyTierCommunityAction(state, enabled, nativeVoiceEnabled);
  const prepare = async () => {
    if (!serverId || !window.easyTierCommunity) return;
    setPreparing(true);
    try {
      const result = await window.easyTierCommunity.prepareRuntime();
      if (!result.ready) throw Error("runtime-unavailable");
      refresh.current(serverId);
    } catch { setOperationFailed(true); setPreparing(false); }
  };
  const shownAction = presentCommunityLanAction(action, state, { previewDisabled, preparing, operationFailed, voiceDependsOnLan: nativeVoiceEnabled });
  const host = currentlyViewingServer?.host;
  const connection = host ? serverConnectionStatus[host] : undefined;
  const communityLabel = connection === "refused" ? "社区认证或权限被拒绝" : host && sockets[host]?.connected
    ? "社区服务已连接" : connection === "connecting" || connection === "reconnecting" ? "社区服务连接中" : "社区服务未连接";
  const channelsReceived = Boolean(host && Array.isArray(serverDetailsList[host]?.channels));
  return <CommunityLanControlsContext.Provider value={window.easyTierCommunity && serverId ? {
    enabled: !previewDisabled && enabled, toggleDisabled: previewDisabled, preparing, action: shownAction, communityLabel, channelsReceived,
    onToggle: () => setEnabled(value => !value), onPrepare: () => void prepare(), onRetry: () => refresh.current(serverId),
  } : null}>{children}</CommunityLanControlsContext.Provider>;
}

export function CommunityLanControls() {
  const controls = useContext(CommunityLanControlsContext);
  return controls ? <CommunityLanStatusControl {...controls} /> : null;
}
