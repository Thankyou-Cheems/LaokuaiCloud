import type { EasyTierCommunityLease } from "../src/lib/easyTierCommunity";
import { EasyTierCommunityManager, validEasyTierId, validEasyTierLease } from "./easyTierCommunityManager";

interface IpcEvent { senderFrame: unknown }
interface IpcPort {
  handle(channel: string, listener: (event: IpcEvent, value: unknown) => unknown): void;
  removeHandler(channel: string): void;
}
/** Only the trusted top-level renderer may request community leases. */
export function registerEasyTierCommunityIpc(ipc: IpcPort, manager: EasyTierCommunityManager, trusted: (event: IpcEvent) => boolean): () => void {
  const handlers: Record<string, (value: unknown) => unknown> = {
    "et-community-connect": value => { if (!validEasyTierLease(value)) throw new Error("invalid-community-lease"); return manager.connect(value as EasyTierCommunityLease); },
    "et-community-disconnect": value => { if (!validEasyTierLease(value)) throw new Error("invalid-community-lease"); return manager.disconnect(value as EasyTierCommunityLease); },
    "et-community-disconnect-all": value => { if (!validEasyTierId(value)) throw new Error("invalid-community-id"); return manager.disconnectCommunity(value); },
    "et-community-enabled": value => { if (typeof value !== "boolean") throw new Error("invalid-enabled-value"); return manager.setEnabled(value); },
    "et-community-state": value => { if (!validEasyTierId(value)) throw new Error("invalid-community-id"); return manager.getState(value); },
  };
  for (const [channel, handle] of Object.entries(handlers)) ipc.handle(channel, (event, value) => {
    if (!trusted(event)) throw new Error("untrusted-community-request");
    return handle(value);
  });
  return () => { for (const channel of Object.keys(handlers)) ipc.removeHandler(channel); };
}
