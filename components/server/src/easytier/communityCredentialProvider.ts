import { createPrivateKey, createPublicKey } from 'node:crypto';

import { type ProviderPeerObservation } from './communityDeviceBinding';
import type { RelayNativeIntent } from './communityRelayPolicy';
import {
  COMMUNITY_ET_UPSTREAM_COMMIT, exact, expiryUnixToMs, fail, fingerprint, id, keyBytes,
  positive, privateIpv4, publicKeyFingerprint, safeArray, uuid,
  type CommunityGrantScope, type CreateCredentialIntent, type CredentialProvider,
  type ExtendCredentialIntent, type NativeCredentialReadback, type PrivateNativeCredentialReceipt,
} from './communityGrant';
import {
  CommunityTcpRpcTransport, pbBytes, pbDecode, pbGetBool, pbGetBytes, pbGetNumber,
  pbGetString, pbInstance, pbNumber, pbRepeatedBytes, pbString,
  type CommunityRpcTransport, type RpcEndpoint, type PbFields,
} from './communityRpcWire';

export interface FixedCredentialProviderConfig {
  upstreamCommit: typeof COMMUNITY_ET_UPSTREAM_COMMIT;
  adminInstanceId: string;
  /** Deployment verified this exact native version/payload; NodeInfo exposes no commit hash. */
  expectedVersion: string;
  networkName: string;
  endpoint: RpcEndpoint;
  /** Actual owned issuer process epoch; not per TCP connection or a constant success flag. */
  runtimeGeneration: () => number;
  /** Persisted current grants, used to detect store loss rather than treating it as new. */
  expectedActiveCredentials: () => Array<{credentialId: string; publicKeyFingerprint: string; expiresAtMs: number; allowRelay?: boolean; pendingAllowRelay?: boolean}>;
  /** A separately approved issuer/proxy/native policy deployment. Defaults off. */
  relayPolicyV2Enabled?: () => boolean;
}
/** RFC8410 PKCS8/SPKI for X25519. Derives from an existing secret; generates no key. */
export function deriveCredentialFingerprint(secretB64: string): string {
  try {
    const privateKey = createPrivateKey({key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), keyBytes(secretB64)]), format: 'der', type: 'pkcs8'});
    const publicDer = createPublicKey(privateKey).export({format: 'der', type: 'spki'});
    if (publicDer.length !== 44 || !publicDer.subarray(0, 12).equals(Buffer.from('302a300506032b656e032100', 'hex'))) fail('native-key-mismatch');
    return publicKeyFingerprint(publicDer.subarray(12).toString('base64'));
  } catch { return fail('native-key-mismatch'); }
}
function strings(fields: PbFields, field: number): string[] {
  return pbRepeatedBytes(fields, field).map(bytes => {
    const s = bytes.toString('utf8'); if (!Buffer.from(s, 'utf8').equals(bytes)) fail('rpc-invalid-string'); return s;
  });
}
function credential(bytes: Buffer): NativeCredentialReadback {
  const fields = pbDecode(bytes, {1:2,2:2,3:0,4:0,5:2,6:0,7:2}, [2,5]);
  const result = {id: pbGetString(fields, 1), groups: strings(fields, 2), allowRelay: pbGetBool(fields, 3),
    expiryUnix: pbGetNumber(fields, 4), allowedProxyCidrs: strings(fields, 5),
    reusable: fields.has(6) ? pbGetBool(fields, 6) : true, publicKeyFingerprint: pbGetString(fields, 7)};
  if (!id(result.id) || !fingerprint(result.publicKeyFingerprint)) fail('native-readback-mismatch');
  expiryUnixToMs(result.expiryUnix); return result;
}
export class FixedInstanceCredentialProvider implements CredentialProvider {
  #config: FixedCredentialProviderConfig; #wire: CommunityRpcTransport;
  constructor(config: FixedCredentialProviderConfig, wire?: CommunityRpcTransport) {
    exact<FixedCredentialProviderConfig>(config,['upstreamCommit','adminInstanceId','expectedVersion',
      'networkName','endpoint','runtimeGeneration','expectedActiveCredentials',
      ...(config.relayPolicyV2Enabled !== undefined ? ['relayPolicyV2Enabled'] : [])],'invalid-provider-config');
    exact<RpcEndpoint>(config.endpoint,['host','port','timeoutMs'],'invalid-provider-config');
    if (config.upstreamCommit !== COMMUNITY_ET_UPSTREAM_COMMIT || !uuid(config.adminInstanceId) || !id(config.networkName) ||
        typeof config.runtimeGeneration !== 'function' ||
        typeof config.expectedActiveCredentials !== 'function' || (config.relayPolicyV2Enabled !== undefined && typeof config.relayPolicyV2Enabled !== 'function') || !/^2\.7\.0(?:-[A-Za-z0-9._-]+)?$/.test(config.expectedVersion) ||
        !['127.0.0.1','::1'].includes(config.endpoint.host) || !positive(config.endpoint.port) || config.endpoint.port > 65535 ||
        !positive(config.endpoint.timeoutMs) || config.endpoint.timeoutMs > 1000) fail('invalid-provider-config');
    this.#config = {...config,endpoint:{...config.endpoint}}; this.#wire = wire ?? new CommunityTcpRpcTransport(config.endpoint);
  }
  #select(instance: string): Buffer {
    if (instance !== this.#config.adminInstanceId) fail('invalid-admin-instance'); return pbInstance(instance);
  }
  async #healthy(): Promise<NativeCredentialReadback[]> {
    const records=await this.#list();
    for (const expected of this.#config.expectedActiveCredentials()) {
      const actual=records.find(c=>c.id===expected.credentialId);
      if (!actual || actual.publicKeyFingerprint !== expected.publicKeyFingerprint ||
          expiryUnixToMs(actual.expiryUnix) < expected.expiresAtMs || actual.reusable !== false ||
          (actual.allowRelay !== (expected.allowRelay ?? false) && actual.allowRelay !== expected.pendingAllowRelay) || actual.allowedProxyCidrs.length !== 0) fail('issuer-store-unavailable');
    }
    return records;
  }
  async #node() {
    const bytes = await this.#wire.call({service: 'PeerManageRpc', index: 7}, pbBytes(1, this.#select(this.#config.adminInstanceId)));
    const node = pbDecode(pbGetBytes(pbDecode(bytes, {1:2}), 1), {1:0,2:2,3:2,4:2,5:2,6:2,7:2,8:2,9:2,10:2,11:2,12:2,13:2}, [3,7]);
    // Deliberately discard config field 8 and all other raw NodeInfo fields.
    const result = {peerId: pbGetNumber(node, 1), instanceId: pbGetString(node, 6), version: pbGetString(node, 9)};
    if (!positive(result.peerId) || result.peerId > 0xffffffff || result.instanceId !== this.#config.adminInstanceId ||
        result.version !== this.#config.expectedVersion) fail('provider-incompatible');
    return result;
  }
  /** RPC List/ledger consistency, not an attestation of on-disk persistence.
   * Owner must verify native persistence and Admin before enabling writes. */
  async inspectInstance(instance: string) {
    this.#select(instance); await this.#node(); await this.#healthy();
    return {instance, upstreamCommit: this.#config.upstreamCommit, sameKeyUpsert: true, credentialStore: 'healthy' as const};
  }
  async #list(): Promise<NativeCredentialReadback[]> {
    const bytes = await this.#wire.call({service: 'CredentialManageRpc', index: 3}, pbBytes(1, this.#select(this.#config.adminInstanceId)));
    const result = pbRepeatedBytes(pbDecode(bytes, {1:2}, [1]), 1).map(credential);
    if (new Set(result.map(c => c.id)).size !== result.length) fail('native-readback-mismatch'); return result;
  }
  async read(credentialId: string, instance: string): Promise<NativeCredentialReadback | null> {
    this.#select(instance); if (!id(credentialId)) fail('invalid-credential-id');
    return (await this.#list()).find(c => c.id === credentialId) ?? null;
  }
  async create(request: CreateCredentialIntent): Promise<PrivateNativeCredentialReceipt> {
    this.#select(request.instance);
    if (!id(request.credentialId) || !positive(request.ttlSeconds) || request.ttlSeconds > 3600 || request.reusable !== false ||
        request.allowRelay !== false || !safeArray(request.allowedProxyCidrs, 0) || !safeArray(request.groups, 32) || !request.groups.every(id)) fail('unsafe-native-request');
    await this.#healthy();
    const payload = Buffer.concat([...request.groups.map(g => pbString(1, g)), pbNumber(2, 0), pbNumber(4, request.ttlSeconds),
      pbString(5, request.credentialId), pbBytes(6, this.#select(request.instance)), pbNumber(7, 0)]);
    const reply = pbDecode(await this.#wire.call({service: 'CredentialManageRpc', index: 1}, payload), {1:2,2:2,3:0});
    const credentialId = pbGetString(reply, 1), secret = pbGetString(reply, 2), expiryUnix = pbGetNumber(reply, 3);
    if (credentialId !== request.credentialId) fail('native-readback-mismatch'); expiryUnixToMs(expiryUnix);
    const derivedPublicKeyFingerprint = deriveCredentialFingerprint(secret);
    const actual=await this.read(credentialId,request.instance);
    if (!actual || actual.publicKeyFingerprint !== derivedPublicKeyFingerprint || actual.expiryUnix !== expiryUnix) fail('native-readback-mismatch');
    return {credentialId, credentialSecretB64: secret, expiryUnix, derivedPublicKeyFingerprint};
  }
  async extendSameKey(request: ExtendCredentialIntent): Promise<{changed: boolean}> {
    await this.#healthy(); this.#select(request.instance); keyBytes(request.secret); expiryUnixToMs(request.expiryUnix);
    if (!id(request.id) || request.reusable !== false || request.allowRelay !== false || !safeArray(request.allowedProxyCidrs, 0) ||
        !safeArray(request.groups, 32) || !request.groups.every(id)) fail('unsafe-native-request');
    const previous=await this.read(request.id,request.instance);
    if (!previous || previous.publicKeyFingerprint !== deriveCredentialFingerprint(request.secret)) fail('renewal-identity-changed');
    if (request.expiryUnix < previous.expiryUnix) fail('renewal-not-extended');
    const payload = Buffer.concat([pbString(1, request.id), pbString(2, request.secret), ...request.groups.map(g => pbString(3, g)),
      pbNumber(4, 0), pbNumber(6, request.expiryUnix), pbNumber(7, 0), pbBytes(8, this.#select(request.instance))]);
    const reply = pbDecode(await this.#wire.call({service:'CredentialManageRpc', index: 4}, payload), {1:0});
    return {changed: pbGetBool(reply, 1)};
  }
  /** V2 changes qualification, not membership/key/IP. Unknown outcomes are
   * reconciled by the service's durable pending policy; never revoke here. */
  async setRelayPolicySameKey(request: RelayNativeIntent): Promise<{changed: boolean}> {
    exact<RelayNativeIntent>(request,['v','instance','id','secret','expiryUnix','groups','previousAllowRelay','allowRelay'],'unsafe-native-request');
    this.#select(request.instance); keyBytes(request.secret); expiryUnixToMs(request.expiryUnix);
    if (request.v !== 2 || !id(request.id) || typeof request.allowRelay !== 'boolean' || typeof request.previousAllowRelay !== 'boolean' ||
        !safeArray(request.groups,32) || !request.groups.length || !request.groups.every(id) || new Set(request.groups).size !== request.groups.length)
      fail('unsafe-native-request');
    if (request.allowRelay && this.#config.relayPolicyV2Enabled?.() !== true) fail('relay-v2-disabled');
    await this.#healthy();
    const previous=await this.read(request.id,request.instance);
    if (!previous || previous.publicKeyFingerprint !== deriveCredentialFingerprint(request.secret) || previous.reusable !== false ||
        previous.allowedProxyCidrs.length !== 0 || previous.groups.length !== request.groups.length || !request.groups.every(g=>previous.groups.includes(g)) ||
        (previous.allowRelay !== request.previousAllowRelay && previous.allowRelay !== request.allowRelay)) fail('relay-readback-mismatch');
    if (request.expiryUnix < previous.expiryUnix) fail('renewal-not-extended');
    const payload=Buffer.concat([pbString(1,request.id),pbString(2,request.secret),...request.groups.map(g=>pbString(3,g)),
      pbNumber(4,request.allowRelay ? 1 : 0),pbNumber(6,request.expiryUnix),pbNumber(7,0),pbBytes(8,this.#select(request.instance))]);
    const reply=pbDecode(await this.#wire.call({service:'CredentialManageRpc',index:4},payload),{1:0});
    return {changed:pbGetBool(reply,1)};
  }
  async revoke(request: {credentialId: string; instance: string}) {
    if (!id(request.credentialId)) fail('invalid-credential-id');
    const reply = await this.#wire.call({service:'CredentialManageRpc', index: 2}, Buffer.concat([
      pbString(1, request.credentialId), pbBytes(2, this.#select(request.instance))]));
    return {success: pbGetBool(pbDecode(reply, {1:0}), 1)};
  }
  async #peers(): Promise<ProviderPeerObservation['connections']> {
    const reply = await this.#wire.call({service:'PeerManageRpc', index: 1}, pbBytes(1, this.#select(this.#config.adminInstanceId)));
    const connections: ProviderPeerObservation['connections'] = [];
    for (const peer of pbRepeatedBytes(pbDecode(reply, {1:2,2:2}, [1]), 1)) {
      const p = pbDecode(peer, {1:0,2:2,3:2,4:2}, [2,4]); const peerId = pbGetNumber(p, 1);
      for (const conn of pbRepeatedBytes(p, 2)) {
        const c = pbDecode(conn, {1:2,2:0,3:0,4:2,5:2,6:2,7:5,8:0,9:2,10:0,11:2,12:2,13:0,14:0}, [4]);
        if (pbGetNumber(c, 3) !== peerId) fail('provider-observation-mismatch');
        const networkName = pbGetString(c, 9); if (networkName !== this.#config.networkName) continue;
        const key = pbGetBytes(c, 12); if (key.length === 0) continue;
        if (key.length !== 32) fail('invalid-key-format');
        connections.push({peerId, networkName, isClosed: pbGetBool(c, 10), secureAuthLevel: pbGetNumber(c, 13),
          peerIdentityType: pbGetNumber(c, 14), remotePublicKeyB64: key.toString('base64')});
      }
    }
    if (connections.length > 4096) fail('provider-observation-mismatch'); return connections;
  }
  async #routes(): Promise<ProviderPeerObservation['routes']> {
    const reply = await this.#wire.call({service:'PeerManageRpc', index: 3}, pbBytes(1, this.#select(this.#config.adminInstanceId)));
    const routes: ProviderPeerObservation['routes'] = [];
    for (const bytes of pbRepeatedBytes(pbDecode(reply, {1:2}, [1]), 1)) {
      const r = pbDecode(bytes, {1:0,2:2,3:0,4:0,5:2,6:2,7:2,8:2,9:2,10:2,11:0,12:0,13:0,14:0,15:2,16:2,17:2}, [5]);
      const inet = pbDecode(pbGetBytes(r, 2), {1:2,2:0});
      const address = pbGetNumber(pbDecode(pbGetBytes(inet, 1), {1:0}), 1);
      const virtualIp = [24,16,8,0].map(shift => (address >>> shift) & 255).join('.');
      if (!privateIpv4(virtualIp)) continue; // No DHCP/public-address claim in this contract.
      routes.push({peerId: pbGetNumber(r, 1), nativeInstanceId: pbGetString(r, 8), virtualIp, nextHopPeerId: pbGetNumber(r, 3)});
    }
    if (routes.length > 254) fail('provider-observation-mismatch'); return routes;
  }
  async observeAuthenticatedPeer(request: {instance: string; expectedProviderGeneration: number; scope: CommunityGrantScope}) {
    this.#select(request.instance);
    const generation = this.#config.runtimeGeneration();
    if (!positive(generation) || generation !== request.expectedProviderGeneration) fail('provider-observation-mismatch');
    const beforeNode = await this.#node(); const before = await this.#peers(); const routes = await this.#routes();
    const after = await this.#peers(); const afterNode = await this.#node();
    if (generation !== this.#config.runtimeGeneration() || beforeNode.peerId !== afterNode.peerId ||
        JSON.stringify(before) !== JSON.stringify(after)) return {status:'pending' as const, code:'unstable-sample' as const};
    if (!after.some(c => !c.isClosed && c.secureAuthLevel === 2 && c.peerIdentityType === 1))
      return {status:'pending' as const, code:'no-connection-key' as const};
    return {providerGeneration: generation, observedMonoMs: Math.floor(performance.now()), networkName:this.#config.networkName,
      connections: after, routes};
  }
}
