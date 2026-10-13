import { randomBytes } from 'node:crypto';

/** Only a private overlay namespace; this does not publish Internet DNS records. */
export const COMMUNITY_DNS_SUFFIX = 'lan.voice.ruikang.wang.';
export const COMMUNITY_DNS_MAX_AGE_MS = 10_000;
export const communityDnsZone = (value: unknown): value is string => typeof value === 'string' &&
  /^c-[a-f0-9]{32}\.lan\.voice\.ruikang\.wang\.$/.test(value);
export const communityDnsDeviceAlias = (value: unknown): value is string => typeof value === 'string' && /^d-[a-f0-9]{32}$/.test(value);
export const newCommunityDnsZone = () => `c-${randomBytes(16).toString('hex')}.${COMMUNITY_DNS_SUFFIX}`;
export const newCommunityDnsDeviceAlias = () => `d-${randomBytes(16).toString('hex')}`;
