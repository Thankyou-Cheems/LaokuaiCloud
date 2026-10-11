import type { EasyTierCommunityAPI, EasyTierCommunityState } from "./easyTierCommunity";

/** Renderer owner follows membership IDs. Room/SFU/socket reconnection events never enter here. */
export class EasyTierCommunitySubscriptions {
  private ids = new Set<string>();
  constructor(private api: EasyTierCommunityAPI, private publish: (state: EasyTierCommunityState) => void) {}
  reconcile(serverIds: readonly string[]): void {
    const next = new Set(serverIds);
    if (next.size !== this.ids.size || [...next].some(id => !this.ids.has(id)) || this.ids.size === 0) {
      void this.api.syncMemberships([...next]).then(values => values.forEach(this.publish), () => undefined);
    }
    this.ids = next;
  }
  retry(serverId: string): void {
    void this.api.connect({ serverId, leaseId: "renderer-community" }).then(this.publish, () => undefined);
  }
  /** App component remount/reload must not tear down a game session. */
  dispose(): void { this.ids.clear(); }
}

export function easyTierCommunityAction(state: EasyTierCommunityState | undefined): { message: string; prepare: boolean; retry: boolean } {
  if (!state) return { message: "正在读取社区联机状态…", prepare: false, retry: false };
  if (state.phase === "connected") return { message: state.virtualIp ? `社区联机已连接 · ${state.virtualIp}` : "社区联机已连接", prepare: false, retry: false };
  if (state.phase === "connecting") return { message: "正在连接社区联机…语音聊天可继续使用。", prepare: false, retry: false };
  if (state.phase === "disabled") return { message: "社区联机已关闭。", prepare: false, retry: false };
  const messages: Record<string, string> = {
    "configuration-required": "这个社区尚未提供已授权的联机配置，请联系社区管理员开通。语音聊天可继续使用。",
    "activation-required": "社区联机等待管理员开通。语音聊天可继续使用。",
    "needs-permission": "当前联机组件需要 Windows 驱动授权及管理员权限。请由管理员完成确认后以管理员权限启动应用。应用不会自行提权；语音聊天可继续使用。",
    "runtime-required": "请先下载联机组件。此步骤只准备文件，不安装驱动或连接网络。",
    "multi-community-unavailable": "当前版本同时支持一个社区联机。退出原社区联机后可重试，正在运行的游戏网络会保持连接。",
    "unsupported-target": "当前联机组件无法使用，请准备受支持的组件。语音聊天可继续使用。",
    "cleanup-failed": "联机连接尚未确认退出，请重试或关闭应用后再打开。语音聊天可继续使用。",
  };
  return { message: messages[state.reason ?? ""] ?? "社区联机暂时不可用，可以重试。语音聊天可继续使用。",
    prepare: state.reason === "runtime-required" || state.reason === "unsupported-target", retry: true };
}
