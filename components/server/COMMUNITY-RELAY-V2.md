# Member relay V2 source contract

This is local source work. No deployment, real `allowRelay:true` credential,
public-node configuration change or WAN relay acceptance has occurred.

The backend gate is `LAOKUAI_MEMBER_RELAY_POLICY_V2=1`, and still requires the
existing enabled community and explicitly approved credential writes. The
management proxy has an independent `MEMBER_RELAY_POLICY_VERSION=2` gate;
its default is `1`, which rejects true relay flags. Enable neither gate until
the corresponding proxy/native version and local forwarding budget have been
verified and deployment has been approved. No new service or PKI is introduced.

V1 session/acquire/renew and the V1 grant validator keep their strict false-only
policy. New endpoints share the existing bearer authentication, current member
checks, per-device session and per-scope lease:

```ts
// POST /api/community-et/relay
{
  v: 2, communityId, deviceId, nativeInstanceId, requestId, grantId,
  expectedConsentRevision, enabled, bytesPerSecond
}
// POST /api/community-et/relay-renew or /relay-status
{ v: 2, communityId, deviceId, nativeInstanceId, requestId, grantId }
// Response
{ v: 2, consent: {v: 2, enabled, revision, bytesPerSecond}, grant }
```

`enabled:true` requires an integer budget of 1024–1048576 bytes/second;
`enabled:false` requires zero. Consent starts disabled at revision zero.
Mutation requires the current revision; `relay-status` supplies it after a
conflict or restart. Exact request retries are idempotent. Extra identity,
credential, privilege or native-policy fields are rejected. The main process
retains the private grant; it must never be copied to renderer/public state.

A V2 grant has the existing private V1 fields, `v:2`, and:

```ts
policy: {
  reusable: false, allowRelay: boolean, allowedProxyCidrs: [],
  relay: {v: 2, enabled, revision, bytesPerSecond}
}
```

The grant's `relay.enabled` equals its confirmed `allowRelay`; the response's
top-level `consent` is the persisted desired preference. They can differ after
the deployment gate is disabled or a legacy V1 request downgrades qualification.
Only confirmed grant policy can authorize a local forwarding budget. A backend
budget is an authorization bound; it does not prove a native limiter was applied.

Policy changes use the existing credential's secret/key, fingerprint, credential
ID, grant ID, virtual IP, network and instance. Toggles preserve expiry; V2 renew
extends it through native Upsert and exact List readback. V1 renew/acquire can
downgrade the same credential to false without removing ordinary ET membership.
Per-credential expected policy, including a durable pending target, allows mixed
V1/V2 credentials to pass issuer health checks without treating all as false.

Preferences and pending mutations are encrypted in an add-only SQLite table.
Grant and confirmed preference commit in one transaction. Unknown Upsert results
retain the previous active grant and pending intent; the next request reconciles
native readback. Relay failures never call the ordinary grant retirement path.
Membership revocation still follows the existing authenticated cleanup path.

Withdrawal confirms only that the issuer List readback is false. It does not
prove immediate WAN advertisement propagation or remote forwarding cessation.
Clients should first stop their local budget and retry pending qualification
updates while retaining ordinary LAN service. Existing TTL/expiry safety remains.

Tests cover strict V1 rejection, default-off gates, scoped consent, bounded
budgets, same-key toggles/renewal, mixed credential health, unknown results and
SQLite reopening. The portable proxy policy tests use synthetic RPC frames and
temporary ledgers; the Linux listener lifecycle suite remains separate.

## Rollback boundary

A default-off deployment keeps V1 sealed grants and native false credentials in
their original shape; the added preference table can be left unused. Once V2
has been enabled, an older backend cannot validate V2 sealed grants or a mixed
true/false issuer. Switching directly to the old image is not a valid rollback.

Before reverting a deployment which issued V2 qualification:

1. Back up the complete SQLite database, proxy ledger and exact deployed source/
   images privately. Keep the V2 backend/native/proxy running while downgrading.
   Stop local member forwarding budgets; prevent new enabled consent requests.
2. For each unexpired V2 device scope, submit disabled consent (current consent
   revision, zero budget) and confirm issuer List `allowRelay:false` with the
   same credential ID, key fingerprint and expiry. Then use its authenticated
   legacy V1 acquire/renew to verify the stored sealed grant is V1 (confirmed
   false transitions already save a V1 record). Grant/key/IP
   continuity must be read back, not inferred from an HTTP success alone.
3. Reconcile every pending relay operation. Offline/unavailable device sessions
   require an explicitly reviewed administrative migration using the existing
   sealed store and fixed issuer; this source change does not supply or run an
   unattended production migration. Expired V2 records still need conversion
   before old `recordShape` scans them. If the fixed proxy cannot renew an expired
   credential, remove that expired credential through the existing revoke/readback
   path, then convert its expired stored policy to V1 under a store lease.
4. Verify **all** stored active/expired grant records are V1-readable, all managed
   live native credentials are false, and no relay pending mutation remains.
   Disable both V2 gates and verify ordinary V1 renewal/health. Only then return
   to the old image. Keep backups and failures private for recovery.

These steps are a rollback prerequisite, not a claim that every offline scope
can be downgraded through a user's live session or that WAN peers stop instantly.
