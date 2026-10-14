import { Server, Socket } from "socket.io";
import { Clients } from "../../types";
import { SFUClient } from "../../sfu/client";
import type { CommunityGrantApi } from "../../easytier/communityGrantApi";

/**
 * Shared context passed to every handler module.
 * This avoids each handler needing direct access to closure variables.
 */
export interface HandlerContext {
  io: Server;
  socket: Socket;
  clientId: string;
  serverId: string;
  clientsInfo: Clients;
  sfuClient: SFUClient | null;
  communityGrantService?: Pick<CommunityGrantApi, "binding"> | null;
  getClientIp: () => string;
  /** Whether getClientIp's answer is this client's own address rather than a
   *  proxy's. Only trust an address for an access decision when this is true. */
  clientAddressIsOwn: () => boolean;
}

type SocketListener = Parameters<Socket["on"]>[1];
export type EventHandlerMap = Record<string, SocketListener>;
