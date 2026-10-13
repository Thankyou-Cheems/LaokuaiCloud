# Friendly community DNS contract

This source change requires a separately authorized deployment and product/network
acceptance. It creates private overlay names, not public Internet DNS records.

`POST /api/community-et/directory` uses the existing community member bearer and
exact request parser. The three supported requests are:

```json
{"v":1,"communityId":"configured-community"}
{"v":1,"communityId":"configured-community","includeDnsNames":true}
{"v":1,"communityId":"configured-community","includeDnsNames":true,"dnsNameStyle":"friendly"}
```

The first request retains its numeric-address response. The second retains the
exact existing DNS response and persistent name format
`d-<32 lowercase hex>.c-<32 lowercase hex>.lan.voice.ruikang.wang.` so existing
clients, including `.7`, remain compatible. The third negotiates friendly names
without adding response fields. `dns.zone` and each `members[].dnsName` use the
selected format. A style without `includeDnsNames:true`, any other style, unknown
properties, explicit null/undefined or accessors fail with HTTP 400
`invalid-directory-query`; callers cannot claim their own names or zones.

Friendly labels use a fixed 32-word lowercase pinyin noun vocabulary and a number
from 10 through 999, for example `mogu-27`. Allocation uses no nickname, account
identifier, native instance identifier or IP text. A reservation belongs to the
authenticated `(account_id, community_id, device_id)` and survives token/session,
display identifier and address changes, revocation, expiry and SQLite reopening.
Different devices of one account receive separate names. Revoked aliases remain
reserved and are never reassigned. There are 31,680 reservations per community;
random collisions retry 32 times, then the allocator searches the complete finite
pool. Exhaustion fails with HTTP 503 `dns-alias-pool-exhausted`.

The existing trusted factory inputs configure the short zone. When
`trustedServerOrigin` has the exact HTTPS host `voice.ruikang.wang` (default 443),
`createCommunityGrantFactory` reserves `lk.internal.` solely for its configured
`service.communityId`. No new environment setting is required. Other origins,
ports and community scopes receive separate, randomly issued, persisted
`lk-<8 lowercase hex>.internal.` zones. Zone uniqueness is enforced in SQLite.
The HTTP service still rejects a community other than its configured community.
A stored `lk.internal.` reservation cannot be published under a different
configured community or a factory without the trusted origin. Existing persisted
generic zones stay stable if configuration changes later; changing a trusted
community cannot transfer another community's fixed zone.

New `community_et_friendly_dns_zones` and `community_et_friendly_dns_devices`
tables are independent of legacy DNS and ET state. No existing address, session,
grant, membership, relay or legacy alias tables are rewritten. Older servers can
continue reading the unchanged legacy records after rollback. Keep the new tables
when rolling back so later re-enablement retains friendly reservations.

Both DNS formats use the same current membership/token-version checks, session ID
and authorization epoch fencing, confirmed grant/address verification and
asynchronous-read recheck. The existing 10-second maximum age and the earlier
session/grant expiry bound apply. Removed/revoked/expired devices leave the full
response. An authorized directory entry proves allocation only; it does not prove
a device is online, an ET route works, or a physical direct connection exists.

Source checks cover negotiation rejection, legacy response/table preservation,
fixed-zone origin/scope binding, unique names across devices/accounts, durable
reopening, address/display changes, collision retries, finite exhaustion,
membership/session fencing, revocation, TTL and corrupt independent reservations.
These checks do not establish Windows resolver or real two-device connectivity.
