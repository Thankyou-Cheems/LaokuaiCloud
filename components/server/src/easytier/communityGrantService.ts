import { randomUUID } from 'node:crypto';

import {
  assertCredentialProviderCapability, commitCommunityCredentialReadback, confirmCommunityGrantRevoked,
  COMMUNITY_ET_UPSTREAM_COMMIT, communityIdentity, copiedScope, exact, fail, id, intent, planCommunityCredentialOperation, positive, privateIpv4,
  retireCommunityGrant, safeArray, sameScope, uuid, type CommunityGrantOperation,
  type CommunityGrantScope, type CredentialProvider, type NativeAuthority, type PrivateCommunityGrantV1,
  type PrivateNativeCredentialReceipt, type TrustedCommunityIntent,
} from './communityGrant';
import { verifyCurrentDeviceBinding } from './communityDeviceBinding';
import { deriveCredentialFingerprint } from './communityCredentialProvider';
import type { CommunityMemberAuthorizer, CommunityMemberIdentity } from './communityGrantAuth';
import {
  parseCommunityGrantRequest, type CommunityAcquireRequestV1, type CommunityBindingRequestV1,
  type CommunityGrantApi, type CommunityRenewRequestV1, type CommunitySessionRequestV1,
} from './communityGrantApi';
import {
  SqliteCommunityGrantStore, type CommunityStoredSession, type ScopeLease, type StoredGrantState,
} from './communityGrantStore';

export interface CommunityGrantServiceConfiguration {
  serverInstanceId: string; communityId: string; networkName: string; networkRevision: number;
  bootstrapProfileId: string; virtualIpPool: readonly string[]; authority: NativeAuthority;
  ttlSeconds: number;
  /** Trusted owner controls; construction and session never activate native writes. */
  enabled: () => boolean; credentialWritesEnabled: () => boolean; runtimeGeneration: () => number;
}
export type CommunityGrantServiceProvider = CredentialProvider;
export interface CommunityServiceClock { wallMs: () => number; monoMs: () => number }
const DEFAULT_CLOCK: CommunityServiceClock = {wallMs:Date.now,monoMs:()=>Math.floor(performance.now())};

/** A single backend community, independently of voice room state. No HTTP/native
 * calls on construction. Every native mutation has a durable pre-dispatch intent;
 * every secret/proof response rechecks membership and the same internal session.
 */
export class CommunityGrantService implements CommunityGrantApi {
  #config: CommunityGrantServiceConfiguration; #store: SqliteCommunityGrantStore;
  #provider: CommunityGrantServiceProvider; #auth: CommunityMemberAuthorizer; #clock: CommunityServiceClock;
  constructor(configuration: CommunityGrantServiceConfiguration, store: SqliteCommunityGrantStore,
    provider: CommunityGrantServiceProvider, authorize: CommunityMemberAuthorizer, clock: CommunityServiceClock = DEFAULT_CLOCK) {
    exact<CommunityGrantServiceConfiguration>(configuration,['serverInstanceId','communityId','networkName','networkRevision',
      'bootstrapProfileId','virtualIpPool','authority','ttlSeconds','enabled','credentialWritesEnabled','runtimeGeneration'],'invalid-service-config');
    const c = configuration;
    if (!communityIdentity(c.serverInstanceId) || !communityIdentity(c.communityId) || ![c.networkName,c.bootstrapProfileId].every(id) || !positive(c.networkRevision) ||
        !positive(c.ttlSeconds) || c.ttlSeconds < 30 || c.ttlSeconds > 3600 || !safeArray(c.virtualIpPool,254) || c.virtualIpPool.length < 1 ||
        c.virtualIpPool.length > 254 || !c.virtualIpPool.every(privateIpv4) || new Set(c.virtualIpPool).size !== c.virtualIpPool.length ||
        typeof c.enabled !== 'function' || typeof c.credentialWritesEnabled !== 'function' || typeof c.runtimeGeneration !== 'function') fail('invalid-service-config');
    exact<NativeAuthority>(c.authority,['adminInstanceId','upstreamCommit','groups'],'invalid-authority');
    if (!uuid(c.authority.adminInstanceId) || c.authority.upstreamCommit !== COMMUNITY_ET_UPSTREAM_COMMIT ||
        !safeArray(c.authority.groups,32) || !c.authority.groups.length || !c.authority.groups.every(id) ||
        new Set(c.authority.groups).size !== c.authority.groups.length) fail('invalid-authority');
    this.#config = {...c,virtualIpPool:[...c.virtualIpPool],authority:structuredClone(c.authority)};
    this.#store=store;this.#provider=provider;this.#auth=authorize;this.#clock=clock;
  }
  #enabled(): void { if (this.#config.enabled() !== true) fail('community-et-disabled'); }
  #writes(): void { this.#enabled(); if (this.#config.credentialWritesEnabled() !== true) fail('native-activation-required'); }
  #scope(identity: CommunityMemberIdentity, body: CommunitySessionRequestV1): CommunityGrantScope {
    if (body.communityId !== this.#config.communityId) fail('community-forbidden');
    return {serverInstanceId:this.#config.serverInstanceId,accountId:identity.accountId,communityId:body.communityId,
      deviceId:body.deviceId,nativeInstanceId:body.nativeInstanceId};
  }
  async #identity(bearer: string, communityId: string): Promise<CommunityMemberIdentity> {
    this.#enabled();const identity=await this.#auth(bearer,communityId);this.#enabled();
    if (!id(identity.accountId) || !id(identity.serverUserId) || identity.expiresAtMs <= this.#clock.wallMs()) fail('auth-retired');
    return identity;
  }
  async session(bearer: string, raw: CommunitySessionRequestV1) {
    this.#enabled(); const body=parseCommunityGrantRequest('session',raw), identity=await this.#identity(bearer,body.communityId);
    const value=this.#scope(identity,body);
    const virtualIp=this.#store.registerDevice(identity.accountId,body.communityId,body.deviceId,body.nativeInstanceId,this.#config.virtualIpPool);
    const trusted: TrustedCommunityIntent={...value,networkName:this.#config.networkName,networkRevision:this.#config.networkRevision,
      virtualIp,bootstrapProfileId:this.#config.bootstrapProfileId};intent(trusted);
    const current=await this.#identity(bearer,body.communityId);
    if (current.tokenDigest !== identity.tokenDigest || current.serverUserId !== identity.serverUserId) fail('auth-retired');
    this.#store.createSession({tokenDigest:identity.tokenDigest,serverUserId:identity.serverUserId,
      issuedAtMs:identity.issuedAtMs,expiresAtMs:identity.expiresAtMs,intent:trusted});
    return {v:1 as const,serverUserId:identity.serverUserId,intent:trusted};
  }
  async #session(bearer: string, body: CommunitySessionRequestV1): Promise<CommunityStoredSession> {
    const identity=await this.#identity(bearer,body.communityId), value=this.#scope(identity,body);
    const session=this.#store.sessionForScope(value);
    if (!session || session.tokenDigest !== identity.tokenDigest || session.serverUserId !== identity.serverUserId ||
        session.expiresAtMs <= this.#clock.wallMs() || !sameScope(session.intent,value)) fail('session-required');
    if (session.intent.networkName !== this.#config.networkName || session.intent.networkRevision !== this.#config.networkRevision ||
        session.intent.bootstrapProfileId !== this.#config.bootstrapProfileId) fail('session-retired');
    return session;
  }
  async #recheck(bearer: string, expected: CommunityStoredSession, lease: ScopeLease): Promise<void> {
    this.#store.assertLease(lease,this.#clock.wallMs());
    const live=await this.#session(bearer,{v:1,communityId:expected.intent.communityId,deviceId:expected.intent.deviceId,
      nativeInstanceId:expected.intent.nativeInstanceId});
    if (live.sessionId !== expected.sessionId || live.authorizationEpoch !== expected.authorizationEpoch) fail('auth-retired');
    this.#store.assertLease(lease,this.#clock.wallMs());
  }
  async #clean(grantId: string, value: CommunityGrantScope): Promise<void> {
    const cleanup=this.#store.cleanup(grantId);
    if (!cleanup || !sameScope(cleanup.scope,value) || cleanup.adminInstanceId !== this.#config.authority.adminInstanceId) fail('unknown-grant');
    if (cleanup.confirmed) return;
    if (await this.#provider.read(cleanup.credentialId,cleanup.adminInstanceId)) {
      this.#writes();await this.#provider.revoke({credentialId:cleanup.credentialId,instance:cleanup.adminInstanceId});
    }
    if (await this.#provider.read(cleanup.credentialId,cleanup.adminInstanceId) !== null) fail('revocation-unconfirmed');
    this.#store.confirmCleanup(grantId);
  }
  #retire(lease: ScopeLease, state: StoredGrantState): StoredGrantState {
    const prior=state.record.revision;
    let next=state.record;
    const pending=state.operation?.plan;
    if (state.record.grant) next=retireCommunityGrant(state.record,state.record.grant.grantId,this.#config.authority);
    else if (pending) next={scope:copiedScope(state.record.scope),revision:prior+1,state:'revoke-pending',grant:null,
      revocation:{grantId:pending.grantId,credentialId:pending.credentialId,adminInstanceId:pending.authority.adminInstanceId}};
    if (next.revocation) this.#store.addCleanup({scope:next.scope,...next.revocation,confirmed:false});
    const result: StoredGrantState={record:next,operation:null};this.#store.save(lease,prior,result);return result;
  }
  #reply(grant: PrivateCommunityGrantV1, requestId: string): PrivateCommunityGrantV1 {
    const now=this.#clock.wallMs();if (now >= grant.expiresAtMs || now < grant.serverTimeMs) fail('expired-grant');
    return {...structuredClone(grant),requestId,serverTimeMs:now};
  }
  async acquire(bearer: string, raw: CommunityAcquireRequestV1): Promise<PrivateCommunityGrantV1> {
    this.#enabled();const body=parseCommunityGrantRequest('acquire',raw),session=await this.#session(bearer,body);
    const lease=this.#store.claim(copiedScope(session.intent),this.#clock.wallMs());
    try {
      let state=this.#store.load(session.intent);
      if (state.operation) state=this.#retire(lease,state);
      if (state.record.grant && state.record.grant.expiresAtMs > this.#clock.wallMs() &&
          state.record.grant.networkName === session.intent.networkName && state.record.grant.networkRevision === session.intent.networkRevision &&
          state.record.grant.virtualIp === session.intent.virtualIp && state.record.grant.bootstrapProfileId === session.intent.bootstrapProfileId) {
        const actual=await this.#provider.read(state.record.grant.credentialId,this.#config.authority.adminInstanceId);
        await this.#recheck(bearer,session,lease);
        if (!actual || actual.publicKeyFingerprint !== state.record.grant.publicKeyFingerprint || actual.reusable !== false ||
            actual.allowRelay !== false || actual.allowedProxyCidrs.length !== 0 || actual.expiryUnix*1000 !== state.record.grant.expiresAtMs ||
            actual.groups.length !== this.#config.authority.groups.length || !this.#config.authority.groups.every(group=>actual.groups.includes(group)))
          fail('native-readback-mismatch');
        return this.#reply(state.record.grant,body.requestId);
      }
      this.#writes();
      if (state.record.grant) state=this.#retire(lease,state);
      if (state.record.revocation) {
        await this.#clean(state.record.revocation.grantId,session.intent);await this.#recheck(bearer,session,lease);
        const next: StoredGrantState={record:{scope:copiedScope(session.intent),revision:state.record.revision,state:'prepared',grant:null},operation:null};
        this.#store.save(lease,state.record.revision,next);state=next;
      }
      return await this.#operate('acquire',bearer,body,session,lease,state);
    } finally { this.#store.release(lease); }
  }
  async renew(bearer: string, raw: CommunityRenewRequestV1): Promise<PrivateCommunityGrantV1> {
    this.#enabled();const body=parseCommunityGrantRequest('renew',raw),session=await this.#session(bearer,body);
    const lease=this.#store.claim(copiedScope(session.intent),this.#clock.wallMs());
    try {
      const state=this.#store.load(session.intent),g=state.record.grant;
      if (state.operation) {this.#retire(lease,state);fail('reconciliation-required');}
      if (!g || g.grantId !== body.grantId || g.expiresAtMs <= this.#clock.wallMs()) fail('unknown-grant');
      if (g.requestId === body.requestId) return this.#reply(g,body.requestId);
      this.#writes();return await this.#operate('renew',bearer,body,session,lease,state);
    } finally {this.#store.release(lease);}
  }
  async #operate(operation: 'acquire'|'renew', bearer: string, body: CommunityAcquireRequestV1,
    session: CommunityStoredSession, lease: ScopeLease, state: StoredGrantState): Promise<PrivateCommunityGrantV1> {
    this.#writes();
    const start=Math.floor(this.#clock.wallMs()/1000)*1000;
    const op: CommunityGrantOperation={operation,requestId:body.requestId,grantId:state.record.grant?.grantId??randomUUID(),
      credentialId:state.record.grant?.credentialId??randomUUID(),intent:structuredClone(session.intent),authority:structuredClone(this.#config.authority),
      priorRevision:state.record.revision,revision:state.record.revision+1,authorizationEpoch:session.authorizationEpoch,
      issuedAtMs:start,renewAfterMs:start+Math.floor(this.#config.ttlSeconds*0.6)*1000,expiresAtMs:start+this.#config.ttlSeconds*1000};
    const auth={scope:copiedScope(session.intent),epoch:session.authorizationEpoch,isMember:true};
    const command=planCommunityCredentialOperation(op,state.record,auth);
    assertCredentialProviderCapability(await this.#provider.inspectInstance(op.authority.adminInstanceId),op.authority);
    await this.#recheck(bearer,session,lease);this.#writes();
    const planned: StoredGrantState={record:state.record,operation:{plan:op,stage:'prepared',receipt:null}};
    this.#store.save(lease,state.record.revision,planned);
    planned.operation!.stage='dispatched';this.#store.save(lease,state.record.revision,planned);
    try {
      let receipt: PrivateNativeCredentialReceipt;
      if (command.kind === 'Generate') receipt=await this.#provider.create(command.request);
      else {
        await this.#provider.extendSameKey(command.request);
        const actual=await this.#provider.read(op.credentialId,op.authority.adminInstanceId);
        if (!actual || !state.record.grant) fail('native-readback-mismatch');
        receipt={credentialId:op.credentialId,credentialSecretB64:state.record.grant.credentialSecretB64,
          expiryUnix:actual.expiryUnix,derivedPublicKeyFingerprint:deriveCredentialFingerprint(state.record.grant.credentialSecretB64)};
      }
      this.#store.assertLease(lease,this.#clock.wallMs());
      planned.operation!.stage='receipt';planned.operation!.receipt=receipt;this.#store.save(lease,state.record.revision,planned);
      const readback=await this.#provider.read(op.credentialId,op.authority.adminInstanceId);
      await this.#recheck(bearer,session,lease);this.#writes();
      const current=this.#store.load(session.intent);
      if (current.operation?.plan.requestId !== op.requestId) fail('operation-retired');
      const record=commitCommunityCredentialReadback(op,current.record,auth,receipt,readback,this.#clock.wallMs());
      this.#store.save(lease,state.record.revision,{record,operation:null});return structuredClone(record.grant!);
    } catch (error) {
      // A dispatched operation may have succeeded even when TCP timed out.
      // Preserve cleanup intent before returning; never return its private key.
      this.#store.addCleanup({scope:copiedScope(op.intent),grantId:op.grantId,credentialId:op.credentialId,
        adminInstanceId:op.authority.adminInstanceId,confirmed:false});
      try {this.#store.assertLease(lease,this.#clock.wallMs());this.#retire(lease,this.#store.load(session.intent));} catch { /* lease stolen: new owner recovers persisted operation */ }
      throw error;
    }
  }
  async revoke(bearer: string, raw: CommunityRenewRequestV1) {
    this.#enabled();const body=parseCommunityGrantRequest('revoke',raw),session=await this.#session(bearer,body);
    const lease=this.#store.claim(copiedScope(session.intent),this.#clock.wallMs());
    try {
      let state=this.#store.load(session.intent);
      if (state.record.grant?.grantId === body.grantId || state.operation?.plan.grantId === body.grantId) state=this.#retire(lease,state);
      await this.#clean(body.grantId,session.intent);await this.#recheck(bearer,session,lease);
      // A cleanup belonging to an old grant must not retire a newer acquire.
      if (state.record.state === 'revoke-pending' && state.record.revocation?.grantId === body.grantId) {
        const record=confirmCommunityGrantRevoked(state.record,{instance:this.#config.authority.adminInstanceId,
          credentialId:state.record.revocation.credentialId,readback:null});
        this.#store.save(lease,state.record.revision,{record,operation:null});
      }
      return {v:1 as const,revoked:true as const};
    } finally {this.#store.release(lease);}
  }
  async binding(bearer: string, raw: CommunityBindingRequestV1) {
    this.#enabled();const body=parseCommunityGrantRequest('binding',raw),session=await this.#session(bearer,body);
    const started=this.#clock.monoMs(),lease=this.#store.claim(copiedScope(session.intent),this.#clock.wallMs());
    try {
      const state=this.#store.load(session.intent),g=state.record.grant;
      if (state.operation || !g || g.grantId !== body.grantId || g.expiresAtMs <= this.#clock.wallMs()) fail('inactive-binding-grant');
      const generation=this.#config.runtimeGeneration();if (!positive(generation)) fail('provider-observation-mismatch');
      const sample=await this.#provider.observeAuthenticatedPeer({instance:this.#config.authority.adminInstanceId,
        expectedProviderGeneration:generation,scope:copiedScope(session.intent)});
      await this.#recheck(bearer,session,lease);
      if (this.#clock.monoMs()-started > 5000 || generation !== this.#config.runtimeGeneration()) fail('binding-pending');
      if ('status' in sample) fail('binding-pending');
      const current=this.#store.load(session.intent);
      if (current.operation || current.record.grant?.grantId !== g.grantId || current.record.revision !== g.revision) fail('operation-retired');
      const proof=verifyCurrentDeviceBinding(current.record,sample,this.#clock.wallMs(),this.#clock.monoMs(),generation);
      return {v:1 as const,serverUserId:session.serverUserId,scope:copiedScope(session.intent),grantId:proof.grantId,
        credentialId:proof.credentialId,revision:proof.revision,peerId:proof.peerId,virtualIp:proof.virtualIp,
        publicKeyFingerprint:proof.publicKeyFingerprint,physicalDirectVerified:false as const};
    } finally {this.#store.release(lease);}
  }
}
