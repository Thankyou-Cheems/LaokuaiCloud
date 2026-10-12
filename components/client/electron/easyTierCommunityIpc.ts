import type { EasyTierCommunityLease } from "../src/lib/easyTierCommunity";
import { EasyTierCommunityManager, EasyTierSessionRetiredError, validEasyTierId, validEasyTierLease } from "./easyTierCommunityManager";

interface IpcEvent { senderFrame: unknown }
interface IpcPort {
  handle(channel: string, listener: (event: IpcEvent, value: unknown) => unknown): void;
  removeHandler(channel: string): void;
}
/** Only the trusted top-level renderer may request community leases. */
export function registerEasyTierCommunityIpc(ipc: IpcPort, manager: EasyTierCommunityManager, trusted: (event: IpcEvent) => boolean,
  prepareRuntime: () => Promise<{ ready: boolean }> = async () => ({ ready: false }),
  authenticate?: (value: unknown) => Promise<{serverId: string; changed: boolean; authenticated: boolean}>, previewDisabled = false,
  provisioning?: {mode():Promise<"normal"|"needs-consent">;approve(serverId:string):Promise<{accepted:boolean;reason?:"needs-permission"}>}): () => void {
  const handlers: Record<string, (value: unknown) => unknown> = {
    "et-community-mode": () => previewDisabled ? "preview-disabled" : provisioning?.mode() ?? "normal",
    "et-community-consent": value => {if(previewDisabled||!provisioning||!validEasyTierId(value))throw Error("community-consent-unavailable");return provisioning.approve(value);},
    "et-community-connect": value => { if (!validEasyTierLease(value)) throw new Error("invalid-community-lease"); return manager.connect(value as EasyTierCommunityLease); },
    "et-community-disconnect": value => { if (!validEasyTierLease(value)) throw new Error("invalid-community-lease"); return manager.disconnect(value as EasyTierCommunityLease); },
    "et-community-disconnect-all": value => { if (!validEasyTierId(value)) throw new Error("invalid-community-id"); return manager.disconnectCommunity(value); },
    "et-community-enabled": value => { if (typeof value !== "boolean") throw new Error("invalid-enabled-value"); return manager.setEnabled(value); },
    "et-community-state": value => { if (!validEasyTierId(value)) throw new Error("invalid-community-id"); return manager.getState(value); },
    "et-community-prepare": () => prepareRuntime(),
    "et-community-authenticated-session": async value => {
      if (!authenticate) throw new Error("community-auth-unavailable");
      let result;
      try { result = await authenticate(value); }
      catch (error) {
        if (error instanceof EasyTierSessionRetiredError && value && typeof value === "object" &&
            validEasyTierId((value as {serverId?: unknown}).serverId))
          await manager.authenticatedSessionChanged((value as {serverId: string}).serverId);
        throw error;
      }
      return result.changed ? manager.authenticatedSessionChanged(result.serverId) : manager.getState(result.serverId);
    },
    "et-community-memberships": value => {
      if (!Array.isArray(value) || value.length > 64 || !value.every(validEasyTierId)) throw new Error("invalid-community-memberships");
      return manager.syncMemberships(value);
    },
  };
  for (const [channel, handle] of Object.entries(handlers)) ipc.handle(channel, (event, value) => {
    if (!trusted(event)) throw new Error("untrusted-community-request");
    return handle(value);
  });
  return () => { for (const channel of Object.keys(handlers)) ipc.removeHandler(channel); };
}
