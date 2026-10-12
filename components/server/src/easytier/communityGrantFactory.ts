import type { DatabaseSync } from 'node:sqlite';
import type { RequestHandler } from 'express';

import { COMMUNITY_ET_UPSTREAM_COMMIT, exact, fail, uuid } from './communityGrant';
import { createCommunityMemberAuthorizer, type ExistingCommunityAuthServices } from './communityGrantAuth';
import { FixedInstanceCredentialProvider, type FixedCredentialProviderConfig } from './communityCredentialProvider';
import { createCommunityGrantRouter } from './communityGrantRouter';
import { CommunityGrantService, type CommunityGrantServiceConfiguration, type CommunityServiceClock } from './communityGrantService';
import { communityVaultKey, SqliteCommunityGrantStore } from './communityGrantStore';
import type { CommunityRpcTransport } from './communityRpcWire';

export interface CommunityGrantFactoryOptions {
  db: DatabaseSync; serverSecret: string; existingAuth: ExistingCommunityAuthServices; trustedServerOrigin: string;
  service: CommunityGrantServiceConfiguration;
  provider: Omit<FixedCredentialProviderConfig,'upstreamCommit'|'networkName'|'expectedActiveCredentials'|'runtimeGeneration'>;
  clock?: CommunityServiceClock; rateLimit?: RequestHandler;
  /** Trusted server-owned management-plane adapter, if loopback is inaccessible
   * in the backend namespace. No forwarder/proxy is created by this factory. */
  managementTransport?: CommunityRpcTransport;
}
/** Add-only owner seam. Pass getSqliteDb(), getJwtSecret(), verifyAccessToken,
 * getServerConfig and checkSessionAllowed from their existing modules.
 * Call initializeSchema() explicitly after normal DB init; mount router at
 * /api/community-et. Construction issues no RPC and never starts an ET process.
 * Real public 2.7 target/configuration and activation receipts are owner inputs;
 * no fallback public/private issuer, payload upgrade or endpoint discovery.
 */
export function createCommunityGrantFactory(options: CommunityGrantFactoryOptions) {
  const origin=new URL(options.trustedServerOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash ||
      origin.pathname !== '/') fail('invalid-server-origin');
  exact<CommunityGrantFactoryOptions['provider']>(options.provider,['adminInstanceId','expectedVersion','endpoint'],'invalid-provider-config');
  if (!uuid(options.provider.adminInstanceId) || options.provider.adminInstanceId !== options.service.authority.adminInstanceId ||
      options.service.authority.upstreamCommit !== COMMUNITY_ET_UPSTREAM_COMMIT) fail('invalid-provider-config');
  const wall=options.clock?.wallMs??Date.now;
  const store=new SqliteCommunityGrantStore(options.db,communityVaultKey(options.serverSecret));
  const provider=new FixedInstanceCredentialProvider({...options.provider,upstreamCommit:COMMUNITY_ET_UPSTREAM_COMMIT,
    // Owner's trusted server configuration supplies the actual management plane
    // (public cheems-p2p host-loopback15890), never a request/renderer override.
    networkName:options.service.networkName,
    runtimeGeneration:options.service.runtimeGeneration,expectedActiveCredentials:()=>store.expectedActiveCredentials(wall())},options.managementTransport);
  const authorize=createCommunityMemberAuthorizer(options.existingAuth,{communityId:options.service.communityId,serverHost:origin.host},wall);
  const service=new CommunityGrantService(options.service,store,provider,authorize,options.clock);
  return {service,store,provider,router:createCommunityGrantRouter(service,options.rateLimit,options.service.enabled),initializeSchema:()=>store.initSchema()};
}
