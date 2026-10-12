import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  copiedScope, exact, fail, fingerprint, id, intent, keyBytes, natural, planCommunityCredentialOperation,
  positive, privateIpv4, recordShape, sameScope, scope, uuid,
  type CommunityGrantOperation, type CommunityGrantRecord, type CommunityGrantScope, type PrivateNativeCredentialReceipt,
  type TrustedCommunityIntent,
} from './communityGrant';

export interface StoredGrantOperation {
  plan: CommunityGrantOperation;
  stage: 'prepared' | 'dispatched' | 'receipt' | 'reconcile';
  receipt: PrivateNativeCredentialReceipt | null;
}
export interface CommunityStoredSession {
  sessionId: string; tokenDigest: string; serverUserId: string; authorizationEpoch: number;
  issuedAtMs: number; expiresAtMs: number; intent: TrustedCommunityIntent;
}
export interface ScopeLease { key: string; owner: string }
export interface StoredGrantState { record: CommunityGrantRecord; operation: StoredGrantOperation | null }
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
  #db: DatabaseSync; #key: Buffer;
  constructor(db: DatabaseSync, vaultKey: Buffer) {
    if (vaultKey.length !== 32) fail('invalid-vault-key'); this.#db = db; this.#key = Buffer.from(vaultKey);
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
    if (![accountId,communityId,deviceId].every(id) || !uuid(nativeInstanceId) || pool.length < 1 || pool.length > 254 ||
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
        !positive(value.expiresAtMs) || value.issuedAtMs >= value.expiresAtMs) fail('invalid-session');
    const key = communityScopeKey(value.intent);
    return this.#transaction(() => {
      const previous = this.sessionForScope(value.intent);
      if (previous && previous.tokenDigest === value.tokenDigest && previous.serverUserId === value.serverUserId &&
          JSON.stringify(previous.intent) === JSON.stringify(value.intent)) return previous;
      if (previous && previous.tokenDigest !== value.tokenDigest && value.issuedAtMs <= previous.issuedAtMs)
        fail('auth-retired');
      this.#db.prepare('INSERT INTO community_et_epoch VALUES (?,1) ON CONFLICT(scope_key) DO UPDATE SET epoch=epoch+1').run(key);
      const epoch = Number(this.#db.prepare('SELECT epoch FROM community_et_epoch WHERE scope_key=?').get(key)!.epoch);
      if (!positive(epoch)) fail('grant-store-corrupt');
      const session = {...value, sessionId: randomUUID(), authorizationEpoch: epoch};
      this.#db.prepare('DELETE FROM community_et_sessions WHERE scope_key=?').run(key);
      this.#db.prepare('INSERT INTO community_et_sessions VALUES (?,?,?)').run(session.sessionId, key, this.#seal('session:' + session.sessionId, session));
      return session;
    });
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
  sessionForScope(value: CommunityGrantScope): CommunityStoredSession | null {
    const rows = this.#db.prepare('SELECT session_id FROM community_et_sessions WHERE scope_key=?').all(communityScopeKey(value));
    if (rows.length > 1) fail('grant-store-corrupt');
    if (!rows.length) return null;
    const current=this.session(rows[0].session_id as string);
    const epoch=this.#db.prepare('SELECT epoch FROM community_et_epoch WHERE scope_key=?').get(communityScopeKey(value));
    if (!current || !sameScope(current.intent,value) || epoch?.epoch !== current.authorizationEpoch) fail('grant-store-corrupt');
    return current;
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
  expectedActiveCredentials(nowMs: number): Array<{credentialId: string; publicKeyFingerprint: string; expiresAtMs: number}> {
    const result: Array<{credentialId:string;publicKeyFingerprint:string;expiresAtMs:number}> = [];
    for (const row of this.#db.prepare('SELECT scope_key,sealed_state FROM community_et_grants').all()) {
      const state = this.#open<StoredGrantState>(row.scope_key as string,row.sealed_state); recordShape(state.record);
      const g = state.record.grant;
      if (g && g.expiresAtMs > nowMs) result.push({credentialId:g.credentialId,publicKeyFingerprint:g.publicKeyFingerprint,expiresAtMs:g.expiresAtMs});
    }
    return result;
  }
}
