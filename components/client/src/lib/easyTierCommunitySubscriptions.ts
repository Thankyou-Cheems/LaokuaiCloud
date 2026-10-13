import type { EasyTierCommunityAPI, EasyTierCommunityState } from "./easyTierCommunity";

/** Renderer owner follows membership IDs. Room/SFU/socket reconnection events never enter here. */
export class EasyTierCommunitySubscriptions {
  private ids = new Set<string>();
  private disposed = false;
  private reportFailure = () => { if (!this.disposed) { try { this.onFailure(); } catch { /* Observers never gate community/voice. */ } } };
  constructor(private api: EasyTierCommunityAPI, private publish: (state: EasyTierCommunityState) => void,
    private onFailure: () => void = () => undefined) {}
  reconcile(serverIds: readonly string[]): void {
    if (this.disposed) return;
    const next = new Set(serverIds);
    if (next.size !== this.ids.size || [...next].some(id => !this.ids.has(id)) || this.ids.size === 0) {
      try { void this.api.syncMemberships([...next]).then(values => values.forEach(this.publish)).catch(this.reportFailure); }
      catch { this.reportFailure(); }
    }
    this.ids = next;
  }
  retry(serverId: string): void {
    if (this.disposed) return;
    try { void this.api.connect({ serverId, leaseId: "renderer-community" }).then(this.publish).catch(this.reportFailure); }
    catch { this.reportFailure(); }
  }
  /** App component remount/reload must not tear down a game session. */
  dispose(): void { this.disposed = true; this.ids.clear(); }
}

export interface CommunityLanAction {
  label: string;
  kind: "pending" | "connected" | "disabled" | "unconfigured" | "attention" | "error";
  message: string;
  prepare: boolean;
  retry: boolean;
  retryLabel: string;
}

export function easyTierCommunityAction(state: EasyTierCommunityState | undefined, enabled = true): CommunityLanAction {
  const voice = "联机与社区语音独立；实际语音状态请查看频道。";
  const view = (label: string, kind: CommunityLanAction["kind"], message: string,
    prepare = false, retry = false, retryLabel = "重试"): CommunityLanAction => ({label, kind, message, prepare, retry, retryLabel});
  if (!enabled && state && ["connected", "connecting", "disconnecting"].includes(state.phase))
    return view("正在关闭", "pending", `正在关闭社区联机，等待组件确认退出。${voice}`);
  if ((!enabled && !(state?.phase === "error" && state.reason === "cleanup-failed")) || state?.phase === "disabled")
    return view("已关闭", "disabled", `社区联机已关闭。关闭联机不会关闭语音聊天。${voice}`);
  if (!state) return view("读取中", "pending", `正在读取社区联机状态…${voice}`);
  if (state.phase === "connected") return view("已连接", "connected", `${state.virtualIp ? `社区联机已连接 · ${state.virtualIp}。` : "社区联机已连接。"}${voice}`);
  if (state.phase === "connecting") return view("连接中", "pending", `正在连接社区联机…${voice}`);
  if (state.phase === "disconnecting") return view("正在关闭", "pending", `正在关闭社区联机…${voice}`);
  const messages: Record<string, string> = {
    "configuration-required": "这个社区尚未提供已授权的联机配置，请联系社区管理员开通。语音聊天可继续使用。",
    "activation-required": "社区联机等待管理员开通。语音聊天可继续使用。",
    "needs-permission": "本次联机尚未取得本机同意或 Windows 系统权限。点击重试可重新确认；应用不会自行提权或绕过系统确认，聊天窗口保持普通权限，语音聊天可继续使用。",
    "runtime-required": "本版本缺少可用的联机组件。请安装包含联机组件的应用版本；准备文件不会安装驱动或连接网络，语音聊天可继续使用。",
    "multi-community-unavailable": "当前版本同时支持一个社区联机。退出原社区联机后可重试，正在运行的游戏网络会保持连接。",
    "unsupported-target": "当前联机组件无法使用，请准备受支持的组件。语音聊天可继续使用。",
    "cleanup-failed": "联机连接尚未确认退出，请重试或关闭应用后再打开。语音聊天可继续使用。",
  };
  const reason = state.reason;
  const message = (text: string) => text.replace("语音聊天可继续使用。", voice);
  if (reason === "configuration-required" || reason === "activation-required" || (state.phase === "activation-required" && !reason))
    return view("待开通", "unconfigured", message(messages[reason || "activation-required"]), false, true, "刷新配置");
  if (reason === "runtime-required" || reason === "unsupported-target")
    return view("缺少组件", "attention", message(messages[reason]), true);
  if (reason === "needs-permission" || reason === "multi-community-unavailable")
    return view(reason === "needs-permission" ? "待授权" : "暂不可用", "attention", message(messages[reason]), false, true);
  const failures: Record<string, string> = {
    "connect-failed": "社区联机连接失败，请重试。",
    "operation-timeout": "社区联机操作超时，请重试。",
    "status-unavailable": "暂时无法读取联机状态，请重试。",
    "runtime-exited": "联机组件已退出，请重试。",
  };
  return view(reason === "cleanup-failed" ? "退出异常" : "联机异常", "error",
    messages[reason ?? ""] ? message(messages[reason!]) : `${failures[reason ?? ""] ?? "社区联机暂时不可用，可以重试。"}${voice}`, false, true,
    reason === "cleanup-failed" ? "重试退出" : "重试");
}
