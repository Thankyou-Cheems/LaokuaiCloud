import { randomUUID } from 'node:crypto';

import {
  assertCredentialProviderCapability, commitCommunityCredentialReadback, confirmCommunityGrantRevoked,
  COMMUNITY_ET_UPSTREAM_COMMIT, communityIdentity, copiedScope, exact, fail, id, intent, planCommunityCredentialOperation, positive, privateIpv4,
  retireCommunityGrant, safeArray, sameScope, uuid, type CommunityGrantOperation,
  type CommunityGrantScope, type CredentialProvider, type NativeAuthority, type PrivateCommunityGrantV1,
  type PrivateCommunityGrant, type RelayConsentV2, type PrivateNativeCredentialReceipt, type TrustedCommunityIntent,
} from './communityGrant';
import { verifyCurrentDeviceBinding } from './communityDeviceBinding';
import { deriveCredentialFingerprint } from './communityCredentialProvider';
import { parseRelayRequest, relayGrantFromReadback, type CommunityRelayRequestV2, type CommunityRelayRenewRequestV2,
  type CommunityRelayResponseV2, type RelayCredentialProvider, type StoredRelayState } from './communityRelayPolicy';
import type { CommunityMemberAuthorizer, CommunityMemberIdentity } from './communityGrantAuth';
import {
  parseCommunityGrantRequest, type CommunityAcquireRequestV1, type CommunityBindingRequestV1,
  type CommunityDirectoryRequestV1, type CommunityDirectoryResponseV1, type CommunityDnsDirectoryResponseV1,
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
  relayPolicyV2Enabled?: () => boolean;
}
export type CommunityGrantServiceProvider = CredentialProvider & Partial<RelayCredentialProvider>;
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
      'bootstrapProfileId','virtualIpPool','authority','ttlSeconds','enabled','credentialWritesEnabled','runtimeGeneration',
      ...(configuration.relayPolicyV2Enabled !== undefined ? ['relayPolicyV2Enabled'] : [])],'invalid-service-config');
    const c = configuration;
    if (!communityIdentity(c.serverInstanceId) || !communityIdentity(c.communityId) || ![c.networkName,c.bootstrapProfileId].every(id) || !positive(c.networkRevision) ||
        !positive(c.ttlSeconds) || c.ttlSeconds < 30 || c.ttlSeconds > 3600 || !safeArray(c.virtualIpPool,254) || c.virtualIpPool.length < 1 ||
        c.virtualIpPool.length > 254 || !c.virtualIpPool.every(privateIpv4) || new Set(c.virtualIpPool).size !== c.virtualIpPool.length ||
        typeof c.enabled !== 'function' || typeof c.credentialWritesEnabled !== 'function' || typeof c.runtimeGeneration !== 'function' ||
        (c.relayPolicyV2Enabled !== undefined && typeof c.relayPolicyV2Enabled !== 'function')) fail('invalid-service-config');
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
      issuedAtMs:identity.issuedAtMs,expiresAtMs:identity.expiresAtMs,intent:trusted,
      ...(identity.serverTokenVersion !== undefined && identity.userTokenVersion !== undefined ?
        {serverTokenVersion: identity.serverTokenVersion, userTokenVersion: identity.userTokenVersion} : {})});
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
  #relayReply(grant: PrivateCommunityGrant, relay: StoredRelayState, requestId: string): CommunityRelayResponseV2 {
    const now=this.#clock.wallMs();if (now >= grant.expiresAtMs || now < grant.serverTimeMs) fail('expired-grant');
    const confirmed=grant.v === 2 ? grant : {...grant,v:2 as const,policy:{...grant.policy,relay:{v:2 as const,enabled:false,revision:relay.consent.revision,bytesPerSecond:0}}};
    return {v:2,consent:structuredClone(relay.consent),grant:{...structuredClone(confirmed),requestId,serverTimeMs:now}};
  }
  /** Resolve an unknown Upsert by readback. This never retires ordinary ET. */
  async #settleRelay(bearer: string, session: CommunityStoredSession, lease: ScopeLease, state: StoredGrantState): Promise<StoredGrantState> {
    const relay=this.#store.relayState(session.intent),p=relay.pending,g=state.record.grant;
    if (!p) return state;
    if (!g || p.grantId !== g.grantId || p.credentialId !== g.credentialId || p.publicKeyFingerprint !== g.publicKeyFingerprint) {
      this.#store.saveRelayState(lease,{...relay,pending:null},this.#clock.wallMs());return state;
    }
    const actual=await this.#provider.read(g.credentialId,this.#config.authority.adminInstanceId);
    await this.#recheck(bearer,session,lease);
    if (g.expiresAtMs <= this.#clock.wallMs() && (!actual || actual.expiryUnix*1000 <= this.#clock.wallMs())) {
      this.#store.saveRelayState(lease,{...relay,pending:null},this.#clock.wallMs());return state;
    }
    if (!actual) fail('relay-readback-mismatch');
    if (actual.allowRelay === p.target.enabled && actual.expiryUnix === p.expiryUnix) {
      const grant=relayGrantFromReadback(g,p,actual,this.#config.authority.groups,this.#clock.wallMs());
      const storedGrant:PrivateCommunityGrant=grant.policy.allowRelay ? grant : {...grant,v:1,policy:{reusable:false,allowRelay:false,allowedProxyCidrs:[]}};
      const next={record:{...state.record,revision:grant.revision,grant:storedGrant},operation:null};
      this.#store.commitRelayState(lease,state.record.revision,next,{...relay,lastRequestId:p.requestId,pending:null},this.#clock.wallMs());return next;
    }
    if (actual.id !== g.credentialId || actual.publicKeyFingerprint !== g.publicKeyFingerprint || actual.reusable !== false ||
        actual.allowedProxyCidrs.length !== 0 || actual.allowRelay !== g.policy.allowRelay || actual.expiryUnix*1000 !== g.expiresAtMs ||
        actual.groups.length !== this.#config.authority.groups.length || !this.#config.authority.groups.every(group=>actual.groups.includes(group))) fail('relay-readback-mismatch');
    this.#store.saveRelayState(lease,{...relay,pending:null},this.#clock.wallMs());return state;
  }
  async #changeRelay(bearer: string, session: CommunityStoredSession, lease: ScopeLease, state: StoredGrantState,
    requestId: string, target: RelayConsentV2, renew: boolean, desired: RelayConsentV2 = target): Promise<StoredGrantState> {
    this.#writes();
    if (target.enabled && this.#config.relayPolicyV2Enabled?.() !== true) fail('relay-v2-disabled');
    if (!this.#provider.setRelayPolicySameKey) fail('relay-v2-disabled');
    const g=state.record.grant;
    if (state.operation || !g || g.expiresAtMs <= this.#clock.wallMs()) fail('inactive-binding-grant');
    const expiryUnix=renew ? Math.floor(this.#clock.wallMs()/1000)+this.#config.ttlSeconds : g.expiresAtMs/1000;
    if (renew && expiryUnix*1000 <= g.expiresAtMs) fail('renewal-not-extended');
    const pending={requestId,grantId:g.grantId,credentialId:g.credentialId,publicKeyFingerprint:g.publicKeyFingerprint,
      authorizationEpoch:session.authorizationEpoch,priorRevision:g.revision,previousAllowRelay:g.policy.allowRelay,
      target:structuredClone(target),expiryUnix,renew};
    const relay={consent:structuredClone(desired),lastRequestId:null,lastAttemptId:requestId,pending};
    this.#store.saveRelayState(lease,relay,this.#clock.wallMs());
    // An exception leaves this immutable pending intent plus the prior active
    // credential. A later call reads and reconciles it; no revoke compensation.
    await this.#provider.setRelayPolicySameKey({v:2,instance:this.#config.authority.adminInstanceId,id:g.credentialId,
      secret:g.credentialSecretB64,expiryUnix,groups:[...this.#config.authority.groups],previousAllowRelay:g.policy.allowRelay,allowRelay:target.enabled});
    const actual=await this.#provider.read(g.credentialId,this.#config.authority.adminInstanceId);
    await this.#recheck(bearer,session,lease);if (!actual) fail('relay-readback-mismatch');
    const grant=relayGrantFromReadback(g,pending,actual,this.#config.authority.groups,this.#clock.wallMs());
    const storedGrant:PrivateCommunityGrant=grant.policy.allowRelay ? grant : {...grant,v:1,policy:{reusable:false,allowRelay:false,allowedProxyCidrs:[]}};
    const next={record:{...state.record,revision:grant.revision,grant:storedGrant},operation:null};
    this.#store.commitRelayState(lease,state.record.revision,next,{consent:structuredClone(desired),lastRequestId:requestId,lastAttemptId:requestId,pending:null},this.#clock.wallMs());
    return next;
  }
  async relay(bearer: string, raw: CommunityRelayRequestV2): Promise<CommunityRelayResponseV2> {
    const body=parseRelayRequest(raw) as CommunityRelayRequestV2;
    const session=await this.#session(bearer,{...body,v:1});
    const lease=this.#store.claim(copiedScope(session.intent),this.#clock.wallMs());
    try {
      let state=await this.#settleRelay(bearer,session,lease,this.#store.load(session.intent));
      const current=this.#store.relayState(session.intent),g=state.record.grant;
      if (!g || g.grantId !== body.grantId) fail('unknown-grant');
      if (current.lastRequestId === body.requestId) {
        if (current.consent.enabled !== body.enabled || current.consent.bytesPerSecond !== body.bytesPerSecond) fail('relay-consent-conflict');
        return this.#relayReply(g,current,body.requestId);
      }
      // A failed attempt persisted consent before dispatch; exact retry may
      // finish it without allocating a second consent revision.
      const retry=current.lastAttemptId === body.requestId && current.consent.revision === body.expectedConsentRevision+1 && current.consent.enabled === body.enabled && current.consent.bytesPerSecond === body.bytesPerSecond;
      if (!retry && current.consent.revision !== body.expectedConsentRevision) fail('relay-consent-conflict');
      const consent={v:2 as const,enabled:body.enabled,revision:retry ? current.consent.revision : current.consent.revision+1,bytesPerSecond:body.bytesPerSecond};
      state=await this.#changeRelay(bearer,session,lease,state,body.requestId,consent,false);
      return this.#relayReply(state.record.grant!,this.#store.relayState(session.intent),body.requestId);
    } finally {this.#store.release(lease);}
  }
  async relayRenew(bearer: string, raw: CommunityRelayRenewRequestV2): Promise<CommunityRelayResponseV2> {
    const body=parseRelayRequest(raw,true) as CommunityRelayRenewRequestV2;
    const session=await this.#session(bearer,{...body,v:1}),lease=this.#store.claim(copiedScope(session.intent),this.#clock.wallMs());
    try {
      let state=await this.#settleRelay(bearer,session,lease,this.#store.load(session.intent));
      const relay=this.#store.relayState(session.intent),g=state.record.grant;
      if (!g || g.grantId !== body.grantId) fail('unknown-grant');
      if (relay.lastRequestId === body.requestId) return this.#relayReply(g,relay,body.requestId);
      const consent=this.#config.relayPolicyV2Enabled?.() === true ? relay.consent : {...relay.consent,enabled:false,bytesPerSecond:0};
      state=await this.#changeRelay(bearer,session,lease,state,body.requestId,consent,true,relay.consent);
      return this.#relayReply(state.record.grant!,this.#store.relayState(session.intent),body.requestId);
    } finally {this.#store.release(lease);}
  }
  async relayStatus(bearer: string, raw: CommunityRelayRenewRequestV2): Promise<CommunityRelayResponseV2> {
    const body=parseRelayRequest(raw,true) as CommunityRelayRenewRequestV2,session=await this.#session(bearer,{...body,v:1});
    const lease=this.#store.claim(copiedScope(session.intent),this.#clock.wallMs());
    try {
      const state=await this.#settleRelay(bearer,session,lease,this.#store.load(session.intent));
      if (!state.record.grant || state.record.grant.grantId !== body.grantId) fail('unknown-grant');
      return this.#relayReply(state.record.grant,this.#store.relayState(session.intent),body.requestId);
    } finally {this.#store.release(lease);}
  }
  async acquire(bearer: string, raw: CommunityAcquireRequestV1): Promise<PrivateCommunityGrantV1> {
    this.#enabled();const body=parseCommunityGrantRequest('acquire',raw),session=await this.#session(bearer,body);
    const lease=this.#store.claim(copiedScope(session.intent),this.#clock.wallMs());
    try {
      let state=await this.#settleRelay(bearer,session,lease,this.#store.load(session.intent));
      if (state.record.grant?.v === 2 && state.record.grant.expiresAtMs > this.#clock.wallMs()) {
        const relay=this.#store.relayState(session.intent);
        state=await this.#changeRelay(bearer,session,lease,state,body.requestId,{...relay.consent,enabled:false,bytesPerSecond:0},false,relay.consent);
        const confirmed=state.record.grant!;
        const grant:PrivateCommunityGrantV1={...confirmed,v:1,policy:{reusable:false,allowRelay:false,allowedProxyCidrs:[]}};
        const next={...state,record:{...state.record,grant}};
        this.#store.save(lease,state.record.revision,next);state=next;
      }
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
        return this.#reply(state.record.grant as PrivateCommunityGrantV1,body.requestId);
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
      const state=await this.#settleRelay(bearer,session,lease,this.#store.load(session.intent)),g=state.record.grant;
      if (state.operation) {this.#retire(lease,state);fail('reconciliation-required');}
      if (!g || g.grantId !== body.grantId || g.expiresAtMs <= this.#clock.wallMs()) fail('unknown-grant');
      if (g.v === 2) {
        const relay=this.#store.relayState(session.intent);
        const changed=await this.#changeRelay(bearer,session,lease,state,body.requestId,{...relay.consent,enabled:false,bytesPerSecond:0},true,relay.consent);
        const grant:PrivateCommunityGrantV1={...changed.record.grant!,v:1,policy:{reusable:false,allowRelay:false,allowedProxyCidrs:[]}};
        this.#store.save(lease,changed.record.revision,{...changed,record:{...changed.record,grant}});
        return this.#reply(grant,body.requestId);
      }
      if (g.v === 1 && g.requestId === body.requestId) return this.#reply(g,body.requestId);
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
      this.#store.save(lease,state.record.revision,{record,operation:null});return structuredClone(record.grant!) as PrivateCommunityGrantV1;
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
  async directory(bearer: string, raw: CommunityDirectoryRequestV1): Promise<CommunityDirectoryResponseV1 | CommunityDnsDirectoryResponseV1> {
    this.#enabled();
    const body = parseCommunityGrantRequest('directory', raw);
    if (body.communityId !== this.#config.communityId) fail('community-forbidden');
    const identity = await this.#identity(bearer, body.communityId);
    const directory = body.includeDnsNames === true ? this.#store.dnsDirectory(body.communityId, this.#clock.wallMs()) : null;
    const members = directory?.members ?? this.#store.directory(body.communityId, this.#clock.wallMs());
    const allowedSessions = new Map<string, string>();
    if (directory) {
      if (!this.#auth.directorySessionAllowed) fail('auth-unavailable');
      for (const session of directory.authorizations) {
        // Old sealed sessions remain valid for v1 IPs, but must be verified again
        // before their names can be published against current token versions.
        if (session.serverTokenVersion === undefined || session.userTokenVersion === undefined) continue;
        if (await this.#auth.directorySessionAllowed({...session,
          serverTokenVersion: session.serverTokenVersion, userTokenVersion: session.userTokenVersion}, body.communityId))
          allowedSessions.set(session.dnsName, `${session.sessionId}:${session.authorizationEpoch}`);
      }
    }
    const current = await this.#identity(bearer, body.communityId);
    if (current.tokenDigest !== identity.tokenDigest || current.serverUserId !== identity.serverUserId) fail('auth-retired');
    if (directory) {
      // Recheck grants and scope after asynchronous membership reads; do not
      // carry an old authorization decision into a replaced session or address.
      const fresh = this.#store.dnsDirectory(body.communityId, this.#clock.wallMs());
      const liveNames = new Set(fresh.authorizations.filter(session => allowedSessions.get(session.dnsName) === `${session.sessionId}:${session.authorizationEpoch}`).map(session => session.dnsName));
      const liveMembers = new Map(fresh.members.map(member => [member.dnsName, member]));
      const names = directory.members.flatMap(member => {
        const live = liveMembers.get(member.dnsName);
        if (!liveNames.has(member.dnsName) || !live || live.virtualIp !== member.virtualIp) return [];
        const dnsExpiresAtMs = Math.min(member.dnsExpiresAtMs, live.dnsExpiresAtMs);
        return dnsExpiresAtMs > this.#clock.wallMs() ? [{...member, dnsExpiresAtMs}] : [];
      });
      return {v: 1 as const, communityId: body.communityId, members: names,
        dns: {zone: directory.zone, serverTimeMs: directory.serverTimeMs, maxAgeMs: directory.maxAgeMs}};
    }
    return {v: 1 as const, communityId: body.communityId, members};
  }
}
