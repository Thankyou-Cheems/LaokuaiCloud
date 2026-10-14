import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  communityIdentity, copiedScope, exact, fail, fingerprint, id, intent, keyBytes, natural, planCommunityCredentialOperation,
  positive, privateIpv4, recordShape, sameScope, scope, uuid,
  type CommunityGrantOperation, type CommunityGrantRecord, type CommunityGrantScope, type PrivateNativeCredentialReceipt,
  type TrustedCommunityIntent,
} from './communityGrant';
import {
  COMMUNITY_DNS_MAX_AGE_MS, COMMUNITY_FRIENDLY_DNS_ZONE, communityDnsDeviceAlias, communityDnsZone,
  communityFriendlyDnsDeviceAlias, communityFriendlyDnsZone, newCommunityDnsDeviceAlias, newCommunityDnsZone,
  newCommunityFriendlyDnsDeviceAlias, newCommunityFriendlyDnsZone, type CommunityDnsNameStyle,
} from './communityDnsNames';
import { emptyRelayState, storedRelayShape, type StoredRelayState } from './communityRelayPolicy';

export interface StoredGrantOperation {
  plan: CommunityGrantOperation;
  stage: 'prepared' | 'dispatched' | 'receipt' | 'reconcile';
  receipt: PrivateNativeCredentialReceipt | null;
}
export interface CommunityStoredSession {
  sessionId: string; tokenDigest: string; serverUserId: string; authorizationEpoch: number;
  issuedAtMs: number; expiresAtMs: number; intent: TrustedCommunityIntent;
  /** Authentication input only; persisted in a separate optional DNS table. */
  serverTokenVersion?: number; userTokenVersion?: number;
}
export interface CommunityDirectoryMember { serverUserId: string; virtualIp: string }
export interface CommunityDnsDirectoryMember extends CommunityDirectoryMember { dnsName: string; dnsExpiresAtMs: number }
export interface CommunityDnsSessionAuthorization {
  dnsName: string; sessionId: string; authorizationEpoch: number; accountId: string; serverUserId: string;
  serverTokenVersion?: number; userTokenVersion?: number;
}
/** Private server result: authorizations must never be included in HTTP responses. */
export interface CommunityDnsDirectory { zone: string; serverTimeMs: number; maxAgeMs: number; members: CommunityDnsDirectoryMember[]; authorizations: CommunityDnsSessionAuthorization[] }
export interface ScopeLease { key: string; owner: string }
export interface StoredGrantState { record: CommunityGrantRecord; operation: StoredGrantOperation | null }
/** Private sampling input; never return sessions, grants or credentials over HTTP. */
export interface CommunityBindingDirectoryEntry { session: CommunityStoredSession; state: StoredGrantState }
export interface CleanupIntent { scope: CommunityGrantScope; grantId: string; credentialId: string; adminInstanceId: string; confirmed: boolean }
export const communityScopeKey = (value: CommunityGrantScope) => createHash('sha256').update(JSON.stringify(copiedScope(value))).digest('hex');
/** Reuses the existing stable private server secret through domain-separated HKDF.
 * Do not use a placeholder JWT secret; rotation without old-key recovery fails closed.
 */
export function communityVaultKey(serverSecret: string): Buffer {
  if (serverSecret.length < 32 || serverSecret === 'your-secret-key-change-in-production') fail('invalid-vault-key');
  return Buffer.from(hkdfSync('sha256', Buffer.from(serverSecret), Buffer.from('laokuai-community-et-v1'), Buffer.from('sqlite-private-grants'), 32));
}
/** Dedicated ET tables in existing SQLite. No shared schema/driver/connection changes.
 * initSchema() is called explicitly AFTER the owner's normal database initialization.
 * All private records/operations are authenticated encrypted; cleanup IDs are secret-free.
 */
export class SqliteCommunityGrantStore {
  #db: DatabaseSync; #key: Buffer; #friendlyDnsCommunityId?: string;
  /** Only the trusted factory may reserve lk.internal. for its configured
   * voice.ruikang.wang community; request bodies cannot configure a zone. */
  constructor(db: DatabaseSync, vaultKey: Buffer, friendlyDnsCommunityId?: string) {
    if (vaultKey.length !== 32) fail('invalid-vault-key'); this.#db = db; this.#key = Buffer.from(vaultKey);
    if (friendlyDnsCommunityId !== undefined && !communityIdentity(friendlyDnsCommunityId)) fail('invalid-directory-query');
    this.#friendlyDnsCommunityId = friendlyDnsCommunityId;
  }
  initSchema(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS community_et_devices (
        account_id TEXT NOT NULL, community_id TEXT NOT NULL, device_id TEXT NOT NULL,
        native_instance_id TEXT NOT NULL, virtual_ip TEXT NOT NULL,
        PRIMARY KEY(account_id,community_id,device_id), UNIQUE(community_id,native_instance_id), UNIQUE(community_id,virtual_ip));
      CREATE TABLE IF NOT EXISTS community_et_grants (
        scope_key TEXT PRIMARY KEY, revision INTEGER NOT NULL, sealed_state TEXT NOT NULL,
        lease_owner TEXT, lease_until_ms INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS community_et_sessions (
        session_id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, sealed_session TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS community_et_epoch (scope_key TEXT PRIMARY KEY, epoch INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS community_et_cleanup (
        grant_id TEXT PRIMARY KEY, scope_json TEXT NOT NULL, credential_id TEXT NOT NULL,
        admin_instance_id TEXT NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS community_et_sessions_scope ON community_et_sessions(scope_key);
      CREATE TABLE IF NOT EXISTS community_et_dns_zones (
        community_id TEXT PRIMARY KEY, zone TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS community_et_dns_devices (
        account_id TEXT NOT NULL, community_id TEXT NOT NULL, device_id TEXT NOT NULL, alias TEXT NOT NULL,
        PRIMARY KEY(account_id,community_id,device_id), UNIQUE(community_id,alias));
      CREATE TABLE IF NOT EXISTS community_et_friendly_dns_zones (
        community_id TEXT PRIMARY KEY, zone TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS community_et_friendly_dns_devices (
        account_id TEXT NOT NULL, community_id TEXT NOT NULL, device_id TEXT NOT NULL, alias TEXT NOT NULL,
        PRIMARY KEY(account_id,community_id,device_id), UNIQUE(community_id,alias));
      CREATE TABLE IF NOT EXISTS community_et_relay_preferences (
        scope_key TEXT PRIMARY KEY, sealed_state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS community_et_dns_session_auth (
        session_id TEXT PRIMARY KEY, sealed_authorization TEXT NOT NULL);
    `);
  }
  #transaction<T>(run: () => T): T {
    if (this.#db.isTransaction) fail('grant-store-busy');
    this.#db.exec('BEGIN IMMEDIATE');
    try { const result = run(); this.#db.exec('COMMIT'); return result; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  #seal(aad: string, value: unknown): string {
    const plaintext = Buffer.from(JSON.stringify(value)); if (plaintext.length > 262144) fail('grant-store-corrupt');
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    cipher.setAAD(Buffer.from(aad)); const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  }
  #open<T>(aad: string, encoded: unknown): T {
    try {
      if (typeof encoded !== 'string' || encoded.length > 400000) fail('grant-store-corrupt');
      const bytes = Buffer.from(encoded, 'base64'); if (bytes.length < 28 || bytes.toString('base64') !== encoded) fail('grant-store-corrupt');
      const decipher = createDecipheriv('aes-256-gcm', this.#key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')) as T;
    } catch { return fail('grant-store-corrupt'); }
  }
  registerDevice(accountId: string, communityId: string, deviceId: string, nativeInstanceId: string, pool: readonly string[]): string {
    if (![accountId,deviceId].every(id) || !communityIdentity(communityId) || !uuid(nativeInstanceId) || pool.length < 1 || pool.length > 254 ||
        !pool.every(privateIpv4) || new Set(pool).size !== pool.length) fail('invalid-device-registration');
    return this.#transaction(() => {
      const row = this.#db.prepare('SELECT native_instance_id, virtual_ip FROM community_et_devices WHERE account_id=? AND community_id=? AND device_id=?').get(accountId, communityId, deviceId);
      if (row) { if (row.native_instance_id !== nativeInstanceId) fail('device-instance-mismatch'); return row.virtual_ip as string; }
      const used = new Set(this.#db.prepare('SELECT virtual_ip FROM community_et_devices WHERE community_id=?').all(communityId).map(r => r.virtual_ip));
      const address = pool.find(ip => !used.has(ip)); if (!address) fail('address-pool-exhausted');
      try { this.#db.prepare('INSERT INTO community_et_devices VALUES (?,?,?,?,?)').run(accountId, communityId, deviceId, nativeInstanceId, address); }
      catch { return fail('device-instance-conflict'); }
      return address;
    });
  }
  createSession(value: Omit<CommunityStoredSession, 'sessionId' | 'authorizationEpoch'>): CommunityStoredSession {
    intent(value.intent);
    if (!fingerprint(value.tokenDigest) || !id(value.serverUserId) || !natural(value.issuedAtMs) ||
        !positive(value.expiresAtMs) || value.issuedAtMs >= value.expiresAtMs ||
        ((value.serverTokenVersion !== undefined || value.userTokenVersion !== undefined) &&
          (!natural(value.serverTokenVersion) || !natural(value.userTokenVersion)))) fail('invalid-session');
    const key = communityScopeKey(value.intent);
    return this.#transaction(() => {
      const previous = this.sessionForScope(value.intent);
      if (previous && previous.tokenDigest === value.tokenDigest && previous.serverUserId === value.serverUserId &&
          JSON.stringify(previous.intent) === JSON.stringify(value.intent)) {
        this.#saveDnsSessionAuthorization(previous.sessionId, value);
        return this.session(previous.sessionId)!;
      }
      if (previous && previous.tokenDigest !== value.tokenDigest && value.issuedAtMs <= previous.issuedAtMs)
        fail('auth-retired');
      this.#db.prepare('INSERT INTO community_et_epoch VALUES (?,1) ON CONFLICT(scope_key) DO UPDATE SET epoch=epoch+1').run(key);
      const epoch = Number(this.#db.prepare('SELECT epoch FROM community_et_epoch WHERE scope_key=?').get(key)!.epoch);
      if (!positive(epoch)) fail('grant-store-corrupt');
      // Preserve the original sealed JSON contract so an older server can read
      // current sessions after a rollback. DNS metadata has its own sealed table.
      const session = {tokenDigest:value.tokenDigest,serverUserId:value.serverUserId,issuedAtMs:value.issuedAtMs,
        expiresAtMs:value.expiresAtMs,intent:value.intent,sessionId:randomUUID(),authorizationEpoch:epoch};
      this.#db.prepare('DELETE FROM community_et_dns_session_auth WHERE session_id IN (SELECT session_id FROM community_et_sessions WHERE scope_key=?)').run(key);
      this.#db.prepare('DELETE FROM community_et_sessions WHERE scope_key=?').run(key);
      this.#db.prepare('INSERT INTO community_et_sessions VALUES (?,?,?)').run(session.sessionId, key, this.#seal('session:' + session.sessionId, session));
      this.#saveDnsSessionAuthorization(session.sessionId, value);
      return this.session(session.sessionId)!;
    });
  }
  #saveDnsSessionAuthorization(sessionId: string, value: {serverTokenVersion?: number; userTokenVersion?: number}): void {
    if (value.serverTokenVersion === undefined || value.userTokenVersion === undefined) {
      this.#db.prepare('DELETE FROM community_et_dns_session_auth WHERE session_id=?').run(sessionId); return;
    }
    this.#db.prepare('INSERT OR REPLACE INTO community_et_dns_session_auth VALUES (?,?)').run(sessionId,
      this.#seal('dns-session-auth:' + sessionId,{serverTokenVersion:value.serverTokenVersion,userTokenVersion:value.userTokenVersion}));
  }
  session(sessionId: string): CommunityStoredSession | null {
    if (!uuid(sessionId)) fail('invalid-session');
    const row = this.#db.prepare('SELECT sealed_session FROM community_et_sessions WHERE session_id=?').get(sessionId);
    if (!row) return null;
    const result = this.#open<CommunityStoredSession>('session:' + sessionId, row.sealed_session);
    exact<CommunityStoredSession>(result,['sessionId','tokenDigest','serverUserId','authorizationEpoch','issuedAtMs','expiresAtMs','intent'],'grant-store-corrupt');
    intent(result.intent); if (result.sessionId !== sessionId || !fingerprint(result.tokenDigest) || !id(result.serverUserId) ||
      !positive(result.authorizationEpoch) || !natural(result.issuedAtMs) || !positive(result.expiresAtMs) ||
      result.issuedAtMs >= result.expiresAtMs) fail('grant-store-corrupt'); return result;
  }
  #dnsSessionAuthorization(sessionId: string): {serverTokenVersion?:number;userTokenVersion?:number} {
    const dns = this.#db.prepare('SELECT sealed_authorization FROM community_et_dns_session_auth WHERE session_id=?').get(sessionId);
    if (!dns) return {};
    const authorization = this.#open<{serverTokenVersion:number;userTokenVersion:number}>('dns-session-auth:' + sessionId, dns.sealed_authorization);
    exact<typeof authorization>(authorization,['serverTokenVersion','userTokenVersion'],'grant-store-corrupt');
    if (!natural(authorization.serverTokenVersion) || !natural(authorization.userTokenVersion)) fail('grant-store-corrupt');
    return authorization;
  }
  sessionForScope(value: CommunityGrantScope): CommunityStoredSession | null {
    const rows = this.#db.prepare('SELECT session_id FROM community_et_sessions WHERE scope_key=?').all(communityScopeKey(value));
    if (rows.length > 1) fail('grant-store-corrupt');
    if (!rows.length) return null;
    const current=this.session(rows[0].session_id as string);
    const epoch=this.#db.prepare('SELECT epoch FROM community_et_epoch WHERE scope_key=?').get(communityScopeKey(value));
    if (!current || !sameScope(current.intent,value) || epoch?.epoch !== current.authorizationEpoch) fail('grant-store-corrupt');
    return current;
  }
  /**
   * Return assigned addresses for unexpired grants in authenticated ET sessions.
   * The session and device row are both checked, so a client supplied roster or
   * nickname can never introduce an address. Preserve every device address;
   * choosing the newest would silently select another device for the account.
   * A grant proves authorization and allocation, not online/route connectivity.
   */
  directory(communityId: string, nowMs: number): CommunityDirectoryMember[] {
    return this.#directoryMembers(communityId, nowMs);
  }
  bindingDirectory(communityId: string, nowMs: number): CommunityBindingDirectoryEntry[] {
    const addresses = new Set(this.#directoryMembers(communityId, nowMs).map(row => `${row.serverUserId}:${row.virtualIp}`));
    const entries: CommunityBindingDirectoryEntry[] = [];
    for (const row of this.#db.prepare('SELECT session_id FROM community_et_sessions').all()) {
      const session = this.session(row.session_id as string);
      if (!session || session.intent.communityId !== communityId || !addresses.has(`${session.serverUserId}:${session.intent.virtualIp}`) ||
          session.issuedAtMs > nowMs || session.expiresAtMs <= nowMs) continue;
      const state = this.load(session.intent), grant = state.record.grant;
      if (state.operation || !grant || grant.issuedAtMs > nowMs || grant.serverTimeMs > nowMs) continue;
      entries.push({session: {...session, ...this.#dnsSessionAuthorization(session.sessionId)}, state});
    }
    return entries;
  }
  /** Persistent opaque names are issued only from validated store identities.
   * Existing device/IP rows are not rewritten. Absent/revoked entries disappear
   * from the full response, but their reserved aliases are never reassigned.
   */
  dnsDirectory(communityId: string, nowMs: number, style: CommunityDnsNameStyle = 'legacy'): CommunityDnsDirectory {
    if (!communityIdentity(communityId) || !positive(nowMs) || !Number.isSafeInteger(nowMs + COMMUNITY_DNS_MAX_AGE_MS) ||
        (style !== 'legacy' && style !== 'friendly')) fail('invalid-directory-query');
    return this.#transaction(() => {
      const zone = style === 'friendly' ? this.#friendlyDnsZone(communityId) : this.#dnsZone(communityId);
      const authorizations: CommunityDnsSessionAuthorization[] = [];
      const members = this.#directoryMembers(communityId, nowMs, zone, authorizations, style);
      return {zone, serverTimeMs: nowMs, maxAgeMs: COMMUNITY_DNS_MAX_AGE_MS, members, authorizations};
    });
  }
  #dnsZone(communityId: string): string {
    const existing = this.#db.prepare('SELECT zone FROM community_et_dns_zones WHERE community_id=?').get(communityId);
    if (existing) {
      if (!communityDnsZone(existing.zone)) fail('grant-store-corrupt');
      return existing.zone;
    }
    // A collision is vanishingly unlikely; uniqueness is still enforced by SQLite.
    for (let attempt = 0; attempt < 8; attempt++) {
      const zone = newCommunityDnsZone();
      if (this.#db.prepare('INSERT OR IGNORE INTO community_et_dns_zones VALUES (?,?)').run(communityId, zone).changes === 1) return zone;
    }
    return fail('grant-store-corrupt');
  }
  #dnsDeviceAlias(accountId: string, communityId: string, deviceId: string): string {
    const existing = this.#db.prepare('SELECT alias FROM community_et_dns_devices WHERE account_id=? AND community_id=? AND device_id=?').get(accountId,communityId,deviceId);
    if (existing) {
      if (!communityDnsDeviceAlias(existing.alias)) fail('grant-store-corrupt');
      return existing.alias;
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const alias = newCommunityDnsDeviceAlias();
      if (this.#db.prepare('INSERT OR IGNORE INTO community_et_dns_devices VALUES (?,?,?,?)').run(accountId,communityId,deviceId,alias).changes === 1) return alias;
    }
    return fail('grant-store-corrupt');
  }
  #friendlyDnsZone(communityId: string): string {
    const existing = this.#db.prepare('SELECT zone FROM community_et_friendly_dns_zones WHERE community_id=?').get(communityId);
    if (existing) {
      if (!communityFriendlyDnsZone(existing.zone) ||
          (existing.zone === COMMUNITY_FRIENDLY_DNS_ZONE && communityId !== this.#friendlyDnsCommunityId)) fail('grant-store-corrupt');
      return existing.zone;
    }
    if (communityId === this.#friendlyDnsCommunityId) {
      if (this.#db.prepare('INSERT OR IGNORE INTO community_et_friendly_dns_zones VALUES (?,?)')
        .run(communityId, COMMUNITY_FRIENDLY_DNS_ZONE).changes !== 1) fail('grant-store-corrupt');
      return COMMUNITY_FRIENDLY_DNS_ZONE;
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const zone = newCommunityFriendlyDnsZone();
      if (this.#db.prepare('INSERT OR IGNORE INTO community_et_friendly_dns_zones VALUES (?,?)').run(communityId, zone).changes === 1) return zone;
    }
    return fail('grant-store-corrupt');
  }
  #friendlyDnsDeviceAlias(accountId: string, communityId: string, deviceId: string): string {
    const existing = this.#db.prepare('SELECT alias FROM community_et_friendly_dns_devices WHERE account_id=? AND community_id=? AND device_id=?')
      .get(accountId,communityId,deviceId);
    if (existing) {
      if (!communityFriendlyDnsDeviceAlias(existing.alias)) fail('grant-store-corrupt');
      return existing.alias;
    }
    const used = new Set(this.#db.prepare('SELECT alias FROM community_et_friendly_dns_devices WHERE community_id=?')
      .all(communityId).map(row => {
        if (!communityFriendlyDnsDeviceAlias(row.alias)) fail('grant-store-corrupt');
        return row.alias;
      }));
    const alias = newCommunityFriendlyDnsDeviceAlias(used);
    // BEGIN IMMEDIATE fences allocation; SQL uniqueness remains the final guard.
    if (this.#db.prepare('INSERT OR IGNORE INTO community_et_friendly_dns_devices VALUES (?,?,?,?)')
      .run(accountId,communityId,deviceId,alias).changes !== 1) fail('grant-store-corrupt');
    return alias;
  }
  #directoryMembers(communityId: string, nowMs: number): CommunityDirectoryMember[];
  #directoryMembers(communityId: string, nowMs: number, zone: string, authorizations: CommunityDnsSessionAuthorization[], style: CommunityDnsNameStyle): CommunityDnsDirectoryMember[];
  #directoryMembers(communityId: string, nowMs: number, zone?: string, authorizations?: CommunityDnsSessionAuthorization[], style?: CommunityDnsNameStyle): Array<CommunityDirectoryMember | CommunityDnsDirectoryMember> {
    if (!communityIdentity(communityId) || !natural(nowMs)) fail('invalid-directory-query');
    const members: Array<CommunityDirectoryMember | CommunityDnsDirectoryMember> = [];
    for (const row of this.#db.prepare('SELECT session_id FROM community_et_sessions').all()) {
      const session = this.session(row.session_id as string);
      if (!session || session.intent.communityId !== communityId || session.expiresAtMs <= nowMs) continue;
      if (this.sessionForScope(session.intent)?.sessionId !== session.sessionId) fail('grant-store-corrupt');
      const state = this.load(session.intent), grant = state.record.grant;
      // A same-key renewal retains the prior confirmed allocation until its
      // original expiry; an in-flight extension never supplies a new lifetime.
      if ((state.operation && state.operation.plan.operation !== 'renew') || state.record.state !== 'active' || !grant || grant.expiresAtMs <= nowMs ||
          grant.networkName !== session.intent.networkName || grant.networkRevision !== session.intent.networkRevision ||
          grant.virtualIp !== session.intent.virtualIp) continue;
      if (zone && (session.issuedAtMs > nowMs || grant.issuedAtMs > nowMs || grant.serverTimeMs > nowMs)) continue;
      const device = this.#db.prepare('SELECT native_instance_id, virtual_ip FROM community_et_devices WHERE account_id=? AND community_id=? AND device_id=?')
        .get(session.intent.accountId, communityId, session.intent.deviceId);
      if (!device || device.native_instance_id !== session.intent.nativeInstanceId || device.virtual_ip !== session.intent.virtualIp || !privateIpv4(device.virtual_ip)) continue;
      const member = {serverUserId: session.serverUserId, virtualIp: session.intent.virtualIp};
      if (zone) {
        const alias = style === 'friendly' ? this.#friendlyDnsDeviceAlias(session.intent.accountId, communityId, session.intent.deviceId)
          : this.#dnsDeviceAlias(session.intent.accountId, communityId, session.intent.deviceId);
        const dnsName = `${alias}.${zone}`;
        members.push({...member, dnsName, dnsExpiresAtMs: Math.min(nowMs + COMMUNITY_DNS_MAX_AGE_MS, session.expiresAtMs, grant.expiresAtMs)});
        authorizations!.push({dnsName, sessionId: session.sessionId, authorizationEpoch: session.authorizationEpoch,
          accountId: session.intent.accountId, serverUserId: session.serverUserId, ...this.#dnsSessionAuthorization(session.sessionId)});
      } else members.push(member);
    }
    return members.sort((a, b) => a.serverUserId.localeCompare(b.serverUserId) || a.virtualIp.localeCompare(b.virtualIp));
  }
  claim(value: CommunityGrantScope, nowMs: number): ScopeLease {
    scope(value); if (!natural(nowMs)) fail('invalid-store-clock');
    const key = communityScopeKey(value), owner = randomUUID();
    return this.#transaction(() => {
      const initial: StoredGrantState = {record:{scope:copiedScope(value), revision:0, state:'prepared', grant:null}, operation:null};
      this.#db.prepare('INSERT OR IGNORE INTO community_et_grants(scope_key,revision,sealed_state) VALUES (?,0,?)').run(key, this.#seal(key, initial));
      const changed = this.#db.prepare('UPDATE community_et_grants SET lease_owner=?,lease_until_ms=? WHERE scope_key=? AND (lease_owner IS NULL OR lease_until_ms<?)').run(owner, nowMs + 120000, key, nowMs);
      if (changed.changes !== 1) fail('grant-operation-busy'); return {key, owner};
    });
  }
  load(value: CommunityGrantScope): StoredGrantState {
    const key = communityScopeKey(value); const row = this.#db.prepare('SELECT revision,sealed_state FROM community_et_grants WHERE scope_key=?').get(key);
    if (!row) return {record:{scope:copiedScope(value),revision:0,state:'prepared',grant:null},operation:null};
    const state = this.#open<StoredGrantState>(key, row.sealed_state); this.#stateShape(state);
    if (state.record.revision !== Number(row.revision) || !sameScope(state.record.scope, value) ||
        (state.operation && !sameScope(state.operation.plan.intent, value))) fail('grant-store-corrupt'); return state;
  }
  save(lease: ScopeLease, priorRevision: number, state: StoredGrantState): void {
    this.#stateShape(state);
    if (!natural(priorRevision) || state.record.revision < priorRevision || state.record.revision > priorRevision + 1 ||
        communityScopeKey(state.record.scope) !== lease.key) fail('grant-store-corrupt');
    const changed = this.#db.prepare('UPDATE community_et_grants SET revision=?,sealed_state=? WHERE scope_key=? AND revision=? AND lease_owner=?').run(
      state.record.revision, this.#seal(lease.key, state), lease.key, priorRevision, lease.owner);
    if (changed.changes !== 1) fail('grant-operation-retired');
  }
  release(lease: ScopeLease): void { this.#db.prepare('UPDATE community_et_grants SET lease_owner=NULL,lease_until_ms=0 WHERE scope_key=? AND lease_owner=?').run(lease.key,lease.owner); }
  assertLease(lease: ScopeLease, nowMs: number): void {
    const row = this.#db.prepare('SELECT lease_owner,lease_until_ms FROM community_et_grants WHERE scope_key=?').get(lease.key);
    if (!natural(nowMs) || row?.lease_owner !== lease.owner || Number(row.lease_until_ms) <= nowMs) fail('grant-operation-retired');
  }
  #stateShape(state: StoredGrantState): void {
    exact<StoredGrantState>(state,['record','operation'],'grant-store-corrupt'); recordShape(state.record);
    if (state.operation !== null) {
      exact<StoredGrantOperation>(state.operation,['plan','stage','receipt'],'grant-store-corrupt');
      if (!['prepared','dispatched','receipt','reconcile'].includes(state.operation.stage)) fail('grant-store-corrupt');
      const op = state.operation.plan;
      planCommunityCredentialOperation(op,state.record,{scope:copiedScope(op.intent),epoch:op.authorizationEpoch,isMember:true});
      if (state.operation.receipt !== null) {
        const r = state.operation.receipt;
        exact<PrivateNativeCredentialReceipt>(r,['credentialId','credentialSecretB64','expiryUnix','derivedPublicKeyFingerprint'],'grant-store-corrupt');
        keyBytes(r.credentialSecretB64);
        if (r.credentialId !== op.credentialId || !fingerprint(r.derivedPublicKeyFingerprint) || !positive(r.expiryUnix)) fail('grant-store-corrupt');
      }
    }
  }
  addCleanup(value: CleanupIntent): void {
    scope(value.scope); if (!id(value.grantId) || !id(value.credentialId) || !uuid(value.adminInstanceId)) fail('invalid-revocation-record');
    this.#db.prepare('INSERT OR IGNORE INTO community_et_cleanup VALUES (?,?,?,?,0)').run(value.grantId, JSON.stringify(copiedScope(value.scope)),value.credentialId,value.adminInstanceId);
  }
  cleanups(): CleanupIntent[] {
    return this.#db.prepare('SELECT * FROM community_et_cleanup').all().map(row => {
      const value: CleanupIntent = {scope:JSON.parse(row.scope_json as string), grantId:row.grant_id as string,
        credentialId:row.credential_id as string,adminInstanceId:row.admin_instance_id as string,confirmed:row.confirmed===1};
      scope(value.scope); return value;
    });
  }
  confirmCleanup(grantId: string): void { this.#db.prepare('UPDATE community_et_cleanup SET confirmed=1 WHERE grant_id=?').run(grantId); }
  cleanup(grantId: string): CleanupIntent | null { return this.cleanups().find(c=>c.grantId === grantId) ?? null; }
  relayState(value: CommunityGrantScope): StoredRelayState {
    scope(copiedScope(value)); const key=communityScopeKey(value);
    const row=this.#db.prepare('SELECT sealed_state FROM community_et_relay_preferences WHERE scope_key=?').get(key);
    if (!row) return emptyRelayState();
    const state=this.#open<StoredRelayState>('relay:'+key,row.sealed_state);storedRelayShape(state);return state;
  }
  saveRelayState(lease: ScopeLease, state: StoredRelayState, nowMs: number): void {
    this.assertLease(lease,nowMs);storedRelayShape(state);
    this.#db.prepare('INSERT INTO community_et_relay_preferences VALUES (?,?) ON CONFLICT(scope_key) DO UPDATE SET sealed_state=excluded.sealed_state')
      .run(lease.key,this.#seal('relay:'+lease.key,state));
  }
  commitRelayState(lease: ScopeLease, priorRevision: number, state: StoredGrantState, relay: StoredRelayState, nowMs: number): void {
    this.#transaction(()=>{this.assertLease(lease,nowMs);this.save(lease,priorRevision,state);this.saveRelayState(lease,relay,nowMs);});
  }
  expectedActiveCredentials(nowMs: number): Array<{credentialId: string; publicKeyFingerprint: string; expiresAtMs: number; allowRelay?:boolean; pendingAllowRelay?:boolean}> {
    const result: Array<{credentialId:string;publicKeyFingerprint:string;expiresAtMs:number;allowRelay?:boolean;pendingAllowRelay?:boolean}> = [];
    for (const row of this.#db.prepare('SELECT scope_key,sealed_state FROM community_et_grants').all()) {
      const state = this.#open<StoredGrantState>(row.scope_key as string,row.sealed_state); recordShape(state.record);
      const g = state.record.grant;
      if (g && g.expiresAtMs > nowMs) {
        const pending=this.relayState(g.scope).pending;
        result.push({credentialId:g.credentialId,publicKeyFingerprint:g.publicKeyFingerprint,expiresAtMs:g.expiresAtMs,
          ...(g.v === 2 ? {allowRelay:g.policy.allowRelay} : {}),
          ...(pending && pending.credentialId === g.credentialId ? {pendingAllowRelay:pending.target.enabled} : {})});
      }
    }
    return result;
  }
}
