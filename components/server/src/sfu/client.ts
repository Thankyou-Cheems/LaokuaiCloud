import WebSocket from 'ws';
import { consola } from 'consola';
import { SFURoomManager } from './clientRooms';
import type { SfuMoveCommand, SfuMovePhase, SfuMoveResult } from './moveProtocol';
import { randomUUID } from 'node:crypto';
import { enforceAudioOnly } from './audioOnly';
import type { SfuHybridCommand, SfuHybridResult } from './hybridProtocol';

interface WebSocketMessage {
  event: string;
  data: string;
}

export interface SFUPeerEvent {
  roomId: string;
  userId: string;
}

export interface SFUSyncRoom {
  room_id: string;
  user_ids: string[];
}

export interface SFUEventCallbacks {
  onPeerJoined?: (event: SFUPeerEvent) => void;
  onPeerLeft?: (event: SFUPeerEvent) => void;
  onSyncResponse?: (rooms: SFUSyncRoom[]) => void;
}

export class SFUClient {
  private hybridPending = new Map<string, { resolve: (value: SfuHybridResult) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  /** Actual registered-SFU ACK; an unknown response never becomes "supported". */
  requestHybrid(request: SfuHybridCommand): Promise<SfuHybridResult> {
    if (!this.isConnected() || this.hybridPending.size >= 512) return Promise.reject(new Error('hybrid_sfu_unavailable'));
    const commandId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.hybridPending.delete(commandId); reject(new Error('hybrid_sfu_ack_timeout')); }, 5000);
      this.hybridPending.set(commandId, { resolve, reject, timer });
      try { this.ws!.send(JSON.stringify({ event: 'hybrid_command', data: JSON.stringify({ ...request,
        command_id: commandId, server_id: this.serverId, server_password: this.serverToken }) })); }
      catch { clearTimeout(timer); this.hybridPending.delete(commandId); reject(new Error('hybrid_sfu_unavailable')); }
    });
  }
  private ws: WebSocket | null = null;
  private serverId: string;
  private serverToken: string;
  private sfuHost: string;
  private reconnectAttempts = 0;
  private reconnectDelay = 10000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldReconnect = true;
  private healthInterval: NodeJS.Timeout | null = null;
  private syncInterval: NodeJS.Timeout | null = null;
  private connectionHealth = {
    lastPing: 0,
    isHealthy: true,
  };
  private roomManager: SFURoomManager;
  private callbacks: SFUEventCallbacks = {};
  private moveSupport = false;
  private moveSupportAt = 0;
  private moveProbe: Promise<boolean> | null = null;
  async supportsAtomicMove(): Promise<boolean> {
    if (!this.isConnected()) return false;
    if (Date.now() - this.moveSupportAt < 10_000) return this.moveSupport;
    if (this.moveProbe) return this.moveProbe;
    this.moveProbe = this.requestMove('probe', { request_id: randomUUID(), user_id: '', source_room_id: '',
      destination_room_id: '', socket_id: '', nonce: '', expires_at_ms: 0, capabilities: [], is_muted: false, is_deafened: false })
      .then(r => this.moveSupport = r.status === 'supported', () => this.moveSupport = false)
      .finally(() => { this.moveSupportAt = Date.now(); this.moveProbe = null; });
    return this.moveProbe;
  }
  private movePending = new Map<string, { requestId: string; resolve: (r: SfuMoveResult) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

  /** A missing ack is an unknown outcome. Callers must query before declaring failure. */
  requestMove(phase: SfuMovePhase, request: SfuMoveCommand): Promise<SfuMoveResult> {
    if (!this.isConnected()) return Promise.reject(new Error('SFU unavailable'));
    const commandId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.movePending.delete(commandId);
        reject(new Error('SFU move acknowledgement timeout'));
      }, 5000);
      this.movePending.set(commandId, { requestId: request.request_id, resolve, reject, timer });
      try {
        this.ws!.send(JSON.stringify({ event: `move_${phase}`, data: JSON.stringify({
          ...request, command_id: commandId, server_id: this.serverId, server_password: this.serverToken,
        }) }));
      } catch (error) {
        clearTimeout(timer);
        this.movePending.delete(commandId);
        reject(error);
      }
    });
  }

  private rejectMoveRequests(): void {
    for (const pending of this.hybridPending.values()) { clearTimeout(pending.timer); pending.reject(new Error('hybrid_sfu_disconnected')); }
    this.hybridPending.clear();
    this.moveSupport = false; this.moveSupportAt = 0;
    for (const pending of this.movePending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('SFU disconnected; move outcome unknown'));
    }
    this.movePending.clear();
  }

  constructor(serverId: string, serverPassword: string, sfuHost: string) {
    this.serverId = serverId;
    this.serverToken = serverPassword;
    this.sfuHost = sfuHost;
    
    if (!serverId || !sfuHost) {
      throw new Error('SFU client requires serverId and sfuHost');
    }

    this.roomManager = new SFURoomManager(() => this.ws, serverId, serverPassword);
  }

  setCallbacks(cb: SFUEventCallbacks): void {
    this.callbacks = cb;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = this.buildWebSocketUrl();
        consola.info(`[SFU-Client:Step 1] Connecting to SFU server at ${wsUrl}`);
        
        this.ws = new WebSocket(wsUrl);
        this.shouldReconnect = true;

        const connectionTimeout = setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
            consola.error(`[SFU-Client:Step 1] Connection timeout (10s) to ${wsUrl}`);
            this.ws.terminate();
            reject(new Error('SFU connection timeout'));
          }
        }, 10000);

        this.ws.on('open', () => {
          clearTimeout(connectionTimeout);
          consola.success(`[SFU-Client:Step 2] Connected to SFU server at ${wsUrl}`);
          this.reconnectAttempts = 0;
          this.connectionHealth.isHealthy = true;
          this.startHealthCheck();
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          
          this.roomManager.reregisterRooms()
            .then(() => {
              if (this.roomManager.registeredRooms.size > 0) {
                this.roomManager.requestSync();
              }
            })
            .catch(error => {
              consola.error('[SFU-Client] Failed to re-register rooms after reconnection:', error);
            });
          
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const message: WebSocketMessage = JSON.parse(data.toString());
            this.handleMessage(message);
          } catch (error) {
            consola.error('[SFU-Client] Error parsing SFU message:', error);
          }
        });

        this.ws.on('close', (code, reason) => {
          clearTimeout(connectionTimeout);
          consola.warn(`[SFU-Client] Connection closed: code=${code} reason="${reason}"`);
          this.ws = null;
          this.connectionHealth.isHealthy = false;
          this.roomManager.onConnectionClosed();
          this.rejectMoveRequests();
          this.scheduleReconnect();
        });

        // ws stops aborting the handshake itself the moment this event has a listener,
        // so tearing the socket down and deciding what happens next is ours from here.
        this.ws.on('unexpected-response', (_req, res) => {
          clearTimeout(connectionTimeout);
          res.resume();

          const refused = this.ws;
          this.ws = null;
          refused?.removeAllListeners();
          refused?.on('error', () => {});
          refused?.terminate();

          if (res.statusCode === 403 && this.adoptControlPort(res.headers['x-gryt-control-port'])) {
            this.connect().then(resolve, reject);
            return;
          }

          const error = new Error(`SFU refused the connection with HTTP ${res.statusCode}`);
          consola.error('[SFU-Client] Connection error:', error);
          this.connectionHealth.isHealthy = false;
          if (this.reconnectAttempts === 0) {
            reject(error);
          }
          this.scheduleReconnect();
        });

        this.ws.on('error', (error) => {
          clearTimeout(connectionTimeout);
          consola.error('[SFU-Client] Connection error:', error);
          this.connectionHealth.isHealthy = false;
          
          if (this.reconnectAttempts === 0) {
            reject(error);
          }
          this.scheduleReconnect();
        });

      } catch (error) {
        consola.error('[SFU-Client] Failed to create connection:', error);
        reject(error);
      }
    });
  }

  private buildWebSocketUrl(): string {
    let url = this.sfuHost;
    
    if (url.startsWith('https://')) {
      url = url.replace('https://', 'wss://');
    } else if (url.startsWith('http://')) {
      url = url.replace('http://', 'ws://');
    } else if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      url = `wss://${url}`;
    }
    
    if (!url.endsWith('/server')) {
      url = url.replace(/\/$/, '') + '/server';
    }
    
    return url;
  }

  // An SFU that has moved registration to its own port says so when it refuses one on
  // the published port. Follow it, so upgrading an SFU needs no change on this side.
  private adoptControlPort(hinted: string | string[] | undefined): boolean {
    const value = Array.isArray(hinted) ? hinted[0] : hinted;
    const port = Number(value);

    if (!value || !Number.isInteger(port) || port < 1 || port > 65535) {
      return false;
    }

    // Only the port moves. Keeping the host means this can never send registration,
    // and the server password with it, somewhere the operator did not already point us.
    const url = new URL(this.buildWebSocketUrl());
    if (url.port === String(port)) {
      return false;
    }

    const previous = url.port || 'the default port';
    url.port = String(port);
    this.sfuHost = url.toString();

    consola.warn(
      `[SFU-Client] This SFU takes registration on port ${port}, not ${previous}. ` +
      `Using ${this.sfuHost} instead. Set SFU_WS_HOST to that so it does not have to be ` +
      `worked out again on every boot.`
    );
    return true;
  }

  private stopHealthCheck(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.connectionHealth.lastPing = Date.now();
    
    this.healthInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.connectionHealth.isHealthy = false;
        this.stopHealthCheck();
        return;
      }

      this.connectionHealth.isHealthy = true;
      try {
        const msg: WebSocketMessage = {
          event: 'keep_alive',
          data: JSON.stringify({ timestamp: Date.now(), server_id: this.serverId }),
        };
        this.ws.send(JSON.stringify(msg));
      } catch {
        this.connectionHealth.isHealthy = false;
        this.stopHealthCheck();
      }
    }, 15000);

    // Two seconds, because a minute of disagreeing with the SFU is a bug report.
    // Cheap only while `onSyncResponse` fans out solely on an actual change.
    this.syncInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.roomManager.registeredRooms.size > 0) {
        this.roomManager.requestSync();
      }
    }, 2_000);
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) {
      consola.info('Reconnect disabled (manual shutdown). Skipping reconnect scheduling.');
      return;
    }

    if (this.reconnectTimer) return;

    this.reconnectAttempts++;
    const delay = this.reconnectDelay;
    consola.info(`Reconnecting to SFU in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((error) => {
        consola.error('SFU reconnection failed:', error);
        this.scheduleReconnect();
      });
    }, delay);
  }

  private handleMessage(message: WebSocketMessage): void {
    this.connectionHealth.lastPing = Date.now();
    
    switch (message.event) {
      case 'hybrid_result': {
        const result = JSON.parse(message.data) as SfuHybridResult;
        if (!result || !['supported', 'applied', 'failed'].includes(result.status)) return;
        const pending = this.hybridPending.get(result.command_id); if (!pending) return;
        clearTimeout(pending.timer); this.hybridPending.delete(result.command_id); pending.resolve(result); break;
      }
      case 'move_result': {
        const result = JSON.parse(message.data) as SfuMoveResult;
        if (!result || typeof result.request_id !== 'string' ||
            !['supported', 'prepared', 'ready', 'committed', 'aborted', 'failed'].includes(result.status)) return;
        const pending = this.movePending.get(result.command_id ?? '');
        if (!pending || pending.requestId !== result.request_id) return;
        clearTimeout(pending.timer);
        this.movePending.delete(result.command_id!);
        pending.resolve(result);
        break;
      }
      case 'room_joined':
        consola.success(`[SFU-Client] Room registration confirmed by SFU: ${message.data}`);
        break;
      case 'room_error':
        consola.error(`[SFU-Client] Room error from SFU: ${message.data}`);
        break;
      case 'peer_joined': {
        try {
          const data = JSON.parse(message.data) as { room_id: string; user_id: string };
          consola.info(`[SFU-Client] Peer joined: user=${data.user_id} room=${data.room_id}`);
          this.callbacks.onPeerJoined?.({ roomId: data.room_id, userId: data.user_id });
        } catch (e) {
          consola.error('[SFU-Client] Failed to parse peer_joined:', e);
        }
        break;
      }
      case 'peer_left': {
        try {
          const data = JSON.parse(message.data) as { room_id: string; user_id: string };
          consola.info(`[SFU-Client] Peer left: user=${data.user_id} room=${data.room_id}`);
          this.callbacks.onPeerLeft?.({ roomId: data.room_id, userId: data.user_id });
        } catch (e) {
          consola.error('[SFU-Client] Failed to parse peer_left:', e);
        }
        break;
      }
      case 'sync_response': {
        try {
          const data = JSON.parse(message.data) as { rooms: SFUSyncRoom[] };
          consola.info(`[SFU-Client] Sync response: ${data.rooms?.length ?? 0} rooms`);
          this.callbacks.onSyncResponse?.(data.rooms ?? []);
        } catch (e) {
          consola.error('[SFU-Client] Failed to parse sync_response:', e);
        }
        break;
      }
      case 'keep_alive':
        break;
      default:
        consola.debug(`[SFU-Client] Message: event=${message.event} data=${message.data}`);
    }
  }

  // ── Delegated room/user methods ───────────────────────────────────

  async registerRoom(roomId: string): Promise<void> {
    return this.roomManager.registerRoom(roomId);
  }

  async unregisterRoom(roomId: string): Promise<void> {
    return this.roomManager.unregisterRoom(roomId);
  }

  generateClientJoinToken(roomId: string, userId: string, capabilities: readonly string[], socketId?: string) {
    return this.roomManager.generateClientJoinToken(roomId, userId,
      enforceAudioOnly(socketId ? [...capabilities, `app_socket:${socketId}`] : capabilities));
  }

  async updateUserAudioState(roomId: string, userId: string, isMuted: boolean, isDeafened: boolean): Promise<void> {
    return this.roomManager.updateUserAudioState(roomId, userId, isMuted, isDeafened);
  }

  async setUserCapabilities(roomId: string, userId: string, capabilities: readonly string[]): Promise<void> {
    return this.roomManager.setUserCapabilities(roomId, userId, enforceAudioOnly(capabilities));
  }

  trackUserConnection(roomId: string, userId: string): boolean {
    return this.roomManager.trackUserConnection(roomId, userId);
  }

  untrackUserConnection(userId: string): void {
    this.roomManager.untrackUserConnection(userId);
  }

  getTrackedUser(userId: string): { roomId: string; userId: string; connectedAt: number } | undefined {
    return this.roomManager.getTrackedUser(userId);
  }

  getActiveUsers(): Map<string, { roomId: string; userId: string; connectedAt: number }> {
    return this.roomManager.getActiveUsers();
  }

  async disconnectUser(roomId: string, userId: string): Promise<void> {
    return this.roomManager.disconnectUser(roomId, userId);
  }

  async setHiddenPeers(roomId: string, userId: string, hidden: string[]): Promise<void> {
    return this.roomManager.setHiddenPeers(roomId, userId, hidden);
  }

  requestSync(): void {
    this.roomManager.requestSync();
  }

  isConnected(): boolean {
    return this.ws !== null && 
           this.ws.readyState === WebSocket.OPEN && 
           this.connectionHealth.isHealthy;
  }

  getConnectionStatus(): {
    connected: boolean;
    healthy: boolean;
    registeredRooms: number;
    roomsToReregister: number;
    reconnectAttempts: number;
  } {
    return {
      connected: this.ws?.readyState === WebSocket.OPEN || false,
      healthy: this.connectionHealth.isHealthy,
      registeredRooms: this.roomManager.registeredRooms.size,
      roomsToReregister: this.roomManager.roomsToReregister.size,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  disconnect(): void {
    this.rejectMoveRequests();
    this.shouldReconnect = false;
    this.stopHealthCheck();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      consola.info('Disconnecting from SFU server');
      this.ws.close(1000, 'Server shutdown');
      this.ws = null;
    }
    this.roomManager.onDisconnect();
    this.connectionHealth.isHealthy = false;
  }
}
