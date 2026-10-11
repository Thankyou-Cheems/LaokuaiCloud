import { createHash } from 'node:crypto';

const deepFreeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; };
const delivery = 'C:\\Users\\cheb2\\Documents\\Codex\\2026-10-10\\task-2\\et-windows-build-no-npcap\\delivery';
export const SCOPE = deepFreeze({
  schema: 3, trial: 'single-no-peer-owned-tun-no-npcap', maximumRunMs: 30000,
  snapshot: { timeoutMs: 40000, maxBufferBytes: 2097152, diagnosticProtocol: 1,
    scriptSha256: 'f73213399a3d07d6e317c480e59ccd87d1e948ffce86aa5e4a94c1a3d1909fdb', readerSha256: 'f2f7394a9cb1666d3a66ae2a8e0606c4ea7ba8f42f8d1ba481fd682e71848726' },
  stopForceAfterMs: 4000, stopFinalAfterMs: 6000, residualObservationMs: 40000,
  alias: 'lk_trial_20261011_a', virtualAddress: '10.253.253.1', prefix: 30,
  portal: '127.0.0.1:15897', peerServers: [], etListeners: [], stunServers: [], upnp: false,
  payload: [
    { name: 'easytier-core.exe', path: delivery + '\\easytier-core.exe', bytes: 20107264, sha256: 'd4f100ace0ae50b5270af10f579a2ccf7b2991731f05b82920eefba60055d49a' },
    { name: 'easytier-cli.exe', path: delivery + '\\easytier-cli.exe', bytes: 6050816, sha256: 'b84fa350b9c8036649df3cdc8ee728c364ea81075d82fd3783cdeede3b9ddccd' },
    { name: 'wintun.dll', path: delivery + '\\wintun.dll', bytes: 427552, sha256: 'e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce' },
    { name: 'WinDivert64.sys', path: delivery + '\\WinDivert64.sys', bytes: 94144, sha256: '8da085332782708d8767bcace5327a6ec7283c17cfb85e40b03cd2323a90ddc2' },
  ],
  buildReceipt: { path: delivery + '\\BUILD-DELIVERY.json', sha256: '2dbb3bb8f67c600fbf48b34e25a8fb3e56a57d58b3bfaa2432eca5ac706c51cf' },
  importAudit: { path: delivery + '\\PE-IMPORT-AUDIT.json', sha256: '7eb78be98d262f56dce1e398ed46924d4362ed2d4b23217f9efa22a78b1174a4' },
  sourceCommit: 'dbaf04531024f4201e73ec0bc5ba6a7a6d8d3b49', sourceTree: 'e58f64a219c204cdaf364fc95466cf03acfb7c21',
  sourcePatchSha256: 'eb30fab089422c82256a8c8db9cb7a15d3c41b8b972a05729f63ebfbac7e8cad',
  cargoLockSha256: 'e3ee41507e7a8ef94470b70f4639140e67aadae646ada82dfd23b0beeb0e7fb2',
  buildProfile: 'windows-default-minus-faketcp-v1',
  features: ['cli','wireguard','websocket','smoltcp','tun','socks5','kcp','quic','magic-dns','zstd','upnp','icmp-proxy','management','endpoint-discovery','extended-services','linux-netlink','tcp-hole-punch'],
  knownDifferences: ['FakeTCP unavailable', 'pnet interface-enumeration fallback unavailable; primary backend failure remains visible', 'Windows broadcast backend retained; no full equivalence claim'],
  licenseFiles: [
    { file: 'licenses/EasyTier-LGPL-3.0.txt', sha256: 'e3a994d82e644b03a792a930f574002658412f62407f5fee083f2555c5f23118' },
    { file: 'licenses/GPL-3.0.txt', sha256: '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986' },
    { file: 'licenses/rust-tun-WTFPL-2.0.txt', sha256: '920b5b5d868a0c56b1ce5696b48a916f6e83caa6fc4ca116a30ee95cce74a2a8' },
    { file: 'licenses/WinDivert-v2.2.2-LICENSE.txt', sha256: '14a0cb5214d536e4fdae6aa3f5696f981eeda106cd026e9794bba489ee79d628' },
    { file: 'licenses/Wintun-0.14.1-LICENSE.txt', sha256: '183adac21e7d96c508c8fd34d394b7b6708bc81564ad1bad61ab66143a008cd2' },
  ],
  notices: { file: 'EASYTIER-NOTICES.md', sha256: '9683fa39ced0539f56bd99bc5ec0cb898ab19acd7b1660850f86a65c3874fbf6' },
  inventory: { file: 'easytier-native-input-inventory.json', sha256: '5634266d1de6d19b527c26ef76443215ea25b1c87dc8164a178f019df83869b2' },
  onlyCoreExecuted: true, cliExecuted: false, winDivertBroadcastRelayEnabled: false, winDivertDriverActivated: false,
  driverSysSha256: '1a7bb3555c5419befb1a5f54267dcae9a7af16749ddf4eef9b431fcf0b863110',
  driverVer: 'DriverVer = 10/13/2021,0.14.0.0',
  protectedGuiPid: 6424, protectedGuid: '4226cc04-7343-4caa-bfd6-55d097487583',
  protectedAddress: '10.126.126.2', protectedPrefix: 24,
  firewallRuleChanges: 0, profileWrites: 0, automaticResidualDeletion: false,
  requiresElevation: true, driverApiInstallationCheck: true,
  localRpcHasWindowsUserAuthentication: false, implicitDriverMaintenanceRiskDisclosed: true, requiresFreshHumanApproval: true,
});
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const SCOPE_SHA256 = sha256(JSON.stringify(SCOPE));
/** Candidate is fixed and statically audited; this is not human approval. */
export const TRIAL_SUSPENDED = false;
export const fail = code => { throw new Error(code); };
const canonGuid = value => String(value).replace(/[{}]/g, '').toLowerCase();

export function validateApproval(args) {
  if (args.length !== 3 || args[0] !== '--execute' || args[1] !== '--approved-scope-sha256' || args[2] !== SCOPE_SHA256) fail('single-trial-approval-required');
  if (TRIAL_SUSPENDED) fail('candidate-awaits-final-build');
}

/** Pure validation of the fixed build owner's metadata; no execution or OS read. */
export function validateBuildEvidence(build, audit) {
  if (build?.schemaVersion !== 2 || build.sourceCommit !== SCOPE.sourceCommit || build.sourceTree !== SCOPE.sourceTree
    || build.sourcePatchSHA256 !== SCOPE.sourcePatchSha256 || build.cargoLockSHA256 !== SCOPE.cargoLockSha256
    || build.buildProfile !== SCOPE.buildProfile || build.noDefaultFeatures !== true || build.toolchain !== '1.95.0'
    || build.target !== 'x86_64-pc-windows-msvc' || build.rustflags !== '-C target-feature=+crt-static'
    || JSON.stringify(build.features) !== JSON.stringify(SCOPE.features) || build.coreOrCliExecuted !== false
    || build.nativeActivation !== false || build.activePnetPackages !== 0 || build.sameFunctionalityAsOfficialClaim !== false
    || build.normalAndDelayImportsBothPassed !== true || build.actualPnetIdentifierScansBothPassed !== true
    || !Array.isArray(build.files) || build.files.length !== SCOPE.payload.length) fail('unreviewed-build-delivery');
  for (const file of SCOPE.payload) {
    const matches = build.files.filter(item => item.name === file.name);
    if (matches.length !== 1 || matches[0].bytes !== file.bytes || matches[0].sha256 !== file.sha256) fail('unreviewed-build-delivery');
  }
  if (audit?.status !== 'passed' || audit.normalAndDelayImportsParsed !== true || audit.dumpbinHeadersImportsDependentsPassed !== true
    || audit.binaryIdentifierScansPassed !== true || audit.coreAndCliExecuted !== false
    || !Array.isArray(audit.coreAndCli) || audit.coreAndCli.length !== 2) fail('unreviewed-import-audit');
  for (const file of SCOPE.payload.filter(item => item.name.endsWith('.exe'))) {
    const matches = audit.coreAndCli.filter(item => item.file === file.path);
    const row = matches[0];
    if (matches.length !== 1 || row.sha256 !== file.sha256 || row.bytes !== file.bytes || row.executed !== false
      || row.machine !== 'AMD64' || row.optionalMagic !== 'PE32+' || !Array.isArray(row.normalImports) || !Array.isArray(row.delayImports)
      || [...row.normalImports, ...row.delayImports].some(name => /packet\.dll|wpcap\.dll|npcap|pnet/i.test(String(name)))
      || !Array.isArray(row.forbiddenImports) || row.forbiddenImports.length !== 0
      || !row.forbiddenIdentifierByteSearch || ['Packet.dll','wpcap.dll','Npcap','pnet_datalink','pnet_sys','pnet_base','pnet_packet']
        .some(name => row.forbiddenIdentifierByteSearch[name]?.asciiMatches !== 0 || row.forbiddenIdentifierByteSearch[name]?.utf16leMatches !== 0)) fail('unreviewed-import-audit');
  }
}

export function verifyTrialPayload(files, buildBytes, auditBytes) {
  if (Object.keys(files).length !== SCOPE.payload.length) fail('unexpected-runtime-payload');
  for (const file of SCOPE.payload) {
    if (!files[file.name] || files[file.name].byteLength !== file.bytes || sha256(files[file.name]) !== file.sha256) fail('approved-binary-hash-mismatch');
  }
  if (sha256(buildBytes) !== SCOPE.buildReceipt.sha256 || sha256(auditBytes) !== SCOPE.importAudit.sha256) fail('approved-build-evidence-mismatch');
  let build, audit;
  try { build = JSON.parse(buildBytes); audit = JSON.parse(auditBytes); } catch { fail('invalid-build-evidence'); }
  validateBuildEvidence(build, audit);
}

export function verifyTrialDocuments(files) {
  for (const doc of [...SCOPE.licenseFiles, SCOPE.notices, SCOPE.inventory]) {
    if (!files[doc.file] || sha256(files[doc.file]) !== doc.sha256) fail('approved-notices-hash-mismatch');
  }
}

/** No peers, credentials or community binding. Called only after the execution gate. */
export function buildIsolatedConfig(instanceId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(instanceId)) fail('invalid-instance-id');
  return `instance_id = "${instanceId}"\ninstance_name = "owned-nic-trial"\nhostname = "owned-nic-trial"\nipv4 = "10.253.253.1/30"\ndhcp = false\nlisteners = []\npeer = []\nmapped_listeners = []\nexit_nodes = []\nroutes = []\nproxy_network = []\nport_forward = []\nstun_servers = []\ntcp_stun_servers = []\nstun_servers_v6 = []\nipv6_public_addr_provider = false\nipv6_public_addr_auto = false\n\n[flags]\ndev_name = "lk_trial_20261011_a"\nenable_ipv6 = false\ndisable_upnp = true\ndisable_p2p = true\ndisable_tcp_hole_punching = true\ndisable_udp_hole_punching = true\nenable_udp_broadcast_relay = false\naccept_dns = false\nenable_exit_node = false\nproxy_forward_by_system = false\nno_tun = false\nprivate_mode = true\ndisable_relay_data = true\nrelay_network_whitelist = ""\n`;
}

export function validateBefore(s) {
  if (!s?.complete || !s.administrator || !s.guiAlive || s.driverCount !== 1 || s.driverVer !== SCOPE.driverVer || s.driverSysSha256 !== SCOPE.driverSysSha256 || !s.driverRunning) fail('baseline-or-driver-unavailable');
  const old = s.adapters.find(n => canonGuid(n.guid) === SCOPE.protectedGuid);
  if (!old || old.status !== 'Up' || !old.addresses.some(a => a.ip === SCOPE.protectedAddress && a.prefix === SCOPE.protectedPrefix)) fail('old-private-network-not-ready');
  if (s.aliasConflict || s.addressOrRouteConflict || s.portalOwnerPids.length) fail('trial-scope-conflict');
  if (!s.guiFingerprint || s.ownedForbiddenSocketCount !== 0 || !Array.isArray(s.categories) || !s.firewallSha256 || !s.default4Sha256 || !s.default6Sha256) fail('baseline-incomplete');
}

export function validateDuring(before, now, owned) {
  if (!now?.complete || !now.guiAlive || !now.driverRunning || now.driverVer !== before.driverVer || now.driverSysSha256 !== before.driverSysSha256 || now.driverCount !== before.driverCount) fail('old-network-or-driver-changed');
  if (now.firewallSha256 !== before.firewallSha256 || now.default4Sha256 !== before.default4Sha256 || now.default6Sha256 !== before.default6Sha256) fail('global-network-policy-changed');
  if (now.guiFingerprint !== before.guiFingerprint || now.ownedForbiddenSocketCount !== 0) fail('foreign-network-socket-or-gui-identity-changed');
  for (const profile of before.categories) if (!now.categories.some(p => p.id === profile.id && p.category === profile.category)) fail('existing-network-category-changed');
  for (const old of before.adapters) {
    const current = now.adapters.find(n => canonGuid(n.guid) === canonGuid(old.guid));
    if (!current || current.fingerprint !== old.fingerprint) fail('existing-interface-changed');
  }
  const added = now.adapters.filter(n => !before.adapters.some(old => canonGuid(n.guid) === canonGuid(old.guid)));
  if (added.length > 1) fail('unexpected-extra-interface');
  if (owned && (owned.interfaces.length > 1 || !owned.pid)) fail('invalid-owned-receipt');
  if (!added.length) {
    if (now.portalOwnerPids.some(pid => pid !== owned?.pid)) fail('foreign-rpc-listener');
    return false;
  }
  const n = added[0];
  if (n.alias !== SCOPE.alias || n.addresses.some(a => a.family === 4 && (a.ip !== SCOPE.virtualAddress || a.prefix !== SCOPE.prefix)) || n.hasDefault || !n.safeTrialRoutes) fail('unexpected-trial-address-or-route');
  const receipt = owned?.interfaces?.[0];
  if (!receipt) return false; // Startup may emit the receipt after the OS creates the adapter.
  if (canonGuid(receipt.guid) !== canonGuid(n.guid) || receipt.ifIndex !== n.ifIndex || receipt.luid !== n.luid) fail('receipt-os-identity-mismatch');
  if (now.portalOwnerPids.some(pid => pid !== owned.pid)) fail('foreign-rpc-listener');
  return n.status === 'Up' && n.addresses.some(a => a.family === 4 && a.ip === SCOPE.virtualAddress && a.prefix === SCOPE.prefix) && now.portalOwnerPids.includes(owned.pid);
}

export function validateAfter(before, now, reports) {
  validateDuring(before, now, null);
  if (now.adapters.some(n => !before.adapters.some(old => canonGuid(old.guid) === canonGuid(n.guid))) || now.portalOwnerPids.length) fail('owned-residual-present');
  if (reports.length !== 1 || reports[0].outcome !== 'graceful') fail('owned-stop-unconfirmed');
}

/** All effects injected. Deadline signals owned shutdown even when startup or a read stalls. */
export async function runBoundedTrial(p) {
  const before = await p.snapshot();
  validateBefore(before);
  await p.prepare();
  const prepared = await p.snapshot();
  validateBefore(prepared); validateDuring(before, prepared, null);
  let reason = null, stopped = false, ready = false, failure = null, core;
  let signalStop;
  const stopEvent = new Promise(resolve => { signalStop = resolve; });
  const stop = code => {
    if (stopped) return;
    stopped = true; reason = code;
    p.processes.shutdownOwned();
    signalStop();
    p.cancelReads?.();
  };
  const timer = p.setTimer(() => stop('deadline'), SCOPE.maximumRunMs);
  const detach = p.onCancel(() => stop('operator-stop'));
  async function untilStop(operation) {
    const result = await Promise.race([Promise.resolve(operation).then(value => ({ value })), stopEvent.then(() => ({ stopped: true }))]);
    if (result.stopped) return undefined;
    return result.value;
  }
  try {
    core = await untilStop(p.start());
    if (core && !stopped) {
      while (!stopped) {
        const now = await untilStop(p.snapshot());
        if (!now || stopped) break;
        if (!core.isAlive()) fail('owned-core-exited');
        const valid = validateDuring(before, now, core.ownedResources());
        ready ||= valid;
        await untilStop(p.pause(1500));
      }
    }
  } catch (error) { if (!stopped) { failure = String(error.message); stop('failure'); } }
  finally {
    if (!stopped) stop('failure');
    p.clearTimer(timer); detach();
    try { await p.processes.drainOwned(); } catch { failure ||= 'owned-cleanup-failed'; }
  }
  const reports = p.processes.cleanupReports();
  let after, residual = true, observationExpired = false, endObservation;
  const observationEnd = new Promise(resolve => { endObservation = resolve; });
  const observationTimer = p.setTimer(() => { observationExpired = true; endObservation(); }, SCOPE.residualObservationMs);
  while (!observationExpired) {
    try {
      const sample = await Promise.race([p.snapshot().then(value => ({ value })), observationEnd.then(() => ({ expired: true }))]);
      if (sample.expired) break;
      after = sample.value; validateAfter(before, after, reports); residual = false; break;
    }
    catch (error) {
      const code = String(error.message);
      if (code !== 'owned-residual-present') { failure ||= code; break; }
      await Promise.race([p.pause(1000), observationEnd]);
    }
  }
  p.clearTimer(observationTimer);
  p.cancelReads?.();
  if (residual) failure ||= 'owned-residual-or-observation-unavailable';
  if (!ready) failure ||= 'owned-nic-never-ready';
  if (reason !== 'deadline') failure ||= reason;
  return { schema: 1, outcome: failure ? 'failed' : 'passed', reason, failure,
    scopeSha256: SCOPE_SHA256, ready, before, after: after ?? null, reports,
    realCommunityJoinVerified: false, deletedOsResources: false };
}
