import { randomBytes, randomInt } from 'node:crypto';

import { fail } from './communityGrant';

/** Only a private overlay namespace; this does not publish Internet DNS records. */
export const COMMUNITY_DNS_SUFFIX = 'lan.voice.ruikang.wang.';
export const COMMUNITY_DNS_MAX_AGE_MS = 10_000;
export const communityDnsZone = (value: unknown): value is string => typeof value === 'string' &&
  /^c-[a-f0-9]{32}\.lan\.voice\.ruikang\.wang\.$/.test(value);
export const communityDnsDeviceAlias = (value: unknown): value is string => typeof value === 'string' && /^d-[a-f0-9]{32}$/.test(value);
export const newCommunityDnsZone = () => `c-${randomBytes(16).toString('hex')}.${COMMUNITY_DNS_SUFFIX}`;
export const newCommunityDnsDeviceAlias = () => `d-${randomBytes(16).toString('hex')}`;

export type CommunityDnsNameStyle = 'legacy' | 'friendly';
export const COMMUNITY_FRIENDLY_DNS_ZONE = 'lk.internal.';
// A fixed vocabulary avoids nicknames, machine names and account identifiers.
export const COMMUNITY_FRIENDLY_DNS_NOUNS = Object.freeze([
  'mogu', 'pingguo', 'taozi', 'juzi', 'lizi', 'putao', 'xigua', 'ningmeng',
  'hulu', 'douzi', 'huasheng', 'zhima', 'mantou', 'baozi', 'jiaozi', 'tangyuan',
  'yunduo', 'shitou', 'shanye', 'songshu', 'zhuzi', 'huaduo', 'yueliang', 'xingxing',
  'xiaolu', 'xiaomao', 'xiaogou', 'haitun', 'qie', 'xiongmao', 'mifeng', 'hudie',
]);
export const COMMUNITY_FRIENDLY_DNS_ALIAS_CAPACITY = COMMUNITY_FRIENDLY_DNS_NOUNS.length * 990;
export const communityFriendlyDnsAliasAt = (index: number): string =>
  `${COMMUNITY_FRIENDLY_DNS_NOUNS[Math.floor(index / 990)]}-${10 + index % 990}`;
const friendlyNouns = new Set<string>(COMMUNITY_FRIENDLY_DNS_NOUNS);
export const communityFriendlyDnsDeviceAlias = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const match = /^([a-z]{3,12})-([1-9][0-9]{1,2})$/.exec(value);
  return !!match && friendlyNouns.has(match[1]);
};
export const communityFriendlyDnsZone = (value: unknown): value is string => typeof value === 'string' &&
  /^(?:lk|lk-[a-f0-9]{8})\.internal\.$/.test(value);
export const newCommunityFriendlyDnsZone = () => `lk-${randomBytes(4).toString('hex')}.internal.`;
/** Retry random collisions, then search the finite pool so luck cannot cause
 * premature exhaustion. Reserved aliases, including revoked ones, stay taken. */
export function newCommunityFriendlyDnsDeviceAlias(used: ReadonlySet<string>, pick: (max: number) => number = randomInt): string {
  for (let attempt = 0; attempt < 32; attempt++) {
    const alias = communityFriendlyDnsAliasAt(pick(COMMUNITY_FRIENDLY_DNS_ALIAS_CAPACITY));
    if (!used.has(alias)) return alias;
  }
  const start = pick(COMMUNITY_FRIENDLY_DNS_ALIAS_CAPACITY);
  for (let offset = 0; offset < COMMUNITY_FRIENDLY_DNS_ALIAS_CAPACITY; offset++) {
    const alias = communityFriendlyDnsAliasAt((start + offset) % COMMUNITY_FRIENDLY_DNS_ALIAS_CAPACITY);
    if (!used.has(alias)) return alias;
  }
  return fail('dns-alias-pool-exhausted');
}
