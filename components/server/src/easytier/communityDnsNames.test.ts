import assert from 'node:assert/strict';
import test from 'node:test';

import { ContractError } from './communityGrant';
import {
  COMMUNITY_FRIENDLY_DNS_ALIAS_CAPACITY, communityFriendlyDnsAliasAt, communityFriendlyDnsDeviceAlias,
  communityFriendlyDnsZone, newCommunityFriendlyDnsDeviceAlias,
} from './communityDnsNames';

test('the controlled finite friendly alias vocabulary is unique and matches the short wire format',()=>{
  const pool=new Set<string>();
  for(let index=0;index<COMMUNITY_FRIENDLY_DNS_ALIAS_CAPACITY;index++){
    const alias=communityFriendlyDnsAliasAt(index);
    assert.match(alias,/^[a-z]{3,12}-[1-9][0-9]{1,2}$/);
    assert.equal(communityFriendlyDnsDeviceAlias(alias),true);
    assert.equal(pool.has(alias),false);pool.add(alias);
  }
  assert.equal(pool.size,31680);
  for(const invalid of ['nickname-27','mogu-01','mogu-1','mogu-1000','Mogu-27','mogu-27.example'])
    assert.equal(communityFriendlyDnsDeviceAlias(invalid),false);
});

test('friendly allocation retries collisions and deterministically finds the last available reservation',()=>{
  const first=communityFriendlyDnsAliasAt(0),second=communityFriendlyDnsAliasAt(1);
  let calls=0;
  assert.equal(newCommunityFriendlyDnsDeviceAlias(new Set([first]),()=>calls++===0?0:1),second);
  assert.equal(calls,2);
  const used=new Set(Array.from({length:COMMUNITY_FRIENDLY_DNS_ALIAS_CAPACITY-1},(_,index)=>communityFriendlyDnsAliasAt(index)));
  calls=0;
  assert.equal(newCommunityFriendlyDnsDeviceAlias(used,()=>{calls++;return 0;}),communityFriendlyDnsAliasAt(COMMUNITY_FRIENDLY_DNS_ALIAS_CAPACITY-1));
  assert.equal(calls,33);
  used.add(communityFriendlyDnsAliasAt(COMMUNITY_FRIENDLY_DNS_ALIAS_CAPACITY-1));
  assert.throws(()=>newCommunityFriendlyDnsDeviceAlias(used,()=>0),error=>error instanceof ContractError&&error.code==='dns-alias-pool-exhausted');
});

test('friendly zones are private absolute names with exact supported shapes',()=>{
  for(const zone of ['lk.internal.','lk-0123abcd.internal.'])assert.equal(communityFriendlyDnsZone(zone),true);
  for(const zone of ['lk.internal','lk-123.internal.','LK.internal.','lk-0123abcd.internal.evil.','evil.internal.'])
    assert.equal(communityFriendlyDnsZone(zone),false);
});
