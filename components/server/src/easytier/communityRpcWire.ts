/** EasyTier 8b7f1f0 standalone RPC wire, derived from pinned common.proto,
 * packet/mod.rs, tunnel/framed.rs, rpc/client.rs and rpc/standalone.rs.
 * This is not gRPC or HTTP. Construction performs no network I/O.
 */
import { createConnection, type Socket } from 'node:net';

import { exact, fail, natural, positive, uuid } from './communityGrant';

export type PbValue = bigint | Buffer;
export type PbFields = Map<number, PbValue[]>;
export function pbVarint(value: number | bigint): Buffer {
  let n = BigInt(value); if (n < BigInt('0') || n > BigInt('0xffffffffffffffff')) fail('rpc-invalid-integer');
  const bytes: number[] = [];
  do { bytes.push(Number(n & BigInt('127')) | (n > BigInt('127') ? 128 : 0)); n >>= BigInt('7'); } while (n);
  return Buffer.from(bytes);
}
export function pbNumber(field: number, value: number | bigint): Buffer {
  return Buffer.concat([pbVarint(field * 8), pbVarint(value)]);
}
export function pbBytes(field: number, value: Buffer): Buffer {
  return Buffer.concat([pbVarint(field * 8 + 2), pbVarint(value.length), value]);
}
export function pbString(field: number, value: string): Buffer { return pbBytes(field, Buffer.from(value, 'utf8')); }
export function pbDecode(buffer: Buffer, schema: Readonly<Record<number, number>>, repeat: readonly number[] = []): PbFields {
  if (buffer.length > 262144) fail('rpc-size-limit');
  let offset = 0; const fields: PbFields = new Map();
  const read = (): bigint => {
    let result = BigInt('0');
    for (let shift = BigInt('0'); shift <= BigInt('63'); shift += BigInt('7')) {
      if (offset >= buffer.length) fail('rpc-truncated');
      const b = buffer[offset++];
      if (shift === BigInt('63') && b > 1) fail('rpc-invalid-integer');
      result |= BigInt(b & 127) << shift;
      if (!(b & 128)) return result;
    }
    return fail('rpc-invalid-integer');
  };
  while (offset < buffer.length) {
    const tag = read(); const field = Number(tag >> BigInt('3')), wire = Number(tag & BigInt('7'));
    if (!field || schema[field] !== wire || (fields.has(field) && !repeat.includes(field))) fail('rpc-schema-mismatch');
    let value: PbValue;
    if (wire === 0) value = read();
    else {
      const length = wire === 2 ? Number(read()) : wire === 5 ? 4 : wire === 1 ? 8 : -1;
      if (!natural(length) || offset + length > buffer.length) fail('rpc-truncated');
      value = buffer.subarray(offset, offset + length); offset += length;
    }
    const values = fields.get(field) ?? []; values.push(value); fields.set(field, values);
    if (values.length > 4096) fail('rpc-size-limit');
  }
  return fields;
}
export function pbGetBytes(fields: PbFields, key: number): Buffer {
  const value = fields.get(key)?.[0];
  if (value === undefined) return Buffer.alloc(0);
  if (!Buffer.isBuffer(value)) fail('rpc-schema-mismatch');
  return value;
}
export function pbGetString(fields: PbFields, key: number): string {
  const bytes = pbGetBytes(fields, key); const value = bytes.toString('utf8');
  if (!Buffer.from(value, 'utf8').equals(bytes)) fail('rpc-invalid-string');
  return value;
}
export function pbGetNumber(fields: PbFields, key: number): number {
  const value = fields.get(key)?.[0] ?? BigInt('0');
  if (typeof value !== 'bigint' || value > BigInt(Number.MAX_SAFE_INTEGER)) fail('rpc-invalid-integer');
  return Number(value);
}
export function pbGetBool(fields: PbFields, key: number): boolean {
  const n = pbGetNumber(fields, key); if (n !== 0 && n !== 1) fail('rpc-schema-mismatch'); return n === 1;
}
export function pbRepeatedBytes(fields: PbFields, key: number): Buffer[] {
  return (fields.get(key) ?? []).map(v => { if (!Buffer.isBuffer(v)) fail('rpc-schema-mismatch'); return v; });
}
/** UUID parts are the four big-endian u32 words of uuid.as_u64_pair(). */
export function pbInstance(instance: string): Buffer {
  if (!uuid(instance)) fail('invalid-admin-instance');
  const bytes = Buffer.from(instance.replace(/-/g, ''), 'hex');
  const parts = Array.from({length: 4}, (_, i) => pbNumber(i + 1, bytes.readUInt32BE(i * 4)));
  return pbBytes(1, Buffer.concat(parts));
}
export interface RpcMethod { service: 'CredentialManageRpc' | 'PeerManageRpc'; index: number }
export interface CommunityRpcTransport { call(method: RpcMethod, request: Buffer): Promise<Buffer> }
export interface RpcEndpoint { host: '127.0.0.1' | '::1'; port: number; timeoutMs: number }
export interface RpcByteChannel {
  write(bytes: Buffer): void;
  onData(listener: (bytes: Buffer) => void): void;
  onError(listener: () => void): void;
  onClose(listener: () => void): void;
  close(): void;
}
export type RpcDialer = (endpoint: RpcEndpoint) => Promise<RpcByteChannel>;
export const dialLoopbackRpc: RpcDialer = endpoint => new Promise((resolve, reject) => {
  const socket: Socket = createConnection({host: endpoint.host, port: endpoint.port});
  const timer = setTimeout(() => { socket.destroy(); reject(new Error('rpc-unavailable')); }, endpoint.timeoutMs);
  const failed = () => { clearTimeout(timer); reject(new Error('rpc-unavailable')); };
  socket.once('error', failed);
  socket.once('connect', () => {
    clearTimeout(timer); socket.removeListener('error', failed);
    resolve({write: data => { socket.write(data); }, onData: fn => { socket.on('data', fn); },
      onError: fn => { socket.on('error', fn); }, onClose: fn => { socket.on('close', fn); }, close: () => { socket.destroy(); }});
  });
});
export function buildRpcFrame(method: RpcMethod, request: Buffer, transaction: number, timeoutMs: number): Buffer {
  // ServiceDescriptor.proto_name() is the protobuf service name, not its package.
  const descriptor = Buffer.concat([pbString(2, method.service), pbString(3, method.service), pbNumber(4, method.index)]);
  const body = Buffer.concat([pbBytes(2, request), pbNumber(3, timeoutMs)]);
  const packet = Buffer.concat([pbNumber(1, 1), pbNumber(2, 1), pbNumber(3, transaction), pbBytes(4, descriptor),
    pbBytes(5, body), pbNumber(6, 1), pbNumber(7, 1), pbBytes(10, Buffer.concat([pbNumber(1, 1), pbNumber(2, 1)]))]);
  if (packet.length + 16 > 2000) fail('rpc-size-limit');
  const header = Buffer.alloc(20); header.writeUInt32LE(packet.length + 16); header.writeUInt32LE(1, 4);
  header.writeUInt32LE(1, 8); header[12] = 8; header[14] = 1; header.writeUInt32LE(packet.length, 16);
  return Buffer.concat([header, packet]);
}
export class CommunityTcpRpcTransport implements CommunityRpcTransport {
  #endpoint: RpcEndpoint; #dial: RpcDialer; #transaction = 0;
  constructor(endpoint: RpcEndpoint, dial: RpcDialer = dialLoopbackRpc) {
    exact<RpcEndpoint>(endpoint, ['host', 'port', 'timeoutMs'], 'invalid-rpc-endpoint');
    if (!['127.0.0.1', '::1'].includes(endpoint.host) || !positive(endpoint.port) || endpoint.port > 65535 ||
        !positive(endpoint.timeoutMs) || endpoint.timeoutMs > 10000) fail('invalid-rpc-endpoint');
    this.#endpoint = {...endpoint}; this.#dial = dial;
  }
  async call(method: RpcMethod, request: Buffer): Promise<Buffer> {
    // Pinned code generator assigns one-based method indices (i + 1).
    if (!['CredentialManageRpc', 'PeerManageRpc'].includes(method.service) || !positive(method.index) ||
        method.index > (method.service === 'CredentialManageRpc' ? 4 : 8)) fail('invalid-rpc-method');
    const transaction = ++this.#transaction;
    if (!positive(transaction)) fail('rpc-invalid-integer');
    const frame = buildRpcFrame(method, request, transaction, this.#endpoint.timeoutMs);
    let channel: RpcByteChannel;
    try { channel = await this.#dial(this.#endpoint); } catch { return fail('rpc-unavailable'); }
    return new Promise<Buffer>((resolve, reject) => {
      let settled = false, buffered: Buffer = Buffer.alloc(0), total = 0, size = 0;
      const pieces = new Map<number, Buffer>();
      const finish = (code: string | null, result?: Buffer, nativeErrorKind?: string) => {
        if (settled) return; settled = true; clearTimeout(timer); channel.close();
        if (code) reject(Object.assign(new Error(code), nativeErrorKind ? {nativeErrorKind} : {})); else resolve(result!);
      };
      const timer = setTimeout(() => finish('rpc-outcome-unknown'), this.#endpoint.timeoutMs);
      channel.onError(() => finish('rpc-outcome-unknown')); channel.onClose(() => finish('rpc-outcome-unknown'));
      channel.onData(data => {
        if (settled) return;
        try {
          if (buffered.length + data.length > 262144) fail('rpc-size-limit');
          buffered = Buffer.concat([buffered, data]);
          while (buffered.length >= 4) {
            const length = buffered.readUInt32LE();
            if (length < 16 || length > 2000) fail('rpc-frame-mismatch');
            if (buffered.length < length + 4) break;
            const packet = buffered.subarray(4, length + 4); buffered = buffered.subarray(length + 4);
            if (packet.readUInt32LE(0) !== 1 || packet.readUInt32LE(4) !== 1 || packet[8] !== 9 ||
                packet[9] !== 0 || packet.readUInt32LE(12) !== length - 16) fail('rpc-frame-mismatch');
            const fields = pbDecode(packet.subarray(16), {1:0,2:0,3:0,4:2,5:2,6:0,7:0,8:0,9:0,10:2});
            if (pbGetNumber(fields, 1) !== 1 || pbGetNumber(fields, 2) !== 1 || pbGetNumber(fields, 3) !== transaction || pbGetBool(fields, 6)) fail('rpc-response-mismatch');
            const descriptor = pbDecode(pbGetBytes(fields, 4), {1:2,2:2,3:2,4:0});
            if (pbGetString(descriptor, 1) !== '' || pbGetString(descriptor, 2) !== method.service ||
                pbGetString(descriptor, 3) !== method.service || pbGetNumber(descriptor, 4) !== method.index) fail('rpc-response-mismatch');
            const compression = pbDecode(pbGetBytes(fields, 10), {1:0,2:0});
            if (fields.has(10) && pbGetNumber(compression, 1) !== 1) fail('rpc-compression-unsupported');
            const count = pbGetNumber(fields, 7) || 1, index = pbGetNumber(fields, 8), body = pbGetBytes(fields, 5);
            if (count > 256 || index >= count || (total && count !== total) || pieces.has(index)) fail('rpc-piece-mismatch');
            total = count; size += body.length; if (size > 262144) fail('rpc-size-limit'); pieces.set(index, body);
            if (pieces.size === total) {
              const response = pbDecode(Buffer.concat(Array.from({length: total}, (_, i) => pieces.get(i)!)), {1:2,2:2,3:0});
              // Never include upstream error payload; it may contain credential/config text.
              if (response.has(2)) {
                const error = pbDecode(pbGetBytes(response, 2), {1:2,2:2,3:2,4:2,5:2,6:2,7:2,8:2});
                const kinds = ['unknown','other','invalid-method','invalid-service','decode','encode','execute','malformed','timeout'];
                const kind = error.size === 1 ? kinds[Array.from(error.keys())[0]] : 'unknown';
                finish('rpc-native-error', undefined, kind); return;
              }
              finish(null, Buffer.from(pbGetBytes(response, 1))); return;
            }
          }
        } catch { finish('rpc-invalid-response'); }
      });
      try { channel.write(frame); } catch { finish('rpc-outcome-unknown'); }
    });
  }
}
