import { createSocket, type Socket as DatagramSocket } from 'node:dgram';
import { createServer, type Server, type Socket } from 'node:net';

export const COMMUNITY_DNS_ADDRESS = '127.0.0.153';
export const communityDnsZone = (value: unknown): value is string =>
  typeof value === 'string' && /^c-[0-9a-f]{32}\.lan\.voice\.ruikang\.wang\.$/.test(value);
export interface CommunityDnsDirectory {
  v: 1; communityId: string;
  dns: {zone: string; serverTimeMs: number; maxAgeMs: number};
  members: Array<{serverUserId: string; virtualIp: string; dnsName: string; dnsExpiresAtMs: number}>;
}
interface RecordEntry { address: number[]; monoDeadline: number; wallDeadline: number }
interface Zone { communityId: string; records: Map<string, RecordEntry>; monoDeadline: number; wallDeadline: number }
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).length === keys.length &&
  keys.every(key => Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
const natural = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function ipv4(value: unknown): number[] | null {
  if (typeof value !== 'string') return null;
  const parts = value.split('.').map(Number);
  return parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255) &&
    parts.join('.') === value && (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)) ? parts : null;
}
/** Authenticated HTTPS only. DNS records never come from peer advertisements. */
export function parseCommunityDnsDirectory(raw: unknown, communityId: string): CommunityDnsDirectory {
  const fail = (): never => { throw new Error('invalid-community-dns-directory'); };
  if (!exact(raw, ['v', 'communityId', 'dns', 'members']) || raw.v !== 1 || raw.communityId !== communityId ||
      !exact(raw.dns, ['zone', 'serverTimeMs', 'maxAgeMs']) || !communityDnsZone(raw.dns.zone) ||
      !natural(raw.dns.serverTimeMs) || raw.dns.serverTimeMs === 0 || !natural(raw.dns.maxAgeMs) || raw.dns.maxAgeMs < 1 || raw.dns.maxAgeMs > 10_000 ||
      !Array.isArray(raw.members) || raw.members.length > 254 || Reflect.ownKeys(raw.members).length !== raw.members.length + 1) return fail();
  const names = new Set<string>(), addresses = new Set<string>();
  for (let index = 0; index < raw.members.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw.members, String(index));
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return fail();
    const member: unknown = descriptor.value;
    if (!exact(member, ['serverUserId', 'virtualIp', 'dnsName', 'dnsExpiresAtMs']) ||
        typeof member.serverUserId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(member.serverUserId) ||
        !ipv4(member.virtualIp) || typeof member.dnsName !== 'string' ||
        !/^d-[0-9a-f]{32}\./.test(member.dnsName) || member.dnsName.slice(35) !== raw.dns.zone ||
        !natural(member.dnsExpiresAtMs) || member.dnsExpiresAtMs <= raw.dns.serverTimeMs ||
        member.dnsExpiresAtMs - raw.dns.serverTimeMs > raw.dns.maxAgeMs ||
        names.has(member.dnsName) || addresses.has(member.virtualIp as string)) return fail();
    names.add(member.dnsName); addresses.add(member.virtualIp as string);
  }
  return structuredClone(raw) as unknown as CommunityDnsDirectory;
}

/** Small authoritative, non-recursive resolver. TTL checked on every query, even if timers stall. */
export class CommunityDnsRecords {
  private zones = new Map<string, Zone>();
  private previousClock: {mono: number; wall: number} | null = null;
  constructor(private monoMs = () => performance.now(), private wallMs = () => Date.now()) {}
  private clock(): {mono: number; wall: number} {
    const now = {mono: this.monoMs(), wall: this.wallMs()};
    if (!Number.isFinite(now.mono) || !Number.isSafeInteger(now.wall) || now.mono < 0 || now.wall <= 0 ||
      (this.previousClock && (now.mono < this.previousClock.mono || now.wall < this.previousClock.wall))) {
      this.zones.clear(); this.previousClock = null; throw new Error('dns-clock-retired');
    }
    this.previousClock = now; return now;
  }
  replace(raw: unknown, communityId: string, requestMono: number, requestWall: number): string {
    const directory = parseCommunityDnsDirectory(raw, communityId), now = this.clock();
    if (!Number.isFinite(requestMono) || !Number.isSafeInteger(requestWall) || requestMono < 0 || requestWall <= 0 || requestMono > now.mono || requestWall > now.wall)
      throw new Error('dns-request-retired');
    const elapsed = Math.max(now.mono - requestMono, now.wall - requestWall);
    if (elapsed > 1000 || elapsed >= directory.dns.maxAgeMs) throw new Error('dns-request-retired');
    const prior = this.zones.get(directory.dns.zone);
    if (prior && prior.communityId !== communityId) throw new Error('dns-zone-collision');
    this.clear(communityId);
    const records = new Map<string, RecordEntry>();
    for (const row of directory.members) {
      const ttl = row.dnsExpiresAtMs - directory.dns.serverTimeMs - elapsed;
      if (ttl > 0) records.set(row.dnsName, {address: ipv4(row.virtualIp)!, monoDeadline: now.mono + ttl, wallDeadline: now.wall + ttl});
    }
    this.zones.set(directory.dns.zone, {communityId, records,
      monoDeadline: now.mono + directory.dns.maxAgeMs - elapsed, wallDeadline: now.wall + directory.dns.maxAgeMs - elapsed});
    return directory.dns.zone;
  }
  clear(communityId: string): void {
    for (const [name, value] of this.zones) if (value.communityId === communityId) this.zones.delete(name);
  }
  clearAll(): void { this.zones.clear(); }
  hasFreshZone(communityId: string, zone: string): boolean {
    let now: {mono: number; wall: number};
    try { now = this.clock(); } catch { return false; }
    const value = this.zones.get(zone);
    return !!value && value.communityId === communityId && now.mono < value.monoDeadline && now.wall < value.wallDeadline;
  }
  answer(packet: Buffer): Buffer | null {
    // No reflection of responses, multiple questions, compressed/malformed names or unbounded TCP messages.
    if (packet.length < 12 || packet.length > 512 || (packet.readUInt16BE(2) & ~0x0130) !== 0 ||
      packet.readUInt16BE(4) !== 1 || packet.readUInt16BE(6) !== 0 || packet.readUInt16BE(8) !== 0 || packet.readUInt16BE(10) > 1) return null;
    let offset = 12; const labels: string[] = [];
    while (offset < packet.length && packet[offset] !== 0) {
      const size = packet[offset++];
      if (size > 63 || offset + size >= packet.length) return null;
      // ASCII decoding masks high bits, which could turn a malformed octet into
      // a trusted alias. Latin-1 preserves it so the ASCII grammar rejects it.
      const label = packet.subarray(offset, offset + size).toString('latin1');
      if (!/^[A-Za-z0-9-]+$/.test(label)) return null;
      labels.push(label.toLowerCase()); offset += size;
    }
    if (offset + 5 > packet.length) return null;
    const name = labels.join('.') + '.'; if (name.length > 253) return null;
    offset++;
    const type = packet.readUInt16BE(offset), klass = packet.readUInt16BE(offset + 2); offset += 4;
    // Accept one structurally valid EDNS0 OPT; never echo its data/options.
    if (packet.readUInt16BE(10) === 0) { if (offset !== packet.length) return null; }
    else {
      const opt = offset;
      if (opt + 11 > packet.length || packet[opt] !== 0 || packet.readUInt16BE(opt + 1) !== 41 ||
          packet.readUInt16BE(opt + 3) < 512 || (packet.readUInt32BE(opt + 5) & ~0x8000) !== 0 ||
          opt + 11 + packet.readUInt16BE(opt + 9) !== packet.length) return null;
      let cursor = opt + 11;
      while (cursor < packet.length) {
        if (cursor + 4 > packet.length) return null;
        const length = packet.readUInt16BE(cursor + 2); cursor += 4 + length;
        if (cursor > packet.length) return null;
      }
    }
    let code = 5, record: RecordEntry | undefined;
    let now: {mono: number; wall: number};
    try { now = this.clock(); } catch { now = {mono: Infinity, wall: Infinity}; }
    for (const [zone, value] of this.zones) {
      if (name !== zone && !name.endsWith('.' + zone)) continue;
      code = now.mono >= value.monoDeadline || now.wall >= value.wallDeadline ? 2 : 0;
      if (code === 0) {
        record = value.records.get(name);
        if (record && (now.mono >= record.monoDeadline || now.wall >= record.wallDeadline)) record = undefined;
        if (!record) code = 3;
      }
      break;
    }
    if (klass !== 1) { code = 5; record = undefined; }
    const hasAnswer = code === 0 && type === 1 && !!record;
    const header = Buffer.alloc(12); packet.copy(header, 0, 0, 2);
    header.writeUInt16BE(0x8400 | (packet.readUInt16BE(2) & 0x0100) | code, 2);
    header.writeUInt16BE(1, 4); header.writeUInt16BE(hasAnswer ? 1 : 0, 6);
    const question = packet.subarray(12, offset);
    if (!hasAnswer) return Buffer.concat([header, question]);
    const answer = Buffer.alloc(16); answer.writeUInt16BE(0xc00c, 0); answer.writeUInt16BE(1, 2); answer.writeUInt16BE(1, 4);
    answer.writeUInt32BE(Math.max(0, Math.min(1, Math.floor(Math.min(record!.monoDeadline - now.mono, record!.wallDeadline - now.wall) / 1000))), 6);
    answer.writeUInt16BE(4, 10); Buffer.from(record!.address).copy(answer, 12);
    return Buffer.concat([header, question, answer]);
  }
}

export class CommunityDnsListener {
  private udp: DatagramSocket | null = null;
  private tcp: Server | null = null;
  private clients = new Set<Socket>();
  private generation = 0;
  private stopping: Promise<void> | null = null;
  private failures = new Set<() => void>();
  constructor(readonly records: CommunityDnsRecords) {}
  onFailure(callback: () => void): () => void { this.failures.add(callback); return () => this.failures.delete(callback); }
  private close(resource: DatagramSocket | Server | null): Promise<void> {
    return new Promise(resolve => { try { if (resource) resource.close(() => resolve()); else resolve(); } catch { resolve(); } });
  }
  async start(port = 53): Promise<void> {
    if (this.stopping) await this.stopping;
    if (this.udp || this.tcp) throw new Error('dns-already-started');
    const generation = ++this.generation;
    let udp: DatagramSocket | null = null, tcp: Server | null = null;
    try {
      udp = createSocket('udp4'); this.udp = udp;
      tcp = createServer(); this.tcp = tcp;
      const current = () => this.generation === generation && this.udp === udp && this.tcp === tcp;
      const failed = () => {
        if (!current()) return;
        this.records.clearAll();
        for (const callback of this.failures) { try { callback(); } catch { /* observer cannot prevent cleanup */ } }
        void this.stop().catch(() => undefined);
      };
      // Keep permanent handlers during startup as well as after listen().
      udp.on('error', failed); tcp.on('error', failed);
      let windowStart = performance.now(), requests = 0;
      const answer = (packet: Buffer): Buffer | null => {
        if (performance.now() - windowStart >= 1000) { windowStart = performance.now(); requests = 0; }
        if (++requests > 500) return null;
        return this.records.answer(packet);
      };
      udp.on('message', (packet, remote) => {
        if (!current() || !remote.address.startsWith('127.')) return;
        const response = answer(packet); if (response) udp!.send(response, remote.port, remote.address, () => undefined);
      });
      tcp.on('connection', socket => {
        if (!current() || this.clients.size >= 8 || !socket.remoteAddress?.startsWith('127.')) { socket.destroy(); return; }
        this.clients.add(socket); socket.setTimeout(2000, () => socket.destroy());
        socket.on('error', () => socket.destroy()); socket.once('close', () => this.clients.delete(socket));
        let buffered = Buffer.alloc(0), handled = false;
        socket.on('data', chunk => {
          if (handled || buffered.length + chunk.length > 514) { socket.destroy(); return; }
          buffered = Buffer.concat([buffered, chunk]); if (buffered.length < 2) return;
          const size = buffered.readUInt16BE(0);
          if (size < 12 || size > 512 || buffered.length > size + 2) { socket.destroy(); return; }
          if (buffered.length !== size + 2) return;
          handled = true; const response = answer(buffered.subarray(2));
          if (!response) { socket.destroy(); return; }
          const header = Buffer.alloc(2); header.writeUInt16BE(response.length); socket.end(Buffer.concat([header, response]));
        });
      });
      await new Promise<void>((resolve, reject) => {
        const retired = () => reject(new Error('dns-listener-retired'));
        udp!.once('error', reject); udp!.once('close', retired);
        udp!.bind(port, COMMUNITY_DNS_ADDRESS, () => {
          udp!.removeListener('error', reject); udp!.removeListener('close', retired);
          if (!current()) { void this.close(udp); retired(); } else resolve();
        });
      });
      const actualPort = udp.address().port;
      await new Promise<void>((resolve, reject) => {
        const retired = () => reject(new Error('dns-listener-retired'));
        tcp!.once('error', reject); tcp!.once('close', retired);
        tcp!.listen(actualPort, COMMUNITY_DNS_ADDRESS, () => {
          tcp!.removeListener('error', reject); tcp!.removeListener('close', retired);
          if (!current()) { void this.close(tcp); retired(); } else resolve();
        });
      });
    } catch (error) {
      if (this.generation === generation) await this.stop();
      else await Promise.all([this.close(udp), this.close(tcp)]);
      throw error;
    }
  }
  get port(): number | null { try { return this.udp?.address().port ?? null; } catch { return null; } }
  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.generation++;
    const udp = this.udp, tcp = this.tcp; this.udp = null; this.tcp = null; this.records.clearAll();
    for (const client of this.clients) client.destroy(); this.clients.clear();
    const work = Promise.all([this.close(udp), this.close(tcp)]).then(() => undefined); this.stopping = work;
    try { await work; } finally { if (this.stopping === work) this.stopping = null; }
  }
}
